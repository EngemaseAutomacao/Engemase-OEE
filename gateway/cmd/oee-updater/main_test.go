package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

// keygen → sign → as chaves e o manifesto que o updater aceita.
func TestKeygenAndSign(t *testing.T) {
	dir := t.TempDir()
	var out, errb bytes.Buffer
	if code := run([]string{"keygen", "--out", filepath.Join(dir, "ota")}, &out, &errb); code != 0 {
		t.Fatalf("keygen: %d %s", code, errb.String())
	}
	if st, err := os.Stat(filepath.Join(dir, "ota.key")); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("chave privada: %v %v", st, err)
	}
	if code := run([]string{"keygen", "--out", filepath.Join(dir, "ota")}, &out, &errb); code == 0 {
		t.Fatal("keygen sobrescreveu uma chave existente")
	}
	deb := filepath.Join(dir, "oee-gateway_1.2.0_arm64.deb")
	_ = os.WriteFile(deb, []byte("pacote"), 0o644)
	out.Reset()
	args := []string{"sign", "--deb", deb, "--version", "1.2.0", "--arch", "arm64", "--url", "oee-gateway_1.2.0_arm64.deb",
		"--key", filepath.Join(dir, "ota.key"), "--out", dir, "--allowed-rollback-to", "1.1.0"}
	if code := run(args, &out, &errb); code != 0 {
		t.Fatalf("sign: %d %s", code, errb.String())
	}
	mpath := strings.TrimSpace(out.String())
	mb, _ := os.ReadFile(mpath)
	sb, _ := os.ReadFile(mpath + ".sig")
	keysDir := filepath.Join(dir, "keys")
	_ = os.MkdirAll(keysDir, 0o755)
	pub, _ := os.ReadFile(filepath.Join(dir, "ota.pub"))
	_ = os.WriteFile(filepath.Join(keysDir, "ota.pub"), pub, 0o644)
	keys, err := update.LoadKeys(keysDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := update.VerifyManifest(keys, mb, sb); err != nil {
		t.Fatalf("assinatura: %v", err)
	}
	m, err := update.ParseManifest(mb)
	if err != nil || m.Schema() != buffer.SchemaVersion || m.Size != 6 || m.AllowedRollbackTo[0] != "1.1.0" {
		t.Fatalf("manifesto: %+v %v", m, err)
	}
	if code := run([]string{"sign", "--deb", deb, "--version", "1.2", "--arch", "arm64", "--key", filepath.Join(dir, "ota.key"),
		"--out", dir}, &out, &errb); code == 0 {
		t.Fatal("versão que não é semver assinada")
	}
	if code := run([]string{"nada"}, &out, &errb); code != 2 {
		t.Fatalf("subcomando desconhecido: %d", code)
	}
}
