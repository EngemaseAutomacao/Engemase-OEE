package app

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

// fakeClock é o relógio injetado no agente (parede e monotônico), seguro entre a
// rotina de coleta e o teste.
type fakeClock struct{ mono atomic.Int64 }

var fakeWall = time.Date(2026, 11, 12, 8, 0, 0, 0, time.UTC)

func (c *fakeClock) set(d time.Duration) { c.mono.Store(int64(d)) }

func (c *fakeClock) read() (time.Time, time.Duration) {
	d := time.Duration(c.mono.Load())
	return fakeWall.Add(d), d
}

// syncBuffer é um io.Writer seguro entre goroutines (pollers e coleta logam juntos).
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// watchdogAgent é um agente de teste com relógio injetado, log capturado e um buffer.
func watchdogAgent(t *testing.T) (*agent, *fakeClock, *syncBuffer, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "b.db")
	store, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	a := testAgent(store)
	logs := &syncBuffer{}
	a.log = slog.New(slog.NewTextHandler(logs, nil))
	clk := &fakeClock{}
	a.clock = clk.read
	return a, clk, logs, path
}

func checkAt(a *agent, d time.Duration) *healthFailure {
	return a.healthCheck(fakeWall.Add(d), d)
}

// Sem tick do motor dentro do limite, o watchdog não é alimentado e o log (warn) diz
// qual verificação falhou; o tick seguinte devolve a saúde.
func TestWatchdogSkipsPingWhenEngineTickStale(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	eng, err := engine.New(engineTestConfig(t), fakeWall, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	if f := checkAt(a, time.Hour); f != nil {
		t.Fatalf("sem coleta rodando não há o que conferir: %+v", f)
	}
	a.beatStart()
	a.tick(context.Background(), eng, nil)
	if f := checkAt(a, tickStaleMin-time.Millisecond); f != nil {
		t.Fatalf("tick dentro do limite: %+v", f)
	}
	clk.set(tickStaleMin + time.Second)
	if a.feedWatchdog() {
		t.Fatal("motor sem tick além do limite: o watchdog não deveria ser alimentado")
	}
	if out := logs.String(); !strings.Contains(out, "level=WARN") || !strings.Contains(out, "verificacao=motor") ||
		!strings.Contains(out, "ultimo_tick_ha_ms=6000") {
		t.Fatalf("log do watchdog não alimentado:\n%s", out)
	}
	a.tick(context.Background(), eng, nil)
	if !a.feedWatchdog() {
		t.Fatal("depois de um tick, o watchdog deveria ser alimentado")
	}
}

// Buffer que falha (disco cheio, erro de E/S) não para o watchdog: cada tentativa
// termina com erro e a próxima vem depois da espera crescente (até commitRetryMax,
// mais que flushStuckAfter), então o agente não reinicia em laço.
func TestWatchdogKeepsFeedingWhileBufferFails(t *testing.T) {
	a, clk, logs, path := watchdogAgent(t)
	setWriteFailure(t, path, true)
	eng, err := engine.New(engineTestConfig(t), fakeWall, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a.beatStart()
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(ids.NewGenerator(nil), fakeWall)}})
	for d := time.Duration(0); d < 10*time.Minute; d += time.Second {
		clk.set(d)
		a.tick(context.Background(), eng, nil)
		if f := checkAt(a, d+999*time.Millisecond); f != nil {
			t.Fatalf("aos %v, com o buffer falhando: %+v\n%s", d, f, logs.String())
		}
	}
	if a.retryWait != commitRetryMax || len(a.unsent.Items) == 0 {
		t.Fatalf("o buffer deveria estar falhando com a espera no teto: espera %v, %d itens pendentes", a.retryWait, len(a.unsent.Items))
	}
}

// Escritor travado (gravação que não volta: aqui, presa no writeMu que outra gravação
// segura) para o watchdog depois de flushStuckAfter. Antes disso é disco lento: nem a
// falta de tick conta como motor travado.
func TestWatchdogSkipsPingWhenWriterHangs(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	eng, err := engine.New(engineTestConfig(t), fakeWall, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a.beatStart()
	a.tick(context.Background(), eng, nil)

	// Uma perda pendente faz o flush travar o writeMu, preso por "outra gravação".
	gen := ids.NewGenerator(nil)
	a.lost = &unsentLoss{id: gen.New(fakeWall), at: fakeWall, items: 1, from: fakeWall, to: fakeWall}
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, fakeWall)}})
	a.writeMu.Lock()
	clk.set(time.Second)
	done := make(chan struct{})
	go func() {
		defer close(done)
		a.tick(context.Background(), eng, nil)
	}()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
		a.beats.mu.Lock()
		flushing := a.beats.flushing
		a.beats.mu.Unlock()
		if flushing {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("o tick não chegou à gravação")
		}
	}
	if f := checkAt(a, time.Second+flushStuckAfter-time.Second); f != nil {
		t.Fatalf("gravação lenta, dentro do limite, não é escritor travado: %+v", f)
	}
	clk.set(time.Second + flushStuckAfter + time.Second)
	if a.feedWatchdog() {
		t.Fatal("escritor travado além do limite: o watchdog não deveria ser alimentado")
	}
	if out := logs.String(); !strings.Contains(out, "level=WARN") || !strings.Contains(out, "verificacao=gravacao") ||
		!strings.Contains(out, "em_curso_ha_ms=31000") {
		t.Fatalf("log do watchdog não alimentado:\n%s", out)
	}
	a.writeMu.Unlock()
	<-done
	if !a.feedWatchdog() {
		t.Fatalf("a gravação voltou: o watchdog deveria ser alimentado\n%s", logs.String())
	}
}

// Ticks sem nenhuma tentativa de gravação além da prevista (caminho de gravação
// parado) também param o watchdog.
func TestWatchdogSkipsPingWhenFlushNeverAttempted(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	eng, err := engine.New(engineTestConfig(t), fakeWall, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a.beatStart()
	a.retryAt = time.Hour // defeito simulado: a próxima tentativa nunca chega
	for d := time.Second; d <= flushStuckAfter+2*time.Second; d += time.Second {
		clk.set(d)
		a.tick(context.Background(), eng, nil)
		f := checkAt(a, d)
		if d <= flushStuckAfter && f != nil {
			t.Fatalf("aos %v: %+v", d, f)
		}
		if d > flushStuckAfter && (f == nil || f.check != "gravacao") {
			t.Fatalf("aos %v, sem tentativa de gravação desde o início: %+v", d, f)
		}
	}
	if a.feedWatchdog() || !strings.Contains(logs.String(), "verificacao=gravacao") {
		t.Fatalf("watchdog alimentado com a gravação parada:\n%s", logs.String())
	}
}

// Config sem pollers montáveis (porta serial sem mapeamento neste hardware): a coleta
// espera outra config, sem motor. Não há o que conferir, e o agente não reinicia em
// laço (reiniciar não resolve).
func TestWatchdogIdleWhileConfigCannotBuildPollers(t *testing.T) {
	a, clk, _, _ := watchdogAgent(t)
	cfg, err := config.ParseRemote(testutil.ReadFixture(t, "gateway-config.valid.tcp-and-rtu-bus.json"))
	if err != nil {
		t.Fatal(err)
	}
	a.local = config.DefaultLocal()
	a.local.Hardware.Profile = "generic"
	a.reconfigure = make(chan *config.GatewayConfig, 1)
	a.setConfig(cfg, "applied", "")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, cfg) }()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		a.mu.Lock()
		st := a.cfgStatus.State
		a.mu.Unlock()
		if st == "rejected" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a config deveria ser recusada por não montar os pollers")
		}
	}
	clk.set(time.Hour)
	if f := checkAt(a, time.Hour); f != nil {
		t.Fatalf("sem motor à espera de outra config: %+v", f)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("collectWith: %v", err)
	}
}

// A coleta registra os pollers no watchdog e o logger neles: as mudanças de estado
// de conexão vão para o log do agente, e um laço de leitura fora do prazo para o
// watchdog, com o nome do poller. Na troca de config, os registros saem.
func TestCollectWiresPollersIntoWatchdogAndLog(t *testing.T) {
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	defer plc.Close()
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	plc.SetHolding(1000, 1, 1, 1, 0, cnt[0], cnt[1])
	cfg, err := config.ParseRemote(oeeConfig(plc.Addr(), 1))
	if err != nil {
		t.Fatal(err)
	}
	store, err := buffer.Open(filepath.Join(t.TempDir(), "b.db"), buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a := testAgent(store)
	logs := &syncBuffer{}
	a.log = slog.New(slog.NewTextHandler(logs, nil))
	a.local, a.opts.TickEvery = config.DefaultLocal(), 50*time.Millisecond
	a.reconfigure = make(chan *config.GatewayConfig, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, cfg) }()
	for deadline := time.Now().Add(5 * time.Second); !strings.Contains(logs.String(), "dispositivo conectado"); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("o log deveria ter o dispositivo conectado:\n%s", logs.String())
		}
	}
	if out := logs.String(); !strings.Contains(out, "dispositivo="+devID) || !strings.Contains(out, `nome="CLP de teste"`) ||
		!strings.Contains(out, "protocolo=modbus-tcp") {
		t.Fatalf("log de conexão sem identificar o dispositivo:\n%s", out)
	}
	a.beats.mu.Lock()
	ps := a.beats.pollers
	a.beats.mu.Unlock()
	if len(ps) != 1 {
		t.Fatalf("pollers registrados no watchdog: %d", len(ps))
	}
	now, mono := a.readClock()
	if f := a.healthCheck(now, mono); f != nil {
		t.Fatalf("coleta saudável: %+v", f)
	}
	// Um laço que não completa volta há mais que o prazo dele (aqui, visto do futuro,
	// com motor e gravação em dia) para o watchdog.
	f := a.healthCheck(now.Add(ps[0].LivenessBound()+time.Minute), mono)
	if f == nil || f.check != "leitor" || !strings.Contains(strings.Join(attrStrings(f.attrs), " "), ps[0].Name) {
		t.Fatalf("leitor fora do prazo: %+v", f)
	}

	a.reconfigure <- cfg // troca de config: a coleta para e volta (aqui, só para)
	if err := <-done; err != nil {
		t.Fatalf("collectWith: %v", err)
	}
	a.beats.mu.Lock()
	running, n := a.beats.running, len(a.beats.pollers)
	a.beats.mu.Unlock()
	if running || n != 0 {
		t.Fatalf("depois da troca: coleta %v, %d pollers no watchdog", running, n)
	}
}

func attrStrings(attrs []any) []string {
	out := make([]string, 0, len(attrs))
	for _, v := range attrs {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// beatsView é uma cópia dos batimentos do watchdog, lida sob beats.mu.
type beatsView struct {
	running, flushing        bool
	tick, flushAt, flushNext time.Duration
	pollers                  []*poller.Poller
}

func beatsOf(a *agent) beatsView {
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	return beatsView{running: b.running, flushing: b.flushing, tick: b.tick, flushAt: b.flushAt, flushNext: b.flushNext,
		pollers: b.pollers}
}

// waitBeats espera os batimentos satisfazerem cond (a coleta roda em outra rotina).
func waitBeats(t *testing.T, a *agent, cond func(beatsView) bool) beatsView {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
		if b := beatsOf(a); cond(b) {
			return b
		}
		if time.Now().After(deadline) {
			t.Fatalf("batimentos não chegaram ao esperado: %+v", beatsOf(a))
		}
	}
}

// Troca de config com o buffer falhando: a parada tenta gravar (e falha), o que
// agenda a próxima tentativa para depois da espera (até commitRetryMax). A coleta da
// config nova respeita essa espera: sem tentativa até lá não é caminho de gravação
// parado, e o watchdog segue alimentado (sem isso, ele parava de 30 s a 60 s depois
// da troca e o systemd reiniciava o agente, perdendo a saída pendente).
func TestWatchdogFedAcrossReconfigureWhileBufferFails(t *testing.T) {
	a, clk, logs, path := watchdogAgent(t)
	setWriteFailure(t, path, true)
	a.local, a.opts.TickEvery = config.DefaultLocal(), 5*time.Millisecond
	a.reconfigure = make(chan *config.GatewayConfig, 1)
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(ids.NewGenerator(nil), fakeWall)}})
	a.retryWait = commitRetryMax // o buffer já falha há tempo: espera no teto
	cfg := engineTestConfig(t)
	t0 := 3 * time.Minute
	clk.set(t0)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, cfg) }()
	waitBeats(t, a, func(b beatsView) bool { return b.flushNext >= t0+commitRetryMax }) // tentou e falhou
	a.reconfigure <- cfg
	if err := <-done; err != nil {
		t.Fatalf("collectWith: %v", err)
	}
	if a.retryAt != t0+commitRetryMax {
		t.Fatalf("a parada deveria ter tentado gravar e agendado a próxima tentativa: retryAt %v", a.retryAt)
	}

	go func() { done <- a.collectWith(ctx, cfg) }() // collect volta com a config nova
	waitBeats(t, a, func(b beatsView) bool { return b.running })
	for d := t0 + time.Second; d <= t0+commitRetryMax+flushStuckAfter; d += time.Second {
		clk.set(d)
		waitBeats(t, a, func(b beatsView) bool { return b.tick >= d && !b.flushing })
		if f := a.healthCheck(time.Now(), d); f != nil {
			t.Fatalf("%v depois da troca, com o buffer falhando: %+v\n%s", d-t0, f, logs.String())
		}
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("collectWith: %v", err)
	}
}

// Gravação lenta (abaixo de flushStuckAfter) e mais longa que o limite do motor: o
// resto do tick, depois dela, ainda não é motor travado. O limite do motor conta do
// fim da gravação até o tick terminar, e continua valendo para esse resto.
func TestWatchdogEngineCheckCountsFromFlushEnd(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	eng, err := engine.New(engineTestConfig(t), fakeWall, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	a.beatStart()
	a.tick(context.Background(), eng, nil)

	// Uma perda pendente faz o flush travar o writeMu: a gravação dura o quanto o teste quiser.
	gen := ids.NewGenerator(nil)
	a.lost = &unsentLoss{id: gen.New(fakeWall), at: fakeWall, items: 1, from: fakeWall, to: fakeWall}
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, fakeWall)}})
	a.writeMu.Lock()
	a.mu.Lock() // o resto do tick (live e saúde dos dispositivos) espera este lock
	clk.set(time.Second)
	done := make(chan struct{})
	go func() {
		defer close(done)
		a.tick(context.Background(), eng, nil)
	}()
	waitBeats(t, a, func(b beatsView) bool { return b.flushing })
	slow := flushStuckAfter - 9*time.Second // 21 s: gravação lenta, não travada
	clk.set(slow)
	a.writeMu.Unlock()
	waitBeats(t, a, func(b beatsView) bool { return !b.flushing })
	if f := checkAt(a, slow); f != nil {
		a.mu.Unlock()
		t.Fatalf("tick ainda em curso logo depois de uma gravação lenta não é motor travado: %+v", f)
	}
	stale := slow + a.tickStaleAfter() + time.Second
	if f := checkAt(a, stale); f == nil || f.check != "motor" {
		a.mu.Unlock()
		t.Fatalf("resto do tick preso além do limite, contado do fim da gravação: %+v", f)
	}
	a.mu.Unlock()
	<-done
	if f := checkAt(a, slow); f != nil {
		t.Fatalf("tick terminado: %+v\n%s", f, logs.String())
	}
}

// Na troca de config, os pollers param antes do último tick (que grava o que já
// fechou): durante essa gravação, lenta mas dentro do limite, os leitores parados não
// são conferidos (o laço deles acabou de propósito) e o watchdog não culpa um leitor
// pelo disco lento.
func TestWatchdogIgnoresStoppedPollersDuringFinalFlush(t *testing.T) {
	a, _, logs, path := watchdogAgent(t) // relógio do agente parado em 0
	// Toda tentativa falha: a perda pendente continua e cada gravação usa o writeMu.
	setWriteFailure(t, path, true)
	a.local, a.opts.TickEvery = config.DefaultLocal(), 5*time.Millisecond
	a.reconfigure = make(chan *config.GatewayConfig, 1)
	gen := ids.NewGenerator(nil)
	a.lost = &unsentLoss{id: gen.New(fakeWall), at: fakeWall, items: 1, from: fakeWall, to: fakeWall}
	a.addUnsent(buffer.Write{Items: []buffer.Item{stateItem(gen, fakeWall)}})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, engineTestConfig(t)) }()
	// A primeira tentativa falhou (a próxima só depois da espera) e o poller já rodou.
	b := waitBeats(t, a, func(b beatsView) bool {
		return b.flushNext >= commitRetryMin && len(b.pollers) == 1 && !b.pollers[0].Liveness().Beat.IsZero()
	})
	far := time.Now().Add(b.pollers[0].LivenessBound() + time.Hour) // prazo do leitor vencido

	a.writeMu.Lock() // a gravação da parada fica lenta
	a.reconfigure <- engineTestConfig(t)
	waitBeats(t, a, func(b beatsView) bool { return b.flushing })
	f := a.healthCheck(far, flushStuckAfter-time.Second)
	a.writeMu.Unlock()
	if f != nil {
		t.Fatalf("gravação final dentro do limite, com os pollers já parados: %+v\n%s", f, logs.String())
	}
	if err := <-done; err != nil {
		t.Fatalf("collectWith: %v", err)
	}
}
