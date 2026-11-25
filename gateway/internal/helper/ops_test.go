package helper

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSys grava as chamadas e simula o NetworkManager.
type fakeSys struct {
	mu          sync.Mutex
	calls       []string
	checkpoints map[string]bool
	next        int
	failUp      bool
	ntpSynced   bool
	clock       time.Time
	host        string
}

func newFakeSys() *fakeSys { return &fakeSys{checkpoints: map[string]bool{}, host: "egw-00042"} }

func (f *fakeSys) rec(s string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s)
}

func (f *fakeSys) called(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func (f *fakeSys) CheckpointCreate(_ context.Context, d time.Duration) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	p := "/org/freedesktop/NetworkManager/Checkpoint/" + string(rune('0'+f.next))
	f.checkpoints[p] = true
	f.calls = append(f.calls, "create "+d.String())
	return p, nil
}

func (f *fakeSys) CheckpointDestroy(_ context.Context, p string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "destroy")
	if !f.checkpoints[p] {
		return errors.New("checkpoint não existe")
	}
	delete(f.checkpoints, p)
	return nil
}

func (f *fakeSys) CheckpointRollback(_ context.Context, p string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "rollback")
	if !f.checkpoints[p] {
		return errors.New("checkpoint não existe")
	}
	delete(f.checkpoints, p)
	return nil
}

func (f *fakeSys) ReloadConnections(context.Context) error { f.rec("reload"); return nil }
func (f *fakeSys) ActivateConnection(_ context.Context, id string) error {
	f.rec("up " + id)
	if f.failUp {
		return errors.New("sem link")
	}
	return nil
}
func (f *fakeSys) RestartUnit(_ context.Context, u string) error { f.rec("restart " + u); return nil }
func (f *fakeSys) StopUnit(_ context.Context, u string) error    { f.rec("stop " + u); return nil }
func (f *fakeSys) StartUnit(_ context.Context, u string) error   { f.rec("start " + u); return nil }
func (f *fakeSys) NTPSynchronized(context.Context) (bool, error) { return f.ntpSynced, nil }
func (f *fakeSys) SetClock(t time.Time) error                    { f.clock = t; f.rec("clock"); return nil }
func (f *fakeSys) Chown(string, string) error                    { return nil }
func (f *fakeSys) Hostname() (string, error)                     { return f.host, nil }

const factoryJSON = `{
  "network_version": 0,
  "origin": "factory",
  "hostname": "egw-00042",
  "it": { "mac": "2c:f7:f1:00:00:02", "mode": "dhcp", "addresses": [], "gateway": null, "dns": [], "ipv6": "disabled", "allow_ping": false },
  "ot": { "mac": "2c:f7:f1:00:00:01", "mode": "static", "addresses": ["192.168.10.250/24"], "routes": [],
          "service_address": "169.254.127.58/16", "local_ui": true },
  "proxy": null,
  "ca_bundle_pem": null,
  "ntp": { "servers": [], "use_dhcp": true, "public_fallback": true }
}`

type rig struct {
	ops   *Ops
	sys   *fakeSys
	paths Paths
	now   atomic.Value
}

func newRig(t *testing.T) *rig {
	t.Helper()
	dir := t.TempDir()
	p := Paths{
		NetworkJSON:   filepath.Join(dir, "etc/oee-gateway/network.json"),
		ProxyEnv:      filepath.Join(dir, "etc/oee-gateway/proxy.env"),
		CABundle:      filepath.Join(dir, "etc/oee-gateway/ca-bundle.pem"),
		NMDir:         filepath.Join(dir, "etc/NetworkManager/system-connections"),
		ChronySources: filepath.Join(dir, "etc/chrony/sources.d/egw-ficha-ti.sources"),
		StateDir:      filepath.Join(dir, "var/lib/oee-helper"),
		USBDir:        filepath.Join(dir, "run/oee-usb/OEE"),
		AgentState:    filepath.Join(dir, "var/lib/oee-gateway"),
		LocalUIState:  filepath.Join(dir, "var/lib/oee-localui"),
	}
	for _, d := range []string{filepath.Dir(p.NetworkJSON), p.NMDir, p.AgentState, p.LocalUIState} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(p.NetworkJSON, []byte(factoryJSON), 0o640); err != nil {
		t.Fatal(err)
	}
	// Keyfile do factory init, com uuid aleatório: tem de ser mantido.
	if err := os.WriteFile(filepath.Join(p.NMDir, "oee-ot.nmconnection"),
		[]byte("[connection]\nid=oee-ot\nuuid=0b7c4c1e-1111-4222-8333-944455556666\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := &rig{sys: newFakeSys(), paths: p}
	r.now.Store(time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC))
	r.ops = &Ops{Sys: r.sys, Paths: p, AgentGroup: "oee", Now: func() time.Time { return r.now.Load().(time.Time) }}
	return r
}

func (r *rig) advance(d time.Duration) { r.now.Store(r.now.Load().(time.Time).Add(d)) }

func opCode(err error) string {
	var oe *opError
	if errors.As(err, &oe) {
		return oe.code
	}
	if err != nil {
		return "?" + err.Error()
	}
	return ""
}

func staticIT(t *testing.T) json.RawMessage {
	t.Helper()
	n, err := ParseNetwork([]byte(factoryJSON))
	if err != nil {
		t.Fatal(err)
	}
	gw := "10.20.0.1"
	n.IT = ITNet{Mode: "static", Addresses: []string{"10.20.0.50/24"}, Gateway: &gw, DNS: []string{"10.20.0.10"}, IPv6: "disabled",
		MAC: "aa:aa:aa:aa:aa:aa"} // MAC de quem chama é ignorado
	n.OT.Routes = []OTRoute{{To: "192.168.20.0/24", Via: "192.168.10.1"}}
	n.Proxy = &Proxy{URL: "http://10.20.0.5:3128", NoProxy: []string{"10.0.0.0/8"}}
	n.NTP.Servers = []string{"10.20.0.5"}
	b, _ := json.Marshal(NetworkApplyParams{Network: n})
	return b
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestNetworkApplyConfirm(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	res, err := r.ops.NetworkApply(ctx, staticIT(t))
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["network_version"] != 1 {
		t.Fatalf("versão: %v", res)
	}
	if r.sys.called("create 2m0s") != 1 || r.sys.called("up oee-ot") != 1 || r.sys.called("up oee-it") != 1 {
		t.Fatalf("chamadas: %v", r.sys.calls)
	}
	it := read(t, filepath.Join(r.paths.NMDir, "oee-it.nmconnection"))
	for _, want := range []string{"mac-address=2c:f7:f1:00:00:02", "address1=10.20.0.50/24,10.20.0.1", "dns=10.20.0.10;"} {
		if !strings.Contains(it, want) {
			t.Errorf("keyfile IT sem %q:\n%s", want, it)
		}
	}
	ot := read(t, filepath.Join(r.paths.NMDir, "oee-ot.nmconnection"))
	for _, want := range []string{"uuid=0b7c4c1e-1111-4222-8333-944455556666", "address1=192.168.10.250/24", "address2=169.254.127.58/16",
		"route1=192.168.20.0/24,192.168.10.1", "never-default=true"} {
		if !strings.Contains(ot, want) {
			t.Errorf("keyfile OT sem %q:\n%s", want, ot)
		}
	}
	if pe := read(t, r.paths.ProxyEnv); !strings.Contains(pe, "HTTPS_PROXY=http://10.20.0.5:3128") || !strings.Contains(pe, "10.0.0.0/8") {
		t.Errorf("proxy.env: %s", pe)
	}
	if c := read(t, r.paths.ChronySources); c != "# Gerado pelo oee-helper a partir do network.json.\nserver 10.20.0.5 iburst\n" {
		t.Errorf("chrony: %q", c)
	}
	// Segunda mudança com uma pendente: conflito.
	if _, err := r.ops.NetworkApply(ctx, staticIT(t)); opCode(err) != ErrConflict {
		t.Fatalf("segunda mudança: %v", err)
	}
	if _, err := r.ops.NetworkConfirm(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if r.ops.PendingDeadline() != (time.Time{}) {
		t.Fatal("confirmada continua pendente")
	}
	nj, _ := ParseNetwork([]byte(read(t, r.paths.NetworkJSON)))
	if nj.NetworkVersion != 1 || nj.IT.Mode != "static" || nj.IT.MAC != "2c:f7:f1:00:00:02" || nj.Origin != "local" {
		t.Fatalf("network.json: %+v", nj)
	}
	if _, err := r.ops.NetworkConfirm(ctx, nil); opCode(err) != ErrNothingPending {
		t.Fatalf("confirmar de novo: %v", err)
	}
}

// Sem confirmação: o NetworkManager volta sozinho e o ajudante devolve os arquivos.
func TestNetworkApplyExpires(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	before := read(t, r.paths.NetworkJSON)
	if _, err := r.ops.NetworkApply(ctx, staticIT(t)); err != nil {
		t.Fatal(err)
	}
	if undone, _ := r.ops.Reconcile(ctx); undone {
		t.Fatal("desfez antes do prazo")
	}
	r.advance(ConfirmTimeout + reconcileGrace)
	if undone, err := r.ops.Reconcile(ctx); !undone || err != nil {
		t.Fatalf("reconcile: %v %v", undone, err)
	}
	if read(t, r.paths.NetworkJSON) != before {
		t.Fatal("network.json não voltou")
	}
	for _, p := range []string{r.paths.ProxyEnv, r.paths.ChronySources, filepath.Join(r.paths.NMDir, "oee-it.nmconnection")} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s deveria ter sumido (não existia antes)", p)
		}
	}
	if _, err := r.ops.NetworkConfirm(ctx, nil); opCode(err) != ErrNothingPending {
		t.Fatalf("confirmar depois: %v", err)
	}
}

func TestNetworkConfirmLate(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	if _, err := r.ops.NetworkApply(ctx, staticIT(t)); err != nil {
		t.Fatal(err)
	}
	r.advance(ConfirmTimeout)
	if _, err := r.ops.NetworkConfirm(ctx, nil); opCode(err) != ErrExpired {
		t.Fatalf("confirmar no prazo vencido: %v", err)
	}
}

func TestNetworkApplyFailsAndRollsBack(t *testing.T) {
	r := newRig(t)
	r.sys.failUp = true
	before := read(t, r.paths.NetworkJSON)
	if _, err := r.ops.NetworkApply(context.Background(), staticIT(t)); opCode(err) != ErrFailed {
		t.Fatalf("perfil que não sobe: %v", err)
	}
	if r.sys.called("rollback") != 1 || read(t, r.paths.NetworkJSON) != before || !r.ops.PendingDeadline().IsZero() {
		t.Fatalf("não voltou: %v", r.sys.calls)
	}
}

func TestNetworkRollbackAndFactoryProfile(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	if _, err := r.ops.NetworkRollback(ctx, nil); opCode(err) != ErrNothingPending {
		t.Fatalf("sem pendente: %v", err)
	}
	if _, err := r.ops.NetworkApply(ctx, json.RawMessage(`{"profile":"factory"}`)); err != nil {
		t.Fatal(err)
	}
	ot := read(t, filepath.Join(r.paths.NMDir, "oee-ot.nmconnection"))
	if strings.Contains(ot, "192.168.10.250") || !strings.Contains(ot, "address1=169.254.127.58/16") {
		t.Fatalf("perfil de fábrica: %s", ot)
	}
	if _, err := r.ops.NetworkRollback(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if read(t, r.paths.NetworkJSON) != factoryJSON {
		t.Fatal("rollback não devolveu o network.json")
	}
}

func TestNetworkValidation(t *testing.T) {
	r := newRig(t)
	gw := "10.30.0.1"
	cases := map[string]func(n *Network){
		"gateway fora": func(n *Network) {
			n.IT = ITNet{Mode: "static", Addresses: []string{"10.20.0.50/24"}, Gateway: &gw, DNS: []string{"1.1.1.1"}, IPv6: "disabled"}
		},
		"rota padrão na OT": func(n *Network) { n.OT.Routes = []OTRoute{{To: "0.0.0.0/0", Via: "192.168.10.1"}} },
		"via fora da OT":    func(n *Network) { n.OT.Routes = []OTRoute{{To: "192.168.20.0/24", Via: "10.0.0.1"}} },
		"serviço fora":      func(n *Network) { n.OT.ServiceAddress = "169.254.0.5/16" },
		"OT em 169.254":     func(n *Network) { n.OT.Addresses = []string{"169.254.10.1/16"} },
		"sobreposição": func(n *Network) {
			g := "192.168.10.1"
			n.IT = ITNet{Mode: "static", Addresses: []string{"192.168.10.20/24"}, Gateway: &g, DNS: []string{"1.1.1.1"}, IPv6: "disabled"}
		},
		"proxy com quebra de linha": func(n *Network) { n.Proxy = &Proxy{URL: "http://p:3128\nX=1"} },
		"proxy sem porta":           func(n *Network) { n.Proxy = &Proxy{URL: "http://proxy"} },
		"ntp com espaço":            func(n *Network) { n.NTP.Servers = []string{"a b"} },
		"ipv6":                      func(n *Network) { n.IT.IPv6 = "auto" },
		"ca inválida":               func(n *Network) { s := "não é PEM"; n.CABundlePEM = &s },
	}
	for name, mut := range cases {
		t.Run(name, func(t *testing.T) {
			n, _ := ParseNetwork([]byte(factoryJSON))
			mut(n)
			b, _ := json.Marshal(NetworkApplyParams{Network: n})
			if _, err := r.ops.NetworkApply(context.Background(), b); opCode(err) != ErrInvalidParams {
				t.Fatalf("deveria recusar: %v", err)
			}
		})
	}
	for name, raw := range map[string]string{
		"campo desconhecido": `{"network":` + strings.Replace(factoryJSON, `"origin"`, `"vlan_id": 5, "origin"`, 1) + `}`,
		"dois modos":         `{"profile":"factory","network":` + factoryJSON + `}`,
		"perfil estranho":    `{"profile":"aberto"}`,
		"parâmetro extra":    `{"profile":"factory","shell":"rm"}`,
	} {
		if _, err := r.ops.NetworkApply(context.Background(), json.RawMessage(raw)); opCode(err) != ErrInvalidParams {
			t.Errorf("%s: %v", name, err)
		}
	}
	if r.sys.called("create") != 0 {
		t.Fatal("pedido inválido chegou ao NetworkManager")
	}
}

func TestClockSet(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	if _, err := r.ops.ClockSet(ctx, json.RawMessage(`{"time":"2026-11-24T12:00:00-03:00"}`)); err != nil {
		t.Fatal(err)
	}
	if !r.sys.clock.Equal(time.Date(2026, 11, 24, 15, 0, 0, 0, time.UTC)) {
		t.Fatalf("relógio: %v", r.sys.clock)
	}
	for _, bad := range []string{`{"time":"ontem"}`, `{"time":"1999-01-01T00:00:00Z"}`, `{}`, `{"time":"2026-11-24T12:00:00Z","x":1}`} {
		if _, err := r.ops.ClockSet(ctx, json.RawMessage(bad)); opCode(err) != ErrInvalidParams {
			t.Errorf("%s: %v", bad, err)
		}
	}
	r.sys.ntpSynced = true
	if _, err := r.ops.ClockSet(ctx, json.RawMessage(`{"time":"2026-11-24T12:00:00Z"}`)); opCode(err) != ErrNTPSynced {
		t.Fatalf("com NTP: %v", err)
	}
}

func TestFactoryReset(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	for _, f := range []string{"credentials.json", "buffer.db", "buffer.db-wal", "gateway-extra.txt"} {
		_ = os.WriteFile(filepath.Join(r.paths.AgentState, f), []byte("x"), 0o600)
	}
	_ = os.MkdirAll(filepath.Join(r.paths.LocalUIState, "tls"), 0o700)
	_ = os.WriteFile(filepath.Join(r.paths.LocalUIState, "password.hash"), []byte("h"), 0o600)
	if _, err := r.ops.FactoryReset(ctx, json.RawMessage(`{"confirm":"egw-00041"}`)); opCode(err) != ErrInvalidParams {
		t.Fatalf("hostname errado: %v", err)
	}
	if _, err := os.Stat(filepath.Join(r.paths.AgentState, "credentials.json")); err != nil {
		t.Fatal("confirmação errada apagou algo")
	}
	if _, err := r.ops.FactoryReset(ctx, json.RawMessage(`{"confirm":"egw-00042"}`)); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"credentials.json", "buffer.db", "buffer.db-wal"} {
		if _, err := os.Stat(filepath.Join(r.paths.AgentState, gone)); !os.IsNotExist(err) {
			t.Errorf("%s ficou", gone)
		}
	}
	for _, kept := range []string{filepath.Join(r.paths.AgentState, "gateway-extra.txt"), filepath.Join(r.paths.LocalUIState, "password.hash")} {
		if _, err := os.Stat(kept); err != nil {
			t.Errorf("%s não podia sumir", kept)
		}
	}
	if r.sys.called("stop oee-gateway.service") != 1 || r.sys.called("start oee-gateway.service") != 1 {
		t.Fatalf("units: %v", r.sys.calls)
	}
	nj, _ := ParseNetwork([]byte(read(t, r.paths.NetworkJSON)))
	if nj.Origin != "factory" || len(nj.OT.Addresses) != 0 || nj.IT.Mode != "dhcp" {
		t.Fatalf("rede de fábrica: %+v", nj)
	}
}

func TestUSBRead(t *testing.T) {
	r := newRig(t)
	res, _ := r.ops.USBRead(context.Background(), nil)
	if res.(map[string]any)["mounted"] != false {
		t.Fatalf("sem pendrive: %v", res)
	}
	_ = os.MkdirAll(r.paths.USBDir, 0o755)
	_ = os.WriteFile(filepath.Join(r.paths.USBDir, "net-reset"), nil, 0o644)
	_ = os.Symlink("/etc/shadow", filepath.Join(r.paths.USBDir, "diag"))
	res, _ = r.ops.USBRead(context.Background(), nil)
	files := res.(map[string]any)["files"].(map[string]bool)
	if !files["net-reset"] || files["diag"] {
		t.Fatalf("arquivos (link simbólico não conta): %v", files)
	}
	if _, err := r.ops.USBRead(context.Background(), json.RawMessage(`{"path":"/etc"}`)); opCode(err) != ErrInvalidParams {
		t.Fatalf("parâmetro: %v", err)
	}
}

// Pelo socket: o agente aplica a rede; o reset de fábrica continua só para root; o
// ajudante não sai ocioso com mudança pendente.
func TestServerWithOps(t *testing.T) {
	r := newRig(t)
	var who atomic.Value
	who.Store(Peer{UID: 990, GID: 990})
	s := &Server{AgentGID: 990, Log: quiet, Ops: r.ops, IdleExit: 30 * time.Millisecond,
		peer: func(net.Conn) (Peer, error) { return who.Load().(Peer), nil }}
	sock := filepath.Join(t.TempDir(), "h.sock")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(context.Background(), l) }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := Call(ctx, sock, Request{Op: OpNetworkApply, Params: staticIT(t)})
	if err != nil || !resp.OK {
		t.Fatalf("apply: %+v %v", resp, err)
	}
	resp, _ = Call(ctx, sock, Request{Op: OpFactoryReset, Params: json.RawMessage(`{"confirm":"egw-00042"}`)})
	if code(resp) != ErrForbidden {
		t.Fatalf("reset pelo agente: %+v", resp)
	}
	time.Sleep(100 * time.Millisecond) // > IdleExit: pendente segura o ajudante
	select {
	case <-done:
		t.Fatal("saiu ocioso com mudança de rede pendente")
	default:
	}
	resp, _ = Call(ctx, sock, Request{Op: OpNetworkConfirm})
	if !resp.OK {
		t.Fatalf("confirm: %+v", resp)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("não saiu ocioso depois de confirmar")
	}
}
