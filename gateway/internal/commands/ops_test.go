package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// runRaw executa um comando e devolve o resultado sem conferir o contrato (log.level
// e logs.upload ainda não estão no v1).
func runRaw(t *testing.T, x *Executor, typ, payload string) map[string]any {
	t.Helper()
	id := fmt.Sprintf("01a1cab3-55e8-7cf0-a52e-%012d", time.Now().UnixNano()%1e12)
	x.Handle([]contracts.Command{{ID: id, Type: typ, ExpiresAt: contracts.FormatTime(time.Now().Add(time.Minute)), Payload: json.RawMessage(payload)}}, time.Now())
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(5 * time.Millisecond) {
		for _, r := range x.Results(50) {
			if strings.Contains(string(r), id) {
				var m map[string]any
				_ = json.Unmarshal(r, &m)
				x.Confirm()
				return m
			}
		}
	}
	t.Fatalf("%s sem resultado", typ)
	return nil
}

func TestLogLevel(t *testing.T) {
	lv := &slog.LevelVar{}
	ctl := &LevelControl{Var: lv, Base: slog.LevelInfo}
	defer ctl.Stop()
	x := New(Options{Log: quiet})
	defer x.Close()
	RegisterOps(x, OpsDeps{Level: ctl, ReadLogs: func(context.Context, int, time.Duration) ([]string, error) { return nil, nil }})

	m := runRaw(t, x, TypeLogLevel, `{"level":"debug","duration_s":60}`)
	r, _ := m["result"].(map[string]any)
	if m["status"] != "ok" || r["level"] != "debug" || r["previous"] != "info" || lv.Level() != slog.LevelDebug {
		t.Fatalf("log.level: %v (nível %v)", m, lv.Level())
	}
	if until, err := contracts.ParseTime(r["until"].(string)); err != nil || time.Until(until) < 50*time.Second {
		t.Fatalf("until: %v", r)
	}
	for _, bad := range []string{`{"level":"trace"}`, `{"level":"debug","duration_s":30}`, `{"level":"debug","duration_s":3601}`} {
		if m := runRaw(t, x, TypeLogLevel, bad); m["status"] != "rejected" {
			t.Fatalf("%s: %v", bad, m)
		}
	}
	// O nível volta sozinho ao do gateway.yaml.
	ctl.Set(slog.LevelError, 20*time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	if lv.Level() != slog.LevelInfo {
		t.Fatalf("nível não voltou: %v", lv.Level())
	}
}

func TestLogsUpload(t *testing.T) {
	var gotN int
	var gotSince time.Duration
	lines := []string{
		"2026-11-24T10:00:00 agente iniciado",
		`2026-11-24T10:00:01 {"msg":"sync","authorization":"Bearer gw_live_abcdefghijklmnop"}`,
		`2026-11-24T10:00:02 {"token":"segredo123","code":"ABCD-1234"}`,
		`2026-11-24T10:00:03 {"fault_code":47} última`,
	}
	x := New(Options{Log: quiet})
	defer x.Close()
	RegisterOps(x, OpsDeps{ReadLogs: func(_ context.Context, n int, since time.Duration) ([]string, error) {
		gotN, gotSince = n, since
		return append([]string(nil), lines...), nil
	}})
	if _, ok := x.handlers[TypeLogLevel]; ok {
		t.Fatal("log.level sem LevelControl deveria ficar unsupported")
	}
	m := runRaw(t, x, TypeLogsUpload, `{"lines":3,"since_s":600}`)
	r, _ := m["result"].(map[string]any)
	got, _ := r["lines"].([]any)
	if m["status"] != "ok" || gotN != 3 || gotSince != 10*time.Minute || len(got) != 4-1 || r["truncated"] != true {
		t.Fatalf("logs.upload: %v (n=%d since=%v)", m, gotN, gotSince)
	}
	text := fmt.Sprint(got)
	if strings.Contains(text, "abcdefghijklmnop") || strings.Contains(text, "segredo123") || strings.Contains(text, "ABCD-1234") ||
		!strings.Contains(text, `"fault_code":47`) {
		t.Fatalf("redação: %s", text)
	}
	if m := runRaw(t, x, TypeLogsUpload, `{"lines":0}`); m["status"] != "rejected" {
		t.Fatalf("lines 0: %v", m)
	}
	// Corte por tamanho: ficam as linhas mais novas.
	big := limitLines([]string{strings.Repeat("a", 1500), strings.Repeat("b", 1500)}, 10)
	if len(big.Lines) != 2 || big.Truncated {
		t.Fatalf("linhas pequenas: %+v", big.Truncated)
	}
	many := make([]string, 400)
	for i := range many {
		many[i] = fmt.Sprintf("%04d %s", i, strings.Repeat("x", 1000))
	}
	cut := limitLines(many, 2000)
	if !cut.Truncated || len(cut.Lines) >= 400 || !strings.HasPrefix(cut.Lines[len(cut.Lines)-1], "0399 ") {
		t.Fatalf("corte por bytes: %d linhas, truncated=%v", len(cut.Lines), cut.Truncated)
	}
}

func TestJournalLines(t *testing.T) {
	if _, err := exec.LookPath("journalctl"); err != nil {
		t.Skip("sem journalctl")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Sem o serviço (máquina de desenvolvimento), journalctl devolve vazio ou erro de
	// acesso: só não pode travar nem entrar em pânico.
	_, _ = JournalLines(ctx, 5, time.Minute)
}
