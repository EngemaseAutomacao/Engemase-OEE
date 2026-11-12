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
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
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

// Config de uma máquina (estado + contador total), sem CLP: o motor é alimentado à mão.
func engineTestConfig(t *testing.T) *config.GatewayConfig {
	t.Helper()
	cfg, err := config.ParseRemote([]byte(`{"config_version":1,"serial_buses":[],
	"devices":[{"id":"` + devID + `","protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":502,"unit_id":1},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[{"id":"` + tState + `","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"` + mID + `"},
	   {"id":"` + tTotal + `","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"` + mID + `"}]}],
	"machines":[{"id":"` + mID + `","state_rules":{"mode":"state_code","map":{"0":"STOPPED","1":"RUNNING"}}}],
	"uplink":{"sync_interval_s":1,"max_batch_items":2000}}`))
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
	a.tick(context.Background(), eng, nil) // o motor fecha os minutos aqui; o Commit falha
	a.tick(context.Background(), eng, nil) // nova tentativa, ainda falhando

	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a.store = store
	a.tick(context.Background(), eng, nil) // o buffer voltou
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
		{t0.Add(2*time.Second + 1500*time.Millisecond), 3 * time.Second}, // ruído abaixo do limite
		{t0.Add(-time.Hour + 4*time.Second), 4 * time.Second},            // voltou 1 h
		{t0.Add(-time.Hour + 15*time.Second), 5 * time.Second},           // adiantou 10 s
	}
	for _, s := range steps {
		a.clock = func() (time.Time, time.Duration) { return s.wall, s.mono }
		a.tick(context.Background(), eng, nil)
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
