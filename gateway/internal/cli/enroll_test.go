package cli

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

const (
	oldGatewayID = "01a1c5d4-0000-752e-89a7-834df2a74de4"
	oldToken     = "gw_test_tokenAntigoRevogado0000000000000000000000000"
	newGatewayID = "01a1c5d4-9208-752e-89a7-834df2a74de4"
	newToken     = "gw_test_8f2cJ3kq0V1mZ9xYtR4pL6wE2sA7dF5gH8jK1lQ0nB3"
)

// enrollCloud responde ao /enroll com uma credencial nova e conta as chamadas.
func enrollCloud(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"gateway_id":"` + newGatewayID + `","token":"` + newToken + `","org":"acme"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// enrolledLocal cria o gateway.yaml e uma credencial já gravada (gateway antigo).
func enrolledLocal(t *testing.T, cloudURL string) (cfgPath, credPath string) {
	t.Helper()
	cfgPath, dir := writeLocal(t, cloudURL)
	credPath = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(credPath, &config.Credentials{GatewayID: oldGatewayID, Token: oldToken, Org: "acme", CloudURL: cloudURL}); err != nil {
		t.Fatal(err)
	}
	return cfgPath, credPath
}

// credDirOwnedBy faz o enroll enxergar outro dono no diretório da credencial.
func credDirOwnedBy(t *testing.T, uid int, name string) {
	t.Helper()
	prev := credDirOwner
	credDirOwner = func(string) (int, string, error) { return uid, name, nil }
	t.Cleanup(func() { credDirOwner = prev })
}

// Como root, com o diretório da credencial do agente (oee), a credencial ficaria
// com dono root e o agente não a leria: o enroll recusa antes de gastar o código e
// ensina o comando certo.
func TestEnrollRefusesRoot(t *testing.T) {
	asUser(t, 0)
	credDirOwnedBy(t, 999, "oee")
	srv, calls := enrollCloud(t)
	cfgPath, dir := writeLocal(t, srv.URL)

	for _, extra := range [][]string{nil, {"--force"}} {
		args := append([]string{"enroll", "--config", cfgPath, "--code", "abcd1234", "--hostname", "egw-00042"}, extra...)
		_, errOut, code := run(t, args...)
		if code == 0 || !strings.Contains(errOut, "root") || !strings.Contains(errOut, "sudo -u oee oee-gateway enroll --code ABCD-1234") {
			t.Fatalf("enroll como root %v: código %d, stderr %q", extra, code, errOut)
		}
	}
	// Dono sem nome no /etc/passwd: o uid vai entre aspas para o shell.
	credDirOwnedBy(t, 1234, "#1234")
	if _, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code == 0 ||
		!strings.Contains(errOut, "sudo -u '#1234' oee-gateway enroll --code ABCD-1234") {
		t.Fatalf("dono sem nome: código %d, stderr %q", code, errOut)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("como root não pode chamar a nuvem (o código é de uso único): %d chamada(s)", n)
	}
	if _, err := os.Stat(filepath.Join(dir, "credentials.json")); !os.IsNotExist(err) {
		t.Fatalf("não deveria gravar credencial como root: %v", err)
	}
}

// Como root com o diretório da credencial também de root (bancada, teste ponta a
// ponta em contêiner/CI como root, com o agente rodando como root), a credencial
// fica legível para quem vai lê-la: o enroll segue.
func TestEnrollAsRootWithRootOwnedStateDir(t *testing.T) {
	asUser(t, 0)
	credDirOwnedBy(t, 0, "root")
	srv, calls := enrollCloud(t)
	cfgPath, dir := writeLocal(t, srv.URL)
	if out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code != 0 ||
		!strings.Contains(out, "Gateway registrado") {
		t.Fatalf("enroll como root com diretório de root: código %d, saída %q, stderr %q", code, out, errOut)
	}
	if creds, err := config.LoadCredentials(filepath.Join(dir, "credentials.json")); err != nil || creds == nil || creds.Token != newToken || calls.Load() != 1 {
		t.Fatalf("credencial: %+v (%v), chamadas %d", creds, err, calls.Load())
	}
}

// dirOwner olha o diretório da credencial ou, se ele ainda não existe, o primeiro
// ancestral que existe.
func TestDirOwner(t *testing.T) {
	dir := t.TempDir()
	for _, path := range []string{filepath.Join(dir, "credentials.json"), filepath.Join(dir, "falta", "mais", "credentials.json")} {
		uid, name, err := dirOwner(path)
		if err != nil || uid != os.Getuid() || name == "" {
			t.Fatalf("%s: uid %d nome %q (%v); quer uid %d", path, uid, name, err, os.Getuid())
		}
	}
}

// Credencial existente e nenhum 401 marcado pelo agente: sem --force, recusa (e
// não gasta o código de ativação).
func TestEnrollKeepsCredentialsWithoutBlockedMarker(t *testing.T) {
	asUser(t, 999)
	srv, calls := enrollCloud(t)
	cfgPath, credPath := enrolledLocal(t, srv.URL)

	_, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042")
	if code == 0 || !strings.Contains(errOut, "já registrado") || !strings.Contains(errOut, "--force") || !strings.Contains(errOut, oldGatewayID) {
		t.Fatalf("enroll sem marcador: código %d, stderr %q", code, errOut)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("não deveria chamar a nuvem: %d chamada(s)", n)
	}
	if creds, err := config.LoadCredentials(credPath); err != nil || creds.Token != oldToken {
		t.Fatalf("credencial deveria ficar intacta: %+v (%v)", creds, err)
	}
}

// Credencial recusada pela nuvem (marcador do agente presente): o técnico, sem
// --force (o sudo dele recusa), registra de novo; o marcador é apagado.
func TestEnrollReplacesCredentialsRefusedByCloud(t *testing.T) {
	asUser(t, 999)
	srv, calls := enrollCloud(t)
	cfgPath, credPath := enrolledLocal(t, srv.URL)
	marker := uplink.BlockedMarkerPath(credPath)
	if err := uplink.WriteBlockedMarker(marker, &uplink.BlockedMarker{
		Since: "2026-11-10T08:00:00Z", Last: "2026-11-12T08:00:00Z", Status: 401, Code: "token_revoked",
	}); err != nil {
		t.Fatal(err)
	}

	out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042")
	if code != 0 {
		t.Fatalf("enroll com marcador: código %d, stderr %q", code, errOut)
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("chamadas ao /enroll: %d", n)
	}
	creds, err := config.LoadCredentials(credPath)
	if err != nil || creds.Token != newToken || creds.GatewayID != newGatewayID {
		t.Fatalf("credencial deveria ser a nova: %+v (%v)", creds, err)
	}
	for _, want := range []string{"Gateway registrado", "Credencial anterior (gateway " + oldGatewayID, "substituída", "2026-11-10T08:00:00Z", "token_revoked"} {
		if !strings.Contains(out, want) {
			t.Errorf("saída sem %q:\n%s", want, out)
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("o marcador deveria ser apagado depois do novo registro: %v", err)
	}
	// Sem marcador de novo, um segundo enroll volta a exigir --force.
	if _, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code == 0 || !strings.Contains(errOut, "já registrado") {
		t.Fatalf("segundo enroll: código %d, stderr %q", code, errOut)
	}
}

// Marcador ilegível (só o agente grava o arquivo) ainda conta como recusa.
func TestEnrollAcceptsUnreadableMarkerContent(t *testing.T) {
	asUser(t, 999)
	srv, _ := enrollCloud(t)
	cfgPath, credPath := enrolledLocal(t, srv.URL)
	if err := os.WriteFile(uplink.BlockedMarkerPath(credPath), []byte("{corrompido"), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code != 0 || !strings.Contains(out, "substituída") {
		t.Fatalf("enroll com marcador ilegível: código %d, saída %q, stderr %q", code, out, errOut)
	}
}

// --force (administrador) continua trocando a credencial e diz o que fez.
func TestEnrollForceReportsReplacement(t *testing.T) {
	asUser(t, 999)
	srv, _ := enrollCloud(t)
	cfgPath, _ := enrolledLocal(t, srv.URL)
	out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042", "--force")
	if code != 0 || !strings.Contains(out, "substituída (--force)") {
		t.Fatalf("enroll --force: código %d, saída %q, stderr %q", code, out, errOut)
	}
}

// O diag aponta a credencial recusada pela nuvem (falha, código 2) e o caminho
// para resolver; sem o marcador, a credencial está ok.
func TestDiagReportsRefusedCredential(t *testing.T) {
	cfgPath, credPath := enrolledLocal(t, "https://localhost")
	check := func() diagCheck {
		t.Helper()
		out, _, _ := run(t, "diag", "--config", cfgPath, "--json")
		var res struct {
			Checks []diagCheck `json:"checks"`
		}
		if err := json.Unmarshal([]byte(out), &res); err != nil || len(res.Checks) < 2 {
			t.Fatalf("json: %v\n%s", err, out)
		}
		return res.Checks[1]
	}
	if c := check(); c.Name != "credencial" || c.Result != diagOK {
		t.Fatalf("sem marcador: %+v", c)
	}
	if err := uplink.WriteBlockedMarker(uplink.BlockedMarkerPath(credPath), &uplink.BlockedMarker{Since: "2026-11-10T08:00:00Z", Status: 401, Code: "token_revoked"}); err != nil {
		t.Fatal(err)
	}
	c := check()
	if c.Result != diagFail || !strings.Contains(c.Detail, "recusa o token desde 2026-11-10T08:00:00Z (token_revoked)") || !strings.Contains(c.Detail, "enroll --code") {
		t.Fatalf("com marcador: %+v", c)
	}
	if _, _, code := run(t, "diag", "--config", cfgPath); code != 2 {
		t.Fatalf("credencial recusada deveria dar código 2: %d", code)
	}
}

// clearProxyEnv zera as variáveis de proxy do teste (restauradas no fim).
func clearProxyEnv(t *testing.T) {
	t.Helper()
	for _, k := range proxyVars {
		t.Setenv(k, "")
	}
}

func TestLoadProxyEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, proxyEnvFile)
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0o640); err != nil {
			t.Fatal(err)
		}
	}

	clearProxyEnv(t)
	if applied, err := loadProxyEnv(path); applied != nil || err != nil {
		t.Fatalf("arquivo ausente: %v %v", applied, err)
	}
	write("# gerado pelo oee-helper\r\n; outro comentário\nHTTPS_PROXY=\"http://usuario:senha@proxy.cliente.local:3128\"\r\n" +
		"  NO_PROXY = 'localhost,10.0.0.0/8'\nGOMEMLIMIT=1MiB\nlinha sem igual\n")
	applied, err := loadProxyEnv(path)
	if err != nil || strings.Join(applied, ",") != "HTTPS_PROXY,NO_PROXY" {
		t.Fatalf("aplicadas: %v (%v)", applied, err)
	}
	if os.Getenv("HTTPS_PROXY") != "http://usuario:senha@proxy.cliente.local:3128" || os.Getenv("NO_PROXY") != "localhost,10.0.0.0/8" || os.Getenv("GOMEMLIMIT") == "1MiB" {
		t.Fatalf("ambiente: HTTPS_PROXY=%q NO_PROXY=%q GOMEMLIMIT=%q", os.Getenv("HTTPS_PROXY"), os.Getenv("NO_PROXY"), os.Getenv("GOMEMLIMIT"))
	}

	// Proxy já no ambiente (qualquer grafia): o arquivo não é lido.
	clearProxyEnv(t)
	t.Setenv("http_proxy", "http://do-ambiente:8080")
	if applied, err := loadProxyEnv(path); applied != nil || err != nil || os.Getenv("HTTPS_PROXY") != "" {
		t.Fatalf("com proxy no ambiente: %v %v HTTPS_PROXY=%q", applied, err, os.Getenv("HTTPS_PROXY"))
	}

	// Só NO_PROXY no arquivo não é proxy: nada muda.
	clearProxyEnv(t)
	write("NO_PROXY=localhost\nHTTPS_PROXY=\n")
	if applied, err := loadProxyEnv(path); applied != nil || err != nil || os.Getenv("NO_PROXY") != "" {
		t.Fatalf("sem proxy no arquivo: %v %v NO_PROXY=%q", applied, err, os.Getenv("NO_PROXY"))
	}

	// Ilegível: erro (o enroll avisa e segue direto).
	if _, err := loadProxyEnv(dir); err == nil {
		t.Fatal("diretório no lugar do arquivo deveria dar erro")
	}
}

// O enroll avisa de onde veio o proxy (só os nomes: a URL pode ter senha) e, se o
// arquivo não dá para ler, avisa e segue direto.
func TestEnrollReportsProxyEnv(t *testing.T) {
	asUser(t, 999)
	clearProxyEnv(t)
	srv, _ := enrollCloud(t)
	cfgPath, dir := writeLocal(t, srv.URL)
	if err := os.WriteFile(filepath.Join(dir, proxyEnvFile), []byte("HTTPS_PROXY=http://usuario:senha@127.0.0.1:9\nNO_PROXY=127.0.0.1\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042")
	if code != 0 || !strings.Contains(out, "Proxy de "+filepath.Join(dir, proxyEnvFile)+" (HTTPS_PROXY, NO_PROXY).") || strings.Contains(out+errOut, "senha") {
		t.Fatalf("código %d, saída %q, stderr %q", code, out, errOut)
	}

	clearProxyEnv(t)
	cfgPath, dir = writeLocal(t, srv.URL)
	if err := os.Mkdir(filepath.Join(dir, proxyEnvFile), 0o750); err != nil {
		t.Fatal(err)
	}
	if _, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code != 0 ||
		!strings.Contains(errOut, "aviso: proxy de "+filepath.Join(dir, proxyEnvFile)+" não aplicado") {
		t.Fatalf("proxy.env ilegível: código %d, stderr %q", code, errOut)
	}
}

// enrollChildEnv é a variável que faz o binário de teste rodar só o enroll
// (TestEnrollUsesProxyEnvFile): o transporte do Go lê o proxy do ambiente uma vez
// por processo, então o teste precisa de um processo novo.
const enrollChildEnv = "OEE_GATEWAY_TEST_ENROLL_ARGS"

// No gateway de campo o enroll roda pelo sudo do técnico (env_reset, sem o
// proxy.env da unit): com o proxy obrigatório do cliente, ele precisa sair pelo
// proxy do /etc/oee-gateway/proxy.env, como o agente.
func TestEnrollUsesProxyEnvFile(t *testing.T) {
	if raw := os.Getenv(enrollChildEnv); raw != "" {
		var args []string
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			t.Fatal(err)
		}
		os.Exit(Execute(args, os.Stdout, os.Stderr))
	}

	var connects []string
	var mu sync.Mutex
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		connects = append(connects, r.Method+" "+r.Host)
		mu.Unlock()
		w.WriteHeader(http.StatusProxyAuthRequired)
	}))
	defer proxy.Close()

	// .invalid nunca resolve: sem o proxy, o enroll falharia no DNS.
	cfgPath, dir := writeLocal(t, "https://oee.exemplo.invalid")
	if err := os.WriteFile(filepath.Join(dir, proxyEnvFile), []byte("HTTPS_PROXY="+proxy.URL+"\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal([]string{"enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"})
	child := exec.Command(os.Args[0], "-test.run=^TestEnrollUsesProxyEnvFile$")
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if !slices.ContainsFunc(proxyVars, func(p string) bool { return strings.EqualFold(p, k) }) {
			child.Env = append(child.Env, kv)
		}
	}
	child.Env = append(child.Env, enrollChildEnv+"="+string(args))
	out, err := child.CombinedOutput()
	var ee *exec.ExitError
	if !errors.As(err, &ee) || ee.ExitCode() != 1 {
		t.Fatalf("o enroll deveria falhar no 407 do proxy (código 1): %v\n%s", err, out)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(connects) == 0 || connects[0] != "CONNECT oee.exemplo.invalid:443" {
		t.Fatalf("o enroll não passou pelo proxy do %s: %v\n%s", proxyEnvFile, connects, out)
	}
	if !strings.Contains(string(out), "Proxy de "+filepath.Join(dir, proxyEnvFile)+" (HTTPS_PROXY).") ||
		!strings.Contains(string(out), "Proxy Authentication Required") {
		t.Fatalf("saída:\n%s", out)
	}
}
