package remoteaccess

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/peercred"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	gwID   = "01a1cab3-2bea-7244-bb03-702b326efb32"
	sessID = "01a1cab3-2bea-7244-bb03-702b326efb99"
)

type signer struct {
	priv ed25519.PrivateKey
	kid  string
}

func newSigner(t *testing.T) (signer, map[string]ed25519.PublicKey) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return signer{priv, KeyID(pub)}, map[string]ed25519.PublicKey{KeyID(pub): pub}
}

func (s signer) sign(c Claims) string {
	h := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","typ":"JWT","kid":"` + s.kid + `"}`))
	b, _ := json.Marshal(c)
	p := base64.RawURLEncoding.EncodeToString(b)
	return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.priv, []byte(h+"."+p)))
}

func claims(now time.Time, exp time.Time) Claims {
	return Claims{Typ: ApprovalType, GatewayID: gwID, SessionID: sessID, RequestedBy: "user:a", ApprovedBy: "user:b", ApprovedAt: now.Format(time.RFC3339), NotAfter: exp.Format(time.RFC3339)}
}

func TestVerifyApproval(t *testing.T) {
	s, keys := newSigner(t)
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	exp := now.Add(time.Hour)
	if _, err := VerifyApproval(s.sign(claims(now, exp)), keys, gwID, sessID, exp, now); err != nil {
		t.Fatalf("aprovação válida recusada: %v", err)
	}
	other, _ := newSigner(t)
	bad := map[string]string{
		"outra chave":        other.sign(claims(now, exp)),
		"outro gateway":      s.sign(func() Claims { c := claims(now, exp); c.GatewayID = sessID; return c }()),
		"outra sessão":       s.sign(func() Claims { c := claims(now, exp); c.SessionID = gwID; return c }()),
		"vencida":            s.sign(claims(now.Add(-2*time.Hour), now.Add(-time.Hour))),
		"prazo curto":        s.sign(claims(now, now.Add(30*time.Minute))),
		"tipo errado":        s.sign(func() Claims { c := claims(now, exp); c.Typ = "x"; return c }()),
		"lixo":               "a.b.c",
		"assinatura trocada": func() string { j := s.sign(claims(now, exp)); return j[:len(j)-4] + "AAAA" }(),
	}
	for name, jws := range bad {
		if _, err := VerifyApproval(jws, keys, gwID, sessID, exp, now); err == nil {
			t.Errorf("%s: deveria recusar", name)
		}
	}
}

func TestLoadKeysAndPolicy(t *testing.T) {
	dir := t.TempDir()
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	_ = os.WriteFile(filepath.Join(dir, "vpn-approval-x.pub"), []byte("# comentário\n"+base64.StdEncoding.EncodeToString(pub)+"\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "ota-2026.pub"), []byte(base64.StdEncoding.EncodeToString(make([]byte, 32))), 0o644) // ignorada
	keys, err := LoadKeys(dir)
	if err != nil || len(keys) != 1 || keys[KeyID(pub)] == nil {
		t.Fatalf("chaves: %v %v", keys, err)
	}
	if p := LoadPolicy(filepath.Join(dir, "nao-existe.json")); !p.Permits() || p.AllowOtForward {
		t.Fatalf("sem arquivo deveria permitir sem CLP: %+v", p)
	}
	bad := filepath.Join(dir, "ruim.json")
	_ = os.WriteFile(bad, []byte("{"), 0o644)
	if LoadPolicy(bad).Permits() {
		t.Fatal("arquivo ilegível deveria bloquear")
	}
	locked := filepath.Join(dir, "lock.json")
	_ = os.WriteFile(locked, []byte(`{"allowed":true,"locked":true}`), 0o644)
	if LoadPolicy(locked).Permits() {
		t.Fatal("kill switch deveria bloquear")
	}
}

// --- rede e SSH de mentira -------------------------------------------------

type fakeNet struct {
	mu   sync.Mutex
	ups  []UpOptions
	tuns []*fakeTun
	err  error
}

type fakeTun struct {
	ln     net.Listener
	closed bool
}

func (f *fakeNet) Up(_ context.Context, o UpOptions) (Tunnel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ups = append(f.ups, o)
	if f.err != nil {
		return nil, f.err
	}
	t := &fakeTun{}
	f.tuns = append(f.tuns, t)
	return t, nil
}
func (t *fakeTun) Listen(int) (net.Listener, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	t.ln = ln
	return ln, err
}
func (t *fakeTun) IP() string         { return "100.64.0.9" }
func (t *fakeTun) Connection() string { return "direct" }
func (t *fakeTun) Close() error       { t.closed = true; return nil }

func echoSSH(t *testing.T) func(context.Context) (net.Conn, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { _, _ = io.Copy(c, c); _ = c.Close() }()
		}
	}()
	return func(ctx context.Context) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "tcp", ln.Addr().String())
	}
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func setup(t *testing.T) (*Manager, *fakeNet, *clock, signer) {
	s, keys := newSigner(t)
	clk := &clock{t: time.Now().UTC().Truncate(time.Second)}
	fn := &fakeNet{}
	m := &Manager{Net: fn, Keys: keys, PolicyPath: filepath.Join(t.TempDir(), "remote-access.json"), DialSSH: echoSSH(t), Now: clk.Now}
	return m, fn, clk, s
}

func enableReq(clk *clock, s signer) EnableRequest {
	exp := clk.Now().Add(time.Hour)
	return EnableRequest{GatewayID: gwID, SessionID: sessID, AuthKey: "tskey-auth-xxxxxxxxxxxx", NodeName: "oee-gw-abc-def", SessionExpiresAt: exp, IdleTimeout: 15 * time.Minute, Approval: s.sign(claims(clk.Now(), exp))}
}

func TestSessionLifecycle(t *testing.T) {
	m, fn, clk, s := setup(t)
	res, err := m.Enable(context.Background(), enableReq(clk, s))
	if err != nil || res.State != "active" || res.NodeIP != "100.64.0.9" {
		t.Fatalf("enable: %+v %v", res, err)
	}
	if fn.ups[0].AuthKey == "" || fn.ups[0].NodeName != "oee-gw-abc-def" {
		t.Fatalf("up: %+v", fn.ups[0])
	}
	// Idempotente para a mesma sessão; outra sessão = conflito.
	if _, err := m.Enable(context.Background(), enableReq(clk, s)); err != nil {
		t.Fatalf("mesma sessão deveria ser idempotente: %v", err)
	}

	// Uma conexão pela "VPN" chega ao SSH local e volta.
	c, err := net.Dial("tcp", fn.tuns[0].ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = c.Write([]byte("ola"))
	buf := make([]byte, 3)
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != "ola" {
		t.Fatalf("eco: %q %v", buf, err)
	}
	if st := m.Status(); st.State != "active" || st.ActiveConnections != 1 {
		t.Fatalf("status: %+v", st)
	}
	_ = c.Close()

	sum, err := m.Disable(sessID, EndRequested)
	if err != nil || sum.EndReason != EndRequested || sum.SSHLogins != 1 || sum.BytesIn < 3 {
		t.Fatalf("disable: %+v %v", sum, err)
	}
	if !fn.tuns[0].closed || m.Status().State != "off" {
		t.Fatal("a VPN deveria estar desligada")
	}
	// De novo: devolve o resumo (idempotente).
	if again, err := m.Disable(sessID, EndRequested); err != nil || again.SessionID != sessID {
		t.Fatalf("disable repetido: %v", err)
	}
	actions := []string{}
	for _, e := range m.Drain() {
		actions = append(actions, e.Action)
	}
	want := []string{"session_started", "ssh_login", "ssh_logout", "session_ended"}
	if len(actions) < 4 || actions[0] != want[0] || actions[len(actions)-1] != want[3] {
		t.Fatalf("eventos: %v", actions)
	}
}

func TestTimersAndPolicy(t *testing.T) {
	m, _, clk, s := setup(t)
	if _, err := m.Enable(context.Background(), enableReq(clk, s)); err != nil {
		t.Fatal(err)
	}
	clk.Add(16 * time.Minute) // sem conexão por mais que a inatividade
	m.Check()
	if st := m.Status(); st.State != "off" || st.Last == nil || st.Last.EndReason != EndIdle {
		t.Fatalf("inatividade: %+v", st)
	}

	m2, _, clk2, s2 := setup(t)
	r := enableReq(clk2, s2)
	r.IdleTimeout = 2 * time.Hour
	if _, err := m2.Enable(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	clk2.Add(61 * time.Minute)
	m2.Check()
	if st := m2.Status(); st.Last == nil || st.Last.EndReason != EndExpired {
		t.Fatalf("prazo: %+v", st)
	}

	m3, _, clk3, s3 := setup(t)
	if _, err := m3.Enable(context.Background(), enableReq(clk3, s3)); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(m3.PolicyPath, []byte(`{"allowed":true,"locked":true}`), 0o644)
	m3.Check()
	if st := m3.Status(); st.Last == nil || st.Last.EndReason != EndLocalLock {
		t.Fatalf("kill switch: %+v", st)
	}
	// Com o kill switch, nem liga.
	if _, err := m3.Enable(context.Background(), enableReq(clk3, s3)); !IsCode(err, CodePolicyDenied) {
		t.Fatalf("deveria recusar pela política: %v", err)
	}
}

func TestEnableRefusals(t *testing.T) {
	m, fn, clk, s := setup(t)
	r := enableReq(clk, s)
	r.Approval = "x.y.z"
	if _, err := m.Enable(context.Background(), r); !IsCode(err, CodeApprovalInvalid) {
		t.Fatalf("aprovação ruim: %v", err)
	}
	r = enableReq(clk, s)
	r.SessionExpiresAt = clk.Now().Add(9 * time.Hour)
	if _, err := m.Enable(context.Background(), r); !IsCode(err, CodeInvalidPayload) {
		t.Fatalf("acima do teto local: %v", err)
	}
	r = enableReq(clk, s)
	r.NodeName = "Nome Ruim"
	if _, err := m.Enable(context.Background(), r); !IsCode(err, CodeInvalidPayload) {
		t.Fatalf("nome de nó: %v", err)
	}
	fn.err = io.ErrUnexpectedEOF
	if _, err := m.Enable(context.Background(), enableReq(clk, s)); !IsCode(err, CodeVpnFailed) {
		t.Fatalf("falha da rede: %v", err)
	}
	if len(fn.ups) != 1 {
		t.Fatalf("a rede só deveria ser chamada depois de todas as conferências (chamadas: %d)", len(fn.ups))
	}
}

func TestProtocolRoundTrip(t *testing.T) {
	m, _, clk, s := setup(t)
	sock := filepath.Join(t.TempDir(), "ra.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var peer atomic.Value
	peer.Store(peercred.Peer{UID: 1000, GID: 990})
	srv := &Server{Manager: m, AgentGID: 990, peer: func(net.Conn) (peercred.Peer, error) { return peer.Load().(peercred.Peer), nil }}
	go func() { _ = srv.Serve(ctx, ln) }()
	cl := &Client{Socket: sock}

	res, err := cl.Enable(ctx, enableReq(clk, s))
	if err != nil || res.State != "active" {
		t.Fatalf("enable pelo socket: %+v %v", res, err)
	}
	st, err := cl.Status(ctx)
	if err != nil || st.State != "active" || st.SessionID != sessID {
		t.Fatalf("status: %+v %v", st, err)
	}
	if _, err := cl.Disable(ctx, sessID, ""); err != nil {
		t.Fatal(err)
	}
	evs, err := cl.Events(ctx)
	if err != nil || len(evs) < 2 {
		t.Fatalf("eventos: %v %v", evs, err)
	}
	if again, _ := cl.Events(ctx); len(again) != 0 {
		t.Fatal("eventos deveriam ter sido esvaziados")
	}
	// Erro com código do contrato atravessa o socket.
	r := enableReq(clk, s)
	r.Approval = "a.b.c"
	if _, err := cl.Enable(ctx, r); !IsCode(err, CodeApprovalInvalid) {
		t.Fatalf("código do erro: %v", err)
	}
	// Quem não é root nem do grupo do agente: recusado.
	peer.Store(peercred.Peer{UID: 1001, GID: 1001})
	if _, err := cl.Status(ctx); err == nil {
		t.Fatal("chamador sem permissão deveria ser recusado")
	}
}

// A aprovação assinada pela PLATAFORMA (TypeScript) é aceita aqui: os dois lados falam o mesmo JWS.
// A plataforma confere a mesma amostra em apps/web/test/remote/vpn.test.ts.
func TestApprovalFromPlatform(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "approval-from-platform.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		PublicKey string `json:"public_key"`
		Kid       string `json:"kid"`
		JWS       string `json:"jws"`
		Claims    Claims `json:"claims"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	pub, _ := base64.StdEncoding.DecodeString(f.PublicKey)
	if KeyID(pub) != f.Kid {
		t.Fatalf("kid diferente: %s × %s", KeyID(pub), f.Kid)
	}
	now := time.Date(2026, 11, 27, 15, 30, 0, 0, time.UTC)
	exp := time.Date(2026, 11, 27, 16, 0, 0, 0, time.UTC)
	c, err := VerifyApproval(f.JWS, map[string]ed25519.PublicKey{f.Kid: pub}, f.Claims.GatewayID, f.Claims.SessionID, exp, now)
	if err != nil || c.ApprovedBy != "user:b" {
		t.Fatalf("o gateway recusou a aprovação da plataforma: %v", err)
	}
}
