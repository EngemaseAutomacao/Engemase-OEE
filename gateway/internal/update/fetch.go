package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Arquivos do diretório de troca entre o agente (oee) e o updater (root):
// /var/lib/oee-gateway/update. Nomes fixos: nenhum caminho vem do pedido.
const (
	RequestFile   = "request.json"      // pedido do agente (dispara o .path)
	ManifestFile  = "manifest.json"     // manifesto, bytes exatos assinados
	SignatureFile = "manifest.json.sig" // assinatura Ed25519 (base64)
	PackageFile   = "package.deb"       // pacote baixado
	HealthFile    = "health.json"       // saúde do agente novo (1º /sync aceito)
	ResultFile    = "result.json"       // resultado do updater
)

// DefaultUpdateDir é o diretório de troca (dentro do estado do agente).
const DefaultUpdateDir = "/var/lib/oee-gateway/update"

// Request é o pedido do agente ao updater.
type Request struct {
	ID          string    `json:"id"`
	Version     string    `json:"version"`
	RequestedAt time.Time `json:"requested_at"`
}

// Health é o que o agente novo grava depois do primeiro /sync aceito.
type Health struct {
	Version string    `json:"version"`
	At      time.Time `json:"at"`
}

// Result é o resultado final de uma atualização (update/result.json).
type Result struct {
	ID       string    `json:"id,omitempty"`
	Status   string    `json:"status"` // applied | unchanged | rejected | rolled_back | rollback_refused | rollback_failed
	Version  string    `json:"version,omitempty"`
	Previous string    `json:"previous,omitempty"`
	Reason   string    `json:"reason,omitempty"`
	Message  string    `json:"message,omitempty"`
	At       time.Time `json:"at"`
}

// GoArch é a arquitetura do manifesto para o GOARCH deste binário.
func GoArch() string {
	switch runtime.GOARCH {
	case "arm":
		return "armhf"
	default:
		return runtime.GOARCH
	}
}

// FetchOptions configura a busca do pacote pelo agente.
type FetchOptions struct {
	ManifestURL string // https://.../oee-gateway_<versão>_<arq>.manifest.json
	Dir         string // DefaultUpdateDir
	Keys        []ed25519.PublicKey
	Client      *http.Client // nil = NewHTTPClient("")
	RequestID   string
	Now         func() time.Time
	// AllowHTTP aceita http:// (só testes).
	AllowHTTP bool
}

// ErrBusy: já há um pedido de atualização em andamento.
var ErrBusy = errors.New("já há uma atualização pedida (request.json existe)")

// NewHTTPClient é o cliente da busca: proxy do ambiente (proxy.env), CAs do
// sistema mais as corporativas (extraCA), TLS 1.2+ e redirecionamento só para https.
func NewHTTPClient(extraCA string) (*http.Client, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if extraCA != "" {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		pem, err := os.ReadFile(extraCA)
		if err != nil {
			return nil, err
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("nenhum certificado válido em %s", extraCA)
		}
		tlsCfg.RootCAs = pool
	}
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: tlsCfg,
		TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 60 * time.Second, ForceAttemptHTTP2: true}
	return &http.Client{Transport: tr, Timeout: 15 * time.Minute, CheckRedirect: httpsOnlyRedirect}, nil
}

func httpsOnlyRedirect(r *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("redirecionamentos demais")
	}
	if r.URL.Scheme != "https" {
		return fmt.Errorf("redirecionamento para %s recusado (só https)", r.URL.Redacted())
	}
	return nil
}

// Fetch baixa o manifesto e a assinatura, confere a assinatura, baixa o pacote
// conferindo tamanho e SHA-256 e, só então, grava o request.json (que dispara o
// oee-updater pelo .path). O updater confere tudo de novo: esta conferência só evita
// pedir uma atualização que ele recusaria.
func Fetch(ctx context.Context, o FetchOptions) (*Manifest, error) {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Client == nil {
		c, err := NewHTTPClient("")
		if err != nil {
			return nil, err
		}
		o.Client = c
	}
	base, err := o.checkURL(o.ManifestURL)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(filepath.Join(o.Dir, RequestFile)); err == nil {
		return nil, ErrBusy
	}
	mb, err := o.get(ctx, base.String(), MaxManifestSize)
	if err != nil {
		return nil, fmt.Errorf("manifesto: %w", err)
	}
	sb, err := o.get(ctx, base.String()+".sig", maxSigFile)
	if err != nil {
		return nil, fmt.Errorf("assinatura: %w", err)
	}
	if err := VerifyManifest(o.Keys, mb, sb); err != nil {
		return nil, err
	}
	m, err := ParseManifest(mb)
	if err != nil {
		return nil, err
	}
	if m.Arch != GoArch() {
		return nil, fmt.Errorf("pacote para %s, este gateway é %s", m.Arch, GoArch())
	}
	if m.URL == "" {
		return nil, errors.New("manifesto sem url do pacote")
	}
	ref, err := url.Parse(m.URL)
	if err != nil {
		return nil, fmt.Errorf("url do pacote inválida: %w", err)
	}
	pkgURL, err := o.checkURL(base.ResolveReference(ref).String())
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(o.Dir, 0o750); err != nil {
		return nil, err
	}
	// Restos de uma busca anterior (sem pedido) não valem.
	for _, n := range []string{PackageFile, ManifestFile, SignatureFile, HealthFile} {
		_ = os.Remove(filepath.Join(o.Dir, n))
	}
	if err := o.download(ctx, pkgURL.String(), m); err != nil {
		return nil, fmt.Errorf("pacote: %w", err)
	}
	if err := writeAtomic(filepath.Join(o.Dir, ManifestFile), mb, 0o640); err != nil {
		return nil, err
	}
	if err := writeAtomic(filepath.Join(o.Dir, SignatureFile), sb, 0o640); err != nil {
		return nil, err
	}
	req := Request{ID: o.RequestID, Version: m.Version, RequestedAt: o.Now().UTC()}
	if err := writeJSON(filepath.Join(o.Dir, RequestFile), req, 0o640); err != nil {
		return nil, err
	}
	return m, nil
}

func (o FetchOptions) checkURL(s string) (*url.URL, error) {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("endereço inválido: %q", s)
	}
	if u.Scheme != "https" && !(o.AllowHTTP && u.Scheme == "http") {
		return nil, fmt.Errorf("só https: %s", u.Redacted())
	}
	if u.User != nil {
		return nil, errors.New("endereço com usuário/senha recusado")
	}
	return u, nil
}

func (o FetchOptions) get(ctx context.Context, u string, max int64) ([]byte, error) {
	res, err := o.do(ctx, u)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, fmt.Errorf("resposta maior que %d bytes", max)
	}
	return b, nil
}

func (o FetchOptions) do(ctx context.Context, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "oee-gateway-update/"+runtime.GOARCH)
	res, err := o.Client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("HTTP %d em %s", res.StatusCode, req.URL.Redacted())
	}
	return res, nil
}

func (o FetchOptions) download(ctx context.Context, u string, m *Manifest) error {
	res, err := o.do(ctx, u)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	tmp, err := os.CreateTemp(o.Dir, ".package.*.part")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(res.Body, m.Size+1))
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if n != m.Size {
		return fmt.Errorf("tamanho %d, manifesto diz %d", n, m.Size)
	}
	if sum := hex.EncodeToString(h.Sum(nil)); sum != m.SHA256 {
		return errors.New("SHA-256 do pacote não confere com o manifesto")
	}
	if err := os.Chmod(tmp.Name(), 0o640); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(o.Dir, PackageFile))
}

// WriteHealth grava a saúde do agente (update/health.json), só se houver uma
// atualização pedida: o updater espera por ela para não voltar o pacote.
func WriteHealth(dir, version string, at time.Time) (bool, error) {
	if _, err := os.Lstat(filepath.Join(dir, RequestFile)); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, writeJSON(filepath.Join(dir, HealthFile), Health{Version: version, At: at.UTC()}, 0o640)
}
