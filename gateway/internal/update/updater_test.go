package update

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// fakeDeb é um "pacote" cujo conteúdo diz os campos: o fakeSys o lê como o dpkg-deb.
func fakeDeb(version, arch string) []byte {
	return []byte(fmt.Sprintf("oee-gateway|%s|%s\nconteúdo do pacote %s\n", DebVersion(version), arch, version))
}

type fakeSys struct {
	mu         sync.Mutex
	installed  string
	failFor    string // Install falha para esta versão
	installs   []string
	restarts   int
	configured int
	started    int
}

func (f *fakeSys) DebFields(_ context.Context, deb string) (string, string, string, error) {
	b, err := os.ReadFile(deb)
	if err != nil {
		return "", "", "", err
	}
	line, _, _ := strings.Cut(string(b), "\n")
	p := strings.Split(line, "|")
	if len(p) != 3 {
		return "", "", "", errors.New("não é .deb")
	}
	return p[0], p[1], p[2], nil
}

func (f *fakeSys) InstalledVersion(context.Context, string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.installed, nil
}

func (f *fakeSys) Arch(context.Context) (string, error) { return "arm64", nil }

func (f *fakeSys) Install(ctx context.Context, deb string) error {
	_, ver, _, err := f.DebFields(ctx, deb)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.installs = append(f.installs, ver)
	if ver == f.failFor {
		return errors.New("dpkg: erro no postinst")
	}
	f.installed = ver
	return nil
}

func (f *fakeSys) ConfigurePending(context.Context) error {
	f.mu.Lock()
	f.configured++
	f.mu.Unlock()
	return nil
}
func (f *fakeSys) RestartAgent(context.Context) error {
	f.mu.Lock()
	f.restarts++
	f.mu.Unlock()
	return nil
}
func (f *fakeSys) StartUpdater(context.Context) error {
	f.mu.Lock()
	f.started++
	f.mu.Unlock()
	return nil
}

type env struct {
	t      *testing.T
	priv   ed25519.PrivateKey
	keys   []ed25519.PublicKey
	sys    *fakeSys
	u      *Updater
	xfer   string
	src    string // onde ficam os pacotes "publicados"
	buffer string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	e := &env{t: t, priv: priv, keys: []ed25519.PublicKey{pub}, sys: &fakeSys{},
		xfer: filepath.Join(dir, "oee-gateway/update"), src: filepath.Join(dir, "pub"), buffer: filepath.Join(dir, "oee-gateway/buffer.db")}
	for _, d := range []string{e.xfer, e.src} {
		if err := os.MkdirAll(d, 0o750); err != nil {
			t.Fatal(err)
		}
	}
	e.u = &Updater{UpdateDir: e.xfer, StateDir: filepath.Join(dir, "updater"), Keys: e.keys, BufferPath: e.buffer,
		Sys: e.sys, Log: quiet, HealthTimeout: 300 * time.Millisecond, Poll: 5 * time.Millisecond}
	return e
}

// publish gera .deb, manifesto e assinatura em src/<versão>/.
func (e *env) publish(version string, extra map[string]any) (manifest, sig, deb string) {
	e.t.Helper()
	d := filepath.Join(e.src, version)
	_ = os.MkdirAll(d, 0o755)
	body := fakeDeb(version, "arm64")
	n, sum, _ := Digest(strings.NewReader(string(body)))
	m := map[string]any{"package": "oee-gateway", "version": version, "arch": "arm64", "sha256": sum, "size": n, "url": "pkg.deb"}
	for k, v := range extra {
		m[k] = v
	}
	mb, _ := json.Marshal(m)
	deb, manifest, sig = filepath.Join(d, "pkg.deb"), filepath.Join(d, "m.json"), filepath.Join(d, "m.json.sig")
	_ = os.WriteFile(deb, body, 0o644)
	_ = os.WriteFile(manifest, mb, 0o644)
	_ = os.WriteFile(sig, SignManifest(e.priv, mb), 0o644)
	return manifest, sig, deb
}

// seed instala e registra a versão de partida.
func (e *env) seed(version string, extra map[string]any) {
	e.t.Helper()
	m, s, d := e.publish(version, extra)
	e.sys.installed = DebVersion(version)
	if err := e.u.Seed(context.Background(), m, s, d); err != nil {
		e.t.Fatal(err)
	}
}

// request faz o papel do agente: copia os arquivos e grava o pedido.
func (e *env) request(version string) {
	e.t.Helper()
	d := filepath.Join(e.src, version)
	for src, dst := range map[string]string{"pkg.deb": PackageFile, "m.json": ManifestFile, "m.json.sig": SignatureFile} {
		b, err := os.ReadFile(filepath.Join(d, src))
		if err != nil {
			e.t.Fatal(err)
		}
		_ = os.WriteFile(filepath.Join(e.xfer, dst), b, 0o640)
	}
	if err := writeJSON(filepath.Join(e.xfer, RequestFile), Request{ID: "req-1", Version: version}, 0o640); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) result() Result {
	e.t.Helper()
	var r Result
	if err := readJSON(filepath.Join(e.xfer, ResultFile), 1<<20, &r); err != nil {
		e.t.Fatal(err)
	}
	return r
}

// agentHealthy simula o agente novo: grava health.json quando a versão sobe.
func (e *env) agentHealthy(ctx context.Context, version string) {
	go func() {
		for ctx.Err() == nil {
			e.sys.mu.Lock()
			up := e.sys.installed == DebVersion(version) && e.sys.restarts > 0
			e.sys.mu.Unlock()
			if up {
				_, _ = WriteHealth(e.xfer, version, time.Now())
				return
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()
}

func (e *env) noLeftovers() {
	e.t.Helper()
	for _, n := range []string{RequestFile, PackageFile, ManifestFile, SignatureFile} {
		if _, err := os.Lstat(filepath.Join(e.xfer, n)); err == nil {
			e.t.Errorf("%s ficou no diretório de troca", n)
		}
	}
	if _, err := os.Stat(e.u.statePath()); err == nil {
		e.t.Error("state.json ficou")
	}
}

func TestApplyHealthy(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", map[string]any{"allowed_rollback_to": []string{"0.9.0"}})
	e.publish("1.1.0-rc.1", nil)
	e.request("1.1.0-rc.1")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.agentHealthy(ctx, "1.1.0-rc.1")
	if err := e.u.Apply(ctx); err != nil {
		t.Fatal(err)
	}
	if r := e.result(); r.Status != "applied" || r.Version != "1.1.0-rc.1" || r.Previous != "1.0.0" || r.ID != "req-1" {
		t.Fatalf("resultado: %+v", r)
	}
	if e.sys.installed != "1.1.0~rc.1" {
		t.Fatalf("instalado: %s", e.sys.installed)
	}
	if m, err := e.u.verifyDir(e.u.dir("current")); err != nil || m.Version != "1.1.0-rc.1" {
		t.Fatalf("current/: %v %v", m, err)
	}
	if m, err := e.u.verifyDir(e.u.dir("previous")); err != nil || m.Version != "1.0.0" {
		t.Fatalf("previous/: %v %v", m, err)
	}
	e.noLeftovers()
}

func TestApplyRollbackOnHealthTimeout(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil)
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	if err := e.u.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	r := e.result()
	if r.Status != "rolled_back" || r.Reason != "health_timeout" {
		t.Fatalf("resultado: %+v", r)
	}
	if e.sys.installed != "1.0.0" || strings.Join(e.sys.installs, ",") != "1.1.0,1.0.0" {
		t.Fatalf("dpkg: instalado %s, instalações %v", e.sys.installed, e.sys.installs)
	}
	if m, _ := e.u.verifyDir(e.u.dir("current")); m.Version != "1.0.0" {
		t.Fatalf("current/ deveria continuar 1.0.0: %v", m.Version)
	}
	e.noLeftovers()
}

func TestApplyRollbackOnInstallFailure(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil)
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	e.sys.failFor = "1.1.0"
	_ = e.u.Apply(context.Background())
	if r := e.result(); r.Status != "rolled_back" || r.Reason != "install_failed" || e.sys.installed != "1.0.0" {
		t.Fatalf("resultado: %+v, instalado %s", r, e.sys.installed)
	}
}

// L25: o agente novo migrou o buffer para um esquema que o anterior não abre; o
// rollback automático é recusado e o novo fica.
func TestApplyRollbackRefusedBySchema(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil) // manifesto sem buffer_schema = 1
	e.publish("2.0.0", map[string]any{"buffer_schema": 2})
	e.request("2.0.0")
	// O agente 2.0.0 sobe, migra o buffer para o esquema 2 e não fica saudável.
	go func() {
		for {
			e.sys.mu.Lock()
			up := e.sys.installed == "2.0.0"
			e.sys.mu.Unlock()
			if up {
				setUserVersion(t, e.buffer, 2)
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	err := e.u.Apply(context.Background())
	if !errors.Is(err, ErrRollbackSchema) {
		t.Fatalf("Apply: %v", err)
	}
	if r := e.result(); r.Status != "rollback_refused" || e.sys.installed != "2.0.0" {
		t.Fatalf("resultado: %+v, instalado %s", r, e.sys.installed)
	}
	e.noLeftovers()
}

func setUserVersion(t *testing.T, path string, v int) {
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Error(err)
		return
	}
	defer db.Close()
	if _, err := db.Exec(fmt.Sprintf("PRAGMA user_version = %d", v)); err != nil {
		t.Error(err)
	}
}

func TestApplyRejects(t *testing.T) {
	cases := map[string]struct {
		prep   func(e *env)
		reason string
	}{
		"assinatura de outra chave": {func(e *env) {
			_, other, _ := ed25519.GenerateKey(rand.Reader)
			mb, _ := os.ReadFile(filepath.Join(e.xfer, ManifestFile))
			_ = os.WriteFile(filepath.Join(e.xfer, SignatureFile), SignManifest(other, mb), 0o640)
		}, "verification_failed"},
		"manifesto alterado depois de assinado": {func(e *env) {
			mb, _ := os.ReadFile(filepath.Join(e.xfer, ManifestFile))
			_ = os.WriteFile(filepath.Join(e.xfer, ManifestFile), []byte(strings.Replace(string(mb), `"arm64"`, `"arm64" `, 1)), 0o640)
		}, "verification_failed"},
		"pacote trocado": {func(e *env) {
			_ = os.WriteFile(filepath.Join(e.xfer, PackageFile), fakeDeb("6.6.6", "arm64"), 0o640)
		}, "verification_failed"},
		"pacote é link simbólico": {func(e *env) {
			p := filepath.Join(e.xfer, PackageFile)
			_ = os.Rename(p, p+".real")
			_ = os.Symlink(p+".real", p)
		}, "verification_failed"},
		"versão mais antiga fora da lista": {func(e *env) {
			e.publish("0.9.0", nil)
			e.request("0.9.0")
		}, "downgrade_not_allowed"},
		"pedido de outra versão": {func(e *env) {
			_ = writeJSON(filepath.Join(e.xfer, RequestFile), Request{ID: "x", Version: "9.9.9"}, 0o640)
		}, "verification_failed"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			e.seed("1.0.0", nil)
			e.publish("1.1.0", nil)
			e.request("1.1.0")
			c.prep(e)
			if err := e.u.Apply(context.Background()); err == nil {
				t.Fatal("deveria recusar")
			}
			if r := e.result(); r.Status != "rejected" || r.Reason != c.reason {
				t.Fatalf("resultado: %+v", r)
			}
			if len(e.sys.installs) != 0 { // o seed não chama o dpkg
				t.Fatalf("instalou algo: %v", e.sys.installs)
			}
			e.noLeftovers()
		})
	}
}

func TestApplyAllowedDowngradeAndUnchanged(t *testing.T) {
	e := newEnv(t)
	e.seed("1.1.0", map[string]any{"allowed_rollback_to": []string{"1.0.0"}})
	e.publish("1.0.0", nil)
	e.request("1.0.0")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.agentHealthy(ctx, "1.0.0")
	if err := e.u.Apply(ctx); err != nil {
		t.Fatal(err)
	}
	if r := e.result(); r.Status != "applied" || e.sys.installed != "1.0.0" {
		t.Fatalf("volta manual permitida: %+v", r)
	}
	e.request("1.0.0")
	if err := e.u.Apply(ctx); err != nil {
		t.Fatal(err)
	}
	if r := e.result(); r.Status != "unchanged" {
		t.Fatalf("mesma versão: %+v", r)
	}
}

func TestApplyWithoutSeed(t *testing.T) {
	e := newEnv(t)
	e.sys.installed = "1.0.0"
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	if err := e.u.Apply(context.Background()); !errors.Is(err, ErrNoPrevious) {
		t.Fatalf("sem seed: %v", err)
	}
	if r := e.result(); r.Reason != "no_previous_package" {
		t.Fatalf("resultado: %+v", r)
	}
	// Seed que não é o instalado também não vale.
	e2 := newEnv(t)
	m, s, d := e2.publish("1.0.0", nil)
	e2.sys.installed = "0.9.0"
	if err := e2.u.Seed(context.Background(), m, s, d); err == nil {
		t.Fatal("seed de versão não instalada")
	}
}

func TestNothingToDo(t *testing.T) {
	e := newEnv(t)
	if err := e.u.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := e.u.BootCheck(context.Background()); err != nil || e.sys.configured != 0 || e.sys.started != 0 {
		t.Fatalf("boot-check sem atualização: %v %+v", err, e.sys)
	}
}

// Queda de energia esperando a saúde: o boot-check conserta o dpkg e enfileira o
// apply, que retoma com prazo cheio.
func TestResumeAfterReboot(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil)
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		for {
			e.sys.mu.Lock()
			r := e.sys.restarts
			e.sys.mu.Unlock()
			if r > 0 {
				cancel() // "desligou" durante a espera
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	if err := e.u.Apply(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Apply interrompido: %v", err)
	}
	if st, _ := e.u.loadState(); st == nil || st.Phase != phaseWaiting {
		t.Fatalf("estado: %+v", st)
	}
	if err := e.u.BootCheck(context.Background()); err != nil || e.sys.configured != 1 || e.sys.started != 1 {
		t.Fatalf("boot-check: %v %+v", err, e.sys)
	}
	// O pedido sumiu (o agente apagou?): o apply retoma pelo state.json.
	_ = os.Remove(filepath.Join(e.xfer, RequestFile))
	_ = writeJSON(filepath.Join(e.xfer, RequestFile), Request{ID: "req-1", Version: "1.1.0"}, 0o640)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	e.agentHealthy(ctx2, "1.1.0")
	if err := e.u.Apply(ctx2); err != nil {
		t.Fatal(err)
	}
	if r := e.result(); r.Status != "applied" {
		t.Fatalf("resultado: %+v", r)
	}
}

// Instalação interrompida no meio do dpkg: volta ao anterior.
func TestResumeInterruptedInstall(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil)
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	if _, err := e.u.stage(context.Background(), Request{Version: "1.1.0"}); err != nil {
		t.Fatal(err)
	}
	_ = writeJSON(e.u.statePath(), state{ID: "req-1", Phase: phaseInstalling, Target: "1.1.0", Previous: "1.0.0",
		StartedAt: time.Now()}, 0o600)
	_ = e.u.Apply(context.Background())
	if r := e.result(); r.Status != "rolled_back" || r.Reason != "interrupted" || e.sys.installed != "1.0.0" {
		t.Fatalf("resultado: %+v, instalado %s", r, e.sys.installed)
	}
}

func TestFetch(t *testing.T) {
	e := newEnv(t)
	man, sig, deb := e.publish("1.1.0", nil)
	files := map[string]string{"/r/m.json": man, "/r/m.json.sig": sig, "/r/pkg.deb": deb}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, p)
	}))
	defer srv.Close()
	arch := GoArch()
	if arch != "arm64" {
		// o pacote de teste é arm64: republica para a arquitetura desta máquina
		body := fakeDeb("1.1.0", arch)
		_ = os.WriteFile(deb, body, 0o644)
		n, sum, _ := Digest(strings.NewReader(string(body)))
		mb, _ := json.Marshal(map[string]any{"package": "oee-gateway", "version": "1.1.0", "arch": arch, "sha256": sum, "size": n, "url": "pkg.deb"})
		_ = os.WriteFile(man, mb, 0o644)
		_ = os.WriteFile(sig, SignManifest(e.priv, mb), 0o644)
	}
	o := FetchOptions{ManifestURL: srv.URL + "/r/m.json", Dir: e.xfer, Keys: e.keys, Client: srv.Client(), RequestID: "cmd-1"}
	if _, err := Fetch(context.Background(), o); err == nil || !strings.Contains(err.Error(), "só https") {
		t.Fatalf("http sem AllowHTTP: %v", err)
	}
	o.AllowHTTP = true
	m, err := Fetch(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	var req Request
	if err := readJSON(filepath.Join(e.xfer, RequestFile), 4096, &req); err != nil || req.Version != m.Version || req.ID != "cmd-1" {
		t.Fatalf("pedido: %+v %v", req, err)
	}
	if _, err := Fetch(context.Background(), o); !errors.Is(err, ErrBusy) {
		t.Fatalf("segundo pedido: %v", err)
	}
	if ok, err := WriteHealth(e.xfer, "1.1.0", time.Now()); !ok || err != nil {
		t.Fatalf("health com pedido: %v %v", ok, err)
	}
	// Assinatura de outra chave: nada é gravado.
	_ = os.RemoveAll(e.xfer)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	mb, _ := os.ReadFile(man)
	_ = os.WriteFile(sig, SignManifest(other, mb), 0o644)
	if _, err := Fetch(context.Background(), o); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("assinatura falsa: %v", err)
	}
	if _, err := os.Stat(filepath.Join(e.xfer, RequestFile)); err == nil {
		t.Fatal("pedido gravado com assinatura falsa")
	}
	if ok, _ := WriteHealth(e.xfer, "1.1.0", time.Now()); ok {
		t.Fatal("health sem pedido")
	}
}

func TestKeysAndVersions(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadKeys(dir); !errors.Is(err, ErrNoKeys) {
		t.Fatalf("sem chave: %v", err)
	}
	_ = os.WriteFile(filepath.Join(dir, "ota.pub"), []byte("# comentário\nnão-base64\n"), 0o644)
	if _, err := LoadKeys(dir); err == nil {
		t.Fatal("chave ilegível aceita")
	}
	for _, c := range []struct {
		a, b string
		want int
	}{{"1.0.0", "1.0.1", -1}, {"1.10.0", "1.9.9", 1}, {"1.0.0-rc.1", "1.0.0", -1}, {"1.0.0-rc.2", "1.0.0-rc.10", -1},
		{"1.0.0-alpha", "1.0.0-1", 1}, {"2.0.0", "2.0.0", 0}} {
		if got, err := CompareVersions(c.a, c.b); err != nil || got != c.want {
			t.Errorf("%s × %s = %d (%v), esperado %d", c.a, c.b, got, err, c.want)
		}
	}
	if DebVersion("1.2.0-rc.1") != "1.2.0~rc.1" || DebVersion("1.2.0") != "1.2.0" {
		t.Fatal("DebVersion")
	}
}

// O diretório de troca é do usuário oee: trocado por um link simbólico (ex.: para
// /etc), o root não lê, não apaga e não cria nada pelo link.
func TestXferDirSymlinkNotFollowed(t *testing.T) {
	e := newEnv(t)
	e.seed("1.0.0", nil)
	e.publish("1.1.0", nil)
	e.request("1.1.0")
	real := e.xfer + ".real"
	if err := os.Rename(e.xfer, real); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, e.xfer); err != nil {
		t.Fatal(err)
	}
	if err := e.u.Apply(context.Background()); err == nil {
		t.Fatal("seguiu o link do diretório de troca")
	}
	if len(e.sys.installs) != 0 {
		t.Fatalf("instalou pelo link: %v", e.sys.installs)
	}
	for _, n := range []string{RequestFile, PackageFile} {
		if _, err := os.Stat(filepath.Join(real, n)); err != nil {
			t.Errorf("%s apagado pelo link: %v", n, err)
		}
	}
	if _, err := os.Stat(filepath.Join(real, ResultFile)); err == nil {
		t.Error("result.json criado pelo link")
	}
}
