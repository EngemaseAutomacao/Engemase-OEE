// Package engine é o motor de máquina do agente: a partir das leituras das tags,
// determina o estado de cada máquina (modos signals, state_code e count_derived,
// NO_COMM por falta de comunicação ou heartbeat parado, com debounce), calcula os
// deltas dos contadores (overflow, reset, salto absurdo, nova base) e gera eventos
// de mudança de estado e agregados por minuto.
//
// O motor não lê relógio: todo instante vem de quem chama (leituras e Tick). Assim
// os testes são determinísticos. Não é seguro para uso concorrente: no agente, uma
// goroutine é dona do motor.
//
// Regra de contabilidade: o tempo só é atribuído a um estado quando não há mais
// dúvida sobre ele. Enquanto existe um candidato a estado novo (debounce) ou indício
// de perda de comunicação, a contabilidade fica parada no início do candidato. Por
// isso o instante dos eventos e os segundos dos minutos sempre batem, e o minuto só
// fecha depois que essa dúvida se resolve.
package engine

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// stateUnknown é o estado interno até a primeira leitura boa (conta como no_comm).
const stateUnknown = ""

// Sample é a leitura boa de uma tag.
type Sample struct {
	TagID string
	Value modbus.Value
}

// Record é um item para a outbox: evento ou minuto fechado.
type Record struct {
	Kind      string // "event" | "minute"
	ItemID    string // UUIDv7 do evento | "machine_id|bucket_ms"
	MachineID string
	At        time.Time
	Payload   any // contracts.*Event ou contracts.Minute (sem seq)
}

// Kinds de Record.
const (
	KindEvent  = "event"
	KindMinute = "minute"
)

// Output é o que um Tick produz. Minutos e contadores devem ser gravados na MESMA
// transação (invariante de exatamente uma vez).
type Output struct {
	Records  []Record
	Counters []CounterState
}

// Empty indica se não há nada a gravar.
func (o Output) Empty() bool { return len(o.Records) == 0 && len(o.Counters) == 0 }

// Options configura o motor.
type Options struct {
	// IDs gera os UUIDv7 dos eventos (nil = gerador padrão com crypto/rand).
	IDs *ids.Generator
}

// Engine mantém todas as máquinas de uma config.
type Engine struct {
	machines []*machine
	byID     map[string]*machine
	tags     map[string]*binding
	devices  map[string][]*machine // dispositivo → máquinas com tags de estado/contador nele
	ids      *ids.Generator
	pending  []Record
}

type binding struct {
	tag     *config.Tag
	machine *machine
	counter *counterTracker // só papéis count.*
	mul     float64
	add     float64
}

// New monta o motor para uma config já validada. start é o instante a partir do
// qual o tempo é observado (antes disso, no_comm).
func New(cfg *config.GatewayConfig, start time.Time, opts Options) (*Engine, error) {
	e := &Engine{
		byID:    map[string]*machine{},
		tags:    map[string]*binding{},
		devices: map[string][]*machine{},
		ids:     opts.IDs,
	}
	if e.ids == nil {
		e.ids = ids.NewGenerator(nil)
	}
	start = start.UTC()
	for i := range cfg.Machines {
		m := newMachine(&cfg.Machines[i], start, e)
		e.machines = append(e.machines, m)
		e.byID[m.id] = m
	}
	for d := range cfg.Devices {
		dev := &cfg.Devices[d]
		seen := map[*machine]bool{}
		for t := range dev.Tags {
			tag := &dev.Tags[t]
			if tag.MachineID == "" || tag.Role == config.RoleCustom {
				continue // amostras custom: F2
			}
			m := e.byID[tag.MachineID]
			if m == nil {
				return nil, fmt.Errorf("tag %s aponta para máquina inexistente %s", tag.ID, tag.MachineID)
			}
			b := &binding{tag: tag, machine: m}
			b.mul, b.add = tag.ScaleFactors()
			if config.IsCounterRole(tag.Role) {
				spec := tag.Spec()
				b.counter = &counterTracker{
					state:   CounterState{TagID: tag.ID, MachineID: m.id, Role: tag.Role, Bits: spec.Type.Bits(), AddrKey: tag.AddrKey()},
					maxRate: m.maxRate,
				}
				if tag.Role == config.RoleCountGood {
					m.hasGood = true
				}
				if tag.Role == config.RoleCountTotal {
					m.totalTag = b
				}
			}
			if tag.Role == config.RoleHeartbeat {
				m.hasHeartbeat = true
			}
			if config.IsStateOrCounterRole(tag.Role) {
				if poll := time.Duration(dev.EffectivePollMS(tag)) * time.Millisecond; poll > m.expectedPoll {
					m.expectedPoll = poll
				}
				if !seen[m] {
					e.devices[dev.ID] = append(e.devices[dev.ID], m)
					seen[m] = true
				}
			}
			e.tags[tag.ID] = b
		}
	}
	return e, nil
}

// RestoreCounters carrega os contadores persistidos (antes da primeira leitura).
// Na primeira leitura de cada tag, o delta parte do valor salvo; se o endereço, o
// tipo ou a ordem mudaram, gera counter_rebaseline.
func (e *Engine) RestoreCounters(states []CounterState) {
	for i := range states {
		s := states[i]
		if b := e.tags[s.TagID]; b != nil && b.counter != nil && !b.counter.valid {
			b.counter.restored = &s
		}
	}
}

// OnRead registra as leituras boas de um bloco, todas feitas no mesmo instante.
// Tags desconhecidas são ignoradas.
func (e *Engine) OnRead(at time.Time, samples []Sample) {
	at = at.UTC()
	touched := map[*machine]bool{}
	for _, s := range samples {
		b := e.tags[s.TagID]
		if b == nil {
			continue
		}
		if !touched[b.machine] {
			// Avalia com os sinais antigos antes que a leitura nova esconda o silêncio:
			// se a lacuna até aqui passou de comm_loss_after_s sem Tick no meio, ela
			// vira NO_COMM (tempo não observado), não tempo do último estado.
			b.machine.evaluate(at)
		}
		b.machine.apply(b, s.Value, at)
		touched[b.machine] = true
	}
	for _, m := range e.machines {
		if touched[m] {
			m.evaluate(at)
		}
	}
}

// OnFailure registra que a leitura de um dispositivo falhou neste instante.
func (e *Engine) OnFailure(deviceID string, at time.Time) {
	at = at.UTC()
	for _, m := range e.devices[deviceID] {
		// Como em OnRead: uma lacuna sem Tick maior que comm_loss_after_s é NO_COMM
		// desde a última leitura boa, não desde esta falha.
		m.evaluate(at)
		if m.firstFail.IsZero() || !m.firstFail.After(m.lastGood) {
			m.firstFail = at
		}
		m.evaluate(at)
	}
}

// Tick avança o relógio do motor: confirma estados, contabiliza o tempo e fecha os
// minutos completos. Chame a cada ~1 s.
func (e *Engine) Tick(now time.Time) Output {
	now = now.UTC()
	var out Output
	for _, m := range e.machines {
		m.evaluate(now)
		m.account(m.holdPoint(now))
		m.closeMinutes(&out)
	}
	out.Records = append(e.pending, out.Records...)
	e.pending = nil
	return out
}

// Live devolve a foto atual das máquinas com estado conhecido.
func (e *Engine) Live(now time.Time) []contracts.Live {
	now = now.UTC()
	out := make([]contracts.Live, 0, len(e.machines))
	for _, m := range e.machines {
		if m.confirmed.state == stateUnknown {
			continue
		}
		l := contracts.Live{
			MachineID:  m.id,
			At:         contracts.FormatTime(now),
			State:      m.confirmed.state,
			StateSince: contracts.FormatTime(m.since),
			Product:    m.product,
			Speed:      m.speed,
		}
		if m.since.After(now) {
			l.StateSince = l.At
		}
		if m.confirmed.hasFault {
			fc := m.confirmed.fault
			l.FaultCode = &fc
		}
		if m.totalTag != nil && m.totalTag.counter.valid {
			v := int64(m.totalTag.counter.state.LastRaw)
			l.CounterTotal = &v
		}
		out = append(out, l)
	}
	return out
}

// MachineState é um resumo para diagnóstico (CLI status).
type MachineState struct {
	MachineID string
	State     string // "" = desconhecido
	Since     time.Time
}

// States devolve o estado confirmado de cada máquina.
func (e *Engine) States() []MachineState {
	out := make([]MachineState, 0, len(e.machines))
	for _, m := range e.machines {
		out = append(out, MachineState{MachineID: m.id, State: m.confirmed.state, Since: m.since})
	}
	return out
}

func (e *Engine) emit(m *machine, at time.Time, payload any) {
	e.pending = append(e.pending, Record{Kind: KindEvent, ItemID: eventID(payload), MachineID: m.id, At: at, Payload: payload})
}

func eventID(p any) string {
	switch ev := p.(type) {
	case contracts.StateEvent:
		return ev.ID
	case contracts.ProductEvent:
		return ev.ID
	case contracts.CounterEvent:
		return ev.ID
	}
	return ""
}

// ---------------------------------------------------------------------------
// Máquina
// ---------------------------------------------------------------------------

type stateKey struct {
	state    string
	fault    int64
	hasFault bool
}

type candidate struct {
	key   stateKey
	since time.Time
}

type optBool struct {
	v  bool
	ok bool
}

type optInt struct {
	v  int64
	ok bool
}

type machine struct {
	e    *Engine
	id   string
	mode string

	debounce     time.Duration
	commLoss     time.Duration
	hbTimeout    time.Duration
	idleWindow   time.Duration
	maxRate      float64
	expectedPoll time.Duration
	stateMap     map[int64]string
	defaultState string
	hasGood      bool
	hasHeartbeat bool
	totalTag     *binding

	// Sinais
	running, fault optBool
	stateCode      optInt
	faultCode      optInt
	product        string
	speed          *float64
	hbValue        optInt
	hbLastChange   time.Time
	hbLastRead     time.Time
	lastGood       time.Time // última leitura boa de tag state.* ou count.*
	firstFail      time.Time // primeira falha depois da última leitura boa
	lastPieceAt    time.Time // count_derived

	// Estado
	started   time.Time
	confirmed stateKey
	since     time.Time
	cand      *candidate
	accounted time.Time

	minutes     map[int64]*minuteAcc
	closedUntil time.Time // fim do último minuto fechado
	lastProduct string    // produto no fim do último minuto fechado
}

func newMachine(cfg *config.Machine, start time.Time, e *Engine) *machine {
	r := cfg.StateRules
	m := &machine{
		e:            e,
		id:           cfg.ID,
		mode:         r.Mode,
		debounce:     time.Duration(r.Debounce() * float64(time.Second)),
		commLoss:     time.Duration(r.CommLossAfter()) * time.Second,
		maxRate:      cfg.MaxRate(),
		defaultState: r.DefaultState,
		started:      start,
		since:        start,
		accounted:    start,
		minutes:      map[int64]*minuteAcc{},
		closedUntil:  start.Truncate(time.Minute),
	}
	if r.HeartbeatTimeoutS != nil {
		m.hbTimeout = time.Duration(*r.HeartbeatTimeoutS) * time.Second
	}
	if r.IdealCycleS != nil {
		m.idleWindow = time.Duration(r.IdleAfter() * *r.IdealCycleS * float64(time.Second))
	}
	if m.defaultState == "" {
		m.defaultState = contracts.StateStopped
	}
	if len(r.Map) > 0 {
		m.stateMap = make(map[int64]string, len(r.Map))
		for k, v := range r.Map {
			if code, err := strconv.ParseInt(k, 10, 64); err == nil {
				m.stateMap[code] = v
			}
		}
	}
	return m
}

// apply registra o valor de uma tag (sem avaliar o estado).
func (m *machine) apply(b *binding, v modbus.Value, at time.Time) {
	role := b.tag.Role
	if config.IsStateOrCounterRole(role) {
		m.lastGood = maxTime(m.lastGood, at)
	}
	switch role {
	case config.RoleStateRunning:
		m.running = optBool{v.Bool(), true}
	case config.RoleStateFault:
		m.fault = optBool{v.Bool(), true}
	case config.RoleStateCode:
		m.stateCode = optInt{v.Int64(), true}
	case config.RoleFaultCode:
		m.faultCode = optInt{v.Int64(), true}
	case config.RoleProductCode:
		p := strconv.FormatInt(v.Int64(), 10)
		if m.product != "" && p != m.product {
			m.e.emit(m, at, contracts.ProductEvent{
				ID: m.e.ids.New(at), Type: contracts.EventProduct, At: contracts.FormatTime(at),
				MachineID: m.id, Product: p, PreviousProduct: m.product,
			})
		}
		m.product = p
		m.acc(at).product = p
	case config.RoleSpeedActual:
		// float32 do CLP pode vir NaN/±Inf (ou a escala estourar): isso no Live faria
		// o json.Marshal do /sync inteiro falhar. Sem valor finito, sem velocidade.
		if s := v.Scaled(b.mul, b.add); math.IsNaN(s) || math.IsInf(s, 0) {
			m.speed = nil
		} else {
			m.speed = &s
		}
	case config.RoleHeartbeat:
		hb := v.Int64()
		if !m.hbValue.ok || m.hbValue.v != hb {
			m.hbLastChange = at
		}
		m.hbValue = optInt{hb, true}
		m.hbLastRead = at
	case config.RoleCountTotal, config.RoleCountReject, config.RoleCountGood:
		m.applyCounter(b, v, at)
	}
}

func (m *machine) applyCounter(b *binding, v modbus.Value, at time.Time) {
	c := b.counter
	res := c.update(v.Raw(), at)
	acc := m.acc(at)
	acc.counterEnd[c.state.TagID] = c.state

	switch b.tag.Role {
	case config.RoleCountTotal:
		acc.total += res.Delta
		if res.Delta > 0 {
			m.lastPieceAt = at
		}
	case config.RoleCountReject:
		acc.reject += res.Delta
	case config.RoleCountGood:
		acc.good += res.Delta
	}

	evType := ""
	switch res.Kind {
	case CounterReset:
		evType = contracts.EventCounterReset
	case CounterJump:
		evType = contracts.EventCounterJump
	case CounterRebaseline:
		evType = contracts.EventCounterRebaseline
	}
	if evType == "" {
		return
	}
	ev := contracts.CounterEvent{
		ID: m.e.ids.New(at), Type: evType, At: contracts.FormatTime(at),
		MachineID: m.id, TagID: b.tag.ID, Role: b.tag.Role, Raw: int64(c.state.LastRaw),
	}
	if res.HasPrevious {
		p := int64(res.PreviousRaw)
		ev.PreviousRaw = &p
	}
	if res.Kind == CounterJump {
		d := int64(res.DiscardedDelta)
		ev.DiscardedDelta = &d
	}
	m.e.emit(m, at, ev)
}

// acc devolve o minuto aberto que contém at. Leitura atrasada para um minuto já
// fechado vai para o primeiro minuto aberto (a peça não se perde).
func (m *machine) acc(at time.Time) *minuteAcc {
	if at.Before(m.closedUntil) {
		at = m.closedUntil
	}
	start := at.Truncate(time.Minute)
	k := start.UnixMilli()
	a := m.minutes[k]
	if a == nil {
		a = newMinuteAcc(start)
		m.minutes[k] = a
	}
	return a
}

// rawState calcula o estado que os sinais indicam agora.
// Devolve ok=false quando ainda não há dado para decidir (fica como está).
func (m *machine) rawState(now time.Time) (key stateKey, since time.Time, noComm, ok bool) {
	// Perda de comunicação.
	if m.lastGood.IsZero() {
		if now.Sub(m.started) >= m.commLoss {
			return stateKey{state: contracts.StateNoComm}, m.started, true, true
		}
		return stateKey{}, time.Time{}, false, false
	}
	if now.Sub(m.lastGood) >= m.commLoss {
		since := m.lastGood
		if m.firstFail.After(m.lastGood) {
			since = m.firstFail
		}
		return stateKey{state: contracts.StateNoComm}, since, true, true
	}
	// CLP "congelado": heartbeat parado.
	if m.hbTimeout > 0 && m.hbValue.ok && now.Sub(m.hbLastChange) >= m.hbTimeout {
		return stateKey{state: contracts.StateNoComm}, m.hbLastChange, true, true
	}

	withFault := func(state string) stateKey {
		k := stateKey{state: state}
		if state == contracts.StateFault && m.faultCode.ok && m.faultCode.v >= 0 {
			k.fault, k.hasFault = m.faultCode.v, true
		}
		return k
	}
	switch m.mode {
	case config.ModeSignals:
		if !m.running.ok {
			return stateKey{}, time.Time{}, false, false
		}
		switch {
		case m.fault.ok && m.fault.v:
			return withFault(contracts.StateFault), now, false, true
		case m.running.v:
			return withFault(contracts.StateRunning), now, false, true
		default:
			return withFault(contracts.StateStopped), now, false, true
		}
	case config.ModeStateCode:
		if !m.stateCode.ok {
			return stateKey{}, time.Time{}, false, false
		}
		st, found := m.stateMap[m.stateCode.v]
		if !found {
			st = m.defaultState
		}
		return withFault(st), now, false, true
	case config.ModeCountDerived:
		if !m.lastPieceAt.IsZero() && now.Sub(m.lastPieceAt) < m.idleWindow {
			return withFault(contracts.StateRunning), now, false, true
		}
		since := now
		if !m.lastPieceAt.IsZero() {
			since = m.lastPieceAt.Add(m.idleWindow) // instante exato em que ficou ociosa
		}
		return withFault(contracts.StateStopped), since, false, true
	}
	return stateKey{}, time.Time{}, false, false
}

// evaluate cria, descarta ou confirma o candidato a estado novo.
func (m *machine) evaluate(now time.Time) {
	key, since, noComm, ok := m.rawState(now)
	if !ok || key == m.confirmed {
		if ok {
			m.cand = nil
		}
		return
	}
	if noComm {
		// O próprio prazo (comm_loss_after_s / heartbeat_timeout_s) já é o debounce.
		m.confirm(key, since)
		return
	}
	if m.cand == nil || m.cand.key != key {
		m.cand = &candidate{key: key, since: maxTime(since, m.accounted)}
	}
	if now.Sub(m.cand.since) >= m.debounce {
		m.confirm(m.cand.key, m.cand.since)
	}
}

// confirm troca o estado confirmado e gera o evento (instante = início do candidato).
func (m *machine) confirm(key stateKey, at time.Time) {
	prev := m.confirmed.state
	// O evento pode ser retroativo só se os dois estados caem no mesmo bucket do
	// minuto (desconhecido → NO_COMM: ambos são no_comm). Senão, nunca antes do
	// que já foi contabilizado, para eventos e minutos baterem.
	if secondsIndex(prev) != secondsIndex(key.state) || at.After(m.accounted) {
		at = maxTime(at, m.accounted)
		m.account(at)
	}
	ev := contracts.StateEvent{
		ID: m.e.ids.New(at), Type: contracts.EventState, At: contracts.FormatTime(at),
		MachineID: m.id, State: key.state, PreviousState: prev,
	}
	if key.hasFault {
		fc := key.fault
		ev.FaultCode = &fc
	}
	m.e.emit(m, at, ev)
	m.confirmed, m.since, m.cand = key, at, nil
}

// holdPoint é até onde o tempo pode ser contabilizado sem dúvida.
func (m *machine) holdPoint(now time.Time) time.Time {
	hold := now
	if m.cand != nil && m.cand.since.Before(hold) {
		hold = m.cand.since
	}
	if m.confirmed.state == contracts.StateNoComm || m.confirmed.state == stateUnknown {
		return hold // já é no_comm: nada a esperar
	}
	// Indícios de perda de comunicação ainda não confirmada.
	if m.firstFail.After(m.lastGood) && m.firstFail.Before(hold) {
		hold = m.firstFail
	}
	silence := 2*m.expectedPoll + time.Second
	if !m.lastGood.IsZero() && now.Sub(m.lastGood) > silence && m.lastGood.Before(hold) {
		hold = m.lastGood
	}
	if m.hbTimeout > 0 && m.hbValue.ok && m.hbLastRead.After(m.hbLastChange) && m.hbLastChange.Before(hold) {
		hold = m.hbLastChange // heartbeat não mudou na última leitura
	}
	return hold
}

// account atribui [accounted, until) ao estado confirmado, minuto a minuto.
func (m *machine) account(until time.Time) {
	idx := secondsIndex(m.confirmed.state)
	for m.accounted.Before(until) {
		start := m.accounted.Truncate(time.Minute)
		end := minTime(until, start.Add(time.Minute))
		m.acc(m.accounted).ms[idx] += end.Sub(m.accounted).Milliseconds()
		m.accounted = end
	}
}

// closeMinutes fecha, em ordem, os minutos já totalmente contabilizados.
func (m *machine) closeMinutes(out *Output) {
	keys := make([]int64, 0, len(m.minutes))
	for k := range m.minutes {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	for _, k := range keys {
		a := m.minutes[k]
		end := a.start.Add(time.Minute)
		if end.After(m.accounted) {
			break
		}
		secs := a.seconds()
		product := a.product
		if product == "" {
			product = m.lastProduct
		}
		mn := contracts.Minute{
			MachineID: m.id, T: contracts.FormatMinute(a.start),
			RunS: secs[secRun], StopS: secs[secStop], FaultS: secs[secFault], SetupS: secs[secSetup], NoCommS: secs[secNoComm],
			Total: clampCount(a.total), Reject: clampCount(a.reject), Product: product,
		}
		if m.hasGood {
			g := clampCount(a.good)
			mn.Good = &g
		}
		out.Records = append(out.Records, Record{
			Kind: KindMinute, ItemID: fmt.Sprintf("%s|%d", m.id, a.start.UnixMilli()),
			MachineID: m.id, At: a.start, Payload: mn,
		})
		tagIDs := make([]string, 0, len(a.counterEnd))
		for id := range a.counterEnd {
			tagIDs = append(tagIDs, id)
		}
		sort.Strings(tagIDs)
		for _, id := range tagIDs {
			out.Counters = append(out.Counters, a.counterEnd[id])
		}
		m.lastProduct = product
		m.closedUntil = end
		delete(m.minutes, k)
	}
}

func secondsIndex(state string) int {
	switch state {
	case contracts.StateRunning:
		return secRun
	case contracts.StateStopped:
		return secStop
	case contracts.StateFault:
		return secFault
	case contracts.StateSetup:
		return secSetup
	default: // NO_COMM e desconhecido
		return secNoComm
	}
}

func clampCount(n int64) int64 {
	if n < 0 {
		return 0
	}
	if n > contracts.MaxCountPerMinute {
		return contracts.MaxCountPerMinute
	}
	return n
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
