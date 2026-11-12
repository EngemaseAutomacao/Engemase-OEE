// Package poller lê os dispositivos no ritmo da config: um Poller por dispositivo
// TCP (conexão persistente própria) e um por barramento RS-485 (requisições
// estritamente serializadas: um mestre por barramento). Cada leitura em bloco vira
// um Reading com as amostras decodificadas das tags, entregue ao motor.
package poller

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"
	"strconv"
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

// Poller é dono de um transporte (dispositivo TCP ou barramento RTU).
type Poller struct {
	Name   string
	target modbus.Target
	open   func(modbus.Target) (modbus.Reader, error)
	groups []*group
	now    func() time.Time

	mu      sync.Mutex
	devices map[string]*devState
}

type devState struct {
	id           string
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
	for i := range cfg.Devices {
		dev := &cfg.Devices[i]
		if !dev.IsEnabled() {
			continue
		}
		timeout := time.Duration(dev.Timeout()) * time.Millisecond
		var p *Poller
		switch dev.Protocol {
		case config.ProtocolTCP, config.ProtocolRTUOverTCP:
			tr := modbus.TransportTCP
			if dev.Protocol == config.ProtocolRTUOverTCP {
				tr = modbus.TransportRTUOverTCP
			}
			addr := dev.Params.Host + ":" + strconv.Itoa(dev.Params.Port)
			p = newPoller(dev.Name+" ("+addr+")", modbus.Target{Transport: tr, Address: addr, Timeout: timeout, Retries: modbus.DefaultRetries})
			out = append(out, p)
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
	p.devices[dev.ID] = &devState{id: dev.ID, status: contracts.DeviceDisconnected, exceptions: map[byte][]time.Time{}}
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
		<-ctx.Done()
		return ctx.Err()
	}
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
		p.record(g, at, at.Sub(start), rerr)

		// Próximo prazo, sem fila acumulada: período perdido é pulado (overrun).
		g.next = g.next.Add(g.every)
		if g.next.Before(at) {
			p.mu.Lock()
			p.devices[g.deviceID].overruns++
			p.mu.Unlock()
			g.next = at.Add(g.every)
		}
		select {
		case out <- r:
		case <-ctx.Done():
			return ctx.Err()
		}
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

func (p *Poller) record(g *group, at time.Time, rtt time.Duration, err error) {
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
		return
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
