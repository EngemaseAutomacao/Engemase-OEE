package uplink_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

const (
	token     = "gw_test_8f2cJ3kq0V1mZ9xYtR4pL6wE2sA7dF5gH8jK1lQ0nB3"
	machineID = "01a159a1-4a68-72de-9057-14e72d836a47"
)

var t0 = time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)

// fakeCloud é a API dos gateways falsa: confere cabeçalhos, descompacta, valida o
// corpo no JSON Schema ESTRITO do contrato e responde com o handler do teste.
type fakeCloud struct {
	t       *testing.T
	srv     *httptest.Server
	mu      sync.Mutex
	reqs    []contracts.SyncRequest
	respond func(req contracts.SyncRequest) (int, any, http.Header)
}

func newCloud(t *testing.T, respond func(req contracts.SyncRequest) (int, any, http.Header)) *fakeCloud {
	t.Helper()
	schema := testutil.StrictSchema(t, "sync-request")
	fc := &fakeCloud{t: t, respond: respond}
	fc.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != contracts.RouteSync {
			http.Error(w, "rota", http.StatusNotFound)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+token {
			t.Errorf("Authorization = %q", got)
		}
		if r.Header.Get("Content-Encoding") != "gzip" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("cabeçalhos: %v", r.Header)
		}
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "oee-gateway/0.1.0 (") {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		zr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Errorf("corpo não é gzip: %v", err)
			return
		}
		raw, _ := io.ReadAll(zr)
		if errs := testutil.ValidateJSON(t, schema, raw); errs != "" {
			t.Errorf("/sync fora do contrato: %s\n%s", errs, raw)
		}
		var req contracts.SyncRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			t.Errorf("decodificando: %v", err)
		}
		fc.mu.Lock()
		fc.reqs = append(fc.reqs, req)
		fc.mu.Unlock()

		status, body, hdr := fc.respond(req)
		for k, v := range hdr {
			w.Header()[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		// Responde comprimido, como a Vercel faz.
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(status)
		zw := gzip.NewWriter(w)
		_ = json.NewEncoder(zw).Encode(body)
		_ = zw.Close()
	}))
	t.Cleanup(fc.srv.Close)
	return fc
}

func (fc *fakeCloud) requests() []contracts.SyncRequest {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	return append([]contracts.SyncRequest(nil), fc.reqs...)
}

// seqs devolve os seqs de eventos e minutos de uma requisição.
func seqs(req contracts.SyncRequest) []int64 {
	var out []int64
	for _, raw := range append(append([]json.RawMessage{}, req.Events...), req.Minutes...) {
		var v struct {
			Seq int64 `json:"seq"`
		}
		_ = json.Unmarshal(raw, &v)
		out = append(out, v.Seq)
	}
	return out
}

func ok(req contracts.SyncRequest, nextSync int) (int, any, http.Header) {
	ack := int64(0)
	if req.Batch.SeqTo != nil {
		ack = *req.Batch.SeqTo
	}
	return 200, map[string]any{
		"ack_seq": ack, "server_time": contracts.FormatTime(time.Now()), "config": map[string]any{"latest_version": 1},
		"commands": []any{}, "next_sync_s": nextSync, "min_agent_version": "0.1.0",
	}, nil
}

func apiErr(status int, code string, hdr http.Header) (int, any, http.Header) {
	return status, map[string]any{"error": map[string]any{"code": code, "message": "erro de teste"}}, hdr
}

func newStore(t *testing.T, events, minutes int) (*buffer.Store, []int64) {
	t.Helper()
	s, err := buffer.Open(filepath.Join(t.TempDir(), "buffer.db"), buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	gen := ids.NewGenerator(nil)
	var items []buffer.Item
	for i := 0; i < events; i++ {
		at := t0.Add(time.Duration(i) * time.Second)
		ev := contracts.StateEvent{ID: gen.New(at), Type: contracts.EventState, At: contracts.FormatTime(at), MachineID: machineID, State: "RUNNING"}
		b, _ := json.Marshal(ev)
		items = append(items, buffer.Item{Kind: buffer.KindEvent, ItemID: ev.ID, MachineID: machineID, At: at, Payload: b})
	}
	for i := 0; i < minutes; i++ {
		start := t0.Add(time.Duration(i) * time.Minute)
		m := contracts.Minute{MachineID: machineID, T: contracts.FormatMinute(start), RunS: 50, StopS: 10, Total: 7}
		b, _ := json.Marshal(m)
		items = append(items, buffer.Item{Kind: buffer.KindMinute, ItemID: machineID + "|" + start.String(), MachineID: machineID, At: start, Payload: b})
	}
	seqs, err := s.Enqueue(context.Background(), items...)
	if err != nil {
		t.Fatal(err)
	}
	return s, seqs
}

func newSyncer(t *testing.T, fc *fakeCloud, q uplink.Queue) *uplink.Syncer {
	t.Helper()
	c, err := uplink.New(uplink.Options{BaseURL: fc.srv.URL, Token: token, AgentVersion: "0.1.0", Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return &uplink.Syncer{
		Sender: c,
		Queue:  q,
		Snapshot: func(now time.Time) uplink.Snapshot {
			return uplink.Snapshot{
				Agent: contracts.AgentHealth{Version: "0.1.0", UptimeS: 10, ConfigVersion: 1, CPUPct: 1.5, MemMB: 30, DiskFreeMB: 1000},
				Live:  []contracts.Live{{MachineID: machineID, At: contracts.FormatTime(now), State: "RUNNING", StateSince: contracts.FormatTime(now.Add(-time.Minute))}},
			}
		},
	}
}

func pending(t *testing.T, s *buffer.Store) buffer.Stats {
	t.Helper()
	st, err := s.Stats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func TestSyncSendsBatchAndAcks(t *testing.T) {
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) { return ok(req, 10) })
	store, all := newStore(t, 3, 2)
	sy := newSyncer(t, fc, store)
	var got *contracts.SyncResponse
	sy.OnResponse = func(r *contracts.SyncResponse) { got = r }

	res, err := sy.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Acked != 5 || res.More || got == nil || got.NextSyncS != 10 {
		t.Fatalf("resultado: %+v resp=%+v", res, got)
	}
	reqs := fc.requests()
	if len(reqs) != 1 || len(reqs[0].Events) != 3 || len(reqs[0].Minutes) != 2 ||
		*reqs[0].Batch.SeqFrom != all[0] || *reqs[0].Batch.SeqTo != all[4] {
		t.Fatalf("requisição: %+v", reqs)
	}
	if st := pending(t, store); st.Pending != 0 || st.AckedSeq != all[4] {
		t.Fatalf("fila: %+v", st)
	}
	// Fila vazia: sync só de saúde (sem faixa de seq), ainda válido no contrato.
	if _, err := sy.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if last := fc.requests()[1]; last.Batch.SeqFrom != nil || len(last.Events) != 0 {
		t.Fatalf("sync de saúde: %+v", last.Batch)
	}
}

func TestAckIsCappedToBatchAndQueueDrainsInBatches(t *testing.T) {
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		status, body, h := ok(req, 10)
		body.(map[string]any)["ack_seq"] = 999_999 // servidor confirmando além do lote
		return status, body, h
	})
	store, all := newStore(t, 5, 0)
	sy := newSyncer(t, fc, store)
	sy.MaxItems = 2

	res, err := sy.SyncOnce(context.Background())
	if err != nil || res.Acked != 2 || !res.More {
		t.Fatalf("primeiro lote: %+v (%v)", res, err)
	}
	if st := pending(t, store); st.Pending != 3 || st.AckedSeq != all[1] {
		t.Fatalf("ack deveria parar no fim do lote: %+v", st)
	}
	for i := 0; i < 2; i++ {
		if _, err := sy.SyncOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if st := pending(t, store); st.Pending != 0 {
		t.Fatalf("fila deveria esvaziar: %+v", st)
	}
}

func TestBadRequestIsolatesOnlyTheBadItem(t *testing.T) {
	store, all := newStore(t, 7, 0)
	bad := all[4]
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		for _, s := range seqs(req) {
			if s == bad {
				return apiErr(400, "invalid_payload", nil)
			}
		}
		return ok(req, 10)
	})
	sy := newSyncer(t, fc, store)
	res, err := sy.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Quarantined != 1 || res.Acked != 6 {
		t.Fatalf("resultado: %+v", res)
	}
	if st := pending(t, store); st.Pending != 0 || st.Quarantined != 1 {
		t.Fatalf("fila: %+v", st)
	}
}

func TestBadRequestOutsideItemsQuarantinesNothing(t *testing.T) {
	store, _ := newStore(t, 2, 0)
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) { return apiErr(400, "invalid_payload", nil) })
	sy := newSyncer(t, fc, store)
	_, err := sy.SyncOnce(context.Background())
	if uplink.ActionFor(err) != uplink.ActionIsolateItem {
		t.Fatalf("erro: %v", err)
	}
	if st := pending(t, store); st.Pending != 2 || st.Quarantined != 0 {
		t.Fatalf("nada deveria ir para a quarentena: %+v", st)
	}
}

func TestPayloadTooLargeSplitsBatch(t *testing.T) {
	store, _ := newStore(t, 9, 0)
	var sizes []int
	var mu sync.Mutex
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		mu.Lock()
		sizes = append(sizes, len(req.Events))
		mu.Unlock()
		if len(req.Events) > 2 {
			return apiErr(413, "payload_too_large", nil)
		}
		return ok(req, 10)
	})
	sy := newSyncer(t, fc, store)
	res, err := sy.SyncOnce(context.Background())
	if err != nil || res.Acked != 9 || res.Quarantined != 0 {
		t.Fatalf("resultado: %+v (%v)", res, err)
	}
	if sizes[0] != 9 {
		t.Fatalf("primeiro envio deveria ter o lote inteiro: %v", sizes)
	}
	for _, n := range sizes[1:] {
		if n > 5 { // 9 → 4 + 5 → ...
			t.Fatalf("lotes divididos ao meio: %v", sizes)
		}
	}
}

func TestUnauthorizedBlocksAndKeepsBuffer(t *testing.T) {
	var revoked = true
	var mu sync.Mutex
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		mu.Lock()
		defer mu.Unlock()
		if revoked {
			return apiErr(401, "token_revoked", nil)
		}
		return ok(req, 10)
	})
	store, _ := newStore(t, 3, 0)
	sy := newSyncer(t, fc, store)
	var alarm error
	sy.OnBlocked = func(err error) { alarm = err }

	if _, err := sy.SyncOnce(context.Background()); uplink.ActionFor(err) != uplink.ActionStopSending || alarm == nil {
		t.Fatalf("401: %v (alarme %v)", err, alarm)
	}
	if _, err := sy.SyncOnce(context.Background()); !errors.Is(err, uplink.ErrBlocked) {
		t.Fatalf("bloqueado deveria parar de enviar: %v", err)
	}
	if n := len(fc.requests()); n != 1 {
		t.Fatalf("enviou %d vezes depois do 401", n)
	}
	if st := pending(t, store); st.Pending != 3 {
		t.Fatalf("buffer deveria ser mantido: %+v", st)
	}
	mu.Lock()
	revoked = false
	mu.Unlock()
	sy.Unblock()
	if res, err := sy.SyncOnce(context.Background()); err != nil || res.Acked != 3 {
		t.Fatalf("depois do novo token: %+v (%v)", res, err)
	}
}

func TestConflictRefreshesConfig(t *testing.T) {
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) { return apiErr(409, "config_outdated", nil) })
	store, _ := newStore(t, 1, 0)
	sy := newSyncer(t, fc, store)
	refreshed := false
	sy.OnConfigOutdated = func() { refreshed = true }
	if _, err := sy.SyncOnce(context.Background()); uplink.ActionFor(err) != uplink.ActionRefreshConfig || !refreshed {
		t.Fatalf("409: %v refreshed=%v", err, refreshed)
	}
}

// Run: 500 → backoff crescente; 429 → Retry-After; depois 200 → next_sync_s do servidor.
func TestRunPacing(t *testing.T) {
	var mu sync.Mutex
	call := 0
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		mu.Lock()
		defer mu.Unlock()
		call++
		switch call {
		case 1, 2, 3:
			return apiErr(500, "internal_error", nil)
		case 4:
			return apiErr(429, "rate_limited", http.Header{"Retry-After": {"7"}})
		}
		return ok(req, 1) // modo interativo
	})
	store, _ := newStore(t, 1, 0)
	sy := newSyncer(t, fc, store)
	sy.Backoff = &uplink.Backoff{Base: time.Second, Max: 5 * time.Minute, Rand: func(n int64) int64 { return n - 1 }} // sempre o teto
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var waits []time.Duration
	sy.Sleep = func(ctx context.Context, d time.Duration) error {
		waits = append(waits, d)
		if len(waits) == 6 {
			cancel()
			return ctx.Err()
		}
		return nil
	}
	if err := sy.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run: %v", err)
	}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 7 * time.Second, time.Second, time.Second}
	for i := range want {
		if waits[i] != want[i] {
			t.Fatalf("esperas = %v, quer %v", waits, want)
		}
	}
	if st := pending(t, store); st.Pending != 0 {
		t.Fatalf("fila: %+v", st)
	}
}

func TestClockOffset(t *testing.T) {
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		status, body, h := ok(req, 10)
		body.(map[string]any)["server_time"] = contracts.FormatTime(time.Now().Add(5 * time.Second))
		return status, body, h
	})
	store, _ := newStore(t, 0, 0)
	sy := newSyncer(t, fc, store)
	for i := 0; i < 3; i++ {
		if _, err := sy.SyncOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if off := sy.ClockOffsetMS(); off < 4500 || off > 5500 {
		t.Fatalf("diferença de relógio = %d ms", off)
	}
}

func TestBackoffBounds(t *testing.T) {
	hi := &uplink.Backoff{Base: time.Second, Max: 5 * time.Minute, Rand: func(n int64) int64 { return n - 1 }}
	var got []time.Duration
	for i := 0; i < 12; i++ {
		got = append(got, hi.Next())
	}
	want := []time.Duration{1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300, 300}
	for i := range want {
		if got[i] != want[i]*time.Second {
			t.Fatalf("teto do backoff = %v", got)
		}
	}
	lo := &uplink.Backoff{Base: time.Second, Max: 5 * time.Minute, Rand: func(n int64) int64 { return 0 }}
	for i := 0; i < 5; i++ {
		if d := lo.Next(); d != time.Second {
			t.Fatalf("piso do backoff = %v", d)
		}
	}
	hi.Reset()
	if hi.Next() != time.Second {
		t.Fatal("Reset deveria voltar ao início")
	}
	real := uplink.NewBackoff()
	for i := 0; i < 20; i++ {
		if d := real.Next(); d < time.Second || d > 5*time.Minute {
			t.Fatalf("fora da faixa: %v", d)
		}
	}
}

func TestEnrollAndFetchConfig(t *testing.T) {
	cfgBody := testutil.ReadFixture(t, "gateway-config.valid.tcp-only-io.json")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case contracts.RouteEnroll:
			if r.Header.Get("Authorization") != "" {
				t.Errorf("enroll não leva Bearer")
			}
			zr, _ := gzip.NewReader(r.Body)
			var req contracts.EnrollRequest
			_ = json.NewDecoder(zr).Decode(&req)
			if req.Code != "ABCD-1234" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error":{"code":"activation_code_invalid","message":"Código de ativação inválido."}}`))
				return
			}
			w.WriteHeader(201)
			_, _ = w.Write([]byte(`{"gateway_id":"01a1c5d4-9208-752e-89a7-834df2a74de4","token":"` + token + `","org":"acme"}`))
		case contracts.RouteConfig:
			if r.Header.Get("If-None-Match") == `"v7"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"v7"`)
			_, _ = w.Write(cfgBody)
		}
	}))
	defer srv.Close()
	c, err := uplink.New(uplink.Options{BaseURL: srv.URL + "/", AgentVersion: "0.1.0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	req := &contracts.EnrollRequest{Code: "ABCD-1234", Hostname: "egw-00042", AgentVersion: "0.1.0", HW: contracts.HardwareInfo{Arch: "arm64", Model: "reComputer R1000", MemMB: 2048}}
	res, err := c.Enroll(ctx, req)
	if err != nil || res.Token != token || res.Org != "acme" {
		t.Fatalf("enroll: %+v (%v)", res, err)
	}
	req.Code = "ZZZZ-9999"
	var he *uplink.HTTPError
	if _, err := c.Enroll(ctx, req); !errors.As(err, &he) || he.Code != "activation_code_invalid" || uplink.ActionFor(err) != uplink.ActionIsolateItem {
		t.Fatalf("código inválido: %v", err)
	}

	c.SetToken(token)
	body, etag, err := c.FetchConfig(ctx, "")
	if err != nil || etag != `"v7"` || !bytes.Equal(body, cfgBody) {
		t.Fatalf("config: etag=%s err=%v", etag, err)
	}
	if _, _, err := c.FetchConfig(ctx, etag); !errors.Is(err, uplink.ErrNotModified) {
		t.Fatalf("304: %v", err)
	}
}

func TestActionTable(t *testing.T) {
	cases := map[int]uplink.Action{
		200: uplink.ActionOK, 201: uplink.ActionOK, 400: uplink.ActionIsolateItem, 401: uplink.ActionStopSending,
		409: uplink.ActionRefreshConfig, 413: uplink.ActionSplitBatch, 429: uplink.ActionRetryAfter,
		500: uplink.ActionBackoff, 503: uplink.ActionBackoff, 404: uplink.ActionFixAndRetry, 410: uplink.ActionFixAndRetry,
	}
	for status, want := range cases {
		if got := uplink.ActionForStatus(status); got != want {
			t.Errorf("%d → %s, quer %s", status, got, want)
		}
	}
	if uplink.ActionFor(errors.New("connection refused")) != uplink.ActionBackoff {
		t.Error("erro de rede deveria dar backoff")
	}
	if uplink.ActionFor(uplink.ErrBodyTooLarge) != uplink.ActionSplitBatch {
		t.Error("lote grande demais deveria dividir")
	}
}
