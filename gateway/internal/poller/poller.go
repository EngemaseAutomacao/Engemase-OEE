// Package poller lê os dispositivos no ritmo da config: um Poller por dispositivo
// Modbus TCP (conexão persistente própria), um por barramento RS-485 e um por
// conversor serial↔Ethernet transparente (RTU sobre TCP, mesmo host:porta). Nos dois
// últimos, as requisições são estritamente serializadas: uma linha RS-485, um mestre,
// uma requisição por vez. Cada leitura em bloco vira um Reading com as amostras
// decodificadas das tags, entregue ao motor.
//
// Cada poller também informa a saúde dos seus dispositivos (Health), registra no log
// as mudanças do estado de conexão deles (Logger) e expõe o batimento do laço de
// leitura (Liveness), que o watchdog do agente confere.
package poller

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// Reading é o resultado de uma leitura em bloco.
type Reading struct {
	DeviceID string
	At       time.Time
	Samples  []engine.Sample
	Err      error
}

// backoffSteps é a espera de um dispositivo depois de 3 falhas seguidas.
var backoffSteps = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second}

type tagRef struct {
	id   string
	spec modbus.TagSpec
}

type group struct {
	deviceID string
	unit     uint8
	span     modbus.Span
	every    time.Duration
	tags     []tagRef
	next     time.Time
}

// Poller é dono de um transporte (dispositivo Modbus TCP, barramento RTU ou conversor
// RTU sobre TCP).
type Poller struct {
	Name string
	// Logger recebe as mudanças do estado de conexão dos dispositivos (nil: sem log).
	// Definido antes de Run.
	Logger *slog.Logger
	target modbus.Target
	open   func(modbus.Target) (modbus.Reader, error)
	groups []*group
	now    func() time.Time

	mu      sync.Mutex
	devices map[string]*devState

	// liveMu protege só o batimento do laço (ver Liveness) e nunca fica travado
	// durante E/S: o watchdog lê o batimento sem esperar por uma leitura presa.
	liveMu sync.Mutex
	live   Liveness
	bound  time.Duration // LivenessBound, calculado na primeira volta
}

type devState struct {
	id           string
	name         string
	protocol     string
	logged       string // último estado de conexão registrado no log ("" = nenhum ainda)
	failures     int
	until        time.Time
	status       string
	latencyEWMA  float64
	errs         []time.Time // falhas no último minuto
	timeouts     []time.Time
	exceptions   map[byte][]time.Time
	lastOK       time.Time
	lastErr      string
	everOK       bool
	overruns     int64
	readsOK      int64
	readsErr     int64
	lastReadTime time.Duration
}

// Build monta os pollers de uma config. Dispositivos desabilitados são ignorados.
func Build(cfg *config.GatewayConfig, local *config.Local) ([]*Poller, error) {
	buses := map[string]*config.SerialBus{}
	for i := range cfg.SerialBuses {
		buses[cfg.SerialBuses[i].ID] = &cfg.SerialBuses[i]
	}
	var out []*Poller
	byBus := map[string]*Poller{}
	byConverter := map[string]*Poller{} // host (sem diferença de caixa):porta
	for i := range cfg.Devices {
		dev := &cfg.Devices[i]
		if !dev.IsEnabled() {
			continue
		}
		timeout := time.Duration(dev.Timeout()) * time.Millisecond
		addr := dev.Params.Host + ":" + strconv.Itoa(dev.Params.Port)
		var p *Poller
		switch dev.Protocol {
		case config.ProtocolTCP:
			// O servidor Modbus TCP casa cada resposta pelo id de transação e atende
			// conexões simultâneas: um poller (uma conexão) por dispositivo.
			p = newPoller(dev.Name+" ("+addr+")", modbus.Target{Transport: modbus.TransportTCP, Address: addr, Timeout: timeout, Retries: modbus.DefaultRetries})
			out = append(out, p)
		case config.ProtocolRTUOverTCP:
			// Os escravos atrás de um conversor transparente estão numa linha RS-485 só, e
			// o quadro RTU não tem id de transação. Um socket por escravo punha as
			// requisições em paralelo na mesma linha: colisões, respostas entregues à
			// conexão do outro e NO_COMM intermitente. Como no barramento serial, o
			// conversor (host:porta) tem um poller e um socket só: uma requisição por vez.
			key := strings.ToLower(dev.Params.Host) + ":" + strconv.Itoa(dev.Params.Port)
			p = byConverter[key]
			if p == nil {
				p = newPoller("rtu-tcp "+addr, modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr, Timeout: timeout, Retries: modbus.DefaultRetries})
				byConverter[key] = p
				out = append(out, p)
			}
			if timeout > p.target.Timeout {
				p.target.Timeout = timeout // o conversor usa o maior timeout dos escravos
			}
		case config.ProtocolRTU:
			bus := buses[dev.Params.Bus]
			if bus == nil {
				return nil, fmt.Errorf("dispositivo %s: barramento %s não existe", dev.ID, dev.Params.Bus)
			}
			p = byBus[bus.ID]
			if p == nil {
				path, err := local.ResolveSerialPort(bus.Port)
				if err != nil {
					return nil, fmt.Errorf("barramento %s: %w", bus.ID, err)
				}
				p = newPoller("rs485 "+bus.Port, modbus.Target{
					Transport: modbus.TransportRTU, Address: path, Baud: bus.Baud, Parity: bus.Parity,
					DataBits: bus.DataBits, StopBits: bus.StopBits, Timeout: timeout, Retries: modbus.DefaultRetries,
					TurnaroundDelay: config.DefaultRTUTurnaroundMS * time.Millisecond,
				})
				byBus[bus.ID] = p
				out = append(out, p)
			}
			if timeout > p.target.Timeout {
				p.target.Timeout = timeout // o barramento usa o maior timeout dos escravos
			}
			if dev.Params.TurnaroundMS != nil {
				if d := time.Duration(*dev.Params.TurnaroundMS) * time.Millisecond; d > p.target.TurnaroundDelay {
					p.target.TurnaroundDelay = d
				}
			}
		default:
			return nil, fmt.Errorf("dispositivo %s: protocolo %q não suportado", dev.ID, dev.Protocol)
		}
		p.addDevice(dev)
	}
	return out, nil
}

func newPoller(name string, t modbus.Target) *Poller {
	return &Poller{Name: name, target: t, open: modbus.Open, now: time.Now, devices: map[string]*devState{}}
}

// addDevice compila os grupos de leitura do dispositivo: os blocos da config e as
// tags fora de bloco, agrupadas por poll_ms com o planejador.
func (p *Poller) addDevice(dev *config.Device) {
	p.devices[dev.ID] = &devState{id: dev.ID, name: dev.Name, protocol: dev.Protocol, status: contracts.DeviceDisconnected,
		exceptions: map[byte][]time.Time{}}
	unit := dev.UnitID()
	var groups []*group
	for i := range dev.Blocks {
		b := &dev.Blocks[i]
		groups = append(groups, &group{deviceID: dev.ID, unit: unit, span: b.Span(), every: time.Duration(b.PollMS) * time.Millisecond})
	}
	loose := map[int][]modbus.Span{}
	for i := range dev.Tags {
		t := &dev.Tags[i]
		if dev.ContainingBlock(t) == nil {
			loose[t.PollMS] = append(loose[t.PollMS], t.Spec().Span())
		}
	}
	polls := make([]int, 0, len(loose))
	for ms := range loose {
		polls = append(polls, ms)
	}
	sort.Ints(polls)
	for _, ms := range polls {
		for _, sp := range modbus.Plan(loose[ms], 0) {
			groups = append(groups, &group{deviceID: dev.ID, unit: unit, span: sp, every: time.Duration(ms) * time.Millisecond})
		}
	}
	for _, g := range groups {
		for i := range dev.Tags {
			t := &dev.Tags[i]
			spec := t.Spec()
			sp := spec.Span()
			if g.span.Contains(sp.Area, sp.Start, int(sp.Count)) {
				if dev.ContainingBlock(t) == nil && dev.EffectivePollMS(t) != int(g.every/time.Millisecond) {
					continue // tag solta de outro ritmo
				}
				g.tags = append(g.tags, tagRef{id: t.ID, spec: spec})
			}
		}
		if len(g.tags) > 0 {
			p.groups = append(p.groups, g)
		}
	}
}

// Run lê até o contexto acabar, entregando os resultados em out (bloqueia se o
// motor estiver atrasado: contrapressão, nada é descartado em silêncio).
func (p *Poller) Run(ctx context.Context, out chan<- Reading) error {
	if len(p.groups) == 0 {
		<-ctx.Done() // sem laço de leitura: Liveness fica zerado, nada a conferir
		return ctx.Err()
	}
	// Abrir o transporte conta como volta do laço: o supervisor que reinicia o poller
	// depois de uma falha está vivo, mesmo que a porta não exista.
	p.beat(p.now())
	reader, err := p.open(p.target)
	if err != nil {
		return fmt.Errorf("%s: %w", p.Name, err)
	}
	defer reader.Close()

	now := p.now()
	for i, g := range p.groups {
		// Espalha o primeiro ciclo para não ler tudo no mesmo instante.
		g.next = now.Add(time.Duration(i) * 10 * time.Millisecond)
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		g, due := p.nextDue()
		if d := due.Sub(p.now()); d > 0 {
			p.sleepUntil(due) // espera planejada (ritmo ou backoff), não laço parado
			timer.Reset(d)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
			}
		} else if ctx.Err() != nil {
			return ctx.Err()
		}

		start := p.now()
		raw, rerr := reader.ReadBlock(ctx, g.unit, g.span)
		at := p.now()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		r := Reading{DeviceID: g.deviceID, At: at}
		if rerr == nil {
			r.Samples, rerr = decode(raw, g.tags)
		}
		r.Err = rerr
		change := p.record(g, at, at.Sub(start), rerr)
		p.beat(at) // volta completa, com sucesso ou falha: o laço está vivo mesmo sem o CLP
		p.logChange(change)

		// Próximo prazo, sem fila acumulada: período perdido é pulado (overrun).
		g.next = g.next.Add(g.every)
		if g.next.Before(at) {
			p.mu.Lock()
			p.devices[g.deviceID].overruns++
			p.mu.Unlock()
			g.next = at.Add(g.every)
		}
		if err := p.deliver(ctx, out, r); err != nil {
			return err
		}
	}
}

// deliver entrega a leitura ao motor. Esperando o motor consumir (contrapressão: a
// rotina de coleta do agente ocupada, por exemplo numa gravação lenta), o laço não
// está travado: o prazo fica suspenso (Liveness.Delivering) e recomeça na entrega. O
// consumidor é conferido à parte pelo watchdog do agente (motor e gravação).
func (p *Poller) deliver(ctx context.Context, out chan<- Reading, r Reading) error {
	select {
	case out <- r: // caso comum: há folga no canal
		return nil
	default:
	}
	p.setDelivering(true)
	defer p.setDelivering(false)
	select {
	case out <- r:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// nextDue escolhe o grupo de prazo mais cedo (respeitando o backoff do dispositivo).
func (p *Poller) nextDue() (*group, time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	var best *group
	var bestDue time.Time
	for _, g := range p.groups {
		due := g.next
		if u := p.devices[g.deviceID].until; u.After(due) {
			due = u
		}
		if best == nil || due.Before(bestDue) {
			best, bestDue = g, due
		}
	}
	return best, bestDue
}

func decode(raw modbus.Raw, tags []tagRef) ([]engine.Sample, error) {
	out := make([]engine.Sample, 0, len(tags))
	for _, t := range tags {
		v, err := raw.Decode(t.spec)
		if err != nil {
			return nil, fmt.Errorf("decodificando tag %s: %w", t.id, err)
		}
		out = append(out, engine.Sample{TagID: t.id, Value: v})
	}
	return out, nil
}

// record atualiza a saúde do dispositivo com o resultado de uma leitura e devolve a
// mudança de estado de conexão ainda não registrada no log (nil se não houve).
func (p *Poller) record(g *group, at time.Time, rtt time.Duration, err error) *statusChange {
	p.mu.Lock()
	defer p.mu.Unlock()
	d := p.devices[g.deviceID]
	d.lastReadTime = rtt
	if err == nil {
		d.failures, d.until = 0, time.Time{}
		d.status, d.lastOK, d.everOK = contracts.DeviceConnected, at, true
		d.readsOK++
		ms := float64(rtt.Microseconds()) / 1000
		if d.latencyEWMA == 0 {
			d.latencyEWMA = ms
		} else {
			d.latencyEWMA = 0.8*d.latencyEWMA + 0.2*ms
		}
		return d.takeChange()
	}
	d.readsErr++
	d.failures++
	d.lastErr = err.Error()
	d.errs = append(d.errs, at)
	if errors.Is(err, modbus.ErrTimeout) {
		d.timeouts = append(d.timeouts, at)
	}
	var exc *modbus.ExceptionError
	if errors.As(err, &exc) {
		d.exceptions[exc.Code] = append(d.exceptions[exc.Code], at)
	}
	if d.failures >= 3 {
		step := backoffSteps[min(d.failures-3, len(backoffSteps)-1)]
		jitter := time.Duration(rand.Int64N(int64(step/5) + 1))
		d.until = at.Add(step + jitter)
		d.status = contracts.DeviceDisconnected
	} else if d.everOK {
		d.status = contracts.DeviceDegraded
	}
	return d.takeChange()
}

// statusChange é uma mudança do estado de conexão de um dispositivo, para o log.
type statusChange struct {
	id, name, protocol string
	from, to           string // from "" = primeiro estado definido
	failures           int
	lastErr            string
}

// takeChange devolve a mudança de estado ainda não registrada no log e a marca como
// registrada (uma vez por transição). O estado inicial (desconectado) só conta depois
// de definido: na primeira leitura boa ou ao entrar em backoff (3 falhas seguidas); as
// primeiras falhas de um dispositivo que nunca respondeu não mudam nada. Com p.mu.
func (d *devState) takeChange() *statusChange {
	if d.status == d.logged || (!d.everOK && d.failures < 3) {
		return nil
	}
	c := &statusChange{id: d.id, name: d.name, protocol: d.protocol, from: d.logged, to: d.status,
		failures: d.failures, lastErr: truncate(d.lastErr, 500)}
	d.logged = d.status
	return c
}

// logChange registra a mudança de estado de conexão de um dispositivo: conectado em
// info; degradado e desconectado em warn. Fora de p.mu (o log pode demorar).
func (p *Poller) logChange(c *statusChange) {
	if c == nil || p.Logger == nil {
		return
	}
	level, msg := slog.LevelWarn, "dispositivo desconectado: leituras seguidas falharam; novas tentativas com espera crescente"
	switch c.to {
	case contracts.DeviceConnected:
		level, msg = slog.LevelInfo, "dispositivo conectado"
	case contracts.DeviceDegraded:
		msg = "dispositivo degradado: leitura falhou"
	}
	p.Logger.Log(context.Background(), level, msg, "dispositivo", c.id, "nome", c.name, "protocolo", c.protocol,
		"poller", p.Name, "estado", c.to, "anterior", c.from, "falhas_seguidas", c.failures, "ultimo_erro", c.lastErr)
}

// ---------------------------------------------------------------------------
// Batimento do laço de leitura (watchdog)
// ---------------------------------------------------------------------------

// livenessMin é o menor prazo para o laço de leitura completar uma volta.
const livenessMin = 30 * time.Second

// Liveness é o batimento do laço de leitura, conferido pelo watchdog do agente. Os
// tempos vêm do relógio do poller (time.Now: com a leitura monotônica, imunes a
// acertos do relógio de parede).
type Liveness struct {
	// Beat é quando o laço completou a última volta: uma leitura terminada, com
	// sucesso ou falha (o laço está vivo mesmo que o CLP não responda), ou uma
	// tentativa de abrir o transporte. Zero: o laço ainda não rodou.
	Beat time.Time
	// Deadline é até quando a próxima volta tem de terminar: Beat + LivenessBound,
	// estendido enquanto o laço dorme de propósito até o próximo prazo (ritmo dos
	// grupos ou backoff de dispositivo sem resposta, até 36 s) e recomeçado quando
	// uma entrega que esperou o motor termina (entrega + LivenessBound).
	Deadline time.Time
	// Delivering diz que o laço espera o motor consumir a leitura (canal cheio:
	// contrapressão). O prazo fica suspenso: a espera é do consumidor, que o watchdog
	// do agente confere à parte (motor e gravação), não um leitor travado.
	Delivering bool
}

// Stalled diz se o laço passou do prazo em now: travado (leitura presa), não só sem
// resposta do CLP nem à espera do motor consumir as leituras.
func (l Liveness) Stalled(now time.Time) bool {
	return !l.Beat.IsZero() && !l.Delivering && now.After(l.Deadline)
}

// Liveness devolve o batimento atual do laço (seguro de qualquer goroutine).
func (p *Poller) Liveness() Liveness {
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	return p.live
}

// LivenessBound é o prazo para o laço completar uma volta depois da anterior, fora
// das esperas planejadas: 3 × (o maior poll do poller + o pior tempo de uma leitura),
// no mínimo livenessMin. Num barramento ou conversor, o poll é o maior entre os grupos
// de todos os escravos, e o timeout do alvo já é o maior deles (Build).
func (p *Poller) LivenessBound() time.Duration {
	var every time.Duration
	for _, g := range p.groups {
		every = max(every, g.every)
	}
	return max(3*(every+readWorst(p.target)), livenessMin)
}

// readWorst é o pior tempo de uma leitura em bloco que termina, com sucesso ou falha:
// em cada tentativa (Retries + 1), a conexão, a espera da linha quieta depois de um
// erro no RTU (até 3 timeouts no RTU sobre TCP), a pausa do RS-485 e o timeout da
// própria leitura.
func readWorst(t modbus.Target) time.Duration {
	timeout := t.Timeout
	if timeout <= 0 {
		timeout = modbus.DefaultTCPTimeout // o maior padrão dos transportes
	}
	connect := t.ConnectTimeout
	if connect <= 0 {
		connect = modbus.DefaultConnectTimeout
	}
	return time.Duration(max(t.Retries, 0)+1) * (connect + 4*timeout + t.TurnaroundDelay)
}

// beat registra uma volta completa do laço em at: a próxima tem prazo at + o limite.
func (p *Poller) beat(at time.Time) {
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	if p.bound == 0 {
		p.bound = p.LivenessBound()
	}
	p.live = Liveness{Beat: at, Deadline: at.Add(p.bound)}
}

// setDelivering marca o início (true) ou o fim (false) de uma entrega que espera o
// motor consumir. No fim, o prazo recomeça: a próxima volta tem até agora + o limite.
func (p *Poller) setDelivering(on bool) {
	now := p.now()
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	p.live.Delivering = on
	if d := now.Add(p.bound); !on && d.After(p.live.Deadline) {
		p.live.Deadline = d
	}
}

// sleepUntil estende o prazo enquanto o laço dorme de propósito até due.
func (p *Poller) sleepUntil(due time.Time) {
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	if d := due.Add(p.bound); d.After(p.live.Deadline) {
		p.live.Deadline = d
	}
}

// Health devolve a saúde de cada dispositivo deste poller (para o /sync).
func (p *Poller) Health(now time.Time) []contracts.DeviceHealth {
	p.mu.Lock()
	defer p.mu.Unlock()
	cut := now.Add(-time.Minute)
	prune := func(ts []time.Time) []time.Time {
		i := 0
		for i < len(ts) && ts[i].Before(cut) {
			i++
		}
		return ts[i:]
	}
	ids := make([]string, 0, len(p.devices))
	for id := range p.devices {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]contracts.DeviceHealth, 0, len(ids))
	for _, id := range ids {
		d := p.devices[id]
		d.errs, d.timeouts = prune(d.errs), prune(d.timeouts)
		h := contracts.DeviceHealth{ID: id, Status: d.status, Errors1m: int64(len(d.errs)), LastError: truncate(d.lastErr, 500)}
		to := int64(len(d.timeouts))
		h.Timeouts1m = &to
		if d.latencyEWMA > 0 {
			l := int64(d.latencyEWMA + 0.5)
			h.LatencyMS = &l
		}
		for code, ts := range d.exceptions {
			ts = prune(ts)
			d.exceptions[code] = ts
			if len(ts) > 0 {
				if h.Exceptions1m == nil {
					h.Exceptions1m = map[string]int64{}
				}
				h.Exceptions1m[strconv.Itoa(int(code))] = int64(len(ts))
			}
		}
		if !d.lastOK.IsZero() {
			h.LastOKAt = contracts.FormatTime(d.lastOK)
		}
		out = append(out, h)
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
