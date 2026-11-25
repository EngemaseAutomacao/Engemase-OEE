// Package helper é o esqueleto do oee-helper (docs/16 §3): o único processo root,
// ativado pelo oee-helper.socket (/run/oee-gateway/helper.sock), com operações
// FECHADAS. Cada conexão leva um pedido JSON numa linha e recebe uma resposta JSON
// numa linha. O chamador é identificado pelo SO_PEERCRED: root (CLI pelo sudo
// restrito do técnico) ou o grupo do agente (oee), cada um com a sua lista de
// operações.
//
// As operações (ops.go) são as do contrato da unit: aplicar a rede com checkpoint do
// NetworkManager (confirmar ou voltar), ajustar o relógio sem NTP, reset de fábrica
// (só root) e ver os arquivos de serviço do pendrive. Cada uma valida os parâmetros
// sem aceitar campo desconhecido; toda chamada vai para o log (auditoria no journal).
package helper

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
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/peercred"
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
	ErrInvalidParams  = "invalid_params"
	ErrConflict       = "conflict"           // já há mudança de rede pendente
	ErrNothingPending = "nothing_pending"    // confirmar/voltar sem mudança pendente
	ErrExpired        = "checkpoint_expired" // a rede já voltou sozinha
	ErrNTPSynced      = "ntp_synchronized"   // relógio só à mão sem NTP
	ErrFailed         = "failed"             // falha do sistema (detalhe no log)
)

// Limites de um pedido.
const (
	maxRequestBytes = 128 << 10
	requestTimeout  = 10 * time.Second
	// opTimeout: a operação mais longa (rede: checkpoint, reload e subir 2 perfis).
	opTimeout = 90 * time.Second
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
type Peer = peercred.Peer

// Server atende os pedidos.
type Server struct {
	// AgentGID é o grupo do agente (oee); quem não é root nem desse grupo é recusado.
	AgentGID uint32
	// IdleExit faz Serve terminar depois desse tempo sem conexão (0 = nunca): o
	// systemd reativa pelo socket.
	IdleExit time.Duration
	Log      *slog.Logger
	// Ops executa as operações (nil: só ping; o resto responde not_implemented).
	Ops *Ops
	// peer identifica o chamador (padrão: SO_PEERCRED; trocado nos testes).
	peer func(net.Conn) (Peer, error)
}

// Serve atende até o contexto acabar ou o ajudante ficar ocioso por IdleExit.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	if s.Log == nil {
		s.Log = slog.Default()
	}
	if s.peer == nil {
		s.peer = peercred.Of
	}
	s.reconcile(ctx)
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
		// Mudança de rede pendente: o ajudante fica vivo até o prazo para desfazer os
		// arquivos gerados se o NetworkManager voltar a rede sozinho.
		var due <-chan time.Time
		if s.Ops != nil {
			if d := s.Ops.PendingDeadline(); !d.IsZero() {
				due = time.After(time.Until(d.Add(reconcileGrace)) + 100*time.Millisecond)
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-due:
			s.reconcile(ctx)
		case <-idle:
			if s.Ops != nil && !s.Ops.PendingDeadline().IsZero() {
				timer.Reset(s.IdleExit)
				continue
			}
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
	_ = c.SetReadDeadline(time.Now().Add(requestTimeout))
	resp := s.respond(c)
	_ = c.SetWriteDeadline(time.Now().Add(requestTimeout))
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
	if err := decodeStrict(line, &req); err != nil {
		return fail(ErrBadRequest, "pedido não é JSON válido")
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
	if req.Op == OpPing {
		return Response{OK: true, Result: map[string]any{"version": buildinfo.Version, "uid": p.UID}}
	}
	if s.Ops == nil {
		return fail(ErrNotImplemented, "operação "+req.Op+" indisponível neste ajudante")
	}
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	var fn func(context.Context, json.RawMessage) (any, error)
	switch req.Op {
	case OpNetworkApply:
		fn = s.Ops.NetworkApply
	case OpNetworkConfirm:
		fn = s.Ops.NetworkConfirm
	case OpNetworkRollback:
		fn = s.Ops.NetworkRollback
	case OpClockSet:
		fn = s.Ops.ClockSet
	case OpFactoryReset:
		fn = s.Ops.FactoryReset
	case OpUSBRead:
		fn = s.Ops.USBRead
	}
	res, err := fn(ctx, req.Params)
	if err != nil {
		code, msg := ErrFailed, "falha interna (detalhe no journal)"
		var oe *opError
		if errors.As(err, &oe) {
			code, msg = oe.code, oe.msg
		}
		// Auditoria: a operação, quem pediu e o resultado (sem os parâmetros, que
		// podem ter a senha do proxy).
		s.Log.Warn("ajudante: operação falhou", "op", req.Op, "uid", p.UID, "pid", p.PID, "codigo", code, "erro", err.Error())
		return fail(code, msg)
	}
	s.Log.Info("ajudante: operação feita", "op", req.Op, "uid", p.UID, "pid", p.PID)
	return Response{OK: true, Result: res}
}

// reconcile desfaz os arquivos de uma mudança de rede que passou do prazo.
func (s *Server) reconcile(ctx context.Context) {
	if s.Ops == nil {
		return
	}
	undone, err := s.Ops.Reconcile(ctx)
	if err != nil {
		s.Log.Error("ajudante: falha ao conferir a mudança de rede pendente", "erro", err)
	} else if undone {
		s.Log.Warn("ajudante: rede não confirmada no prazo; voltou à anterior")
	}
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

// decodeStrict decodifica um único valor JSON sem campos desconhecidos.
func decodeStrict(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("conteúdo depois do objeto")
	}
	return nil
}
