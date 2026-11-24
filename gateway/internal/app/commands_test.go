package app

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

// cmdCloud é uma nuvem falsa com fila de comandos: reenvia cada comando aberto em
// todo /sync até receber o resultado (docs/04), como a fila do lado da nuvem.
type cmdCloud struct {
	t       *testing.T
	plc     string
	version atomic.Int64
	// failRestart: /sync com o resultado do agent.restart recebe 503 (nuvem fora).
	failRestart atomic.Bool
	// applied é a config_version da saúde no último /sync.
	applied atomic.Int64

	mu      sync.Mutex
	open    []map[string]any
	results map[string]map[string]any
	sent    map[string]int // quantas vezes cada resultado chegou
}

func (c *cmdCloud) add(id, typ string, payload map[string]any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.open = append(c.open, map[string]any{"id": id, "type": typ, "payload": payload,
		"issued_at": contracts.FormatTime(time.Now()), "expires_at": contracts.FormatTime(time.Now().Add(ttl))})
}

func (c *cmdCloud) result(id string) map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.results[id]
}

func (c *cmdCloud) waitResult(id string, within time.Duration) map[string]any {
	c.t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if r := c.result(id); r != nil {
			return r
		}
		time.Sleep(20 * time.Millisecond)
	}
	c.t.Fatalf("sem resultado para %s", id)
	return nil
}

func (c *cmdCloud) handler() http.Handler {
	schema := testutil.StrictSchema(c.t, "sync-request")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case contracts.RouteConfig:
			v := int(c.version.Load())
			w.Header().Set("ETag", `"`+string(rune('0'+v))+`"`)
			_, _ = w.Write(oeeConfig(c.plc, v))
		case contracts.RouteSync:
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				c.t.Errorf("gzip: %v", err)
				return
			}
			raw, _ := io.ReadAll(zr)
			if errs := testutil.ValidateJSON(c.t, schema, raw); errs != "" {
				c.t.Errorf("/sync fora do contrato: %s\n%s", errs, raw)
			}
			var req contracts.SyncRequest
			_ = json.Unmarshal(raw, &req)
			c.applied.Store(int64(req.Agent.ConfigVersion))
			if c.failRestart.Load() && strings.Contains(string(raw), `"agent.restart"`) {
				w.WriteHeader(503)
				return
			}
			c.mu.Lock()
			for _, res := range req.CommandResults {
				var m map[string]any
				_ = json.Unmarshal(res, &m)
				id := m["id"].(string)
				c.results[id] = m
				c.sent[id]++
				kept := c.open[:0]
				for _, cmd := range c.open {
					if cmd["id"] != id {
						kept = append(kept, cmd)
					}
				}
				c.open = kept
			}
			cmds := append([]map[string]any{}, c.open...)
			c.mu.Unlock()
			ack := int64(0)
			if req.Batch.SeqTo != nil {
				ack = *req.Batch.SeqTo
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ack_seq": ack, "server_time": contracts.FormatTime(time.Now()),
				"config":   map[string]any{"latest_version": c.version.Load()},
				"commands": cmds, "next_sync_s": 1, "min_agent_version": "0.1.0",
			})
		}
	})
}

// Comandos de ponta a ponta no agente: tag.read pela fila do poller, config.reload,
// tipo desconhecido e agent.restart (com o resultado confirmado antes de sair, e,
// com a nuvem fora, reenviado depois de religar sem reiniciar de novo).
func TestAgentCommandsEndToEnd(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	cnt, _ := modbus.Split32(123456, modbus.CDAB)
	plc.SetHolding(1000, 1, 1, 1, 0, cnt[0], cnt[1])

	cl := &cmdCloud{t: t, plc: plc.Addr(), results: map[string]map[string]any{}, sent: map[string]int{}}
	cl.version.Store(1)
	srv := httptest.NewServer(cl.handler())
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
	oldWait := restartConfirmWait
	restartConfirmWait = 4 * time.Second // o envio imediato respeita 2 s entre syncs
	defer func() { restartConfirmWait = oldWait }()

	start := func() (context.CancelFunc, chan error) {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), TickEvery: 200 * time.Millisecond, CredentialsPollEvery: 100 * time.Millisecond})
		}()
		return cancel, done
	}
	cancel, done := start()
	defer cancel()
	for deadline := time.Now().Add(15 * time.Second); cl.applied.Load() != 1; time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("config não aplicada")
		}
	}

	const (
		idRead    = "01a1cab3-0000-7000-8000-000000000001"
		idReload  = "01a1cab3-0000-7000-8000-000000000002"
		idUnknown = "01a1cab3-0000-7000-8000-000000000003"
		idRestart = "01a1cab3-0000-7000-8000-000000000004"
		idRestar2 = "01a1cab3-0000-7000-8000-000000000005"
	)
	cl.add(idRead, "tag.read", map[string]any{"device_id": devID, "address": map[string]any{"area": "holding_register", "offset": 1004},
		"type": "uint32", "word_order": "CDAB"}, 2*time.Minute)
	r := cl.waitResult(idRead, 20*time.Second)
	if r["status"] != "ok" || r["result"].(map[string]any)["value"] != float64(123456) {
		t.Fatalf("tag.read: %v", r)
	}

	cl.version.Store(2)
	cl.add(idReload, "config.reload", map[string]any{}, 10*time.Minute)
	cl.add(idUnknown, "agent.update", map[string]any{"version": "9.9.9"}, 10*time.Minute)
	if r = cl.waitResult(idReload, 20*time.Second); r["status"] != "ok" || r["result"].(map[string]any)["version"] != float64(2) {
		t.Fatalf("config.reload: %v", r)
	}
	if r = cl.waitResult(idUnknown, 20*time.Second); r["status"] != "rejected" || r["error"].(map[string]any)["code"] != "unsupported" {
		t.Fatalf("tipo desconhecido: %v", r)
	}

	// agent.restart: o resultado chega à nuvem e só então o agente sai (limpo).
	cl.add(idRestart, "agent.restart", map[string]any{"reason": "teste"}, 10*time.Minute)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run depois do agent.restart: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("o agente não reiniciou")
	}
	if r = cl.result(idRestart); r == nil || r["status"] != "ok" {
		t.Fatalf("resultado do agent.restart antes de sair: %v", r)
	}
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	items, _ := store.Peek(context.Background(), 1000, 0)
	last := string(items[len(items)-1].Payload)
	saved, _ := store.Meta(context.Background(), metaRestartCommand)
	_ = store.Close()
	if !strings.Contains(last, `"reason":"restart"`) || !strings.Contains(last, idRestart) {
		t.Fatalf("agent_stop do reinício: %s", last)
	}
	if saved != "" {
		t.Fatalf("resultado confirmado não precisa ficar gravado: %q", saved)
	}

	// Nuvem fora na hora do resultado: o agente reinicia sem a confirmação e, ao
	// religar, reenvia o resultado gravado sem executar o comando de novo.
	cl.failRestart.Store(true)
	cancel, done = start()
	defer cancel()
	cl.add(idRestar2, "agent.restart", map[string]any{}, 10*time.Minute)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("o agente não reiniciou sem a confirmação")
	}
	cl.failRestart.Store(false)
	cancel, done = start()
	defer cancel()
	if r = cl.waitResult(idRestar2, 20*time.Second); r["status"] != "ok" {
		t.Fatalf("resultado reenviado: %v", r)
	}
	select {
	case err := <-done:
		t.Fatalf("o agente reiniciou de novo com o mesmo comando: %v", err)
	case <-time.After(3 * time.Second):
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
}
