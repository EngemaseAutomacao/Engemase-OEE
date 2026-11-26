// Package localapi é a API local do agente para a página local (oee-localui), no
// socket /run/oee-gateway/ui.sock (oee-gateway-ui.socket, ativação pelo systemd).
// Só leitura: uma rota, GET /v1/status, com o retrato que a página mostra (conexões,
// últimas leituras, fila e nuvem). Quem conecta é conferido pelo SO_PEERCRED: o
// grupo da página (oee-ui), o próprio usuário do agente ou root. Nada aqui lê o
// buffer item a item, a credencial ou a config inteira.
package localapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/peercred"
)

// Status é o retrato do agente para a página local.
type Status struct {
	GeneratedAt time.Time `json:"generated_at"`
	Agent       Agent     `json:"agent"`
	Cloud       Cloud     `json:"cloud"`
	Queue       Queue     `json:"queue"`
	Devices     []Device  `json:"devices"`
	Machines    []Machine `json:"machines"`
}

// Agent é a parte do agente.
type Agent struct {
	Version       string    `json:"version"`
	Commit        string    `json:"commit,omitempty"`
	StartedAt     time.Time `json:"started_at"`
	ConfigVersion int       `json:"config_version"`
	ConfigState   string    `json:"config_state,omitempty"`
	ConfigError   string    `json:"config_error,omitempty"`
}

// Cloud é a conectividade com a nuvem.
type Cloud struct {
	URL           string     `json:"url"`
	Registered    bool       `json:"registered"`
	Blocked       bool       `json:"blocked"` // 401: token recusado
	LastOKAt      *time.Time `json:"last_ok_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	LastErrorKind string     `json:"last_error_kind,omitempty"` // classe (dns, tls, proxy, ...)
	ClockOffsetMS int64      `json:"clock_offset_ms"`
}

// Queue é a fila pendente (outbox).
type Queue struct {
	Pending     int64  `json:"pending"`
	Quarantined int64  `json:"quarantined"`
	OldestS     *int64 `json:"oldest_s,omitempty"`
	Error       string `json:"error,omitempty"`
}

// Device é o estado da conexão com um CLP.
type Device struct {
	ID        string `json:"id"`
	Name      string `json:"name,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
	Status    string `json:"status"` // connected | degraded | disconnected | disabled
	LatencyMS *int64 `json:"latency_ms,omitempty"`
	Errors1m  int64  `json:"errors_1m"`
	LastOKAt  string `json:"last_ok_at,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

// Machine é a última leitura de uma máquina.
type Machine struct {
	ID           string `json:"id"`
	Name         string `json:"name,omitempty"`
	At           string `json:"at,omitempty"`
	State        string `json:"state,omitempty"`
	StateSince   string `json:"state_since,omitempty"`
	FaultCode    *int64 `json:"fault_code,omitempty"`
	CounterTotal *int64 `json:"counter_total,omitempty"`
	Product      string `json:"product,omitempty"`
}

// Server atende a API no socket.
type Server struct {
	// Status monta o retrato (chamado a cada pedido).
	Status func(ctx context.Context) Status
	// AllowUIDs e AllowGIDs: quem pode conectar além de root.
	AllowUIDs []uint32
	AllowGIDs []uint32
	Log       *slog.Logger
	// peer identifica o chamador (padrão: SO_PEERCRED; trocado nos testes).
	peer func(net.Conn) (peercred.Peer, error)
}

type peerKey struct{}

// Serve atende até o contexto acabar.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	if s.Log == nil {
		s.Log = slog.Default()
	}
	if s.peer == nil {
		s.peer = peercred.Of
	}
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
		ConnContext: func(ctx context.Context, c net.Conn) context.Context {
			p, err := s.peer(c)
			if err != nil {
				return ctx
			}
			return context.WithValue(ctx, peerKey{}, p)
		},
		ErrorLog: slog.NewLogLogger(s.Log.Handler(), slog.LevelWarn),
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	err := srv.Serve(l)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) allowed(p peercred.Peer) bool {
	if p.Root {
		return true
	}
	for _, u := range s.AllowUIDs {
		if p.UID == u {
			return true
		}
	}
	for _, g := range s.AllowGIDs {
		if p.GID == g {
			return true
		}
	}
	return false
}

// Handler é a única rota.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := r.Context().Value(peerKey{}).(peercred.Peer)
		if !ok || !s.allowed(p) {
			s.Log.Warn("API local: chamador recusado", "uid", p.UID, "gid", p.GID, "pid", p.PID)
			http.Error(w, "chamador sem permissão", http.StatusForbidden)
			return
		}
		if r.URL.Path != "/v1/status" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
			return
		}
		st := s.Status(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(st)
	})
}

// Client fala com a API pelo socket.
type Client struct {
	hc *http.Client
}

// DefaultSocket é o caminho do ui.sock.
const DefaultSocket = "/run/oee-gateway/ui.sock"

// NewClient cria o cliente do socket.
func NewClient(socket string) *Client {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socket)
		},
		MaxIdleConns:    2,
		IdleConnTimeout: 30 * time.Second,
	}
	return &Client{hc: &http.Client{Transport: tr, Timeout: 5 * time.Second}}
}

// Status busca o retrato.
func (c *Client) Status(ctx context.Context) (*Status, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://agente/v1/status", nil)
	if err != nil {
		return nil, err
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("agente respondeu %d", res.StatusCode)
	}
	var st Status
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&st); err != nil {
		return nil, err
	}
	return &st, nil
}
