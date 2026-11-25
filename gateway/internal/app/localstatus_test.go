package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

// A página local lê, pelo ui.sock, o que o agente está vendo: dispositivo
// conectado, última leitura da máquina, fila e nuvem. E, com uma atualização pedida,
// o agente grava o health.json depois do primeiro /sync aceito (OTA mínimo).
func TestLocalAPIAndUpdateHealth(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("SO_PEERCRED só no Linux")
	}
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	plc.SetHolding(1000, 1, 1, 1, 0, cnt[0], cnt[1])

	cl := &cloud{}
	srv := syncCloud(t, cl, 1, oeeConfig(plc.Addr(), 1), `"1"`)
	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: token, Org: "acme", CloudURL: srv.URL}); err != nil {
		t.Fatal(err)
	}
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveConfig(context.Background(), 1, oeeConfig(plc.Addr(), 1)); err != nil {
		t.Fatal(err)
	}
	store.Close()
	// Atualização pedida (o oee-updater espera o health.json).
	upd := filepath.Join(dir, "update")
	if err := os.MkdirAll(upd, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(upd, update.RequestFile), []byte(`{"id":"x","version":"9.9.9"}`), 0o640); err != nil {
		t.Fatal(err)
	}

	sock := filepath.Join(t.TempDir(), "ui.sock")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), TickEvery: 200 * time.Millisecond,
			CredentialsPollEvery: 100 * time.Millisecond, UIListener: l})
	}()
	client := localapi.NewClient(sock)
	var st *localapi.Status
	ok := func() bool {
		c, cc := context.WithTimeout(context.Background(), 2*time.Second)
		defer cc()
		s, err := client.Status(c)
		if err != nil {
			return false
		}
		st = s
		if len(s.Devices) != 1 || s.Devices[0].Status != "connected" || s.Cloud.LastOKAt == nil {
			return false
		}
		for _, m := range s.Machines {
			if m.ID == mID && m.State == "RUNNING" && m.CounterTotal != nil && *m.CounterTotal == 100000 {
				return true
			}
		}
		return false
	}
	passed := false
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		plc.SetHolding(1001, uint16(time.Now().UnixMilli()/1000))
		if passed = ok(); passed {
			break
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !passed {
		t.Fatalf("status da página: %+v", st)
	}
	if st.Agent.Version != buildinfo.Version || st.Agent.ConfigVersion != 1 || !st.Cloud.Registered || st.Cloud.URL != srv.URL {
		t.Fatalf("agente/nuvem: %+v %+v", st.Agent, st.Cloud)
	}
	if st.Devices[0].Protocol != "modbus-tcp" {
		t.Fatalf("dispositivo: %+v", st.Devices[0])
	}

	b, err := os.ReadFile(filepath.Join(upd, update.HealthFile))
	if err != nil {
		t.Fatalf("health.json: %v", err)
	}
	var h update.Health
	if err := json.Unmarshal(b, &h); err != nil || h.Version != buildinfo.Version || h.At.IsZero() {
		t.Fatalf("health.json: %s %v", b, err)
	}
}
