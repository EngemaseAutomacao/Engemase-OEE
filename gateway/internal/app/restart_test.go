package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
)

// outboxSummary soma as peças dos minutos da outbox e conta os counter_reset.
func outboxSummary(t *testing.T, store *buffer.Store) (pieces int64, minutes, resets int) {
	t.Helper()
	for _, it := range outbox(t, store) {
		if it.Kind == buffer.KindMinute {
			var m contracts.Minute
			if err := json.Unmarshal(it.Payload, &m); err != nil {
				t.Fatal(err)
			}
			pieces += m.Total
			minutes++
		} else if payloadOf(t, it)["type"] == contracts.EventCounterReset {
			resets++
		}
	}
	return pieces, minutes, resets
}

// Reset do contador do CLP com o minuto ainda aberto e o agente reinicia (crash) antes
// de ele fechar. Junto com o counter_reset, o motor grava um checkpoint: a base depois
// do reset e, em Carry, as peças do minuto aberto contadas antes dele. O buffer guarda
// o Carry e o motor da partida seguinte o soma: nenhuma peça se perde (sem ele, as 10
// peças de 13:01:00 a 13:01:09 sumiam: 228 em vez de 238) e o reset não sai de novo.
func TestCounterResetInOpenMinuteSurvivesAgentRestart(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	const resetAt, crashAt, end = 70, 75, 241 // segundos desde 13:00:00
	// 1 peça/s; o CLP zera o contador em 13:01:10, com o minuto 13:01 aberto.
	raw := func(s int) uint32 {
		if s >= resetAt {
			return uint32(s - resetAt)
		}
		return 50000 + uint32(s)
	}
	running, _ := modbus.DecodeRegisters([]uint16{1}, modbus.Uint16, modbus.WordOrderNone, -1)
	// run entrega uma leitura por segundo, de from a to (exclusive), cada uma seguida
	// de um tick do agente (que grava no buffer o que o motor entrega).
	run := func(a *agent, eng *engine.Engine, from, to int) {
		t.Helper()
		readings := make(chan poller.Reading, 1)
		for s := from; s < to; s++ {
			at := t0.Add(time.Duration(s) * time.Second)
			r, _ := modbus.Split32(raw(s), modbus.CDAB)
			v, _ := modbus.DecodeRegisters(r[:], modbus.Uint32, modbus.CDAB, -1)
			readings <- poller.Reading{DeviceID: devID, At: at, Samples: []engine.Sample{{TagID: tState, Value: running}, {TagID: tTotal, Value: v}}}
			a.clock = func() (time.Time, time.Duration) { return at, time.Duration(s) * time.Second }
			a.tick(ctx, eng, nil, readings)
		}
		if len(a.unsent.Items) != 0 || len(a.unsent.Counters) != 0 {
			t.Fatalf("saída do motor sem gravar: %d itens", len(a.unsent.Items))
		}
	}
	// start abre o buffer e parte um agente e um motor dos contadores gravados nele.
	start := func(path string, s int) (*agent, *engine.Engine, *buffer.Store) {
		t.Helper()
		store, err := buffer.Open(path, buffer.Options{})
		if err != nil {
			t.Fatal(err)
		}
		a := testAgent(store)
		eng, err := engine.New(engineTestConfig(t), t0.Add(time.Duration(s)*time.Second), engine.Options{IDs: a.ids})
		if err != nil {
			t.Fatal(err)
		}
		if err := a.restoreCounters(ctx, eng); err != nil {
			t.Fatal(err)
		}
		return a, eng, store
	}

	// Referência: o mesmo turno sem reinício.
	a, eng, ref := start(filepath.Join(t.TempDir(), "ref.db"), 0)
	run(a, eng, 0, end)
	want, wantMinutes, resets := outboxSummary(t, ref)
	ref.Close()
	// 13:00 a 13:03 fechados: 69 peças até o reset, 0 nele (o CLP voltou a 0) e 169 depois.
	if want != 238 || wantMinutes != 4 || resets != 1 {
		t.Fatalf("referência: %d peças em %d minutos, %d counter_reset; quer 238, 4 e 1", want, wantMinutes, resets)
	}

	path := filepath.Join(t.TempDir(), "buffer.db")
	a, eng, store := start(path, 0)
	run(a, eng, 0, crashAt)
	counters, err := store.LoadCounters(ctx)
	if err != nil || len(counters) != 1 || counters[0].LastRaw != 0 || counters[0].Carry != 10 {
		t.Fatalf("checkpoint no buffer depois do reset: %+v (%v); quer base 0 e Carry 10", counters, err)
	}
	store.Close() // crash em 13:01:15: o minuto 13:01 ainda aberto se perde

	a, eng, store = start(path, crashAt)
	defer store.Close()
	run(a, eng, crashAt, end)
	got, minutes, resets := outboxSummary(t, store)
	if got != want || minutes != wantMinutes || resets != 1 {
		t.Fatalf("depois do reinício: %d peças em %d minutos, %d counter_reset; quer %d, %d e 1", got, minutes, resets, want, wantMinutes)
	}
}

// breakCounterState tira do lugar a coluna last_raw de counter_state (como uma leitura
// do buffer que falha): LoadCounters falha com counterReadErr; buffer.Open (que confere
// as colunas acrescentadas, não esta) e a gravação de itens na outbox seguem
// funcionando.
func breakCounterState(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`ALTER TABLE counter_state RENAME COLUMN last_raw TO last_raw_ilegivel`); err != nil {
		t.Fatal(err)
	}
}

// counterReadErr está no erro de LoadCounters depois de breakCounterState.
const counterReadErr = "no such column: last_raw"

// Troca de config com saída do motor ainda em memória (a parada da config anterior
// não gravou) e os contadores ilegíveis no buffer: o motor novo não parte. Antes de a
// coleta terminar com o erro (o agente para e o systemd o reinicia), a saída pendente
// tem uma última tentativa de gravação; o que não for gravado vai para o log.
func TestCollectWithoutCounterBaseFlushesUnsentAndStops(t *testing.T) {
	for _, writable := range []bool{true, false} {
		name := "buffer-grava"
		if !writable {
			name = "buffer-sem-gravar"
		}
		t.Run(name, func(t *testing.T) {
			a, clk, logs, path := watchdogAgent(t)
			breakCounterState(t, path)
			if !writable {
				setWriteFailure(t, path, true)
			}
			a.local, a.opts.TickEvery = config.DefaultLocal(), 5*time.Millisecond
			a.reconfigure = make(chan *config.GatewayConfig, 1)
			// A gravação da parada da config anterior falhou: a próxima só depois da espera.
			a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(ids.NewGenerator(nil), fakeWall)}})
			a.retryWait, a.retryAt = commitRetryMax, commitRetryMax
			clk.set(time.Second)

			done := make(chan error, 1)
			go func() { done <- a.collectWith(context.Background(), engineTestConfig(t)) }()
			var err error
			select {
			case err = <-done:
			case <-time.After(10 * time.Second):
				t.Fatal("a coleta deveria terminar sem a base dos contadores")
			}
			if err == nil || errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), counterReadErr) {
				t.Fatalf("collectWith: %v; quer o erro da leitura dos contadores", err)
			}

			n, out := len(outbox(t, a.store)), logs.String()
			lostLogged := strings.Contains(out, "saída do motor perdida") && strings.Contains(out, "itens_perdidos=1")
			if writable && (n != 1 || len(a.unsent.Items) != 0 || lostLogged) {
				t.Fatalf("buffer gravando: %d itens na outbox, %d em memória (quer 1 e 0), perda no log: %v\n%s",
					n, len(a.unsent.Items), lostLogged, out)
			}
			if !writable && (n != 0 || len(a.unsent.Items) != 1 || !lostLogged) {
				t.Fatalf("buffer sem gravar: %d itens na outbox, %d em memória (quer 0 e 1); a perda deveria ir para o log\n%s",
					n, len(a.unsent.Items), out)
			}
			// Os batimentos seguem ligados: o agente para (Run); se não parasse, o
			// watchdog deixaria de ser alimentado, sem motor.
			if f := checkAt(a, time.Second+a.tickStaleAfter()+time.Second); f == nil || f.check != "motor" {
				t.Fatalf("sem motor, o watchdog não pode seguir alimentado: %+v", f)
			}
		})
	}
}

// Contadores ilegíveis no buffer na partida: o agente não fica vivo sem coletar até o
// watchdog matá-lo. Run termina com o erro (o systemd reinicia o agente) e registra a
// parada como erro: agent_stop com reason error e clean_shutdown "0".
func TestRunStopsWithErrorWhenEngineCannotStart(t *testing.T) {
	dir := t.TempDir()
	local := config.DefaultLocal()
	local.Paths.StateDir = dir
	local.Paths.Buffer = filepath.Join(dir, "buffer.db")
	local.Paths.Credentials = filepath.Join(dir, "credentials.json") // sem credencial: offline
	store, err := buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveConfig(context.Background(), 1, []byte(engineTestConfigJSON)); err != nil {
		t.Fatal(err)
	}
	store.Close()
	breakCounterState(t, local.Paths.Buffer)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Local: local, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), TickEvery: 50 * time.Millisecond})
	}()
	select {
	case err = <-done:
	case <-time.After(10 * time.Second):
		cancel()
		<-done
		t.Fatal("Run deveria terminar sozinho com a coleta parada por erro")
	}
	if err == nil || !strings.Contains(err.Error(), counterReadErr) {
		t.Fatalf("Run: %v; quer o erro da coleta", err)
	}

	store, err = buffer.Open(local.Paths.Buffer, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if clean, _ := store.Meta(context.Background(), "clean_shutdown"); clean != "0" {
		t.Fatalf("clean_shutdown = %q depois de parar por erro", clean)
	}
	items := outbox(t, store)
	if len(items) == 0 {
		t.Fatal("outbox vazia")
	}
	stop := payloadOf(t, items[len(items)-1])
	if stop["type"] != contracts.EventAgentStop || stop["reason"] != "error" || !strings.Contains(stop["detail"].(string), counterReadErr) {
		t.Fatalf("último evento: %v; quer agent_stop com reason error e o erro no detail", stop)
	}
	validEvents(t, items)
}
