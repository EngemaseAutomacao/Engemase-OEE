package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

const (
	cmdA = "01a1cab3-55e8-7cf0-a52e-692c5f1aac62"
	cmdB = "01a1cab3-55e8-7cf0-a52e-692c5f1aac63"
	cmdC = "01a1cab3-55e8-7cf0-a52e-692c5f1aac64"
)

// waitResults espera n resultados pendentes (os handlers rodam em goroutines).
func waitResults(t *testing.T, x *Executor, n int) []json.RawMessage {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		res := x.Results(50)
		if len(res) >= n {
			return res
		}
		if time.Now().After(deadline) {
			t.Fatalf("esperava %d resultados, veio %d: %s", n, len(res), res)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// byID indexa os resultados pelo id do comando, conferindo o contrato estrito.
func byID(t *testing.T, res []json.RawMessage) map[string]map[string]any {
	t.Helper()
	schema := testutil.StrictSchema(t, "command-result")
	out := map[string]map[string]any{}
	for _, r := range res {
		if errs := testutil.ValidateJSON(t, schema, r); errs != "" {
			t.Fatalf("resultado fora do contrato: %s\n%s", errs, r)
		}
		var m map[string]any
		if err := json.Unmarshal(r, &m); err != nil {
			t.Fatal(err)
		}
		out[m["id"].(string)] = m
	}
	return out
}

func errCode(m map[string]any) string {
	e, _ := m["error"].(map[string]any)
	if e == nil {
		return ""
	}
	return e["code"].(string)
}

func TestExecutorDedupExpiryAndConfirm(t *testing.T) {
	now := time.Date(2026, 11, 11, 13, 2, 5, 0, time.UTC)
	cmds := []contracts.Command{
		{ID: cmdA, Type: "tag.read", ExpiresAt: contracts.FormatTime(now.Add(time.Minute)), Payload: json.RawMessage(`{}`)},
		{ID: cmdB, Type: "fleet.rollout", ExpiresAt: contracts.FormatTime(now.Add(-time.Second)), Payload: json.RawMessage(`{}`)},
	}
	x := New(Options{Log: quiet})
	x.Handle(cmds, now)
	x.Handle(cmds, now.Add(time.Second)) // repetido pela nuvem: ignorado
	got := byID(t, x.Results(50))
	if len(got) != 2 {
		t.Fatalf("resultados: %v", got)
	}
	if got[cmdA]["status"] != "rejected" || errCode(got[cmdA]) != CodeUnsupported {
		t.Fatalf("sem handler: %v", got[cmdA])
	}
	if got[cmdB]["status"] != "expired" || errCode(got[cmdB]) != CodeExpired {
		t.Fatalf("vencido: %v", got[cmdB])
	}
	done := x.Confirm()
	if len(done) != 2 || len(x.Results(50)) != 0 {
		t.Fatalf("confirmados deveriam sair da fila: %v", done)
	}
	x.Handle(cmds, now.Add(2*time.Second))
	if len(x.Results(50)) != 0 {
		t.Fatal("comando já visto não gera resultado de novo")
	}
}

// Só os resultados enviados no último /sync saem no Confirm: o que ficou pronto
// depois do envio continua pendente.
func TestConfirmOnlyWhatWasSent(t *testing.T) {
	now := time.Now()
	x := New(Options{Log: quiet})
	x.Handle([]contracts.Command{{ID: cmdA, Type: "x.y", ExpiresAt: contracts.FormatTime(now.Add(time.Minute)), Payload: json.RawMessage(`{}`)}}, now)
	_ = x.Results(50)
	x.Handle([]contracts.Command{{ID: cmdB, Type: "x.y", ExpiresAt: contracts.FormatTime(now.Add(time.Minute)), Payload: json.RawMessage(`{}`)}}, now)
	done := x.Confirm()
	if len(done) != 1 || done[0].ID != cmdA || done[0].Type != "x.y" {
		t.Fatalf("confirmados: %v", done)
	}
	if res := x.Results(50); len(res) != 1 || !strings.Contains(string(res[0]), cmdB) {
		t.Fatalf("pendente: %s", res)
	}
}

func TestExecutorEnvelope(t *testing.T) {
	now := time.Now()
	exp := contracts.FormatTime(now.Add(time.Minute))
	x := New(Options{Log: quiet})
	x.Register("t.ok", time.Second, func(context.Context, contracts.Command) (any, error) { return nil, nil })
	x.Handle([]contracts.Command{
		{ID: "nao-e-uuid", Type: "t.ok", ExpiresAt: exp, Payload: json.RawMessage(`{}`)},   // sem id válido: ignorado
		{ID: cmdA, Type: "Agent Update", ExpiresAt: exp, Payload: json.RawMessage(`{}`)},   // tipo fora do padrão: ignorado
		{ID: cmdB, Type: "t.ok", ExpiresAt: exp, Payload: json.RawMessage(`[1]`)},          // payload não é objeto
		{ID: cmdC, Type: "t.ok", ExpiresAt: "amanhã", Payload: json.RawMessage(`{"a":1}`)}, // expires_at ilegível
	}, now)
	got := byID(t, x.Results(50))
	if len(got) != 2 || errCode(got[cmdB]) != CodeInvalidPayload || errCode(got[cmdC]) != CodeInvalidPayload {
		t.Fatalf("resultados: %v", got)
	}
	if got[cmdB]["status"] != "rejected" {
		t.Fatalf("payload inválido é recusa: %v", got[cmdB])
	}
}

func TestExecutorHandlers(t *testing.T) {
	now := time.Now()
	exp := contracts.FormatTime(now.Add(time.Minute))
	var kicks sync.WaitGroup
	kicks.Add(4)
	x := New(Options{Log: quiet, OnResult: kicks.Done})
	// Tipos do contrato (o resultado ok é tipado por type), com handlers de teste.
	x.Register(TypeConfigReload, time.Second, func(context.Context, contracts.Command) (any, error) {
		return ConfigReloadResult{Version: 3, Outcome: "applied"}, nil
	})
	x.Register(TypeTagRead, time.Second, func(context.Context, contracts.Command) (any, error) {
		return nil, &Error{Code: CodeModbusException, Message: "exceção 02", ModbusException: 2}
	})
	x.Register(TypeDeviceTest, 50*time.Millisecond, func(ctx context.Context, _ contracts.Command) (any, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	x.Register(TypeAgentRestart, time.Second, func(context.Context, contracts.Command) (any, error) { panic("ops") })
	ids := []string{cmdA, cmdB, cmdC, "01a1cab3-55e8-7cf0-a52e-692c5f1aac65"}
	var cmds []contracts.Command
	for i, typ := range []string{TypeConfigReload, TypeTagRead, TypeDeviceTest, TypeAgentRestart} {
		cmds = append(cmds, contracts.Command{ID: ids[i], Type: typ, ExpiresAt: exp, Payload: json.RawMessage(`{}`)})
	}
	x.Handle(cmds, now)
	got := byID(t, waitResults(t, x, 4))
	kicks.Wait()
	if got[ids[0]]["status"] != "ok" || got[ids[0]]["result"].(map[string]any)["outcome"] != "applied" {
		t.Fatalf("ok: %v", got[ids[0]])
	}
	if e := got[ids[1]]["error"].(map[string]any); got[ids[1]]["status"] != "error" || e["modbus_exception"] != float64(2) {
		t.Fatalf("falha: %v", got[ids[1]])
	}
	if got[ids[2]]["status"] != "error" || errCode(got[ids[2]]) != CodeTimeout {
		t.Fatalf("prazo: %v", got[ids[2]])
	}
	if errCode(got[ids[3]]) != CodeInternalError {
		t.Fatalf("pânico: %v", got[ids[3]])
	}
}

// Close cancela o que está rodando e não deixa resultado de comando interrompido.
func TestExecutorClose(t *testing.T) {
	x := New(Options{Log: quiet})
	started := make(chan struct{})
	x.Register("t.block", time.Minute, func(ctx context.Context, _ contracts.Command) (any, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	x.Handle([]contracts.Command{{ID: cmdA, Type: "t.block", ExpiresAt: contracts.FormatTime(time.Now().Add(time.Minute)), Payload: json.RawMessage(`{}`)}}, time.Now())
	<-started
	x.Close()
	if res := x.Results(50); len(res) != 0 {
		t.Fatalf("comando interrompido na parada não tem resultado: %s", res)
	}
}

func TestRestoreResendsWithoutRunning(t *testing.T) {
	x := New(Options{Log: quiet})
	ran := false
	x.Register(TypeAgentRestart, time.Second, func(context.Context, contracts.Command) (any, error) { ran = true; return nil, nil })
	at := time.Date(2026, 11, 11, 13, 2, 5, 0, time.UTC)
	x.Restore(cmdA, TypeAgentRestart, AgentRestartResult{RestartAt: contracts.FormatTime(at)}, at)
	x.Handle([]contracts.Command{{ID: cmdA, Type: TypeAgentRestart, ExpiresAt: contracts.FormatTime(time.Now().Add(time.Minute)), Payload: json.RawMessage(`{}`)}}, time.Now())
	got := byID(t, x.Results(50))
	if ran || got[cmdA]["status"] != "ok" {
		t.Fatalf("restaurado: ran=%v %v", ran, got)
	}
}

// Os payloads do contrato: as fixtures válidas passam e as inválidas apontam o
// caminho e a regra do manifest.
func TestPayloadFixtures(t *testing.T) {
	var resp contracts.SyncResponse
	if err := json.Unmarshal(testutil.ReadFixture(t, "sync-response.valid.all-command-types.json"), &resp); err != nil {
		t.Fatal(err)
	}
	parse := map[string]func(json.RawMessage) error{
		TypeTagRead:      func(r json.RawMessage) error { _, err := ParseTagRead(r); return err },
		TypeDeviceTest:   func(r json.RawMessage) error { _, err := ParseDeviceTest(r); return err },
		TypeAgentRestart: func(r json.RawMessage) error { _, err := ParseAgentRestart(r); return err },
	}
	seen := 0
	for _, c := range resp.Commands {
		if fn := parse[c.Type]; fn != nil {
			seen++
			if err := fn(c.Payload); err != nil {
				t.Errorf("%s válido recusado: %v", c.Type, err)
			}
		}
	}
	if seen < 4 {
		t.Fatalf("fixture com %d comandos do MVP", seen)
	}

	cases := []struct{ file, path, rule string }{
		{"sync-response.invalid.tag-read-without-word-order.json", "word_order", "address.word_order"},
		{"sync-response.invalid.device-test-bus-mismatch.json", "serial_bus", "device_test.bus"},
		{"sync-response.invalid.probe-126-registers.json", "probe.count", ""},
	}
	for _, tc := range cases {
		var r contracts.SyncResponse
		if err := json.Unmarshal(testutil.ReadFixture(t, tc.file), &r); err != nil {
			t.Fatal(err)
		}
		var failed error
		for _, c := range r.Commands {
			if fn := parse[c.Type]; fn != nil {
				if err := fn(c.Payload); err != nil {
					failed = err
				}
			}
		}
		var e *Error
		if !errors.As(failed, &e) || e.Code != CodeInvalidPayload {
			t.Fatalf("%s: esperava invalid_payload, veio %v", tc.file, failed)
		}
		found := false
		for _, is := range e.Details["issues"].([]map[string]any) {
			if is["path"] == tc.path && (tc.rule == "" || is["rule"] == tc.rule) {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s: esperava %s [%s] em %v", tc.file, tc.path, tc.rule, e.Details)
		}
	}
}

func TestAgentRestartPayloadLimits(t *testing.T) {
	for _, raw := range []string{`{"delay_s":301}`, `{"delay_s":-1}`, `{"delay_s":1.5}`, fmt.Sprintf(`{"reason":%q}`, strings.Repeat("á", 201))} {
		if _, err := ParseAgentRestart(json.RawMessage(raw)); err == nil {
			t.Errorf("%s deveria ser recusado", raw)
		}
	}
	if p, err := ParseAgentRestart(json.RawMessage(`{"reason":"suporte","delay_s":300,"novo":true}`)); err != nil || *p.DelayS != 300 {
		t.Fatalf("válido: %v %v", p, err)
	}
}
