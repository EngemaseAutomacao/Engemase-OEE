package app

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

const (
	token   = "gw_test_8f2cJ3kq0V1mZ9xYtR4pL6wE2sA7dF5gH8jK1lQ0nB3"
	devID   = "01a1599e-7f90-7b47-976d-2b40a6cb24c1"
	mID     = "01a159a1-4a68-72de-9057-14e72d836a47"
	tHB     = "01a159a4-1540-74dd-a3e5-239a6a4ca4df"
	tState  = "01a159a5-0388-7c92-8248-4dd1953e51e0"
	tTotal  = "01a159a6-e018-779c-9647-cae69dd0eeb2"
	tReject = "01a159a7-ce60-7646-890e-0d4462a5fa79"
)

// Config com o bloco OEE padrão (HR 1000, 14 registradores) apontando para o CLP falso.
func oeeConfig(plcAddr string, version int) []byte {
	host, port, _ := strings.Cut(plcAddr, ":")
	p, _ := strconv.Atoi(port)
	return []byte(fmt.Sprintf(`{"config_version":%d,"serial_buses":[],
	"devices":[{"id":"%s","name":"CLP de teste","protocol":"modbus-tcp","params":{"host":"%s","port":%d,"unit_id":1,"timeout_ms":200},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[
	   {"id":"%s","address":{"area":"holding_register","offset":1001},"type":"uint16","role":"plc.heartbeat","machine_id":"%s"},
	   {"id":"%s","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"%s"},
	   {"id":"%s","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"%s"},
	   {"id":"%s","address":{"area":"holding_register","offset":1006},"type":"uint32","word_order":"CDAB","role":"count.reject","machine_id":"%s"}]}],
	"machines":[{"id":"%s","state_rules":{"mode":"state_code","map":{"0":"STOPPED","1":"RUNNING","2":"FAULT"},"debounce_s":0.5}}],
	"uplink":{"sync_interval_s":1,"max_batch_items":2000}}`,
		version, devID, host, p, tHB, mID, tState, mID, tTotal, mID, tReject, mID, mID))
}

type cloud struct {
	mu      sync.Mutex
	syncs   []contracts.SyncRequest
	configs int
}

func (c *cloud) snapshot() ([]contracts.SyncRequest, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]contracts.SyncRequest(nil), c.syncs...), c.configs
}

func TestAgentEndToEnd(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	plc.SetHolding(1000, 1, 1, 1, 0, cnt[0], cnt[1]) // versão 1, heartbeat 1, produzindo, total 100000

	schema := testutil.StrictSchema(t, "sync-request")
	cfgBody := oeeConfig(plc.Addr(), 1)
	cl := &cloud{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case contracts.RouteConfig:
			cl.mu.Lock()
			cl.configs++
			cl.mu.Unlock()
			w.Header().Set("ETag", `"1"`)
			_, _ = w.Write(cfgBody)
		case contracts.RouteSync:
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				t.Errorf("gzip: %v", err)
				return
			}
			raw, _ := io.ReadAll(zr)
			if errs := testutil.ValidateJSON(t, schema, raw); errs != "" {
				t.Errorf("/sync fora do contrato: %s\n%s", errs, raw)
			}
			var req contracts.SyncRequest
			_ = json.Unmarshal(raw, &req)
			cl.mu.Lock()
			cl.syncs = append(cl.syncs, req)
			cl.mu.Unlock()
			ack := int64(0)
			if req.Batch.SeqTo != nil {
				ack = *req.Batch.SeqTo
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ack_seq": ack, "server_time": contracts.FormatTime(time.Now()), "config": map[string]any{"latest_version": 1},
				"commands": []any{}, "next_sync_s": 1, "min_agent_version": "0.1.0",
			})
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: token, Org: "acme", CloudURL: srv.URL}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), TickEvery: 200 * time.Millisecond, CredentialsPollEvery: 100 * time.Millisecond})
	}()

	// Espera: config baixada, evento RUNNING e live RUNNING chegarem na nuvem.
	deadline := time.Now().Add(15 * time.Second)
	var sawStart, sawApplied, sawRunning, sawLive, sawDevice bool
	for time.Now().Before(deadline) && !(sawStart && sawApplied && sawRunning && sawLive && sawDevice) {
		time.Sleep(100 * time.Millisecond)
		plc.SetHolding(1001, uint16(time.Now().UnixMilli()/1000)) // heartbeat vivo
		syncs, _ := cl.snapshot()
		for _, s := range syncs {
			for _, raw := range s.Events {
				var ev map[string]any
				_ = json.Unmarshal(raw, &ev)
				switch ev["type"] {
				case "agent_start":
					sawStart = true
				case "config_applied":
					sawApplied = true
				case "state":
					sawRunning = sawRunning || ev["state"] == "RUNNING"
				}
			}
			for _, l := range s.Live {
				if l.MachineID == mID && l.State == "RUNNING" && l.CounterTotal != nil && *l.CounterTotal == 100000 {
					sawLive = true
				}
			}
			for _, d := range s.Devices {
				if d.ID == devID && d.Status == contracts.DeviceConnected {
					sawDevice = true
				}
			}
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	_, configs := cl.snapshot()
	if !(sawStart && sawApplied && sawRunning && sawLive && sawDevice) || configs < 1 {
		t.Fatalf("start=%v applied=%v running=%v live=%v device=%v configs=%d", sawStart, sawApplied, sawRunning, sawLive, sawDevice, configs)
	}

	// Depois de parar: config salva, desligamento limpo registrado, agent_stop na fila.
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if v, _, err := store.LoadConfig(context.Background(), "current"); err != nil || v != 1 {
		t.Fatalf("config salva: %d (%v)", v, err)
	}
	if clean, _ := store.Meta(context.Background(), "clean_shutdown"); clean != "1" {
		t.Fatalf("clean_shutdown = %q", clean)
	}
	items, _ := store.Peek(context.Background(), 100, 0)
	if len(items) == 0 || !strings.Contains(string(items[len(items)-1].Payload), `"agent_stop"`) {
		t.Fatalf("agent_stop deveria estar pendente na fila: %d itens", len(items))
	}
}
