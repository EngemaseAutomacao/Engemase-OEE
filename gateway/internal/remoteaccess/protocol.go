package remoteaccess

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/peercred"
)

// DefaultSocket é o socket do oee-remote-access (só o grupo do agente e root).
const DefaultSocket = "/run/oee-gateway/remote-access.sock"

// Operações do protocolo (uma linha JSON por pedido e por resposta).
const (
	OpEnable  = "enable"
	OpDisable = "disable"
	OpStatus  = "status"
	OpEvents  = "events" // devolve e esvazia os eventos pendentes
)

const (
	maxRequestBytes = 16 << 10
	requestTimeout  = 2 * time.Minute
)

type request struct {
	Op     string          `json:"op"`
	Params json.RawMessage `json:"params,omitempty"`
}

type response struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

// DisableParams do pedido disable.
type DisableParams struct {
	SessionID string `json:"session_id,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// Server atende o agente. Quem não for root nem do grupo do agente é recusado.
type Server struct {
	Manager  *Manager
	AgentGID uint32
	// IdleExit faz Serve terminar depois desse tempo sem sessão e sem pedidos (0 = nunca): o systemd
	// religa pelo socket no próximo pedido. Assim a biblioteca da VPN só fica na memória quando usada.
	IdleExit time.Duration
	Log      *slog.Logger
	lastSeen atomic.Int64
	// peer identifica o chamador (padrão: SO_PEERCRED; trocado nos testes).
	peer func(net.Conn) (peercred.Peer, error)
}

// Serve atende até o contexto acabar; a cada segundo aplica prazo, inatividade e kill switch.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	if s.Log == nil {
		s.Log = slog.Default()
	}
	if s.peer == nil {
		s.peer = peercred.Of
	}
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	s.lastSeen.Store(time.Now().UnixNano())
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.Manager.Check()
				if s.IdleExit > 0 && s.Manager.Status().State == "off" && time.Since(time.Unix(0, s.lastSeen.Load())) > s.IdleExit {
					s.Log.Info("sem sessão nem pedidos: saindo (o systemd religa pelo socket)")
					stop()
					return
				}
			}
		}
	}()
	go func() {
		<-ctx.Done()
		_ = l.Close()
	}()
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		c, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				s.Manager.Shutdown()
				return nil
			}
			return err
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.handle(ctx, c)
		}()
	}
}

func (s *Server) handle(ctx context.Context, c net.Conn) {
	defer c.Close()
	s.lastSeen.Store(time.Now().UnixNano())
	_ = c.SetDeadline(time.Now().Add(requestTimeout))
	p, err := s.peer(c)
	if err != nil || (!p.Root && p.UID != 0 && p.GID != s.AgentGID) {
		s.Log.Warn("pedido recusado: chamador sem permissão", "erro", err, "uid", p.UID)
		writeResponse(c, response{Error: &Error{Code: "forbidden", Message: "sem permissão"}})
		return
	}
	line, err := bufio.NewReader(&limited{c, maxRequestBytes}).ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return
	}
	var req request
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeResponse(c, response{Error: &Error{Code: CodeInvalidPayload, Message: "pedido ilegível"}})
		return
	}
	result, err := s.dispatch(ctx, req)
	if err != nil {
		var e *Error
		if !errors.As(err, &e) {
			e = &Error{Code: CodeVpnFailed, Message: err.Error()}
		}
		writeResponse(c, response{Error: e})
		return
	}
	b, _ := json.Marshal(result)
	writeResponse(c, response{OK: true, Result: b})
}

func (s *Server) dispatch(ctx context.Context, req request) (any, error) {
	switch req.Op {
	case OpEnable:
		var r EnableRequest
		if err := strictJSON(req.Params, &r); err != nil {
			return nil, fail(CodeInvalidPayload, "parâmetros de enable inválidos")
		}
		return s.Manager.Enable(ctx, r)
	case OpDisable:
		var p DisableParams
		if err := strictJSON(req.Params, &p); err != nil {
			return nil, fail(CodeInvalidPayload, "parâmetros de disable inválidos")
		}
		return s.Manager.Disable(p.SessionID, p.Reason)
	case OpStatus:
		return s.Manager.Status(), nil
	case OpEvents:
		return s.Manager.Drain(), nil
	default:
		return nil, fail(CodeInvalidPayload, "operação desconhecida")
	}
}

func strictJSON(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeResponse(c net.Conn, r response) {
	b, _ := json.Marshal(r)
	_, _ = c.Write(append(b, '\n'))
}

type limited struct {
	c net.Conn
	n int
}

func (l *limited) Read(p []byte) (int, error) {
	if l.n <= 0 {
		return 0, errors.New("pedido grande demais")
	}
	if len(p) > l.n {
		p = p[:l.n]
	}
	n, err := l.c.Read(p)
	l.n -= n
	return n, err
}

// Client é o lado do agente.
type Client struct {
	Socket string
	// Dial abre a conexão (padrão: unix no Socket).
	Dial func(ctx context.Context) (net.Conn, error)
}

func (c *Client) call(ctx context.Context, op string, params, out any) error {
	dial := c.Dial
	if dial == nil {
		sock := c.Socket
		if sock == "" {
			sock = DefaultSocket
		}
		dial = func(ctx context.Context) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		}
	}
	conn, err := dial(ctx)
	if err != nil {
		return fail(CodeVpnFailed, "serviço de acesso remoto indisponível: %v", err)
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	var raw json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return err
		}
		raw = b
	}
	b, _ := json.Marshal(request{Op: op, Params: raw})
	if _, err := conn.Write(append(b, '\n')); err != nil {
		return fail(CodeVpnFailed, "falha ao falar com o serviço de acesso remoto: %v", err)
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return fail(CodeVpnFailed, "o serviço de acesso remoto não respondeu: %v", err)
	}
	var resp response
	if err := json.Unmarshal(line, &resp); err != nil {
		return fail(CodeVpnFailed, "resposta ilegível do serviço de acesso remoto")
	}
	if !resp.OK {
		if resp.Error != nil {
			return resp.Error
		}
		return fail(CodeVpnFailed, "falha sem detalhe")
	}
	if out != nil {
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return fmt.Errorf("resultado ilegível: %w", err)
		}
	}
	return nil
}

// Enable pede para ligar.
func (c *Client) Enable(ctx context.Context, r EnableRequest) (EnableResult, error) {
	var out EnableResult
	return out, c.call(ctx, OpEnable, r, &out)
}

// Disable pede para desligar.
func (c *Client) Disable(ctx context.Context, sessionID, reason string) (Summary, error) {
	var out Summary
	return out, c.call(ctx, OpDisable, DisableParams{SessionID: sessionID, Reason: reason}, &out)
}

// Status lê o estado.
func (c *Client) Status(ctx context.Context) (Status, error) {
	var out Status
	return out, c.call(ctx, OpStatus, nil, &out)
}

// Events busca (e esvazia) os eventos pendentes.
func (c *Client) Events(ctx context.Context) ([]Event, error) {
	var out []Event
	return out, c.call(ctx, OpEvents, nil, &out)
}
