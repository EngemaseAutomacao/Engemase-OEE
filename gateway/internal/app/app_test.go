package app

import (
	"bytes"
	"compress/gzip"
	"context"
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
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
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

// syncCloud é a nuvem falsa dos testes de config: valida cada /sync no schema estrito,
// conta os GET /config e responde com a latest_version dada.
func syncCloud(t *testing.T, cl *cloud, latest int, configBody []byte, etag string) *httptest.Server {
	t.Helper()
	schema := testutil.StrictSchema(t, "sync-request")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case contracts.RouteConfig:
			cl.mu.Lock()
			cl.configs++
			cl.mu.Unlock()
			if strings.Contains(r.Header.Get("If-None-Match"), etag) {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", etag)
			_, _ = w.Write(configBody)
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
				"ack_seq": ack, "server_time": contracts.FormatTime(time.Now()), "config": map[string]any{"latest_version": latest},
				"commands": []any{}, "next_sync_s": 1, "min_agent_version": "0.1.0",
			})
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// eventsOfType devolve os eventos de um tipo recebidos pela nuvem, em ordem.
func eventsOfType(syncs []contracts.SyncRequest, typ string) []map[string]any {
	var out []map[string]any
	for _, s := range syncs {
		for _, raw := range s.Events {
			var ev map[string]any
			_ = json.Unmarshal(raw, &ev)
			if ev["type"] == typ {
				out = append(out, ev)
			}
		}
	}
	return out
}

// runAgentUntil roda o agente até cond (ou o prazo) e o para.
func runAgentUntil(t *testing.T, local *config.Local, cond func() bool) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), TickEvery: 200 * time.Millisecond, CredentialsPollEvery: 100 * time.Millisecond})
	}()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) && !cond() {
		time.Sleep(100 * time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !cond() {
		t.Fatal("prazo esgotado esperando a condição")
	}
}

// Uma config recusada não pode ser baixada e recusada de novo a cada /sync (a nuvem
// repete a latest_version em todo sync): um GET /config e um config_rejected por
// versão, e isso vale depois de reiniciar o agente.
func TestRejectedConfigIsFetchedAndReportedOncePerVersion(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	// Versão 2 inválida: sync_interval_s fora do limite.
	bad := []byte(`{"config_version":2,"serial_buses":[],"devices":[],"machines":[],"uplink":{"sync_interval_s":0}}`)
	if _, err := config.ParseRemote(bad); err == nil {
		t.Fatal("a config de teste deveria ser inválida")
	}
	cl := &cloud{}
	srv := syncCloud(t, cl, 2, bad, `"2"`)

	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: token, Org: "acme", CloudURL: srv.URL}); err != nil {
		t.Fatal(err)
	}
	// Versão 1 já aplicada.
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveConfig(context.Background(), 1, oeeConfig(plc.Addr(), 1)); err != nil {
		t.Fatal(err)
	}
	store.Close()

	// syncsAfterReject conta os /sync depois do que levou o config_rejected.
	syncsAfterReject := func() int {
		syncs, _ := cl.snapshot()
		for i, s := range syncs {
			if len(eventsOfType([]contracts.SyncRequest{s}, contracts.EventConfigRejected)) > 0 {
				return len(syncs) - i - 1
			}
		}
		return 0
	}
	runAgentUntil(t, local, func() bool { return syncsAfterReject() >= 3 })
	syncs, configs := cl.snapshot()
	rejected := eventsOfType(syncs, contracts.EventConfigRejected)
	if configs != 1 || len(rejected) != 1 {
		t.Fatalf("em %d /sync: GET /config x%d e %d config_rejected; quer 1 e 1", len(syncs), configs, len(rejected))
	}
	if rejected[0]["version"] != float64(2) || rejected[0]["reverted_to"] != float64(1) {
		t.Fatalf("config_rejected: %v", rejected[0])
	}

	// Reiniciado, o agente lembra a recusa: não baixa a v2 de novo e segue informando.
	before := len(syncs)
	runAgentUntil(t, local, func() bool {
		s, _ := cl.snapshot()
		return len(s)-before >= 3
	})
	syncs, configs = cl.snapshot()
	if n := len(eventsOfType(syncs, contracts.EventConfigRejected)); configs != 1 || n != 1 {
		t.Fatalf("depois de reiniciar: GET /config x%d e %d config_rejected; quer 1 e 1", configs, n)
	}
	st := syncs[len(syncs)-1].Agent.ConfigStatus
	if st == nil || st.State != "rejected" || st.Version != 1 || st.Error == "" || syncs[len(syncs)-1].Agent.ConfigVersion != 1 {
		t.Fatalf("saúde depois de reiniciar: config_version=%d status=%+v", syncs[len(syncs)-1].Agent.ConfigVersion, st)
	}
}

// A recusa de uma config depende do binário (protocolos, papéis e limites que ele
// valida). Depois de uma atualização do agente, a versão que o build anterior recusou
// é baixada e validada de novo; se agora passa, é aplicada. Sem isso o gateway ficaria
// na config antiga até a nuvem publicar outra versão.
func TestConfigRejectedByAnotherBuildIsFetchedAgain(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	cl := &cloud{}
	srv := syncCloud(t, cl, 2, oeeConfig(plc.Addr(), 2), `"2"`) // v2 válida para este build

	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: token, Org: "acme", CloudURL: srv.URL}); err != nil {
		t.Fatal(err)
	}
	// v1 aplicada; v2 recusada por um build anterior (o que ele deixa no buffer).
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveConfig(context.Background(), 1, oeeConfig(plc.Addr(), 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Commit(context.Background(), buffer.Write{Meta: map[string]string{
		metaRejectedVersion: "2", metaRejectedError: `protocolo "modbus-tcp" não suportado`, metaRejectedAgent: "0.0.9 antigo",
	}}); err != nil {
		t.Fatal(err)
	}
	store.Close()

	runAgentUntil(t, local, func() bool {
		syncs, _ := cl.snapshot()
		return len(eventsOfType(syncs, contracts.EventConfigApplied)) > 0
	})
	syncs, configs := cl.snapshot()
	applied := eventsOfType(syncs, contracts.EventConfigApplied)
	if configs != 1 || applied[0]["version"] != float64(2) || applied[0]["previous_version"] != float64(1) {
		t.Fatalf("GET /config x%d, config_applied %v; quer 1 GET e a v2 aplicada sobre a v1", configs, applied[0])
	}
	if n := len(eventsOfType(syncs, contracts.EventConfigRejected)); n != 0 {
		t.Fatalf("%d config_rejected; a v2 é válida para este build", n)
	}
}

// engineTestConfigJSON é uma config de uma máquina (estado + contador total), sem CLP.
const engineTestConfigJSON = `{"config_version":1,"serial_buses":[],
	"devices":[{"id":"` + devID + `","protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":502,"unit_id":1},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[{"id":"` + tState + `","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"` + mID + `"},
	   {"id":"` + tTotal + `","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"` + mID + `"}]}],
	"machines":[{"id":"` + mID + `","state_rules":{"mode":"state_code","map":{"0":"STOPPED","1":"RUNNING"}}}],
	"uplink":{"sync_interval_s":1,"max_batch_items":2000}}`

// Config de uma máquina (estado + contador total), sem CLP: o motor é alimentado à mão.
func engineTestConfig(t *testing.T) *config.GatewayConfig {
	t.Helper()
	cfg, err := config.ParseRemote([]byte(engineTestConfigJSON))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// runningEngine devolve um motor que leu a máquina produzindo 1 peça/s de start a end.
func runningEngine(t *testing.T, start, end time.Time) (*engine.Engine, uint32) {
	t.Helper()
	eng, err := engine.New(engineTestConfig(t), start, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	st, _ := modbus.DecodeRegisters([]uint16{1}, modbus.Uint16, modbus.WordOrderNone, -1)
	var total uint32 = 1000
	for ts := start; ts.Before(end); ts = ts.Add(time.Second) {
		total++
		r, _ := modbus.Split32(total, modbus.CDAB)
		v, _ := modbus.DecodeRegisters(r[:], modbus.Uint32, modbus.CDAB, -1)
		eng.OnRead(ts, []engine.Sample{{TagID: tState, Value: st}, {TagID: tTotal, Value: v}})
	}
	return eng, total
}

func testAgent(store *buffer.Store) *agent {
	return &agent{store: store, log: slog.New(slog.NewTextHandler(io.Discard, nil)), ids: ids.NewGenerator(nil)}
}

func outbox(t *testing.T, store *buffer.Store) []buffer.Item {
	t.Helper()
	items, err := store.Peek(context.Background(), 2*maxUnsentItems, 0)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

// validEvents confere os eventos da outbox no schema estrito, dentro de um /sync.
func validEvents(t *testing.T, items []buffer.Item) {
	t.Helper()
	req := contracts.SyncRequest{
		Batch: contracts.Batch{SentAt: contracts.FormatTime(time.Now())},
		Agent: contracts.AgentHealth{Version: "0.1.0", UptimeS: 10, ConfigVersion: 1, CPUPct: 1, MemMB: 30, DiskFreeMB: 1000},
	}
	for _, it := range items {
		if it.Kind == buffer.KindEvent {
			req.Events = append(req.Events, it.JSON())
		}
	}
	if len(req.Events) == 0 {
		return
	}
	from, to := items[0].Seq, items[len(items)-1].Seq
	req.Batch.SeqFrom, req.Batch.SeqTo = &from, &to
	raw, _ := json.Marshal(req)
	if errs := testutil.ValidateJSON(t, testutil.StrictSchema(t, "sync-request"), raw); errs != "" {
		t.Fatalf("eventos fora do contrato: %s", errs)
	}
}

func payloadOf(t *testing.T, it buffer.Item) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(it.Payload, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// Se o buffer não grava (disco cheio, erro de E/S), a saída do motor (minutos já
// fechados, eventos, contadores) fica em memória e é gravada quando o buffer volta: o
// motor não devolve o que já entregou.
func TestTickKeepsEngineOutputWhenCommitFails(t *testing.T) {
	now := time.Now()
	eng, _ := runningEngine(t, now.Add(-150*time.Second), now)
	path := filepath.Join(t.TempDir(), "b.db")
	broken, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	broken.Close() // toda gravação falha
	a := testAgent(broken)
	at := func(d time.Duration) { a.clock = func() (time.Time, time.Duration) { return now.Add(d), d } }
	at(0)
	a.tick(context.Background(), eng, nil, nil) // o motor fecha os minutos aqui; o Commit falha
	at(commitRetryMin)
	a.tick(context.Background(), eng, nil, nil) // nova tentativa (depois da espera), ainda falhando

	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a.store = store
	at(3 * commitRetryMin)
	a.tick(context.Background(), eng, nil, nil) // o buffer voltou; a espera dobrou (2 s) e acabou
	minutes, states := 0, 0
	seen := map[string]bool{}
	for _, it := range outbox(t, store) {
		if seen[it.Kind+it.ItemID] {
			t.Fatalf("item gravado duas vezes: %s %s", it.Kind, it.ItemID)
		}
		seen[it.Kind+it.ItemID] = true
		switch {
		case it.Kind == buffer.KindMinute:
			minutes++
		case payloadOf(t, it)["type"] == contracts.EventState:
			states++
		}
	}
	if minutes < 2 || states != 1 {
		t.Fatalf("depois de voltar, a outbox deveria ter os minutos (>= 2) e o evento RUNNING fechados durante a falha: %d minutos, %d estados", minutes, states)
	}
	counters, err := store.LoadCounters(context.Background())
	if err != nil || len(counters) != 1 {
		t.Fatalf("contadores gravados junto com os minutos: %v (%v)", counters, err)
	}
	if len(a.unsent.Items) != 0 || len(a.unsent.Counters) != 0 {
		t.Fatalf("nada deveria sobrar em memória: %d itens", len(a.unsent.Items))
	}
}

// Troca de config (motor novo) enquanto o buffer não grava: o motor novo parte dos
// contadores ainda em memória, não dos do disco, senão as peças dos minutos que
// esperam gravação seriam contadas de novo. Soma dos minutos = delta do contador.
func TestEngineRestartDuringCommitFailureConservesPieces(t *testing.T) {
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	cfg := engineTestConfig(t)
	running, _ := modbus.DecodeRegisters([]uint16{1}, modbus.Uint16, modbus.WordOrderNone, -1)
	var total uint32 = 1000
	feed := func(eng *engine.Engine, from, to time.Time) {
		for ts := from; ts.Before(to); ts = ts.Add(time.Second) {
			total++
			r, _ := modbus.Split32(total, modbus.CDAB)
			v, _ := modbus.DecodeRegisters(r[:], modbus.Uint32, modbus.CDAB, -1)
			eng.OnRead(ts, []engine.Sample{{TagID: tState, Value: running}, {TagID: tTotal, Value: v}})
		}
	}
	path := filepath.Join(t.TempDir(), "b.db")
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	a := testAgent(store)
	at := func(d time.Duration) { a.clock = func() (time.Time, time.Duration) { return t0.Add(d), d } }

	engA, err := engine.New(cfg, t0, engine.Options{IDs: a.ids})
	if err != nil {
		t.Fatal(err)
	}
	feed(engA, t0, t0.Add(2*time.Minute))
	at(2 * time.Minute)
	a.tick(context.Background(), engA, nil, nil) // 13:00 e 13:01 gravados (contadores no disco)

	store.Close() // o buffer para de gravar
	feed(engA, t0.Add(2*time.Minute), t0.Add(4*time.Minute))
	at(4 * time.Minute)
	a.tick(context.Background(), engA, nil, nil) // 13:02 e 13:03 ficam em memória

	store, err = buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a.store = store
	engB, err := engine.New(cfg, t0.Add(4*time.Minute), engine.Options{IDs: a.ids}) // nova config
	if err != nil {
		t.Fatal(err)
	}
	if err := a.restoreCounters(context.Background(), engB); err != nil {
		t.Fatal(err)
	}
	feed(engB, t0.Add(4*time.Minute), t0.Add(5*time.Minute))
	at(5 * time.Minute)
	a.tick(context.Background(), engB, nil, nil) // grava o pendente e 13:04

	var sum int64
	minutes := 0
	for _, it := range outbox(t, store) {
		if it.Kind != buffer.KindMinute {
			continue
		}
		var m contracts.Minute
		if err := json.Unmarshal(it.Payload, &m); err != nil {
			t.Fatal(err)
		}
		sum += m.Total
		minutes++
	}
	// A primeira leitura (1001) é a referência; daí em diante cada leitura é 1 peça.
	if want := int64(total - 1001); minutes != 5 || sum != want {
		t.Fatalf("%d minutos somando %d peças; quer 5 minutos e %d (delta do contador)", minutes, sum, want)
	}
}

// Falha longa de gravação: a memória tem limite (maxUnsentItems). Saem os itens mais
// antigos e a perda vira UM evento data_loss (nunca silenciosa), gravado quando o
// buffer volta, à frente do restante.
func TestUnsentOverflowDropsOldestAndRecordsDataLoss(t *testing.T) {
	path := filepath.Join(t.TempDir(), "b.db")
	broken, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	broken.Close()
	a := testAgent(broken)
	t0 := time.Date(2026, 11, 11, 8, 0, 0, 0, time.UTC)
	gen := ids.NewGenerator(nil)
	item := func(i int) buffer.Item {
		at := t0.Add(time.Duration(i) * time.Second)
		ev := contracts.StateEvent{ID: gen.New(at), Type: contracts.EventState, At: contracts.FormatTime(at), MachineID: mID, State: "RUNNING"}
		b, _ := json.Marshal(ev)
		return buffer.Item{Kind: buffer.KindEvent, ItemID: ev.ID, MachineID: mID, At: at, Payload: b}
	}
	const extra = 7
	for i := 0; i < maxUnsentItems+extra; i++ {
		a.addUnsent(buffer.Write{Items: []buffer.Item{item(i)}})
		if i == maxUnsentItems || i == maxUnsentItems+extra-1 { // duas tentativas, ambas acima do limite
			a.flush(context.Background(), t0.Add(time.Hour))
		}
	}
	if len(a.unsent.Items) != maxUnsentItems {
		t.Fatalf("em memória: %d itens, limite %d", len(a.unsent.Items), maxUnsentItems)
	}

	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a.store = store
	a.flush(context.Background(), t0.Add(time.Hour))
	items := outbox(t, store)
	if len(items) != maxUnsentItems+1 {
		t.Fatalf("outbox: %d itens, quer %d + data_loss", len(items), maxUnsentItems)
	}
	loss := payloadOf(t, items[0])
	if loss["type"] != "data_loss" || loss["reason"] != "retention_limit" || loss["items"] != float64(extra) ||
		loss["period_from"] != contracts.FormatTime(t0) || loss["period_to"] != contracts.FormatTime(t0.Add((extra-1)*time.Second)) ||
		loss["lost_seq_from"] != float64(items[0].Seq) || loss["lost_seq_to"] != float64(items[0].Seq) {
		t.Fatalf("data_loss: %v (seq %d)", loss, items[0].Seq)
	}
	if first := payloadOf(t, items[1]); first["at"] != contracts.FormatTime(t0.Add(extra*time.Second)) {
		t.Fatalf("deveriam sair só os %d mais antigos; primeiro mantido: %v", extra, first["at"])
	}
	validEvents(t, items[:50])
}

// Um passo do relógio de parede (NTP/RTC) entre dois ticks vira um evento clock_jump
// com o tamanho do salto; o avanço normal não gera nada.
func TestTickReportsWallClockJump(t *testing.T) {
	store, err := buffer.Open(filepath.Join(t.TempDir(), "b.db"), buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	eng, err := engine.New(engineTestConfig(t), t0.Add(-10*time.Second), engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a := testAgent(store)
	steps := []struct {
		wall time.Time
		mono time.Duration
	}{
		{t0, 0},
		{t0.Add(time.Second), time.Second}, // normal
		{t0.Add(2500 * time.Millisecond), 3 * time.Second},     // ruído abaixo do limite
		{t0.Add(-time.Hour + 4*time.Second), 4 * time.Second},  // voltou 1 h
		{t0.Add(-time.Hour + 15*time.Second), 5 * time.Second}, // adiantou 10 s
	}
	for _, s := range steps {
		a.clock = func() (time.Time, time.Duration) { return s.wall, s.mono }
		a.tick(context.Background(), eng, nil, nil)
	}
	var jumps []float64
	for _, it := range outbox(t, store) {
		if p := payloadOf(t, it); p["type"] == "clock_jump" {
			jumps = append(jumps, p["jump_ms"].(float64))
		}
	}
	want := []float64{-3_600_000 + 500, 10_000}
	if len(jumps) != len(want) || jumps[0] != want[0] || jumps[1] != want[1] {
		t.Fatalf("clock_jump: %v, quer %v", jumps, want)
	}
	validEvents(t, outbox(t, store))
}

// setWriteFailure liga ou desliga uma falha de gravação na outbox (como disco cheio):
// todo INSERT falha, as leituras (contadores, Stats, Peek) seguem funcionando.
func setWriteFailure(t *testing.T, path string, fail bool) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	q := `DROP TRIGGER IF EXISTS falha_de_gravacao`
	if fail {
		q = `CREATE TRIGGER falha_de_gravacao BEFORE INSERT ON outbox_core BEGIN SELECT RAISE(ABORT, 'disco cheio'); END`
	}
	if _, err := db.Exec(q); err != nil {
		t.Fatal(err)
	}
}

// stateItem é um evento de estado pronto para a outbox.
func stateItem(gen *ids.Generator, at time.Time) buffer.Item {
	ev := contracts.StateEvent{ID: gen.New(at), Type: contracts.EventState, At: contracts.FormatTime(at), MachineID: mID, State: "RUNNING"}
	b, _ := json.Marshal(ev)
	return buffer.Item{Kind: buffer.KindEvent, ItemID: ev.ID, MachineID: mID, At: at, Payload: b}
}

// Enquanto o buffer falha, a saída pendente (até maxUnsentItems itens) não é regravada
// a cada tick: a espera entre tentativas dobra (1 s, 2 s, ...) até commitRetryMax, para
// não travar a rotina de coleta (leituras dos pollers, watchdog) num disco lento.
func TestCommitRetryBacksOffWhileBufferFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "b.db")
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	setWriteFailure(t, path, true)
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	eng, err := engine.New(engineTestConfig(t), t0, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a := testAgent(store)
	gen := ids.NewGenerator(nil)
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, t0.Add(-time.Minute))}})
	tickAt := func(d time.Duration) {
		a.clock = func() (time.Time, time.Duration) { return t0.Add(d), d }
		a.tick(context.Background(), eng, nil, nil)
	}

	tickAt(0)              // falha: próxima tentativa em 1 s
	tickAt(commitRetryMin) // falha de novo: a espera dobra, próxima em 3 s
	setWriteFailure(t, path, false)
	tickAt(2 * commitRetryMin) // o disco voltou, mas ainda é tempo de espera: não tenta
	if n := len(outbox(t, store)); n != 0 {
		t.Fatalf("regravou antes de a espera acabar: %d itens na outbox", n)
	}
	tickAt(3 * commitRetryMin)
	if n := len(outbox(t, store)); n != 1 || len(a.unsent.Items) != 0 {
		t.Fatalf("depois da espera: %d itens na outbox, %d em memória; quer 1 e 0", n, len(a.unsent.Items))
	}

	// A espera tem teto: uma falha longa tenta de novo pelo menos a cada commitRetryMax.
	setWriteFailure(t, path, true)
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, t0)}})
	for d := 4 * commitRetryMin; d < 30*time.Minute; d += commitRetryMin {
		tickAt(d)
	}
	if a.retryWait != commitRetryMax {
		t.Fatalf("espera entre tentativas = %v, teto %v", a.retryWait, commitRetryMax)
	}
}

// Na parada com o buffer sem gravar, a saída do motor em memória se perde: isso vai
// sempre para o log como erro, mesmo que a falha de gravação tenha sido registrada há
// pouco (o log de falha é espaçado) e sem data_loss possível.
func TestShutdownWithUnwritableBufferLogsLostOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "b.db")
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	setWriteFailure(t, path, true)
	var logs bytes.Buffer
	a := testAgent(store)
	a.log = slog.New(slog.NewTextHandler(&logs, nil))
	a.local, a.opts.TickEvery = config.DefaultLocal(), 10*time.Millisecond
	gen := ids.NewGenerator(nil)
	now := time.Now()
	for i := 3; i >= 1; i-- {
		a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, now.Add(-time.Duration(i)*time.Minute))}})
	}
	a.commitLogAt = now // falha já registrada: os ticks e o da parada não logam de novo

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, engineTestConfig(t)) }()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		a.mu.Lock()
		ticked := !a.lastTick.IsZero()
		a.mu.Unlock()
		if ticked {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a coleta não chegou a dar um tick")
		}
	}
	cancel() // SIGTERM
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("collectWith: %v", err)
	}
	if len(a.unsent.Items) != 3 {
		t.Fatalf("%d itens em memória; o buffer não deveria ter gravado", len(a.unsent.Items))
	}
	if out := logs.String(); !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "itens_perdidos=3") {
		t.Fatalf("a parada deveria registrar os 3 itens perdidos; log:\n%s", out)
	}
}

// O data_loss informa como lost_seq o seq que ele mesmo recebe. Um evento gravado por
// outra rotina (configLoop: config_applied/config_rejected) entre a leitura do seq e o
// Commit não pode deslocá-lo para o seq de um evento entregue.
func TestDataLossSeqNotShiftedByConcurrentEvents(t *testing.T) {
	store, err := buffer.Open(filepath.Join(t.TempDir(), "b.db"), buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a := testAgent(store)
	ctx := context.Background()
	gen := ids.NewGenerator(nil)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() { // configLoop gravando eventos sem parar
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			now := time.Now()
			a.enqueueEvent(ctx, contracts.AgentStopEvent{ID: gen.New(now), Type: contracts.EventAgentStop, At: contracts.FormatTime(now), Reason: "shutdown"}, now)
		}
	}()
	t0 := time.Date(2026, 11, 11, 8, 0, 0, 0, time.UTC)
	const rounds = 20
	for i := 0; i < rounds; i++ {
		at := t0.Add(time.Duration(i) * time.Minute)
		a.lost = &unsentLoss{id: gen.New(at), at: at, items: 1, from: at, to: at}
		a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, at)}})
		if !a.flush(ctx, at) {
			t.Fatal("flush falhou")
		}
	}
	close(stop)
	<-done
	losses := 0
	for _, it := range outbox(t, store) {
		if p := payloadOf(t, it); p["type"] == "data_loss" {
			losses++
			if p["lost_seq_from"] != float64(it.Seq) || p["lost_seq_to"] != float64(it.Seq) {
				t.Fatalf("data_loss no seq %d informa lost_seq %v..%v", it.Seq, p["lost_seq_from"], p["lost_seq_to"])
			}
		}
	}
	if losses != rounds {
		t.Fatalf("%d data_loss, quer %d", losses, rounds)
	}
}

// Token revogado (401): o agente grava o marcador auth-blocked ao lado da credencial.
// É ele que deixa o enroll sem --force (o único que o sudo do técnico permite) trocar
// a credencial recusada. Com a credencial nova aceita pela nuvem (200), o agente
// apaga o marcador (um 401 passageiro não deixa a porta aberta). As linhas do sync
// (volta da nuvem, marcador apagado) vão para o log do agente, não para o padrão.
func TestRevokedTokenWritesAuthBlockedMarkerAndAcceptedSyncClearsIt(t *testing.T) {
	const newToken = "gw_test_Q9mZ2xV7cL4kR1pT8wY3sB6nH0jF5dG2aE7uK9iM4oN"
	var mu sync.Mutex
	refused, accepted := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != contracts.RouteSync {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer "+newToken {
			refused++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":{"code":"token_revoked","message":"token revogado"}}`)
			return
		}
		accepted++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ack_seq": 0, "server_time": contracts.FormatTime(time.Now()), "config": map[string]any{"latest_version": 0},
			"commands": []any{}, "next_sync_s": 1, "min_agent_version": "0.1.0",
		})
	}))
	defer srv.Close()
	counts := func() (int, int) {
		mu.Lock()
		defer mu.Unlock()
		return refused, accepted
	}

	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Cloud.URL = srv.URL
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json")
	saveToken := func(tok string) {
		t.Helper()
		if err := config.SaveCredentials(local.Paths.Credentials, &config.Credentials{GatewayID: "01a1c5d4-9208-752e-89a7-834df2a74de4", Token: tok, Org: "acme", CloudURL: srv.URL}); err != nil {
			t.Fatal(err)
		}
	}
	saveToken(token) // o token que a nuvem revogou
	marker := filepath.Join(dir, uplink.BlockedMarkerFile)
	readMarker := func() *uplink.BlockedMarker {
		t.Helper()
		m, err := uplink.ReadBlockedMarker(marker)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	waitFor := func(what string, cond func() bool) {
		t.Helper()
		for deadline := time.Now().Add(10 * time.Second); !cond(); time.Sleep(20 * time.Millisecond) {
			if time.Now().After(deadline) {
				r, a := counts()
				t.Fatalf("prazo esgotado esperando %s (401 x%d, 200 x%d)", what, r, a)
			}
		}
	}

	logs := &syncBuffer{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(logs, nil)),
			TickEvery: 200 * time.Millisecond, CredentialsPollEvery: 50 * time.Millisecond})
	}()

	waitFor("o marcador auth-blocked ao lado da credencial", func() bool { return readMarker() != nil })
	m := readMarker()
	if m.Status != http.StatusUnauthorized || m.Code != "token_revoked" || m.Since == "" || m.Last == "" {
		t.Fatalf("marcador: %+v", m)
	}
	if st, err := os.Stat(marker); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("permissão do marcador: %v (%v)", st.Mode(), err)
	}

	// Credencial nova (enroll): a nuvem aceita, e o primeiro sync aceito apaga o marcador.
	saveToken(newToken)
	waitFor("o marcador apagado depois do sync aceito", func() bool {
		_, a := counts()
		return a > 0 && readMarker() == nil
	})
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	out := logs.String()
	for _, want := range []string{"nuvem recusou o token", "sync com a nuvem recuperado", "marcador de credencial recusada apagado"} {
		if !strings.Contains(out, want) {
			t.Fatalf("o log do agente deveria ter %q:\n%s", want, out)
		}
	}
}

// stateRead é uma leitura do código de estado de engineTestConfig (0 STOPPED, 1 RUNNING).
func stateRead(t *testing.T, at time.Time, code uint16) poller.Reading {
	t.Helper()
	v, err := modbus.DecodeRegisters([]uint16{code}, modbus.Uint16, modbus.WordOrderNone, -1)
	if err != nil {
		t.Fatal(err)
	}
	return poller.Reading{DeviceID: devID, At: at, Samples: []engine.Sample{{TagID: tState, Value: v}}}
}

// stoppingEngine devolve um motor com a máquina RUNNING desde base e um candidato a
// STOPPED visto em base+2,2 s (debounce padrão de 1 s correndo). Uma leitura RUNNING
// em base+2,6 s o desmente; um tick em base+3,4 s sem ela o confirmaria.
func stoppingEngine(t *testing.T, base time.Time) *engine.Engine {
	t.Helper()
	eng, err := engine.New(engineTestConfig(t), base, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	for ms := 0; ms <= 2000; ms += 200 {
		r := stateRead(t, base.Add(time.Duration(ms)*time.Millisecond), 1)
		eng.OnRead(r.At, r.Samples)
	}
	r := stateRead(t, base.Add(2200*time.Millisecond), 0)
	eng.OnRead(r.At, r.Samples)
	return eng
}

// liveState é o estado da máquina que o último tick publicou (live).
func liveState(a *agent) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, l := range a.live {
		if l.MachineID == mID {
			return l.State
		}
	}
	return ""
}

// Leituras já na fila quando o tick roda (coleta atrasada) entram no motor antes dele:
// o tick não confirma um candidato que uma leitura mais antiga que ele desmente.
func TestTickAppliesQueuedReadingsFirst(t *testing.T) {
	a, clk, _, path := watchdogAgent(t)
	eng := stoppingEngine(t, fakeWall)
	readings := make(chan poller.Reading, 4)
	readings <- stateRead(t, fakeWall.Add(2600*time.Millisecond), 1) // desmente o STOPPED
	clk.set(3400 * time.Millisecond)                                 // 1,2 s depois do candidato: passou do debounce

	a.tick(context.Background(), eng, nil, readings)
	if n := len(readings); n != 0 {
		t.Fatalf("%d leituras ficaram na fila depois do tick", n)
	}
	if st := liveState(a); st != contracts.StateRunning {
		t.Fatalf("live depois do tick: %q; a leitura RUNNING de antes do tick desmente o STOPPED", st)
	}
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, it := range outbox(t, store) {
		if p := payloadOf(t, it); p["type"] == contracts.EventState && p["state"] == contracts.StateStopped {
			t.Fatalf("STOPPED confirmado com a leitura que o desmente ainda na fila: %v", p)
		}
	}
}

// No laço da coleta, o tick pronto junto com leituras (coleta atrasada) não passa à
// frente delas. O select escolhe ao acaso entre os dois: o cenário roda várias vezes
// (sem a drenagem antes do tick, cada rodada falharia com chance 1/2).
func TestCollectLoopTickDoesNotOvertakeQueuedReadings(t *testing.T) {
	a, clk, _, _ := watchdogAgent(t)
	a.reconfigure = make(chan *config.GatewayConfig, 1)
	for i := range 40 {
		offset := time.Duration(i) * time.Minute
		base := fakeWall.Add(offset)
		eng := stoppingEngine(t, base)
		readings := make(chan poller.Reading, 1)
		readings <- stateRead(t, base.Add(2600*time.Millisecond), 1)
		ticks := make(chan time.Time, 1)
		ticks <- base // tick e leitura prontos juntos
		tickAt := offset + 3400*time.Millisecond
		clk.set(tickAt)

		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan bool, 1)
		go func() { done <- a.consume(ctx, eng, nil, readings, ticks) }()
		waitBeats(t, a, func(b beatsView) bool { return b.tick == tickAt })
		cancel()
		if <-done {
			t.Fatal("consume devolveu troca de config")
		}
		if st := liveState(a); st != contracts.StateRunning {
			t.Fatalf("rodada %d: tick rodou antes da leitura que já estava na fila (live %q)", i, st)
		}
	}
}

// waitSendersBlocked espera n rotinas criadas pelo teste paradas no envio a um canal
// cheio: o poller esperando na entrega (contrapressão).
func waitSendersBlocked(t *testing.T, n int) {
	t.Helper()
	buf := make([]byte, 1<<20)
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
		blocked := 0
		for _, g := range strings.Split(string(buf[:runtime.Stack(buf, true)]), "\n\n") {
			if strings.Contains(g, "[chan send") && strings.Contains(g, "."+t.Name()+".func") {
				blocked++
			}
		}
		if blocked == n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d rotinas paradas no envio, quer %d", blocked, n)
		}
	}
}

// Coleta atrasada com a fila cheia (gravação lenta): pollers esperam na entrega
// (contrapressão) com leituras de antes do tick. Cada leitura que a drenagem tira da
// fila dá a vaga à de um deles, e o tick só roda depois de aplicá-las: drenar só o
// que len mostrava no início deixava na fila a leitura que desmente o candidato, e o
// tick confirmava um STOPPED que não houve.
func TestTickDrainsReadingsBlockedInDelivery(t *testing.T) {
	a, clk, _, path := watchdogAgent(t)
	eng := stoppingEngine(t, fakeWall)
	readings := make(chan poller.Reading, 1)
	readings <- stateRead(t, fakeWall.Add(2400*time.Millisecond), 0) // fila cheia
	var wg sync.WaitGroup
	for i, r := range []poller.Reading{ // dois pollers à espera, nesta ordem (o canal é FIFO)
		stateRead(t, fakeWall.Add(2600*time.Millisecond), 1), // desmente o STOPPED
		stateRead(t, fakeWall.Add(2800*time.Millisecond), 1),
	} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			readings <- r
		}()
		waitSendersBlocked(t, i+1)
	}
	sent := make(chan struct{})
	go func() {
		wg.Wait()
		close(sent)
	}()
	clk.set(3400 * time.Millisecond) // 1,2 s depois do candidato: passou do debounce

	a.tick(context.Background(), eng, nil, readings)
	var left []time.Duration // o que o tick não aplicou, na fila ou ainda à espera da entrega
pending:
	for {
		select {
		case r := <-readings:
			left = append(left, r.At.Sub(fakeWall))
		case <-sent:
			for len(readings) > 0 {
				left = append(left, (<-readings).At.Sub(fakeWall))
			}
			break pending
		}
	}
	if len(left) != 0 {
		t.Fatalf("leituras de antes do tick (em 3,4 s) ficaram para depois dele: %v", left)
	}
	if st := liveState(a); st != contracts.StateRunning {
		t.Fatalf("live depois do tick: %q; a leitura RUNNING de antes do tick desmente o STOPPED", st)
	}
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, it := range outbox(t, store) {
		if p := payloadOf(t, it); p["type"] == contracts.EventState && p["state"] == contracts.StateStopped {
			t.Fatalf("STOPPED confirmado com a leitura que o desmente à espera da entrega: %v", p)
		}
	}
}
