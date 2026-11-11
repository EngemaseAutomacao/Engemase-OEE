package sim

import (
	"math"
	"math/rand/v2"
	"time"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
)

// never representa "evento não agendado".
const never = time.Duration(math.MaxInt64)

// HeartbeatPeriod é o período de incremento do heartbeat (docs/11: a cada 1 s).
const HeartbeatPeriod = time.Second

// FirstProduct é o código de produto inicial; as máquinas alternam entre
// FirstProduct, FirstProduct+1 e FirstProduct+2 a cada setup.
const FirstProduct uint16 = 1001

const productCount = 3

// Duração (em ciclos nominais) de cada estado sem produção: [mín, máx).
type cycleRange struct{ min, max float64 }

var stateDurations = map[State]cycleRange{
	StateStopped:   {2, 8},
	StateFault:     {3, 15},
	StateSetup:     {10, 30},
	StateManual:    {3, 10},
	StateEmergency: {2, 5},
}

// Rearme depois de uma emergência (máquina fica parada antes de produzir).
var rearmDuration = cycleRange{1, 3}

// Falhas com duração >= este número de ciclos ligam o bit "manutenção".
const maintenanceAfterCycles = 10

// Pesos do sorteio do tipo de interrupção da produção.
var stopWeights = []struct {
	state  State
	weight int
}{
	{StateStopped, 45},
	{StateFault, 35},
	{StateSetup, 10},
	{StateManual, 5},
	{StateEmergency, 5},
}

// Probabilidade de uma parada simples ser por falta de material.
const noMaterialProbability = 0.4

// Desvio-padrão relativo do tempo de ciclo e limites do sorteio.
const (
	cycleJitterSigma = 0.02
	cycleJitterMin   = -0.05
	cycleJitterMax   = 0.15
)

// Fluxos de números aleatórios independentes, para que ligar um cenário não
// altere a linha do tempo da produção nem a dos outros cenários.
const (
	streamProduction uint64 = iota + 1
	streamReset
	streamOffline
	streamFreeze
)

// Tipos internos de evento agendado. A ordem define o desempate quando dois
// eventos caem no mesmo instante.
type pending int

const (
	pendingReset pending = iota
	pendingOffline
	pendingFreeze
	pendingStateEnd
	pendingCycleEnd
	pendingHeartbeat
	pendingNone
)

// Machine é uma máquina simulada. Não é segura para uso concorrente: quem a
// compartilha entre goroutines deve protegê-la com um mutex.
type Machine struct {
	index int
	cfg   Config

	prod, resetRng, offlineRng, freezeRng *rand.Rand

	now time.Duration

	state      State
	stateEnd   time.Duration
	cycleStart time.Duration
	nextCycle  time.Duration
	faultCode  uint16
	statusBits uint16
	product    uint16

	total, reject, good uint32
	lastCycleMs         uint16

	heartbeat     uint16
	nextHeartbeat time.Duration

	online      bool
	nextOffline time.Duration // próxima troca online/offline

	frozen      bool
	frozenBlock block.Block
	nextFreeze  time.Duration // próxima troca congelado/normal

	nextReset time.Duration

	events []Event
}

// NewMachine cria a máquina de índice index (0 = M1). A mesma semente, índice e
// configuração produzem sempre a mesma sequência de acontecimentos.
func NewMachine(index int, seed int64, cfg Config) (*Machine, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	m := &Machine{
		index:         index,
		cfg:           cfg,
		prod:          newRand(seed, index, streamProduction),
		resetRng:      newRand(seed, index, streamReset),
		offlineRng:    newRand(seed, index, streamOffline),
		freezeRng:     newRand(seed, index, streamFreeze),
		product:       FirstProduct + uint16(index%productCount),
		nextHeartbeat: HeartbeatPeriod,
		online:        true,
		nextOffline:   never,
		nextFreeze:    never,
		nextReset:     never,
	}

	switch {
	case cfg.Scenarios.Overflow:
		// Todos os contadores perto do máximo, mantendo bons + refugo = total (mod 2^32).
		m.total = math.MaxUint32 - cfg.OverflowMargin
		m.reject = math.MaxUint32
		if cfg.GoodCounter {
			m.good = m.total - m.reject
		}
	default:
		m.total = cfg.StartTotal
		if cfg.GoodCounter {
			m.good = cfg.StartTotal
		}
	}

	if cfg.Scenarios.CounterReset {
		m.nextReset = jittered(m.resetRng, cfg.ResetEvery)
	}
	if cfg.Scenarios.Offline {
		m.nextOffline = jittered(m.offlineRng, cfg.OfflineEvery)
	}
	if cfg.Scenarios.Frozen {
		m.nextFreeze = jittered(m.freezeRng, cfg.FreezeEvery)
	}

	m.state = StateProducing
	m.statusBits = block.StatusAutomatic
	m.stateEnd = never
	m.startCycle()
	return m, nil
}

// Index devolve o índice da máquina (0 = M1).
func (m *Machine) Index() int { return m.index }

// Now devolve o instante simulado atual.
func (m *Machine) Now() time.Duration { return m.now }

// State devolve o estado real da máquina (mesmo se o bloco estiver congelado).
func (m *Machine) State() State { return m.state }

// Online indica se a máquina responde no Modbus.
func (m *Machine) Online() bool { return m.online }

// Frozen indica se o bloco está congelado (cenário frozen).
func (m *Machine) Frozen() bool { return m.frozen }

// AdvanceTo avança o relógio simulado até t e devolve os eventos ocorridos, em
// ordem. Um t menor ou igual ao instante atual não faz nada.
func (m *Machine) AdvanceTo(t time.Duration) []Event {
	m.events = nil
	if t <= m.now {
		return nil
	}
	for {
		kind, at := m.nextPending()
		if kind == pendingNone || at > t {
			break
		}
		m.now = at
		m.handle(kind)
	}
	m.now = t
	evs := m.events
	m.events = nil
	return evs
}

// Block devolve o bloco OEE como o CLP o expõe (congelado, se for o caso).
func (m *Machine) Block() block.Block {
	if m.frozen {
		return m.frozenBlock
	}
	return m.liveBlock()
}

// Coils devolve as coils 0 (rodando) e 1 (falha) como o CLP as expõe.
// Emergência também liga a coil de falha.
func (m *Machine) Coils() [block.CoilCount]bool {
	s := State(m.Block().State)
	return [block.CoilCount]bool{
		block.CoilRunning: s == StateProducing,
		block.CoilFault:   s == StateFault || s == StateEmergency,
	}
}

func (m *Machine) liveBlock() block.Block {
	return block.Block{
		Version:     block.Version,
		Heartbeat:   m.heartbeat,
		State:       uint16(m.state),
		FaultCode:   m.faultCode,
		Total:       m.total,
		Reject:      m.reject,
		Good:        m.good,
		Product:     m.product,
		Speed:       m.speed(),
		LastCycleMs: m.lastCycleMs,
		StatusBits:  m.statusBits,
	}
}

// speed devolve a velocidade em peças por hora (0 fora de produção).
func (m *Machine) speed() uint16 {
	if m.state != StateProducing {
		return 0
	}
	ms := float64(m.lastCycleMs)
	if ms == 0 {
		ms = float64(m.cfg.Cycle.Milliseconds())
	}
	if ms <= 0 {
		return 0
	}
	return clampUint16(math.Round(3_600_000 / ms))
}

func (m *Machine) nextPending() (pending, time.Duration) {
	// Os candidatos são considerados na ordem dos tipos e só um instante
	// estritamente menor troca o escolhido: no empate, vence o menor tipo.
	best, at := pendingNone, never
	consider := func(k pending, t time.Duration) {
		if t < at {
			best, at = k, t
		}
	}
	consider(pendingReset, m.nextReset)
	consider(pendingOffline, m.nextOffline)
	consider(pendingFreeze, m.nextFreeze)
	if m.state == StateProducing {
		consider(pendingCycleEnd, m.nextCycle)
	} else {
		consider(pendingStateEnd, m.stateEnd)
	}
	consider(pendingHeartbeat, m.nextHeartbeat)
	return best, at
}

func (m *Machine) handle(k pending) {
	switch k {
	case pendingReset:
		m.emit(Event{Kind: EventCounterReset})
		m.total, m.reject, m.good = 0, 0, 0
		m.nextReset = m.now + jittered(m.resetRng, m.cfg.ResetEvery)
	case pendingOffline:
		if m.online {
			d := jittered(m.offlineRng, m.cfg.OfflineFor)
			m.online = false
			m.nextOffline = m.now + d
			m.emit(Event{Kind: EventOffline, Duration: d})
		} else {
			m.online = true
			m.nextOffline = m.now + jittered(m.offlineRng, m.cfg.OfflineEvery)
			m.emit(Event{Kind: EventOnline})
		}
	case pendingFreeze:
		if m.frozen {
			m.frozen = false
			m.nextFreeze = m.now + jittered(m.freezeRng, m.cfg.FreezeEvery)
			m.emit(Event{Kind: EventUnfreeze})
		} else {
			d := jittered(m.freezeRng, m.cfg.FreezeFor)
			m.frozenBlock = m.liveBlock()
			m.frozen = true
			m.nextFreeze = m.now + d
			m.emit(Event{Kind: EventFreeze, Duration: d})
		}
	case pendingStateEnd:
		m.endState()
	case pendingCycleEnd:
		m.completeCycle()
	case pendingHeartbeat:
		m.heartbeat++ // dá a volta em 65535 → 0, como num CLP
		m.nextHeartbeat += HeartbeatPeriod
	}
}

func (m *Machine) emit(e Event) {
	e.At = m.now
	e.Machine = m.index
	e.Total, e.Reject, e.Good = m.total, m.reject, m.good
	m.events = append(m.events, e)
}

func (m *Machine) startCycle() {
	factor := 1 + clampFloat(m.prod.NormFloat64()*cycleJitterSigma, cycleJitterMin, cycleJitterMax)
	d := time.Duration(float64(m.cfg.Cycle) * factor).Round(time.Millisecond)
	if d < time.Millisecond {
		d = time.Millisecond
	}
	m.cycleStart = m.now
	m.nextCycle = m.now + d
}

func (m *Machine) completeCycle() {
	m.lastCycleMs = clampUint16(float64((m.now - m.cycleStart).Milliseconds()))
	scrap := m.prod.Float64() < m.cfg.ScrapRate

	m.total++
	if m.total == 0 {
		m.emit(Event{Kind: EventCounterWrap, Counter: CounterTotal})
	}
	if scrap {
		m.reject++
		if m.reject == 0 {
			m.emit(Event{Kind: EventCounterWrap, Counter: CounterReject})
		}
	} else if m.cfg.GoodCounter {
		m.good++
		if m.good == 0 {
			m.emit(Event{Kind: EventCounterWrap, Counter: CounterGood})
		}
	}
	m.emit(Event{Kind: EventCycle, CycleMs: m.lastCycleMs, Scrap: scrap})

	if m.prod.Float64() < 1/m.cfg.MeanRunCycles {
		m.interruptProduction()
		return
	}
	m.startCycle()
}

// interruptProduction sorteia o tipo e a duração da interrupção.
func (m *Machine) interruptProduction() {
	total := 0
	for _, w := range stopWeights {
		total += w.weight
	}
	pick := m.prod.IntN(total)
	next := StateStopped
	for _, w := range stopWeights {
		if pick < w.weight {
			next = w.state
			break
		}
		pick -= w.weight
	}

	r := stateDurations[next]
	cycles := r.min + m.prod.Float64()*(r.max-r.min)
	d := m.cycles(cycles)

	var fault uint16
	bits := uint16(0)
	switch next {
	case StateStopped:
		bits = block.StatusAutomatic
		if m.prod.Float64() < noMaterialProbability {
			bits |= block.StatusNoMaterial
		}
	case StateFault:
		f := Faults[m.prod.IntN(len(Faults))]
		fault = f.Code
		bits = block.StatusAutomatic
		if f.DoorOpen {
			bits |= block.StatusDoorOpen
		}
		if cycles >= maintenanceAfterCycles {
			bits |= block.StatusMaintenance
		}
	case StateSetup:
		bits = block.StatusDoorOpen
	case StateManual, StateEmergency:
		bits = 0
	}
	m.setState(next, d, fault, bits)
}

func (m *Machine) endState() {
	switch m.state {
	case StateEmergency:
		cycles := rearmDuration.min + m.prod.Float64()*(rearmDuration.max-rearmDuration.min)
		m.setState(StateStopped, m.cycles(cycles), 0, block.StatusAutomatic)
		return
	case StateSetup:
		m.product = FirstProduct + (m.product-FirstProduct+1)%productCount
	}
	m.setState(StateProducing, 0, 0, block.StatusAutomatic)
	m.startCycle()
}

func (m *Machine) setState(s State, d time.Duration, fault, bits uint16) {
	from := m.state
	m.state = s
	m.faultCode = fault
	m.statusBits = bits
	if s == StateProducing {
		m.stateEnd = never
	} else {
		m.stateEnd = m.now + d
	}
	m.emit(Event{Kind: EventStateChange, From: from, To: s, FaultCode: fault, StatusBits: bits, Product: m.product, Duration: d})
}

// cycles converte um número de ciclos nominais em duração (mínimo 1 ms).
func (m *Machine) cycles(n float64) time.Duration {
	d := time.Duration(n * float64(m.cfg.Cycle)).Round(time.Millisecond)
	if d < time.Millisecond {
		d = time.Millisecond
	}
	return d
}

// jittered sorteia uma duração uniforme em [0,5; 1,5) × mean (mínimo 1 ms).
func jittered(r *rand.Rand, mean time.Duration) time.Duration {
	d := time.Duration(float64(mean) * (0.5 + r.Float64())).Round(time.Millisecond)
	if d < time.Millisecond {
		d = time.Millisecond
	}
	return d
}

func clampFloat(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

func clampUint16(v float64) uint16 {
	if v <= 0 {
		return 0
	}
	if v >= math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(v)
}

// newRand cria um gerador PCG cuja semente mistura (seed, máquina, fluxo) com
// splitmix64, para que sementes vizinhas não gerem sequências parecidas.
func newRand(seed int64, index int, stream uint64) *rand.Rand {
	a := splitmix64(uint64(seed) ^ splitmix64(uint64(index)+1))
	b := splitmix64(a ^ splitmix64(stream))
	return rand.New(rand.NewPCG(a, b))
}

func splitmix64(x uint64) uint64 {
	x += 0x9e3779b97f4a7c15
	x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9
	x = (x ^ (x >> 27)) * 0x94d049bb133111eb
	return x ^ (x >> 31)
}
