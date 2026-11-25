// Package localui é o oee-localui (docs/16 §6, D30): a página local reduzida de
// comissionamento, processo separado do agente (usuário oee-ui, sem rede própria),
// que recebe do systemd a porta 443 só na interface OT (oee-localui.socket) e fala
// com o agente só por /run/oee-gateway/ui.sock (internal/localapi, só leitura).
//
// Proteções da fronteira: HTTPS com chave ECDSA P-256 estável (a do factory init,
// tls.crt/tls.key, ou gerada no primeiro start), recusa de endereço local fora da
// OT/serviço/loopback, recusa de Host que não seja IP (DNS rebinding), só GET/HEAD e
// o POST do login/saída com Origin conferido, cabeçalhos de segurança e CSP sem
// script. Login só com a senha local do cartão lacrado (argon2id), com bloqueio por
// tentativas (auth.go). Telas do MVP: status das conexões com os CLPs, últimas
// leituras, fila pendente e conectividade com a nuvem, em português e só leitura.
package localui

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
)

// DefaultStateDir é o estado da página (StateDirectory=oee-localui): senha, bloqueio
// e chave TLS.
const DefaultStateDir = "/var/lib/oee-localui"

// DefaultTLSDir é onde fica a chave gerada pela própria página (sem a do factory init).
const DefaultTLSDir = DefaultStateDir + "/tls"

// StatusSource é de onde vem o retrato do agente (localapi.Client no gateway).
type StatusSource interface {
	Status(ctx context.Context) (*localapi.Status, error)
}

// Server é a página local.
type Server struct {
	// StateDir guarda a senha (password.argon2id), o bloqueio (lock.json) e, se o
	// factory init gerou, tls.crt/tls.key.
	StateDir string
	// TLSDir guarda key.pem e cert.pem gerados pela página (sem os do factory init).
	TLSDir string
	Agent  StatusSource
	Log    *slog.Logger
	Now    func() time.Time

	once     sync.Once
	sess     *sessions
	lim      *limiter
	verifyMu sync.Mutex // um argon2id por vez: memória limitada e força bruta mais lenta
}

func (s *Server) init() {
	s.once.Do(func() {
		if s.Log == nil {
			s.Log = slog.Default()
		}
		if s.Now == nil {
			s.Now = time.Now
		}
		s.sess = newSessions()
		s.lim = newLimiter(s.StateDir)
	})
}

// Serve atende HTTPS no listener até o contexto acabar.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	s.init()
	cert, err := LoadServerCert(s.StateDir, s.TLSDir)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           s.Handler(),
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}},
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(s.Log.Handler(), slog.LevelWarn),
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	err = srv.Serve(tls.NewListener(l, srv.TLSConfig))
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Handler monta as rotas com as proteções da fronteira.
func (s *Server) Handler() http.Handler {
	s.init()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /{$}", s.status)
	mux.HandleFunc("GET /entrar", s.loginPage)
	mux.HandleFunc("POST /entrar", s.login)
	mux.HandleFunc("POST /sair", s.logout)
	return guard(mux)
}

// guard aplica as proteções da fronteira antes de qualquer rota.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		h.Set("Strict-Transport-Security", "max-age=31536000")
		if la, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok && !allowedLocal(la) {
			http.Error(w, "endereço fora da rede OT", http.StatusForbidden)
			return
		}
		if !allowedHost(r.Host) {
			http.Error(w, "use o endereço IP do gateway", http.StatusMisdirectedRequest)
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodHead:
		case http.MethodPost:
			// CSRF: o POST só vale vindo da própria página (o navegador manda o Origin).
			if r.Header.Get("Origin") != "https://"+r.Host {
				http.Error(w, "origem do formulário recusada", http.StatusForbidden)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
		default:
			http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// allowedLocal: só o endereço da OT (faixas privadas), o de serviço (169.254) e
// loopback. O socket já fica só na interface OT; isto é a segunda barreira.
func allowedLocal(a net.Addr) bool {
	var ip net.IP
	switch v := a.(type) {
	case *net.TCPAddr:
		ip = v.IP
	default:
		host, _, err := net.SplitHostPort(a.String())
		if err != nil {
			return false
		}
		ip = net.ParseIP(host)
	}
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsPrivate()
}

// allowedHost: o Host tem de ser um IP literal (com ou sem porta) ou localhost: um
// nome resolvido por DNS de fora pode apontar para o gateway (DNS rebinding).
func allowedHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if host == "localhost" {
		return true
	}
	if len(host) > 2 && host[0] == '[' && host[len(host)-1] == ']' {
		host = host[1 : len(host)-1]
	}
	return net.ParseIP(host) != nil
}

// LoadServerCert usa a chave do factory init (stateDir/tls.crt e tls.key, cuja
// impressão digital vai no cartão lacrado) ou, sem ela, a da própria página
// (LoadOrCreateCert em tlsDir).
func LoadServerCert(stateDir, tlsDir string) (tls.Certificate, error) {
	if stateDir != "" {
		crt, key := filepath.Join(stateDir, "tls.crt"), filepath.Join(stateDir, "tls.key")
		if _, err := os.Stat(key); err == nil {
			c, err := tls.LoadX509KeyPair(crt, key)
			if err != nil {
				return tls.Certificate{}, fmt.Errorf("localui: chave TLS do factory init ilegível: %w", err)
			}
			return c, nil
		} else if !errors.Is(err, fs.ErrNotExist) {
			return tls.Certificate{}, err
		}
	}
	return LoadOrCreateCert(tlsDir)
}

// LoadOrCreateCert lê a chave e o certificado de dir ou, no primeiro start, gera uma
// chave ECDSA P-256 e um certificado autoassinado (10 anos). A chave é estável:
// sobrevive a atualizações e a troca de IP, e só o reset de fábrica a apaga.
func LoadOrCreateCert(dir string) (tls.Certificate, error) {
	keyPath, certPath := filepath.Join(dir, "key.pem"), filepath.Join(dir, "cert.pem")
	if c, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		return c, nil
	} else if _, statErr := os.Stat(keyPath); statErr == nil {
		return tls.Certificate{}, fmt.Errorf("localui: chave TLS existente ilegível (não é regerada): %w", err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return tls.Certificate{}, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return tls.Certificate{}, err
	}
	host, _ := os.Hostname()
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Gateway OEE " + host, Organization: []string{"Engemase"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	kb, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := writeExclusive(keyPath, keyPEM); err != nil {
		return tls.Certificate{}, err
	}
	if err := writeExclusive(certPath, certPEM); err != nil {
		return tls.Certificate{}, err
	}
	return tls.X509KeyPair(certPEM, keyPEM)
}

// writeExclusive grava um arquivo novo 0600 (via temporário + rename).
func writeExclusive(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
