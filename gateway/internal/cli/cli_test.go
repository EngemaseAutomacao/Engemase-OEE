package cli

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

func run(t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	var out, errb bytes.Buffer
	code := Execute(args, &out, &errb)
	return out.String(), errb.String(), code
}

// writeLocal cria um gateway.yaml com caminhos num diretório temporário.
func writeLocal(t *testing.T, cloudURL string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "gateway.yaml")
	yml := "cloud:\n  url: " + cloudURL + "\npaths:\n  state_dir: " + dir + "\n"
	if err := os.WriteFile(path, []byte(yml), 0o644); err != nil {
		t.Fatal(err)
	}
	return path, dir
}

func TestVersion(t *testing.T) {
	out, _, code := run(t, "version")
	if code != 0 || !strings.HasPrefix(out, "oee-gateway ") {
		t.Fatalf("version: %q (%d)", out, code)
	}
}

func TestNormalizeActivationCode(t *testing.T) {
	for in, want := range map[string]string{"abcd-1234": "ABCD-1234", "ABCD1234": "ABCD-1234", " ab cd 12 34 ": "ABCD-1234"} {
		if got, err := NormalizeActivationCode(in); err != nil || got != want {
			t.Errorf("%q → %q (%v)", in, got, err)
		}
	}
	for _, bad := range []string{"", "ABC-123", "ABCD-12345", "ABCD_1234", "ÁBCD-1234"} {
		if _, err := NormalizeActivationCode(bad); err == nil {
			t.Errorf("%q deveria ser recusado", bad)
		}
	}
}

func TestEnrollValidatesArguments(t *testing.T) {
	asUser(t, 999) // senão o teste como root pararia na recusa de root, antes da validação
	cfgPath, _ := writeLocal(t, "https://oee.exemplo.com.br")
	cases := map[string][]string{
		"sem código":         {"enroll", "--config", cfgPath},
		"código inválido":    {"enroll", "--config", cfgPath, "--code", "XYZ"},
		"URL sem HTTPS":      {"enroll", "--config", cfgPath, "--code", "ABCD-1234", "--url", "http://oee.exemplo.com.br"},
		"URL com caminho":    {"enroll", "--config", cfgPath, "--code", "ABCD-1234", "--url", "https://x.com/api"},
		"hostname inválido":  {"enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "gw_01"},
		"argumento sobrando": {"enroll", "--config", cfgPath, "--code", "ABCD-1234", "extra"},
	}
	for name, args := range cases {
		if _, errOut, code := run(t, args...); code == 0 || !strings.Contains(errOut, "erro:") {
			t.Errorf("%s: código %d, stderr %q", name, code, errOut)
		}
	}
}

// asUser faz o enroll enxergar outro euid (os testes rodam como root no contêiner).
func asUser(t *testing.T, uid int) {
	t.Helper()
	prev := geteuid
	geteuid = func() int { return uid }
	t.Cleanup(func() { geteuid = prev })
}

func TestEnrollWritesCredentials(t *testing.T) {
	asUser(t, 999)
	var got contracts.EnrollRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		zr, _ := gzip.NewReader(r.Body)
		_ = json.NewDecoder(zr).Decode(&got)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"gateway_id":"01a1c5d4-9208-752e-89a7-834df2a74de4","token":"gw_test_8f2cJ3kq0V1mZ9xYtR4pL6wE2sA7dF5gH8jK1lQ0nB3","org":"acme"}`))
	}))
	defer srv.Close()
	cfgPath, dir := writeLocal(t, srv.URL)

	out, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "abcd1234", "--hostname", "egw-00042")
	if code != 0 {
		t.Fatalf("enroll: %d %s", code, errOut)
	}
	if got.Code != "ABCD-1234" || got.Hostname != "egw-00042" || got.HW.MemMB < 1 || got.HW.Model == "" {
		t.Fatalf("requisição: %+v", got)
	}
	b, _ := json.Marshal(got)
	if errs := testutil.ValidateJSON(t, testutil.StrictSchema(t, "enroll-request"), b); errs != "" {
		t.Fatalf("enroll fora do contrato: %s", errs)
	}
	creds, err := config.LoadCredentials(filepath.Join(dir, "credentials.json"))
	if err != nil || creds == nil || creds.Org != "acme" || !strings.Contains(out, "acme") {
		t.Fatalf("credencial: %+v (%v) saída %q", creds, err, out)
	}
	// Já registrado: só com --force.
	if _, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042"); code == 0 || !strings.Contains(errOut, "já registrado") {
		t.Fatalf("segundo enroll: %d %q", code, errOut)
	}
	if _, errOut, code := run(t, "enroll", "--config", cfgPath, "--code", "ABCD-1234", "--hostname", "egw-00042", "--force"); code != 0 {
		t.Fatalf("enroll --force: %d %q", code, errOut)
	}
}

func TestModbusReadDecodesOEEBlock(t *testing.T) {
	srv, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	total, _ := modbus.Split32(100000, modbus.CDAB)
	srv.SetHolding(1000, 1, 42, 2, 520, total[0], total[1])
	srv.SetHolding(1010, 1001)

	out, errOut, code := run(t, "modbus", "read", "--target", "tcp://"+srv.Addr(), "--offset", "1000", "--oee-block", "--decode", "uint32:CDAB@4", "--decode", "uint32:ABCD@4")
	if code != 0 {
		t.Fatalf("modbus read: %d %s", code, errOut)
	}
	for _, want := range []string{"401001", "contador_total   100000", "estado           2 (falha)", "codigo_falha     520", "produto          1001", "uint32:CDAB@4 = 100000", "uint32:ABCD@4 = 2258632705"} {
		if !strings.Contains(out, want) {
			t.Errorf("saída sem %q:\n%s", want, out)
		}
	}

	out, _, code = run(t, "modbus", "read", "--target", "tcp://"+srv.Addr(), "--area", "co", "--offset", "0", "--count", "3", "--json")
	var res readOutput
	if code != 0 || json.Unmarshal([]byte(out), &res) != nil || len(res.Bits) != 3 {
		t.Fatalf("json: %d %s", code, out)
	}

	bad := [][]string{
		{"modbus", "read", "--target", "tcp://" + srv.Addr(), "--count", "126"},
		{"modbus", "read", "--target", "udp://1.2.3.4"},
		{"modbus", "read", "--target", "tcp://" + srv.Addr(), "--count", "2", "--decode", "uint32@0"},
		{"modbus", "read", "--target", "tcp://" + srv.Addr(), "--count", "1", "--decode", "uint32:CDAB@0"},
		{"modbus", "read", "--target", "tcp://" + srv.Addr(), "--area", "ir", "--oee-block"},
		{"modbus", "read", "--target", "tcp://" + srv.Addr(), "--offset", "2040", "--count", "20"}, // exceção 02
	}
	for _, args := range bad {
		if _, _, code := run(t, args...); code == 0 {
			t.Errorf("%v deveria falhar", args)
		}
	}
}

func TestConfigValidate(t *testing.T) {
	dir := testutil.ContractsDir(t)
	out, _, code := run(t, "config", "validate", filepath.Join(dir, "fixtures", "gateway-config.valid.tcp-and-rtu-bus.json"))
	if code != 0 || !strings.Contains(out, "versão 42") {
		t.Fatalf("válida: %d %q", code, out)
	}
	_, errOut, code := run(t, "config", "validate", filepath.Join(dir, "fixtures", "gateway-config.invalid.bus-ref-missing.json"))
	if code != 1 || !strings.Contains(errOut, "bus.ref") {
		t.Fatalf("inválida: %d %q", code, errOut)
	}
}

func TestDiagStub(t *testing.T) {
	cfgPath, _ := writeLocal(t, "https://localhost")
	out, _, code := run(t, "diag", "--config", cfgPath, "--json")
	var res struct {
		Checks []diagCheck `json:"checks"`
	}
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		t.Fatalf("json: %v\n%s", err, out)
	}
	// Sem credencial e sem buffer: avisos → código 1.
	if code != 1 || len(res.Checks) < 4 || res.Checks[1].Name != "credencial" || res.Checks[1].Result != diagWarn {
		t.Fatalf("diag: %d %+v", code, res.Checks)
	}
	if _, _, code := run(t, "diag", "--config", filepath.Join(t.TempDir(), "x.yaml")); code < 1 {
		t.Fatalf("sem arquivo deveria avisar: %d", code)
	}
}
