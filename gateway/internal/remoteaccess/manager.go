package remoteaccess

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"regexp"
	"sync"
	"sync/atomic"
	"time"
)

// Network liga a rede de manutenção (implementação real: tsnet, no oee-remote-access).
type Network interface {
	Up(ctx context.Context, o UpOptions) (Tunnel, error)
}

// UpOptions: a chave de entrada é segredo de uso único (nunca em disco nem em log).
type UpOptions struct {
	AuthKey    string
	NodeName   string
	ControlURL string
}

// Tunnel é a rede ligada: só escuta (nunca roteia) e se desliga em Close.
type Tunnel interface {
	Listen(port int) (net.Listener, error)
	IP() string
	// Connection: "direct" ou "relay" (ou "" se não souber).
	Connection() string
	Close() error
}

// Códigos de erro (contrato COMMAND_ERROR_CODES).
const (
	CodeInvalidPayload  = "invalid_payload"
	CodePolicyDenied    = "policy_denied"
	CodeApprovalInvalid = "approval_invalid"
	CodeSessionConflict = "session_conflict"
	CodeSessionNotFound = "session_not_found"
	CodeVpnFailed       = "vpn_failed"
)

// Motivos de fim (contrato VpnEndReasonSchema).
const (
	EndRequested = "requested"
	EndExpired   = "expired"
	EndIdle      = "idle"
	EndRevoked   = "revoked"
	EndLocalLock = "local_lock"
	EndError     = "error"
)

// Error é um erro com código do contrato.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func fail(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// Limites.
const (
	SSHPort            = 22
	DefaultIdleTimeout = 15 * time.Minute
	MinIdleTimeout     = time.Minute
	MaxIdleTimeout     = 2 * time.Hour
	// MaxSession é o teto local (docs/12): nem uma aprovação errada passa disso.
	MaxSession = 8 * time.Hour
	upTimeout  = 90 * time.Second
	maxConns   = 8
)

var (
	nodeNameRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	idRE       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// EnableRequest é o vpn.enable vindo do agente.
type EnableRequest struct {
	GatewayID        string        `json:"gateway_id"`
	SessionID        string        `json:"session_id"`
	AuthKey          string        `json:"auth_key"`
	ControlURL       string        `json:"control_url,omitempty"`
	NodeName         string        `json:"node_name"`
	SessionExpiresAt time.Time     `json:"session_expires_at"`
	IdleTimeout      time.Duration `json:"idle_timeout"`
	Approval         string        `json:"approval"`
}

// EnableResult (contrato VpnEnableResultSchema).
type EnableResult struct {
	SessionID        string    `json:"session_id"`
	State            string    `json:"state"`
	NodeIP           string    `json:"node_ip,omitempty"`
	Connection       string    `json:"connection,omitempty"`
	SessionExpiresAt time.Time `json:"session_expires_at"`
}

// Summary é o resumo de uma sessão encerrada (contrato VpnSessionSummarySchema).
type Summary struct {
	SessionID string    `json:"session_id"`
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at"`
	EndReason string    `json:"end_reason"`
	BytesIn   int64     `json:"bytes_in"`
	BytesOut  int64     `json:"bytes_out"`
	SSHLogins int       `json:"ssh_logins"`
}

// Status (base do contrato VpnStatusResultSchema).
type Status struct {
	State             string      `json:"state"` // off | active
	SessionID         string      `json:"session_id,omitempty"`
	NodeIP            string      `json:"node_ip,omitempty"`
	Connection        string      `json:"connection,omitempty"`
	SessionExpiresAt  *time.Time  `json:"session_expires_at,omitempty"`
	IdleS             int         `json:"idle_s"`
	ActiveConnections int         `json:"active_connections"`
	Policy            LocalPolicy `json:"local_policy"`
	Last              *Summary    `json:"last,omitempty"`
}

// Event vira um evento remote_access no outbox do agente.
type Event struct {
	Action    string    `json:"action"` // session_started | session_ended | ssh_login | ssh_logout | policy_blocked
	SessionID string    `json:"session_id"`
	Detail    string    `json:"detail,omitempty"`
	At        time.Time `json:"at"`
}

// Manager guarda no máximo UMA sessão viva. Nada vai para disco: depois de reiniciar, a VPN fica
// desligada (docs/12, "nunca religa após reboot").
type Manager struct {
	Net        Network
	Keys       map[string]ed25519.PublicKey
	PolicyPath string
	// DialSSH conecta no OpenSSH local (padrão: 127.0.0.1:22).
	DialSSH func(ctx context.Context) (net.Conn, error)
	Now     func() time.Time
	Log     *slog.Logger

	mu     sync.Mutex
	cur    *session
	last   *Summary
	events []Event
}

type session struct {
	id          string
	expires     time.Time
	idleTimeout time.Duration
	started     time.Time
	tunnel      Tunnel
	listener    net.Listener
	conns       map[net.Conn]struct{}
	active      int
	lastActive  time.Time
	logins      int
	bytesIn     atomic.Int64
	bytesOut    atomic.Int64
	done        chan struct{}
}

func (m *Manager) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func (m *Manager) log() *slog.Logger {
	if m.Log != nil {
		return m.Log
	}
	return slog.Default()
}

func (m *Manager) policy() LocalPolicy {
	if m.PolicyPath == "" {
		return LoadPolicy(DefaultPolicyPath)
	}
	return LoadPolicy(m.PolicyPath)
}

func (m *Manager) emit(action, sessionID, detail string) {
	m.events = append(m.events, Event{Action: action, SessionID: sessionID, Detail: detail, At: m.now().UTC()})
	if len(m.events) > 500 {
		m.events = m.events[len(m.events)-500:]
	}
}

// Drain devolve e esvazia os eventos pendentes (o agente os põe no outbox).
func (m *Manager) Drain() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.events
	m.events = nil
	return out
}

// Enable confere tudo e liga a VPN. Mesma sessão já ativa: devolve o estado (idempotente).
func (m *Manager) Enable(ctx context.Context, r EnableRequest) (EnableResult, error) {
	now := m.now()
	switch {
	case !idRE.MatchString(r.SessionID), !idRE.MatchString(r.GatewayID):
		return EnableResult{}, fail(CodeInvalidPayload, "identificador de sessão ou gateway inválido")
	case len(r.AuthKey) < 16:
		return EnableResult{}, fail(CodeInvalidPayload, "chave de entrada ausente")
	case !nodeNameRE.MatchString(r.NodeName):
		return EnableResult{}, fail(CodeInvalidPayload, "nome de nó inválido")
	case !r.SessionExpiresAt.After(now):
		return EnableResult{}, fail(CodeInvalidPayload, "a sessão já venceu")
	case r.SessionExpiresAt.After(now.Add(MaxSession + clockSkew)):
		return EnableResult{}, fail(CodeInvalidPayload, "sessão acima do teto local de %s", MaxSession)
	}
	idle := r.IdleTimeout
	if idle == 0 {
		idle = DefaultIdleTimeout
	}
	if idle < MinIdleTimeout || idle > MaxIdleTimeout {
		return EnableResult{}, fail(CodeInvalidPayload, "inatividade fora de %s–%s", MinIdleTimeout, MaxIdleTimeout)
	}

	m.mu.Lock()
	if p := m.policy(); !p.Permits() {
		m.emit("policy_blocked", r.SessionID, "política local não permite")
		m.mu.Unlock()
		return EnableResult{}, fail(CodePolicyDenied, "a política local do gateway não permite acesso remoto")
	}
	if _, err := VerifyApproval(r.Approval, m.Keys, r.GatewayID, r.SessionID, r.SessionExpiresAt, now); err != nil {
		m.mu.Unlock()
		return EnableResult{}, fail(CodeApprovalInvalid, "%v", err)
	}
	if m.cur != nil {
		cur := m.cur
		m.mu.Unlock()
		if cur.id == r.SessionID {
			return EnableResult{SessionID: cur.id, State: "active", NodeIP: cur.tunnel.IP(), Connection: cur.tunnel.Connection(), SessionExpiresAt: cur.expires}, nil
		}
		return EnableResult{}, fail(CodeSessionConflict, "já há outra sessão ativa")
	}
	m.mu.Unlock()

	upCtx, cancel := context.WithTimeout(ctx, upTimeout)
	defer cancel()
	tun, err := m.Net.Up(upCtx, UpOptions{AuthKey: r.AuthKey, NodeName: r.NodeName, ControlURL: r.ControlURL})
	if err != nil {
		return EnableResult{}, fail(CodeVpnFailed, "não foi possível ligar a VPN: %v", err)
	}
	ln, err := tun.Listen(SSHPort)
	if err != nil {
		_ = tun.Close()
		return EnableResult{}, fail(CodeVpnFailed, "não foi possível abrir o SSH na VPN: %v", err)
	}

	s := &session{
		id: r.SessionID, expires: r.SessionExpiresAt, idleTimeout: idle, started: m.now(), tunnel: tun, listener: ln,
		conns: map[net.Conn]struct{}{}, lastActive: m.now(), done: make(chan struct{}),
	}
	m.mu.Lock()
	if m.cur != nil { // outra ligou enquanto subíamos
		m.mu.Unlock()
		_ = ln.Close()
		_ = tun.Close()
		return EnableResult{}, fail(CodeSessionConflict, "já há outra sessão ativa")
	}
	m.cur = s
	m.emit("session_started", s.id, fmt.Sprintf("conexão %s", tun.Connection()))
	m.mu.Unlock()
	m.log().Info("acesso remoto ligado", "sessao", s.id, "no", r.NodeName, "ate", s.expires)

	go m.accept(s)
	return EnableResult{SessionID: s.id, State: "active", NodeIP: tun.IP(), Connection: tun.Connection(), SessionExpiresAt: s.expires}, nil
}

func (m *Manager) dialSSH(ctx context.Context) (net.Conn, error) {
	if m.DialSSH != nil {
		return m.DialSSH(ctx)
	}
	var d net.Dialer
	return d.DialContext(ctx, "tcp", "127.0.0.1:22")
}

// accept repassa cada conexão da VPN para o SSH local (nunca para outro destino).
func (m *Manager) accept(s *session) {
	for {
		c, err := s.listener.Accept()
		if err != nil {
			return
		}
		m.mu.Lock()
		if m.cur != s || len(s.conns) >= maxConns {
			m.mu.Unlock()
			_ = c.Close()
			continue
		}
		s.conns[c] = struct{}{}
		s.active++
		s.logins++
		s.lastActive = m.now()
		m.emit("ssh_login", s.id, "conexão "+c.RemoteAddr().String())
		m.mu.Unlock()
		go m.pipe(s, c)
	}
}

type countWriter struct {
	w io.Writer
	n *atomic.Int64
}

func (c countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n.Add(int64(n))
	return n, err
}

func (m *Manager) pipe(s *session, c net.Conn) {
	defer func() {
		_ = c.Close()
		m.mu.Lock()
		if _, ok := s.conns[c]; ok {
			delete(s.conns, c)
			s.active--
			s.lastActive = m.now()
			m.emit("ssh_logout", s.id, "")
		}
		m.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	local, err := m.dialSSH(ctx)
	cancel()
	if err != nil {
		m.log().Warn("SSH local indisponível", "erro", err)
		return
	}
	defer local.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(countWriter{local, &s.bytesIn}, c); done <- struct{}{} }()
	go func() { _, _ = io.Copy(countWriter{c, &s.bytesOut}, local); done <- struct{}{} }()
	<-done
}

// Check aplica prazo, inatividade e kill switch (chamado a cada segundo pelo serviço).
func (m *Manager) Check() {
	m.mu.Lock()
	s := m.cur
	if s == nil {
		m.mu.Unlock()
		return
	}
	now := m.now()
	reason := ""
	switch {
	case !m.policy().Permits():
		reason = EndLocalLock
	case !now.Before(s.expires):
		reason = EndExpired
	case s.active == 0 && now.Sub(s.lastActive) >= s.idleTimeout:
		reason = EndIdle
	}
	m.mu.Unlock()
	if reason != "" {
		_, _ = m.end(s, reason)
	}
}

// Disable encerra a sessão pedida (ou a atual, com sessionID vazio). Já encerrada: devolve o resumo.
func (m *Manager) Disable(sessionID, reason string) (Summary, error) {
	if reason == "" {
		reason = EndRequested
	}
	m.mu.Lock()
	s := m.cur
	last := m.last
	m.mu.Unlock()
	if s == nil || (sessionID != "" && s.id != sessionID) {
		if last != nil && (sessionID == "" || last.SessionID == sessionID) {
			return *last, nil
		}
		return Summary{}, fail(CodeSessionNotFound, "não há sessão ativa com esse id")
	}
	return m.end(s, reason)
}

func (m *Manager) end(s *session, reason string) (Summary, error) {
	m.mu.Lock()
	if m.cur != s {
		last := m.last
		m.mu.Unlock()
		if last != nil {
			return *last, nil
		}
		return Summary{}, fail(CodeSessionNotFound, "sessão já encerrada")
	}
	m.cur = nil
	conns := make([]net.Conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
		delete(s.conns, c)
		s.active--
		m.emit("ssh_logout", s.id, "sessão encerrada")
	}
	m.mu.Unlock()

	_ = s.listener.Close()
	for _, c := range conns {
		_ = c.Close()
	}
	_ = s.tunnel.Close()
	close(s.done)

	sum := Summary{SessionID: s.id, StartedAt: s.started.UTC(), EndedAt: m.now().UTC(), EndReason: reason, BytesIn: s.bytesIn.Load(), BytesOut: s.bytesOut.Load(), SSHLogins: s.logins}
	m.mu.Lock()
	m.last = &sum
	m.emit("session_ended", s.id, reason)
	m.mu.Unlock()
	m.log().Info("acesso remoto desligado", "sessao", s.id, "motivo", reason)
	return sum, nil
}

// Status é o estado atual (sem segredos).
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Status{State: "off", Policy: m.policy(), Last: m.last}
	if s := m.cur; s != nil {
		exp := s.expires
		st.State = "active"
		st.SessionID = s.id
		st.NodeIP = s.tunnel.IP()
		st.Connection = s.tunnel.Connection()
		st.SessionExpiresAt = &exp
		st.ActiveConnections = s.active
		if s.active == 0 {
			st.IdleS = int(m.now().Sub(s.lastActive).Seconds())
		}
	}
	return st
}

// Shutdown desliga tudo (parada do serviço): a sessão termina com motivo "error" se ainda estiver ativa.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	s := m.cur
	m.mu.Unlock()
	if s != nil {
		_, _ = m.end(s, EndError)
	}
}

// IsCode diz se o erro tem esse código do contrato.
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}
