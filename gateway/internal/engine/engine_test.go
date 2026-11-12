package engine_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

const (
	machineID = "01a159a1-4a68-72de-9057-14e72d836a47"
	deviceID  = "01a1599e-7f90-7b47-976d-2b40a6cb24c1"
	tRunning  = "01a159ab-0000-7000-8000-000000000001"
	tFault    = "01a159ab-0000-7000-8000-000000000002"
	tCode     = "01a159ab-0000-7000-8000-000000000003"
	tFaultC   = "01a159ab-0000-7000-8000-000000000004"
	tTotal    = "01a159ab-0000-7000-8000-000000000005"
	tReject   = "01a159ab-0000-7000-8000-000000000006"
	tProduct  = "01a159ab-0000-7000-8000-000000000007"
	tHB       = "01a159ab-0000-7000-8000-000000000008"
	tTotal16  = "01a159ab-0000-7000-8000-000000000009"
	tSpeed    = "01a159ab-0000-7000-8000-00000000000a"
)

var t0 = time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)

func at(s float64) time.Time { return t0.Add(time.Duration(s * float64(time.Millisecond*1000))) }

// tags do bloco HR 0..19 (poll 500 ms).
var allTags = map[string]string{
	tRunning: `{"id":"%s","address":{"area":"holding_register","offset":0,"bit":0},"type":"bool","role":"state.running","machine_id":"%s"}`,
	tFault:   `{"id":"%s","address":{"area":"holding_register","offset":0,"bit":1},"type":"bool","role":"state.fault","machine_id":"%s"}`,
	tCode:    `{"id":"%s","address":{"area":"holding_register","offset":2},"type":"uint16","role":"state.code","machine_id":"%s"}`,
	tFaultC:  `{"id":"%s","address":{"area":"holding_register","offset":3},"type":"uint16","role":"fault.code","machine_id":"%s"}`,
	tTotal:   `{"id":"%s","address":{"area":"holding_register","offset":4},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"%s"}`,
	tReject:  `{"id":"%s","address":{"area":"holding_register","offset":6},"type":"uint32","word_order":"CDAB","role":"count.reject","machine_id":"%s"}`,
	tProduct: `{"id":"%s","address":{"area":"holding_register","offset":10},"type":"uint16","role":"product.code","machine_id":"%s"}`,
	tHB:      `{"id":"%s","address":{"area":"holding_register","offset":1},"type":"uint16","role":"plc.heartbeat","machine_id":"%s"}`,
	tTotal16: `{"id":"%s","address":{"area":"holding_register","offset":12},"type":"uint16","role":"count.total","machine_id":"%s"}`,
	tSpeed:   `{"id":"%s","address":{"area":"holding_register","offset":14},"type":"float32","word_order":"ABCD","role":"speed.actual","machine_id":"%s"}`,
}

func buildConfig(t *testing.T, stateRules string, tagIDs ...string) *config.GatewayConfig {
	t.Helper()
	parts := make([]string, len(tagIDs))
	for i, id := range tagIDs {
		parts[i] = fmt.Sprintf(allTags[id], id, machineID)
	}
	body := fmt.Sprintf(`{"config_version":1,"serial_buses":[],
		"devices":[{"id":"%s","protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":502,"unit_id":1},
			"blocks":[{"area":"holding_register","start":0,"count":20,"poll_ms":500}],"tags":[%s]}],
		"machines":[{"id":"%s","state_rules":%s}],
		"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, deviceID, strings.Join(parts, ","), machineID, stateRules)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func newEngine(t *testing.T, cfg *config.GatewayConfig, start time.Time) *engine.Engine {
	t.Helper()
	e, err := engine.New(cfg, start, engine.Options{IDs: ids.NewGenerator(nil)})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func boolV(b bool) modbus.Value { return modbus.BoolValue(b) }

func u16(v uint16) modbus.Value {
	x, _ := modbus.DecodeRegisters([]uint16{v}, modbus.Uint16, modbus.WordOrderNone, -1)
	return x
}

// f32 decodifica dois registradores ABCD como float32 (permite NaN e ±Inf do CLP).
func f32(hi, lo uint16) modbus.Value {
	x, _ := modbus.DecodeRegisters([]uint16{hi, lo}, modbus.Float32, modbus.ABCD, -1)
	return x
}

func u32(v uint32) modbus.Value {
	r, _ := modbus.Split32(v, modbus.CDAB)
	x, _ := modbus.DecodeRegisters(r[:], modbus.Uint32, modbus.CDAB, -1)
	return x
}

// sim roda o motor num relógio simulado: a cada passo, lê (se read != nil) e dá Tick.
type sim struct {
	e        *engine.Engine
	now      float64
	records  []engine.Record
	counters []engine.CounterState
}

func (s *sim) runUntil(until, step float64, read func(now float64) ([]engine.Sample, bool)) {
	for s.now+step <= until+1e-9 {
		s.now += step
		if read != nil {
			if samples, ok := read(s.now); ok {
				s.e.OnRead(at(s.now), samples)
			} else {
				s.e.OnFailure(deviceID, at(s.now))
			}
		}
		out := s.e.Tick(at(s.now))
		s.records = append(s.records, out.Records...)
		s.counters = append(s.counters, out.Counters...)
	}
}

func (s *sim) stateEvents() []contracts.StateEvent {
	var out []contracts.StateEvent
	for _, r := range s.records {
		if ev, ok := r.Payload.(contracts.StateEvent); ok {
			out = append(out, ev)
		}
	}
	return out
}

func (s *sim) minutes() []contracts.Minute {
	var out []contracts.Minute
	for _, r := range s.records {
		if m, ok := r.Payload.(contracts.Minute); ok {
			out = append(out, m)
		}
	}
	return out
}

func (s *sim) eventsOfType(typ string) []contracts.CounterEvent {
	var out []contracts.CounterEvent
	for _, r := range s.records {
		if ev, ok := r.Payload.(contracts.CounterEvent); ok && ev.Type == typ {
			out = append(out, ev)
		}
	}
	return out
}

type wantEv struct {
	at    string
	state string
	prev  string
	fault int64 // -1 = sem fault_code
}

func checkStates(t *testing.T, got []contracts.StateEvent, want []wantEv) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("eventos de estado: %d, quer %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		fc := int64(-1)
		if g.FaultCode != nil {
			fc = *g.FaultCode
		}
		if g.At != w.at || g.State != w.state || g.PreviousState != w.prev || fc != w.fault {
			t.Fatalf("evento %d = {%s %s prev=%s fault=%d}, quer {%s %s prev=%s fault=%d}",
				i, g.At, g.State, g.PreviousState, fc, w.at, w.state, w.prev, w.fault)
		}
	}
}

func checkMinute(t *testing.T, m contracts.Minute, run, stop, fault, setup, noComm int, total, reject int64) {
	t.Helper()
	if m.RunS != run || m.StopS != stop || m.FaultS != fault || m.SetupS != setup || m.NoCommS != noComm || m.Total != total || m.Reject != reject {
		t.Fatalf("minuto %s = run %d stop %d fault %d setup %d no_comm %d total %d reject %d; quer %d %d %d %d %d %d %d",
			m.T, m.RunS, m.StopS, m.FaultS, m.SetupS, m.NoCommS, m.Total, m.Reject, run, stop, fault, setup, noComm, total, reject)
	}
	if sum := m.RunS + m.StopS + m.FaultS + m.SetupS + m.NoCommS; sum != 60 {
		t.Fatalf("minuto %s soma %d", m.T, sum)
	}
}

// Modo signals: rodando → falha (com código) → parada; contagem por minuto.
func TestSignalsModeTimelineAndMinute(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tFault, tFaultC, tTotal, tReject, tProduct)
	s := &sim{e: newEngine(t, cfg, t0)}
	read := func(now float64) ([]engine.Sample, bool) {
		running := now < 45
		fault := now >= 30 && now < 45
		pieces := uint32(min(now, 30) / 2)
		return []engine.Sample{
			{TagID: tRunning, Value: boolV(running)},
			{TagID: tFault, Value: boolV(fault)},
			{TagID: tFaultC, Value: u16(map[bool]uint16{true: 47, false: 0}[fault])},
			{TagID: tTotal, Value: u32(1000 + pieces)},
			{TagID: tReject, Value: u32(3)},
			{TagID: tProduct, Value: u16(7)},
		}, true
	}
	s.runUntil(65, 0.5, read)

	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1},
		{"2026-11-11T13:00:30.000Z", "FAULT", "RUNNING", 47},
		{"2026-11-11T13:00:45.000Z", "STOPPED", "FAULT", -1},
	})
	mins := s.minutes()
	if len(mins) != 1 {
		t.Fatalf("minutos fechados: %d", len(mins))
	}
	// [0, 0.5) desconhecido = no_comm; 29.5 s rodando, 15 em falha, 15 parada.
	checkMinute(t, mins[0], 30, 15, 15, 0, 0, 15, 0)
	if mins[0].T != "2026-11-11T13:00:00Z" || mins[0].Product != "7" || mins[0].Good != nil {
		t.Fatalf("minuto: %+v", mins[0])
	}
	// Contadores persistidos junto com o minuto: valor no fim do minuto.
	var total *engine.CounterState
	for i := range s.counters {
		if s.counters[i].TagID == tTotal {
			total = &s.counters[i]
		}
	}
	if total == nil || total.LastRaw != 1015 || total.Bits != 32 {
		t.Fatalf("contador persistido: %+v", total)
	}

	live := s.e.Live(at(65))
	if len(live) != 1 || live[0].State != "STOPPED" || live[0].StateSince != "2026-11-11T13:00:45.000Z" || *live[0].CounterTotal != 1015 || live[0].Product != "7" {
		t.Fatalf("live: %+v", live)
	}
}

// Um pulso menor que o debounce não gera evento e o tempo fica no estado anterior.
func TestDebounceFiltersGlitch(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals","debounce_s":1}`, tRunning, tTotal)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 0.5, func(now float64) ([]engine.Sample, bool) {
		running := !(now >= 20 && now < 20.5) // 0,5 s parada
		return []engine.Sample{{TagID: tRunning, Value: boolV(running)}, {TagID: tTotal, Value: u32(0)}}, true
	})
	checkStates(t, s.stateEvents(), []wantEv{{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1}})
	mins := s.minutes()
	if len(mins) != 1 {
		t.Fatalf("minutos: %d", len(mins))
	}
	checkMinute(t, mins[0], 60, 0, 0, 0, 0, 0, 0) // 59,5 s rodando + 0,5 desconhecido → arredonda
}

// Modo state_code com mapa, estado padrão e SETUP.
func TestStateCodeMode(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"state_code","map":{"0":"STOPPED","1":"RUNNING","2":"FAULT","3":"SETUP"},"default_state":"STOPPED"}`, tCode, tFaultC, tTotal)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(70, 0.5, func(now float64) ([]engine.Sample, bool) {
		code := uint16(1)
		switch {
		case now >= 50:
			code = 9 // fora do mapa → default_state
		case now >= 40:
			code = 3
		case now >= 20:
			code = 2
		}
		return []engine.Sample{{TagID: tCode, Value: u16(code)}, {TagID: tFaultC, Value: u16(12)}, {TagID: tTotal, Value: u32(0)}}, true
	})
	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1},
		{"2026-11-11T13:00:20.000Z", "FAULT", "RUNNING", 12},
		{"2026-11-11T13:00:40.000Z", "SETUP", "FAULT", -1},
		{"2026-11-11T13:00:50.000Z", "STOPPED", "SETUP", -1},
	})
	checkMinute(t, s.minutes()[0], 20, 10, 20, 10, 0, 0, 0)
}

// Perda de comunicação: NO_COMM no instante da primeira falha; volta ao normal.
func TestNoCommOnReadFailures(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals","comm_loss_after_s":10}`, tRunning, tTotal)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(65, 0.5, func(now float64) ([]engine.Sample, bool) {
		if now > 20 && now < 40 {
			return nil, false // falha de leitura
		}
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tTotal, Value: u32(0)}}, true
	})
	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1},
		{"2026-11-11T13:00:20.500Z", "NO_COMM", "RUNNING", -1},
		{"2026-11-11T13:00:40.000Z", "RUNNING", "NO_COMM", -1},
	})
	// Rodando: [0.5, 20.5) + [40, 60) = 40 s; no_comm: 0.5 + 19.5 = 20 s.
	checkMinute(t, s.minutes()[0], 40, 0, 0, 0, 20, 0, 0)
}

// Lacuna de observação maior que comm_loss_after_s (relógio adiantado por NTP,
// processo congelado) em que a primeira leitura depois dela é processada antes do
// próximo Tick: o tempo não observado é no_comm (docs/03, docs/16), nunca do último
// estado confirmado.
func TestGapBeforeFirstReadIsNoComm(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals","comm_loss_after_s":10}`, tRunning)
	s := &sim{e: newEngine(t, cfg, t0)}
	running := func(now float64) ([]engine.Sample, bool) {
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}}, true
	}
	s.runUntil(60, 1, running)
	// Uma hora sem leitura nem Tick; no passo seguinte o sim lê antes do Tick.
	s.now = 3659
	s.runUntil(3720, 1, running)

	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1},
		{"2026-11-11T13:01:00.000Z", "NO_COMM", "RUNNING", -1},
		{"2026-11-11T14:01:00.000Z", "RUNNING", "NO_COMM", -1},
	})
	mins := s.minutes()
	if len(mins) != 62 {
		t.Fatalf("minutos fechados: %d, quer 62", len(mins))
	}
	checkMinute(t, mins[0], 59, 0, 0, 0, 1, 0, 0)
	for _, m := range mins[1:61] {
		checkMinute(t, m, 0, 0, 0, 0, 60, 0, 0)
	}
	checkMinute(t, mins[61], 60, 0, 0, 0, 0, 0, 0)
}

// Mesma lacuna, mas o primeiro resultado depois dela é uma falha de leitura: o
// tempo não observado continua no_comm desde a última leitura boa.
func TestGapBeforeFirstFailureIsNoComm(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals","comm_loss_after_s":10}`, tRunning)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(60, 1, func(now float64) ([]engine.Sample, bool) {
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}}, true
	})
	s.now = 3659
	s.runUntil(3720, 1, func(now float64) ([]engine.Sample, bool) { return nil, false })

	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1},
		{"2026-11-11T13:01:00.000Z", "NO_COMM", "RUNNING", -1},
	})
	for _, m := range s.minutes()[1:] {
		checkMinute(t, m, 0, 0, 0, 0, 60, 0, 0)
	}
}

// Sem nenhuma leitura desde o boot: NO_COMM desde o início.
func TestNoCommFromStart(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 1, nil)
	checkStates(t, s.stateEvents(), []wantEv{{"2026-11-11T13:00:00.000Z", "NO_COMM", "", -1}})
	checkMinute(t, s.minutes()[0], 0, 0, 0, 0, 60, 0, 0)
}

// CLP "congelado": o servidor Modbus responde, mas o heartbeat parou.
func TestHeartbeatFrozenGivesNoComm(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"state_code","map":{"1":"RUNNING"},"heartbeat_timeout_s":5}`, tCode, tHB, tTotal)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 0.5, func(now float64) ([]engine.Sample, bool) {
		hb := uint16(now)
		if now >= 20 && now < 40 {
			hb = 20 // congelado
		}
		return []engine.Sample{{TagID: tCode, Value: u16(1)}, {TagID: tHB, Value: u16(hb)}, {TagID: tTotal, Value: u32(0)}}, true
	})
	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1},
		{"2026-11-11T13:00:20.000Z", "NO_COMM", "RUNNING", -1},
		{"2026-11-11T13:00:40.000Z", "RUNNING", "NO_COMM", -1},
	})
	checkMinute(t, s.minutes()[0], 40, 0, 0, 0, 20, 0, 0)
}

// Modo count_derived: produzindo enquanto há peça a cada ≤ N × ciclo ideal.
func TestCountDerivedMode(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"count_derived","ideal_cycle_s":2,"idle_after_cycles":3}`, tTotal)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 0.5, func(now float64) ([]engine.Sample, bool) {
		pieces := uint32(0)
		if now >= 1 {
			pieces = uint32((min(now, 21)-1)/2) + 1 // peças em 1, 3, ..., 21
		}
		return []engine.Sample{{TagID: tTotal, Value: u32(pieces)}}, true
	})
	checkStates(t, s.stateEvents(), []wantEv{
		{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1},
		{"2026-11-11T13:00:27.000Z", "STOPPED", "RUNNING", -1}, // última peça em 21 + 3 × 2 s
	})
	checkMinute(t, s.minutes()[0], 26, 33, 0, 0, 1, 11, 0)
}

// Overflow de uint16, reset e salto absurdo dentro do motor.
func TestCounterEventsInEngine(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tTotal16, tReject)
	cfg.Machines[0].MaxRatePerS = ptr(5.0)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 1, func(now float64) ([]engine.Sample, bool) {
		total := uint16(65530 + uint16(now)) // passa de 65535 em t = 6 s
		reject := uint32(50213)
		switch {
		case now >= 40:
			reject = 3_000_000 + uint32(now) // salto absurdo em 40
		case now >= 30:
			reject = 3 + uint32(now-30) // operador zerou em 30
		}
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tTotal16, Value: u16(total)}, {TagID: tReject, Value: u32(reject)}}, true
	})
	m := s.minutes()[0]
	// total: primeira leitura em 1 s; deltas de 1 por segundo até 59 → 58 (com overflow no meio).
	// reject: 3 (reset em 30) + 9 (31..39) + 0 (salto descartado em 40) + 19 (41..59).
	if m.Total != 58 || m.Reject != 31 {
		t.Fatalf("total %d reject %d", m.Total, m.Reject)
	}
	resets := s.eventsOfType(contracts.EventCounterReset)
	if len(resets) != 1 || *resets[0].PreviousRaw != 50213 || resets[0].Raw != 3 || resets[0].TagID != tReject || resets[0].Role != "count.reject" {
		t.Fatalf("counter_reset: %+v", resets)
	}
	jumps := s.eventsOfType(contracts.EventCounterJump)
	if len(jumps) != 1 || *jumps[0].DiscardedDelta != 3_000_040-12 || jumps[0].At != "2026-11-11T13:00:40.000Z" {
		t.Fatalf("counter_jump: %+v", jumps)
	}
}

// CLP religado (contador de 16 bits não retentivo volta a ~0) enquanto o gateway
// ficou 90 s fora: com a taxa padrão (1000/s) a janela de plausibilidade cobre a
// faixa inteira de 16 bits e qualquer queda caberia como overflow. A queda é reset
// (counter_reset, delta = valor atual), não um overflow que inventaria 53541 peças.
func TestU16CounterDropAfterLongGapIsReset(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tTotal16)
	e := newEngine(t, cfg, t0)
	tag := cfg.Devices[0].Tags[1]
	e.RestoreCounters([]engine.CounterState{{
		TagID: tTotal16, MachineID: machineID, Role: "count.total", Bits: 16, AddrKey: tag.AddrKey(),
		LastRaw: 12000, LastAt: t0.Add(-90 * time.Second),
	}})
	s := &sim{e: e}
	s.runUntil(61, 1, func(now float64) ([]engine.Sample, bool) {
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tTotal16, Value: u16(5 + uint16(now/10))}}, true
	})
	// 5 (reset em 1 s) + 5 (de 5 para 10 até 59 s).
	if m := s.minutes()[0]; m.Total != 10 {
		t.Fatalf("peças no minuto = %d, quer 10", m.Total)
	}
	resets := s.eventsOfType(contracts.EventCounterReset)
	if len(resets) != 1 || resets[0].PreviousRaw == nil || *resets[0].PreviousRaw != 12000 || resets[0].Raw != 5 ||
		resets[0].At != "2026-11-11T13:00:01.000Z" || resets[0].TagID != tTotal16 {
		t.Fatalf("counter_reset: %+v", resets)
	}
}

// Conservação de peças através de um crash: o segundo motor parte do contador
// persistido no fechamento do último minuto e nenhuma peça é perdida ou duplicada.
func TestPieceConservationAcrossRestart(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tTotal)
	counter := func(now float64) uint32 { return 100 + uint32(now) } // CLP conta sempre, 1 peça/s
	read := func(now float64) ([]engine.Sample, bool) {
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tTotal, Value: u32(counter(now))}}, true
	}

	s1 := &sim{e: newEngine(t, cfg, t0)}
	s1.runUntil(90, 0.5, read) // "crash" em 13:01:30: o minuto 13:01 (aberto) se perde
	var persisted []engine.CounterState
	persisted = append(persisted, s1.counters...)

	s2 := &sim{e: newEngine(t, cfg, at(130)), now: 130} // volta em 13:02:10
	s2.e.RestoreCounters(persisted)
	s2.runUntil(240, 0.5, read)

	var sum int64
	seen := map[string]bool{}
	for _, m := range append(s1.minutes(), s2.minutes()...) {
		if seen[m.T] {
			t.Fatalf("minuto %s duplicado", m.T)
		}
		seen[m.T] = true
		sum += m.Total
	}
	last := s2.counters[len(s2.counters)-1]
	if want := int64(last.LastRaw) - 100; sum != want {
		t.Fatalf("peças nos minutos = %d, contador avançou %d", sum, want)
	}
	if len(s2.minutes()) != 2 || s2.minutes()[0].T != "2026-11-11T13:02:00Z" {
		t.Fatalf("minutos do segundo motor: %+v", s2.minutes())
	}
	// O minuto do retorno tem ~10 s não observados (no_comm) e recebe a produção do
	// intervalo sem gateway: 279 (última leitura do minuto) − 159 (persistido).
	if m := s2.minutes()[0]; m.NoCommS != 10 || m.RunS != 50 || m.Total != 279-159 {
		t.Fatalf("minuto do retorno: %+v", m)
	}
}

// Troca de produto gera evento e o minuto leva o produto vigente no fim.
func TestProductChange(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tProduct)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(61, 0.25, func(now float64) ([]engine.Sample, bool) {
		p := uint16(6)
		if now >= 27.25 {
			p = 7
		}
		return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tProduct, Value: u16(p)}}, true
	})
	var prods []contracts.ProductEvent
	for _, r := range s.records {
		if ev, ok := r.Payload.(contracts.ProductEvent); ok {
			prods = append(prods, ev)
		}
	}
	if len(prods) != 1 || prods[0].Product != "7" || prods[0].PreviousProduct != "6" || prods[0].At != "2026-11-11T13:00:27.250Z" {
		t.Fatalf("eventos de produto: %+v", prods)
	}
	if s.minutes()[0].Product != "7" {
		t.Fatalf("produto do minuto: %s", s.minutes()[0].Product)
	}
}

// Candidato pendente na virada do minuto: o minuto só fecha depois da decisão e
// recebe o tempo do estado novo desde o início do candidato.
func TestMinuteWaitsForPendingCandidate(t *testing.T) {
	cfg := buildConfig(t, `{"mode":"signals","debounce_s":10}`, tRunning)
	s := &sim{e: newEngine(t, cfg, t0)}
	read := func(now float64) ([]engine.Sample, bool) {
		return []engine.Sample{{TagID: tRunning, Value: boolV(now < 55)}}, true
	}
	s.runUntil(64, 1, read)
	if len(s.minutes()) != 0 {
		t.Fatal("o minuto não deveria fechar com candidato pendente desde 55 s")
	}
	s.runUntil(66, 1, read)
	if len(s.minutes()) != 1 {
		t.Fatal("o minuto deveria fechar depois da confirmação")
	}
	// Primeira leitura em 1 s; RUNNING confirmado em 11 s com início em 1 s.
	checkMinute(t, s.minutes()[0], 54, 5, 0, 0, 1, 0, 0)
}

// speed.actual float32 com NaN ou ±Inf (ou escala que estoura o float64) não pode
// chegar ao Live: json.Marshal falharia e nenhum /sync seria mais montado. A
// velocidade anterior também não fica: sem valor finito, o Live vai sem speed.
func TestNonFiniteSpeedIsDroppedFromLive(t *testing.T) {
	type step struct {
		v    modbus.Value
		want *float64
	}
	cases := []struct {
		name  string
		mul   float64
		steps []step
	}{
		{"sem escala", 1, []step{
			{f32(0x42C8, 0x0000), ptr(100.0)},
			{f32(0x7FC0, 0x0000), nil}, // NaN
			{f32(0x42C8, 0x0000), ptr(100.0)},
			{f32(0x7F80, 0x0000), nil}, // +Inf
			{f32(0xFF80, 0x0000), nil}, // -Inf
		}},
		{"escala que estoura", 1e300, []step{
			{f32(0x3F80, 0x0000), ptr(1e300)},
			{f32(0x7F7F, 0xFFFF), nil}, // máx. float32 × 1e300 = +Inf
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tSpeed)
			cfg.Devices[0].Tags[1].Scale = &config.Scale{Mul: ptr(c.mul)}
			e := newEngine(t, cfg, t0)
			for i := 1; i <= 3; i++ { // confirma RUNNING (o Live só tem máquina com estado)
				e.OnRead(at(float64(i)), []engine.Sample{{TagID: tRunning, Value: boolV(true)}})
				e.Tick(at(float64(i)))
			}
			for i, st := range c.steps {
				now := at(float64(4 + i))
				e.OnRead(now, []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tSpeed, Value: st.v}})
				e.Tick(now)
				live := e.Live(now)
				if len(live) != 1 {
					t.Fatalf("passo %d: live = %+v", i, live)
				}
				got := live[0].Speed
				if (got == nil) != (st.want == nil) || (got != nil && *got != *st.want) {
					t.Fatalf("passo %d: speed = %s, quer %s", i, fmtPtr(got), fmtPtr(st.want))
				}
				req := contracts.SyncRequest{Batch: contracts.Batch{SentAt: contracts.FormatTime(now)}, Live: live}
				if _, err := json.Marshal(req); err != nil {
					t.Fatalf("passo %d: /sync não serializa: %v", i, err)
				}
			}
		})
	}
}

func fmtPtr(p *float64) string {
	if p == nil {
		return "nil"
	}
	return fmt.Sprint(*p)
}

// Contrato: o que o motor produz, montado num /sync, valida no JSON Schema estrito.
func TestEngineOutputMatchesContract(t *testing.T) {
	schema := testutil.StrictSchema(t, "sync-request")
	cfg := buildConfig(t, `{"mode":"signals"}`, tRunning, tFault, tFaultC, tTotal, tReject, tProduct)
	s := &sim{e: newEngine(t, cfg, t0)}
	s.runUntil(185, 0.5, func(now float64) ([]engine.Sample, bool) {
		if now > 100 && now < 120 {
			return nil, false
		}
		fault := now >= 30 && now < 45
		total := uint32(now)
		if now > 150 {
			total = uint32(now) - 150 // reset
		}
		return []engine.Sample{
			{TagID: tRunning, Value: boolV(now < 60 || now > 125)},
			{TagID: tFault, Value: boolV(fault)},
			{TagID: tFaultC, Value: u16(47)},
			{TagID: tTotal, Value: u32(total)},
			{TagID: tReject, Value: u32(1)},
			{TagID: tProduct, Value: u16(uint16(now/90) + 1)},
		}, true
	})

	seqFrom, seq := int64(1), int64(0)
	req := contracts.SyncRequest{
		Agent: contracts.AgentHealth{Version: "0.1.0", ConfigVersion: 1},
		Live:  s.e.Live(at(185)),
	}
	for _, r := range s.records {
		seq++
		b, err := json.Marshal(r.Payload)
		if err != nil {
			t.Fatal(err)
		}
		if r.Kind == engine.KindMinute {
			req.Minutes = append(req.Minutes, contracts.WithSeq(b, seq))
		} else {
			req.Events = append(req.Events, contracts.WithSeq(b, seq))
		}
	}
	req.Batch = contracts.Batch{SeqFrom: &seqFrom, SeqTo: &seq, SentAt: contracts.FormatTime(at(185))}
	if len(req.Minutes) != 3 || len(req.Events) < 6 {
		t.Fatalf("cenário curto demais: %d minutos, %d eventos", len(req.Minutes), len(req.Events))
	}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if errs := testutil.ValidateJSON(t, schema, body); errs != "" {
		t.Fatalf("saída do motor não valida no contrato:\n%s\n%s", errs, body)
	}
}

func ptr[T any](v T) *T { return &v }
