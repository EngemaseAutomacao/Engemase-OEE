package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

// agent.update de ponta a ponta: o agente baixa pelo manifesto assinado (https, CA corporativa da
// config local), responde "downloaded" e só pede a instalação ao oee-updater depois que a nuvem
// confirma o resultado. Assinatura de outra chave: update_failed e nenhum pedido.
func TestAgentUpdateEndToEnd(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()

	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	keysDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(keysDir, "ota-test.pub"), []byte(base64.StdEncoding.EncodeToString(pub)+"\n"), 0o644)

	arch := update.GoArch()
	deb := []byte("pacote de teste 1.9.0\n")
	n, sum, _ := update.Digest(strings.NewReader(string(deb)))
	man, _ := json.Marshal(map[string]any{"package": "oee-gateway", "version": "1.9.0", "arch": arch, "sha256": sum, "size": n, "url": "oee-gateway_1.9.0.deb"})
	files := map[string][]byte{
		"/ok/oee-gateway_1.9.0.manifest.json":      man,
		"/ok/oee-gateway_1.9.0.manifest.json.sig":  update.SignManifest(priv, man),
		"/ok/oee-gateway_1.9.0.deb":                deb,
		"/bad/oee-gateway_1.9.0.manifest.json":     man,
		"/bad/oee-gateway_1.9.0.manifest.json.sig": update.SignManifest(other, man),
		"/bad/oee-gateway_1.9.0.deb":               deb,
	}
	rel := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(b)
	}))
	defer rel.Close()

	cl := &cmdCloud{t: t, plc: plc.Addr(), results: map[string]map[string]any{}, sent: map[string]int{}}
	cl.version.Store(1)
	srv := httptest.NewServer(cl.handler())
	defer srv.Close()

	dir := t.TempDir()
	caFile := filepath.Join(dir, "ca.pem")
	_ = os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rel.Certificate().Raw}), 0o644)
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Cloud.ExtraCAFile = caFile
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: token, Org: "acme", CloudURL: srv.URL}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, UpdateKeysDir: keysDir, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
			TickEvery: 200 * time.Millisecond, CredentialsPollEvery: 100 * time.Millisecond})
	}()

	const (
		idBad     = "01a1cab3-0000-7000-8000-0000000000a1"
		idCurrent = "01a1cab3-0000-7000-8000-0000000000a2"
		idOK      = "01a1cab3-0000-7000-8000-0000000000a3"
	)
	manifests := func(prefix string) map[string]any {
		return map[string]any{arch: rel.URL + prefix + "/oee-gateway_1.9.0.manifest.json"}
	}
	reqFile := filepath.Join(dir, "update", update.RequestFile)

	cl.add(idBad, "agent.update", map[string]any{"version": "1.9.0", "manifests": manifests("/bad")}, 30*time.Minute)
	r := cl.waitResult(idBad, 20*time.Second)
	if r["status"] != "error" || r["error"].(map[string]any)["code"] != "update_failed" {
		t.Fatalf("assinatura de outra chave: %v", r)
	}

	cl.add(idCurrent, "agent.update", map[string]any{"version": buildinfo.Version, "manifests": manifests("/ok")}, 30*time.Minute)
	if r = cl.waitResult(idCurrent, 20*time.Second); r["status"] != "ok" || r["result"].(map[string]any)["state"] != "current" {
		t.Fatalf("mesma versão: %v", r)
	}
	if _, err := os.Stat(reqFile); err == nil {
		t.Fatal("pedido de instalação sem pacote bom")
	}

	cl.add(idOK, "agent.update", map[string]any{"version": "1.9.0", "manifests": manifests("/ok")}, 30*time.Minute)
	r = cl.waitResult(idOK, 20*time.Second)
	res, _ := r["result"].(map[string]any)
	if r["status"] != "ok" || res["state"] != "downloaded" || res["version"] != "1.9.0" || res["previous"] != buildinfo.Version {
		t.Fatalf("agent.update: %v", r)
	}
	// O pedido sai depois da confirmação (a resposta ao /sync que levou o resultado).
	var req update.Request
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		if b, err := os.ReadFile(reqFile); err == nil && json.Unmarshal(b, &req) == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("instalação não pedida depois da confirmação")
		}
	}
	if req.ID != idOK || req.Version != "1.9.0" {
		t.Fatalf("pedido: %+v", req)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "update", update.PackageFile)); string(b) != string(deb) {
		t.Fatal("pacote baixado diferente")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
}
