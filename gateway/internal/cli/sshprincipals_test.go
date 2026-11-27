package cli

import (
	"path/filepath"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
)

// O sshd do acesso remoto só aceita certificados com o principal deste gateway, e só para o suporte.
func TestSSHPrincipals(t *testing.T) {
	cfg, dir := writeLocal(t, "https://exemplo.invalid")
	if out, _, code := run(t, "ssh-principals", "suporte", "--config", cfg); code != 0 || out != "" {
		t.Fatalf("sem registro: %q %d", out, code)
	}
	const id = "01a1c5d4-9208-752e-89a7-834df2a74de4"
	if err := config.SaveCredentials(filepath.Join(dir, "credentials.json"), &config.Credentials{GatewayID: id, Token: "tok", Org: "acme", CloudURL: "https://exemplo.invalid"}); err != nil {
		t.Fatal(err)
	}
	if out, _, code := run(t, "ssh-principals", "suporte", "--config", cfg); code != 0 || out != "oee-gw-"+id+"\n" {
		t.Fatalf("suporte: %q %d", out, code)
	}
	for _, u := range []string{"root", "tecnico", "oee"} {
		if out, _, code := run(t, "ssh-principals", u, "--config", cfg); code != 0 || out != "" {
			t.Fatalf("%s: %q %d", u, out, code)
		}
	}
}
