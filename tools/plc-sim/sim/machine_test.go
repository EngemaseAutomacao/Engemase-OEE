package sim

import (
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
)

func newTestMachine(t *testing.T, index int, seed int64, cfg Config) *Machine {
	t.Helper()
	m, err := NewMachine(index, seed, cfg)
	if err != nil {
		t.Fatalf("NewMachine: %v", err)
	}
	return m
}

func allScenarios() Config {
	cfg := DefaultConfig()
	cfg.Scenarios = Scenarios{CounterReset: true, Offline: true, Frozen: true}
	return cfg
}

func TestDeterministicRegardlessOfStepSize(t *testing.T) {
	cfg := allScenarios()
	const horizon = 2 * time.Hour

	a := newTestMachine(t, 1, 42, cfg)
	evA := a.AdvanceTo(horizon)

	b := newTestMachine(t, 1, 42, cfg)
	var evB []Event
	for now := time.Duration(0); now < horizon; {
		now += 137 * time.Millisecond
		if now > horizon {
			now = horizon
		}
		evB = append(evB, b.AdvanceTo(now)...)
	}

	if len(evA) == 0 {
		t.Fatal("nenhum evento em 2 h simuladas")
	}
	if !reflect.DeepEqual(evA, evB) {
		t.Fatalf("eventos diferentes conforme o passo: %d vs %d eventos", len(evA), len(evB))
	}
	if a.Block() != b.Block() {
		t.Fatalf("bloco diferente conforme o passo:\n%+v\n%+v", a.Block(), b.Block())
	}
	if a.Online() != b.Online() || a.Frozen() != b.Frozen() {
		t.Fatal("estado de comunicação diferente conforme o passo")
	}
}

func TestSeedChangesBehaviourAndMachinesDiffer(t *testing.T) {
	cfg := DefaultConfig()
	const horizon = time.Hour
	run := func(index int, seed int64) []Event {
		return newTestMachine(t, index, seed, cfg).AdvanceTo(horizon)
	}
	if !reflect.DeepEqual(run(0, 42), run(0, 42)) {
		t.Fatal("mesma semente deveria repetir os eventos")
	}
	if reflect.DeepEqual(run(0, 42), run(0, 43)) {
		t.Fatal("sementes diferentes deveriam mudar os eventos")
	}
	if reflect.DeepEqual(run(0, 42), run(1, 42)) {
		t.Fatal("máquinas diferentes deveriam ter linhas do tempo diferentes")
	}
}

func TestScenarioDoesNotChangeProductionTimeline(t *testing.T) {
	// Ligar offline/frozen não deve mudar ciclos e paradas (fluxos aleatórios separados).
	base := DefaultConfig()
	withComm := base
	withComm.Scenarios = Scenarios{Offline: true, Frozen: true}

	filter := func(evs []Event) []Event {
		var out []Event
		for _, e := range evs {
			if e.Kind == EventCycle || e.Kind == EventStateChange {
				out = append(out, e)
			}
		}
		return out
	}
	a := filter(newTestMachine(t, 0, 7, base).AdvanceTo(time.Hour))
	b := filter(newTestMachine(t, 0, 7, withComm).AdvanceTo(time.Hour))
	if !reflect.DeepEqual(a, b) {
		t.Fatal("os cenários de comunicação alteraram a linha do tempo de produção")
	}
}

func TestInitialBlock(t *testing.T) {
	m := newTestMachine(t, 2, 1, DefaultConfig())
	b := m.Block()
	if b.Version != block.Version {
		t.Fatalf("versao_bloco = %d, esperado %d", b.Version, block.Version)
	}
	if State(b.State) != StateProducing {
		t.Fatalf("estado inicial = %d, esperado produzindo", b.State)
	}
	if b.Total != 0 || b.Reject != 0 || b.Good != 0 {
		t.Fatalf("contadores iniciais = %d/%d/%d, esperado zero", b.Total, b.Reject, b.Good)
	}
	if b.Product != FirstProduct+2 {
		t.Fatalf("produto inicial da M3 = %d, esperado %d", b.Product, FirstProduct+2)
	}
	if b.Speed != 600 { // 3600 s / 6 s
		t.Fatalf("velocidade nominal = %d, esperado 600 peças/h", b.Speed)
	}
	if m.Coils() != [2]bool{true, false} {
		t.Fatalf("coils = %v, esperado [rodando, sem falha]", m.Coils())
	}
}

func TestCountersAdvanceAndHeartbeat(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MeanRunCycles = 1e9 // sem paradas
	m := newTestMachine(t, 0, 42, cfg)

	m.AdvanceTo(61 * time.Second)
	b := m.Block()
	if b.Heartbeat != 61 {
		t.Fatalf("heartbeat após 61 s = %d, esperado 61", b.Heartbeat)
	}
	// ~6 s por ciclo (jitter entre -5% e +15%): entre 8 e 10 peças em 61 s.
	if b.Total < 8 || b.Total > 10 {
		t.Fatalf("total após 61 s = %d, esperado entre 8 e 10", b.Total)
	}
	if b.Good+b.Reject != b.Total {
		t.Fatalf("bons (%d) + refugo (%d) != total (%d)", b.Good, b.Reject, b.Total)
	}
	if b.LastCycleMs < 5700 || b.LastCycleMs > 6900 {
		t.Fatalf("ciclo_ultimo_ms = %d, fora da faixa esperada", b.LastCycleMs)
	}
	prev := b.Total
	m.AdvanceTo(2 * time.Minute)
	if m.Block().Total <= prev {
		t.Fatal("o contador não avançou")
	}
}

func TestHeartbeatWraps(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Cycle = time.Hour // quase sem eventos de produção
	m := newTestMachine(t, 0, 1, cfg)
	m.AdvanceTo(65536 * time.Second)
	if hb := m.Block().Heartbeat; hb != 0 {
		t.Fatalf("heartbeat após 65536 s = %d, esperado 0 (volta)", hb)
	}
}

func TestLongRunStatistics(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Cycle = time.Second
	m := newTestMachine(t, 0, 2026, cfg)

	const horizon = 30 * time.Hour
	var producing time.Duration
	lastChange := time.Duration(0)
	state := StateProducing
	seen := map[State]bool{}
	var cycles, scraps int
	for _, e := range m.AdvanceTo(horizon) {
		switch e.Kind {
		case EventStateChange:
			if state == StateProducing {
				producing += e.At - lastChange
			}
			state, lastChange = e.To, e.At
			seen[e.To] = true
			if !e.To.Valid() {
				t.Fatalf("estado inválido %d", e.To)
			}
			if e.To == StateFault && e.FaultCode == 0 {
				t.Fatal("falha sem código")
			}
			if e.To != StateFault && e.FaultCode != 0 {
				t.Fatalf("código de falha %d fora do estado de falha", e.FaultCode)
			}
			if !block.KnownStatusBits(e.StatusBits) {
				t.Fatalf("bits_status com bit não documentado: %b", e.StatusBits)
			}
		case EventCycle:
			cycles++
			if e.Scrap {
				scraps++
			}
		}
	}
	if state == StateProducing {
		producing += horizon - lastChange
	}

	b := m.Block()
	if int(b.Total) != cycles || int(b.Reject) != scraps || int(b.Good) != cycles-scraps {
		t.Fatalf("contadores %d/%d/%d não batem com os ciclos %d/%d", b.Total, b.Reject, b.Good, cycles, scraps)
	}
	rate := float64(scraps) / float64(cycles)
	if rate < 0.017 || rate > 0.023 {
		t.Fatalf("taxa de refugo = %.4f, esperado ~0,02", rate)
	}
	availability := float64(producing) / float64(horizon)
	if availability < 0.6 || availability > 0.9 {
		t.Fatalf("fração produzindo = %.3f, esperado entre 0,6 e 0,9", availability)
	}
	for _, s := range []State{StateStopped, StateFault, StateSetup, StateManual, StateEmergency} {
		if !seen[s] {
			t.Errorf("estado %s nunca ocorreu em 30 h", s)
		}
	}
}

func TestStateDetails(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MeanRunCycles = 3
	m := newTestMachine(t, 0, 5, cfg)
	var sawProductChange, sawRearm bool
	product := m.Block().Product
	for i := 1; i <= 20000; i++ {
		evs := m.AdvanceTo(time.Duration(i) * 500 * time.Millisecond)
		b := m.Block()
		s := State(b.State)
		coils := m.Coils()
		if coils[block.CoilRunning] != (s == StateProducing) {
			t.Fatalf("coil rodando = %v com estado %s", coils[block.CoilRunning], s)
		}
		if coils[block.CoilFault] != (s == StateFault || s == StateEmergency) {
			t.Fatalf("coil falha = %v com estado %s", coils[block.CoilFault], s)
		}
		if s != StateProducing && b.Speed != 0 {
			t.Fatalf("velocidade %d com a máquina %s", b.Speed, s)
		}
		if b.Product != product {
			sawProductChange = true
			product = b.Product
		}
		for _, e := range evs {
			if e.Kind == EventStateChange && e.From == StateEmergency {
				if e.To != StateStopped {
					t.Fatalf("depois da emergência veio %s, esperado parada (rearme)", e.To)
				}
				sawRearm = true
			}
			if e.Kind == EventStateChange && e.Describe() == "" {
				t.Fatal("descrição vazia")
			}
		}
	}
	if !sawProductChange {
		t.Error("nenhuma troca de produto após setup")
	}
	if !sawRearm {
		t.Error("nenhum rearme após emergência")
	}
}

func TestOverflowScenario(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Scenarios.Overflow = true
	cfg.MeanRunCycles = 1e9
	cfg.ScrapRate = 0.5 // garante refugo cedo
	m := newTestMachine(t, 0, 3, cfg)

	b := m.Block()
	if b.Total != math.MaxUint32-cfg.OverflowMargin {
		t.Fatalf("total inicial = %d, esperado %d", b.Total, uint32(math.MaxUint32)-cfg.OverflowMargin)
	}
	if b.Reject != math.MaxUint32 {
		t.Fatalf("refugo inicial = %d, esperado 4294967295", b.Reject)
	}
	if b.Good+b.Reject != b.Total {
		t.Fatal("bons + refugo deveria ser igual ao total (mod 2^32)")
	}

	wrapped := map[Counter]bool{}
	for _, e := range m.AdvanceTo(10 * time.Minute) {
		if e.Kind == EventCounterWrap {
			wrapped[e.Counter] = true
		}
	}
	for _, c := range []Counter{CounterTotal, CounterReject, CounterGood} {
		if !wrapped[c] {
			t.Errorf("%s não deu a volta em 10 min", c)
		}
	}
	after := m.Block()
	if after.Total >= b.Total {
		t.Fatalf("total %d deveria ter dado a volta (antes %d)", after.Total, b.Total)
	}
	// Delta com tratamento de overflow (como o gateway faz): (max − anterior) + atual + 1.
	delta := uint64(math.MaxUint32-b.Total) + uint64(after.Total) + 1
	if delta != uint64(after.Total-b.Total) {
		t.Fatalf("delta com overflow = %d, aritmética uint32 = %d", delta, after.Total-b.Total)
	}
	if after.Good+after.Reject != after.Total {
		t.Fatal("bons + refugo deveria continuar igual ao total (mod 2^32)")
	}
}

func TestOverflowWithoutGoodCounter(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Scenarios.Overflow = true
	cfg.GoodCounter = false
	m := newTestMachine(t, 0, 3, cfg)
	m.AdvanceTo(30 * time.Minute)
	if g := m.Block().Good; g != 0 {
		t.Fatalf("contador_bons = %d com o contador desligado, esperado 0", g)
	}
}

func TestStartTotal(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StartTotal = 100000
	m := newTestMachine(t, 0, 1, cfg)
	if b := m.Block(); b.Total != 100000 || b.Good != 100000 || b.Reject != 0 {
		t.Fatalf("contadores iniciais = %d/%d/%d, esperado 100000/0/100000", b.Total, b.Reject, b.Good)
	}
}

func TestCounterResetScenario(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Scenarios.CounterReset = true
	cfg.ResetEvery = 5 * time.Minute
	cfg.MeanRunCycles = 1e9
	m := newTestMachine(t, 0, 9, cfg)

	var resets []Event
	for _, e := range m.AdvanceTo(time.Hour) {
		if e.Kind == EventCounterReset {
			resets = append(resets, e)
		}
	}
	// Intervalo uniforme em [2m30s, 7m30s): entre 8 e 24 resets em 1 h.
	if len(resets) < 8 || len(resets) > 24 {
		t.Fatalf("%d resets em 1 h, esperado entre 8 e 24", len(resets))
	}
	for _, r := range resets {
		if r.Total == 0 {
			t.Fatalf("reset em %s com total já zerado (o evento guarda os valores de antes)", r.At)
		}
	}
	// Logo depois de um reset, o contador é pequeno.
	m2 := newTestMachine(t, 0, 9, cfg)
	m2.AdvanceTo(resets[0].At)
	if b := m2.Block(); b.Total != 0 || b.Reject != 0 || b.Good != 0 {
		t.Fatalf("contadores logo após o reset = %d/%d/%d, esperado zero", b.Total, b.Reject, b.Good)
	}
}

func TestOfflineScenario(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Scenarios.Offline = true
	cfg.OfflineEvery = time.Minute
	cfg.OfflineFor = 10 * time.Second
	m := newTestMachine(t, 0, 4, cfg)
	if !m.Online() {
		t.Fatal("a máquina deveria começar online")
	}
	var offline, online int
	var offlineTime time.Duration
	var since time.Duration
	for _, e := range m.AdvanceTo(time.Hour) {
		switch e.Kind {
		case EventOffline:
			offline++
			since = e.At
		case EventOnline:
			online++
			offlineTime += e.At - since
		}
	}
	if offline < 30 || offline > 90 {
		t.Fatalf("%d quedas em 1 h, esperado ~51", offline)
	}
	if online != offline && online != offline-1 {
		t.Fatalf("quedas (%d) e retornos (%d) não alternam", offline, online)
	}
	if avg := offlineTime / time.Duration(online); avg < 7*time.Second || avg > 13*time.Second {
		t.Fatalf("duração média offline = %s, esperado ~10 s", avg)
	}
	// A produção continua enquanto offline (só a rede caiu).
	if m.Block().Total == 0 {
		t.Fatal("a máquina deveria ter produzido")
	}
}

func TestFrozenScenario(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Scenarios.Frozen = true
	cfg.FreezeEvery = time.Minute
	cfg.FreezeFor = 20 * time.Second
	m := newTestMachine(t, 0, 11, cfg)

	var freeze Event
	for step := time.Second; step < time.Hour; step += time.Second {
		for _, e := range m.AdvanceTo(step) {
			if e.Kind == EventFreeze && freeze.Duration == 0 {
				freeze = e
			}
		}
		if freeze.Duration != 0 {
			break
		}
	}
	if freeze.Duration == 0 {
		t.Fatal("nenhum congelamento em 1 h")
	}
	frozen := m.Block()
	m.AdvanceTo(freeze.At + freeze.Duration - time.Millisecond)
	if !m.Frozen() {
		t.Fatal("deveria continuar congelado")
	}
	if m.Block() != frozen {
		t.Fatal("o bloco mudou durante o congelamento")
	}
	m.AdvanceTo(freeze.At + freeze.Duration)
	if m.Frozen() {
		t.Fatal("deveria ter descongelado")
	}
	if m.Block().Heartbeat == frozen.Heartbeat {
		t.Fatal("o heartbeat deveria ter saltado após descongelar")
	}
}

func TestParseScenarios(t *testing.T) {
	sc, err := ParseScenarios("counter-reset, OFFLINE,normal")
	if err != nil {
		t.Fatal(err)
	}
	if !sc.CounterReset || !sc.Offline || sc.Overflow || sc.Frozen {
		t.Fatalf("cenários = %+v", sc)
	}
	if sc.String() != "counter-reset,offline" {
		t.Fatalf("String() = %q", sc.String())
	}
	if s, _ := ParseScenarios("normal"); s.String() != "normal" {
		t.Fatalf("normal.String() = %q", s.String())
	}
	if _, err := ParseScenarios("explode"); err == nil {
		t.Fatal("esperava erro para cenário desconhecido")
	}
}

func TestConfigValidate(t *testing.T) {
	bad := []func(*Config){
		func(c *Config) { c.Cycle = time.Millisecond },
		func(c *Config) { c.ScrapRate = 1.5 },
		func(c *Config) { c.MeanRunCycles = 0 },
		func(c *Config) { c.Scenarios.CounterReset = true; c.ResetEvery = 0 },
		func(c *Config) { c.Scenarios.Overflow = true; c.OverflowMargin = 0 },
		func(c *Config) { c.Scenarios.Overflow = true; c.StartTotal = 10 },
		func(c *Config) { c.Scenarios.Offline = true; c.OfflineFor = 0 },
		func(c *Config) { c.Scenarios.Frozen = true; c.FreezeEvery = 0 },
	}
	for i, mutate := range bad {
		cfg := DefaultConfig()
		mutate(&cfg)
		if err := cfg.Validate(); err == nil {
			t.Errorf("caso %d: esperava erro de validação", i)
		}
	}
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatalf("config padrão inválida: %v", err)
	}
}

func TestEventDescriptions(t *testing.T) {
	evs := []Event{
		{Kind: EventStateChange, From: StateProducing, To: StateFault, FaultCode: 205, Duration: 45 * time.Second},
		{Kind: EventStateChange, From: StateProducing, To: StateStopped, StatusBits: block.StatusNoMaterial, Duration: 30 * time.Second},
		{Kind: EventCycle, CycleMs: 6012, Total: 1, Good: 1},
		{Kind: EventCounterWrap, Counter: CounterTotal},
		{Kind: EventCounterReset, Total: 10},
		{Kind: EventOffline, Duration: 15 * time.Second},
		{Kind: EventOnline},
		{Kind: EventFreeze, Duration: 15 * time.Second},
		{Kind: EventUnfreeze},
	}
	for _, e := range evs {
		if d := e.Describe(); d == "" || d == e.Kind.String() {
			t.Errorf("descrição pobre para %s: %q", e.Kind, d)
		}
	}
	if got := evs[0].Describe(); got != "produzindo → FALHA 205 (pressão de ar baixa) por ~45s" {
		t.Errorf("descrição da falha = %q", got)
	}
}
