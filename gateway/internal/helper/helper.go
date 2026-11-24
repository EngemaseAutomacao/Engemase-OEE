// Package helper é o esqueleto do oee-helper (docs/16 §3): o único processo root,
// ativado pelo oee-helper.socket (/run/oee-gateway/helper.sock), com operações
// FECHADAS. Cada conexão leva um pedido JSON numa linha e recebe uma resposta JSON
// numa linha. O chamador é identificado pelo SO_PEERCRED: root (CLI pelo sudo
// restrito do técnico) ou o grupo do agente (oee), cada um com a sua lista de
// operações.
//
// Neste esqueleto só "ping" está implementada; as outras operações do contrato da
// unit (aplicar rede com checkpoint, ajustar relógio, reset de fábrica, ler o
// pendrive de diagnóstico) respondem not_implemented, já com a autorização e a
// validação no lugar.
package helper

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
)

// Operações fechadas do ajudante.
const (
	OpPing            = "ping"
	OpNetworkApply    = "network.apply"    // aplica network.json com checkpoint do NetworkManager
	OpNetworkConfirm  = "network.confirm"  // confirma a rede nova (senão volta em 120 s)
	OpNetworkRollback = "network.rollback" // volta à última rede boa
	OpClockSet        = "clock.set"        // acerta o relógio (sem NTP)
	OpFactoryReset    = "factory.reset"    // reset de fábrica
	OpUSBRead         = "usb.read"         // lê OEE/net-reset do pendrive de serviço
)

// Quem pode o quê. O agente (grupo oee) só o que ele precisa em operação; reset de
// fábrica só root (técnico com sudo, no local).
var (
	agentOps = map[string]bool{OpPing: true, OpNetworkApply: true, OpNetworkConfirm: true, OpNetworkRollback: true, OpClockSet: true, OpUSBRead: true}
	rootOps  = map[string]bool{OpPing: true, OpNetworkApply: true, OpNetworkConfirm: true, OpNetworkRollback: true, OpClockSet: true, OpFactoryReset: true, OpUSBRead: true}
)

// Códigos de erro da resposta.
const (
	ErrBadRequest     = "bad_request"
	ErrUnknownOp      = "unknown_op"
	ErrForbidden      = "forbidden"
	ErrNotImplemented = "not_implemented"
)

// Limites de um pedido.
const (
	maxRequestBytes = 64 << 10
	requestTimeout  = 10 * time.Second
)

// Request é o pedido (uma linha JSON).
type Request struct {
	Op     string          `json:"op"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Response é a resposta (uma linha JSON).
type Response struct {
	OK     bool       `json:"ok"`
	Result any        `json:"result,omitempty"`
	Error  *ErrorBody `json:"error,omitempty"`
}

// ErrorBody é o erro da resposta.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Peer é quem chamou (SO_PEERCRED).
type Peer struct {
	PID  int32
	UID  uint32
	GID  uint32
	Root bool
}

// Server atende os pedidos.
type Server struct {
	// AgentGID é o grupo do agente (oee); quem não é root nem desse grupo é recusado.
	AgentGID uint32
	// IdleExit faz Serve terminar depois desse tempo sem conexão (0 = nunca): o
	// systemd reativa pelo socket.
	IdleExit time.Duration
	Log      *slog.Logger
	// peer identifica o chamador (padrão: SO_PEERCRED; trocado nos testes).
	peer func(net.Conn) (Peer, error)
}

// Serve atende até o contexto acabar ou o ajudante ficar ocioso por IdleExit.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	if s.Log == nil {
		s.Log = slog.Default()
	}
	if s.peer == nil {
		s.peer = peerCred
	}
	conns := make(chan net.Conn)
	errc := make(chan error, 1)
	stop := make(chan struct{})
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				errc <- err
				return
			}
			select {
			case conns <- c:
			case <-stop:
				_ = c.Close()
				return
			}
		}
	}()
	var wg sync.WaitGroup
	defer wg.Wait()
	defer l.Close()
	defer close(stop)
	var idle <-chan time.Time
	var timer *time.Timer
	if s.IdleExit > 0 {
		timer = time.NewTimer(s.IdleExit)
		defer timer.Stop()
		idle = timer.C
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-idle:
			s.Log.Info("ajudante ocioso; sai até a próxima ativação pelo socket")
			return nil
		case err := <-errc:
			if ctx.Err() != nil {
				return nil
			}
			return err
		case c := <-conns:
			if timer != nil {
				timer.Reset(s.IdleExit)
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				s.handle(c)
			}()
		}
	}
}

func (s *Server) handle(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(requestTimeout))
	resp := s.respond(c)
	b, _ := json.Marshal(resp)
	_, _ = c.Write(append(b, '\n'))
}

func (s *Server) respond(c net.Conn) Response {
	p, err := s.peer(c)
	if err != nil {
		return fail(ErrForbidden, "chamador não identificado: "+err.Error())
	}
	if !p.Root && p.GID != s.AgentGID {
		s.Log.Warn("ajudante: chamador recusado", "uid", p.UID, "gid", p.GID, "pid", p.PID)
		return fail(ErrForbidden, "chamador sem permissão")
	}
	r := bufio.NewReader(&limited{c: c, n: maxRequestBytes})
	line, err := r.ReadBytes('\n')
	if errors.Is(err, errTooBig) {
		return fail(ErrBadRequest, "pedido grande demais")
	}
	if err != nil && len(line) == 0 {
		return fail(ErrBadRequest, "pedido incompleto")
	}
	var req Request
	if err := json.Unmarshal(line, &req); err != nil {
		return fail(ErrBadRequest, "pedido não é JSON")
	}
	allowed := agentOps
	if p.Root {
		allowed = rootOps
	}
	if !rootOps[req.Op] {
		return fail(ErrUnknownOp, fmt.Sprintf("operação %q não existe", req.Op))
	}
	if !allowed[req.Op] {
		s.Log.Warn("ajudante: operação recusada", "op", req.Op, "uid", p.UID, "pid", p.PID)
		return fail(ErrForbidden, "operação "+req.Op+" só para root")
	}
	s.Log.Info("ajudante: operação", "op", req.Op, "uid", p.UID, "pid", p.PID)
	switch req.Op {
	case OpPing:
		return Response{OK: true, Result: map[string]any{"version": buildinfo.Version, "uid": p.UID}}
	}
	return fail(ErrNotImplemented, "operação "+req.Op+" ainda não implementada (Fase 1)")
}

func fail(code, msg string) Response {
	return Response{Error: &ErrorBody{Code: code, Message: msg}}
}

var errTooBig = errors.New("pedido grande demais")

// limited lê no máximo n bytes da conexão.
type limited struct {
	c net.Conn
	n int
}

func (l *limited) Read(p []byte) (int, error) {
	if l.n <= 0 {
		return 0, errTooBig
	}
	if len(p) > l.n {
		p = p[:l.n]
	}
	k, err := l.c.Read(p)
	l.n -= k
	return k, err
}

// Call manda um pedido ao ajudante e lê a resposta (cliente: agente e CLI).
func Call(ctx context.Context, socket string, req Request) (*Response, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "unix", socket)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(dl)
	}
	b, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if _, err := c.Write(append(b, '\n')); err != nil {
		return nil, err
	}
	line, err := bufio.NewReader(c).ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return nil, err
	}
	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("resposta do ajudante inválida: %w", err)
	}
	return &resp, nil
}
