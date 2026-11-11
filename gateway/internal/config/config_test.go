package config_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

// Todas as fixtures de gateway-config do packages/contracts: as válidas passam
// (inclusive sem campos desconhecidos) e as inválidas são recusadas pela mesma
// regra e no mesmo caminho que o Zod aponta.
func TestRemoteConfigFixtures(t *testing.T) {
	for _, fx := range testutil.Fixtures(t, "gateway-config") {
		t.Run(fx.File, func(t *testing.T) {
			body := testutil.ReadFixture(t, fx.File)
			cfg, err := config.ParseRemoteStrict(body)
			if fx.Valid {
				if err != nil {
					t.Fatalf("fixture válida recusada: %v", err)
				}
				if cfg.ConfigVersion < 1 || len(cfg.Devices) == 0 {
					t.Fatalf("config decodificada vazia: %+v", cfg)
				}
				return
			}
			var verr *config.ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("fixture inválida (%s) aceita ou erro inesperado: %v", fx.Description, err)
			}
			found := false
			for _, is := range verr.Issues {
				if is.Path == fx.Expect.Path && (fx.Expect.Rule == "" || is.Rule == fx.Expect.Rule) {
					found = true
				}
			}
			if !found {
				t.Fatalf("esperava problema em %q (regra %q); veio: %v", fx.Expect.Path, fx.Expect.Rule, verr.Issues)
			}
		})
	}
}

func TestRemoteConfigHelpers(t *testing.T) {
	body := testutil.ReadFixture(t, "gateway-config.valid.tcp-and-rtu-bus.json")
	cfg, err := config.ParseRemote(body)
	if err != nil {
		t.Fatal(err)
	}
	inj := &cfg.Devices[0]
	if inj.Timeout() != 500 || inj.UnitID() != 1 || !inj.IsEnabled() {
		t.Fatalf("parâmetros TCP: timeout=%d unit=%d", inj.Timeout(), inj.UnitID())
	}
	counter := &inj.Tags[3]
	if counter.Role != config.RoleCountTotal || inj.EffectivePollMS(counter) != 500 || inj.ContainingBlock(counter) == nil {
		t.Fatalf("contador: poll=%d", inj.EffectivePollMS(counter))
	}
	if spec := counter.Spec(); spec.Offset != 1004 || spec.Type.String() != "uint32" || spec.WordOrder.String() != "CDAB" {
		t.Fatalf("spec = %+v", spec)
	}
	temp := &inj.Tags[7]
	if inj.ContainingBlock(temp) != nil || inj.EffectivePollMS(temp) != 1000 {
		t.Fatal("tag de temperatura deveria estar fora do bloco, com poll 1000")
	}
	speed := &inj.Tags[6]
	if mul, add := speed.ScaleFactors(); mul != 0.1 || add != 0 {
		t.Fatalf("escala = %v %v", mul, add)
	}
	if cfg.Devices[1].Timeout() != 300 {
		t.Fatal("timeout RTU deveria vir da config (300)")
	}
	m := cfg.Machines[0]
	if m.StateRules.CommLossAfter() != 10 || m.StateRules.Debounce() != 1 || m.MaxRate() != 2 {
		t.Fatalf("regras: %+v", m.StateRules)
	}
	if got := cfg.Machines[2].MaxRate(); got < 3.33 || got > 3.34 { // 20 / ciclo ideal de 6 s
		t.Fatalf("max rate padrão = %v", got)
	}
	if cfg.Uplink.SyncInterval() != 10 || cfg.Uplink.BatchBytes() != config.DefaultMaxBatchBytes {
		t.Fatal("padrões do uplink")
	}
}

func TestRemoteConfigToleratesUnknownFields(t *testing.T) {
	body := testutil.ReadFixture(t, "gateway-config.valid.tcp-only-io.json")
	body = []byte(strings.Replace(string(body), `"config_version": 7,`, `"config_version": 7, "campo_futuro": {"x": 1},`, 1))
	if _, err := config.ParseRemote(body); err != nil {
		t.Fatalf("campo novo deveria ser aceito em tempo de execução: %v", err)
	}
	if _, err := config.ParseRemoteStrict(body); err == nil {
		t.Fatal("modo estrito deveria recusar campo desconhecido")
	}
	if _, err := config.ParseRemote([]byte(`{"config_version": 1`)); err == nil {
		t.Fatal("JSON quebrado deveria falhar")
	}
}

func TestLocalConfig(t *testing.T) {
	l, err := config.ParseLocal([]byte(""))
	if err != nil {
		t.Fatalf("arquivo vazio deveria usar os padrões: %v", err)
	}
	if l.Cloud.URL != config.DefaultCloudURL || l.Paths.Buffer != "/var/lib/oee-gateway/buffer.db" ||
		l.Paths.Credentials != "/var/lib/oee-gateway/credentials.json" || l.Log.Level != "info" {
		t.Fatalf("padrões: %+v", l)
	}
	if dev, err := l.ResolveSerialPort("rs485-2"); err != nil || dev != "/dev/ttyAMA3" {
		t.Fatalf("rs485-2 → %q (%v)", dev, err)
	}

	yml := `
schema: 1
cloud:
  url: https://oee.exemplo.com.br/
  timeout_s: 20
paths:
  state_dir: /tmp/oee
hardware:
  profile: generic
  serial_ports:
    rs485-1: /dev/ttyUSB0
log:
  level: debug
`
	l, err = config.ParseLocal([]byte(yml))
	if err != nil {
		t.Fatal(err)
	}
	if l.Cloud.URL != "https://oee.exemplo.com.br" || l.Paths.Buffer != "/tmp/oee/buffer.db" {
		t.Fatalf("config: %+v", l)
	}
	if dev, err := l.ResolveSerialPort("rs485-1"); err != nil || dev != "/dev/ttyUSB0" {
		t.Fatalf("rs485-1 → %q (%v)", dev, err)
	}
	if _, err := l.ResolveSerialPort("rs485-3"); err == nil {
		t.Fatal("perfil generic não tem rs485-3")
	}

	bad := map[string]string{
		"http fora de localhost": "cloud:\n  url: http://oee.exemplo.com.br\n",
		"campo com erro":         "cloud:\n  urll: https://x\n",
		"nível inválido":         "log:\n  level: verbose\n",
		"caminho relativo":       "paths:\n  buffer: buffer.db\n",
		"url com caminho":        "cloud:\n  url: https://x.com/api\n",
	}
	for name, y := range bad {
		if _, err := config.ParseLocal([]byte(y)); err == nil {
			t.Errorf("%s: deveria falhar", name)
		}
	}
	if err := config.ValidateCloudURL("http://127.0.0.1:8080"); err != nil {
		t.Fatalf("http em localhost deveria passar: %v", err)
	}
}

func TestCredentialsRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "credentials.json")
	if c, err := config.LoadCredentials(path); err != nil || c != nil {
		t.Fatalf("sem arquivo: %v %v", c, err)
	}
	in := &config.Credentials{GatewayID: "01a1599c-a300-7f51-9864-1073dc9781ca", Token: "gw_test_x", Org: "acme", CloudURL: "https://x"}
	if err := config.SaveCredentials(path, in); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("permissão = %v (%v)", st.Mode().Perm(), err)
	}
	out, err := config.LoadCredentials(path)
	if err != nil || out.Token != in.Token || out.EnrolledAt == "" {
		t.Fatalf("credencial lida: %+v (%v)", out, err)
	}
}
