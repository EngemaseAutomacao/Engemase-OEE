package poller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// cmdEvery limita os pedidos avulsos com a coleta atrasada: no máximo 1 a cada
// cmdEvery transações (docs/rascunhos/gateway-software.md §3.4). Com a coleta em dia
// (o laço dormindo até o próximo prazo), o pedido é atendido na hora.
const cmdEvery = 3

// ErrUnavailable é o pedido avulso que não entrou na fila do transporte dentro do
// prazo: o laço de leitura está parado (troca de config, reinício do poller depois
// de uma falha) ou ocupado demais.
var ErrUnavailable = errors.New("poller: transporte indisponível para leitura avulsa")

// request é um pedido avulso: uma leitura (span) ou o uso exclusivo da linha (exclusive).
type request struct {
	ctx       context.Context
	unit      uint8
	span      modbus.Span
	exclusive func(context.Context) error
	done      chan response
}

type response struct {
	raw modbus.Raw
	rtt time.Duration
	err error
}

// Read faz uma leitura avulsa (comando da nuvem, CLI, página local) pela fila deste
// transporte: no RS-485 e no conversor RTU sobre TCP, um mestre só; no Modbus TCP, a
// mesma conexão da coleta (sem abrir uma segunda num CLP que aceita poucas). A
// leitura não entra na saúde do dispositivo. O prazo é o do contexto: esperando a
// vez, devolve ErrUnavailable; depois de atendido, o resultado da leitura (o
// transporte tem o próprio timeout).
func (p *Poller) Read(ctx context.Context, unit uint8, s modbus.Span) (modbus.Raw, time.Duration, error) {
	r, err := p.submit(ctx, &request{ctx: ctx, unit: unit, span: s})
	return r.raw, r.rtt, err
}

// Exclusive solta a linha para fn (ex.: device.test em RTU com parâmetros seriais
// diferentes): o poller fecha o transporte (esperando a linha quieta), roda fn e
// reabre. fn tem de respeitar o contexto, que limita a pausa do barramento.
func (p *Poller) Exclusive(ctx context.Context, fn func(context.Context) error) error {
	_, err := p.submit(ctx, &request{ctx: ctx, exclusive: fn})
	return err
}

func (p *Poller) submit(ctx context.Context, r *request) (response, error) {
	r.done = make(chan response, 1)
	select {
	case p.reqs <- r:
	case <-ctx.Done():
		return response{}, fmt.Errorf("%w (%s): %v", ErrUnavailable, p.Name, ctx.Err())
	}
	// Atendido: o laço responde sempre (a leitura termina pelo timeout do transporte).
	resp := <-r.done
	return resp, resp.err
}

// serve atende um pedido avulso na goroutine de Run. Devolve o Reader a usar dali em
// diante (Exclusive reabre o transporte); erro só se não der para reabrir.
func (p *Poller) serve(reader modbus.Reader, r *request) (modbus.Reader, error) {
	p.sinceCmd = 0
	if err := r.ctx.Err(); err != nil {
		r.done <- response{err: err}
		return reader, nil
	}
	if r.exclusive != nil {
		if len(p.groups) > 0 {
			p.beat(p.now()) // o Close espera a linha quieta: conta a partir daqui
		}
		if reader != nil {
			_ = reader.Close()
		}
		r.done <- response{err: r.exclusive(r.ctx)}
		if len(p.groups) > 0 {
			p.beat(p.now())
		}
		nr, err := p.open(p.target)
		if err != nil {
			return nil, fmt.Errorf("%s: reabrindo depois do uso exclusivo: %w", p.Name, err)
		}
		return nr, nil
	}
	if reader == nil {
		nr, err := p.open(p.target)
		if err != nil {
			r.done <- response{err: err}
			return nil, nil
		}
		reader = nr
	}
	start := p.now()
	raw, err := reader.ReadBlock(r.ctx, r.unit, r.span)
	at := p.now()
	if len(p.groups) > 0 {
		p.beat(at)
	}
	r.done <- response{raw: raw, rtt: at.Sub(start), err: err}
	return reader, nil
}

// runIdle é o Run de um transporte sem nada a coletar (dispositivo sem tags): só
// atende pedidos avulsos, com o transporte aberto na primeira vez.
func (p *Poller) runIdle(ctx context.Context) error {
	var reader modbus.Reader
	defer func() {
		if reader != nil {
			_ = reader.Close()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case r := <-p.reqs:
			var err error
			if reader, err = p.serve(reader, r); err != nil {
				return err
			}
		}
	}
}

// Key é a chave do transporte deste poller (TransportKey).
func (p *Poller) Key() string { return p.key }

// Target devolve o alvo do transporte (com o maior timeout dos escravos).
func (p *Poller) Target() modbus.Target { return p.target }

// HasDevice diz se o dispositivo é lido por este poller.
func (p *Poller) HasDevice(id string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, ok := p.devices[id]
	return ok
}

// TransportKey identifica a linha física ou lógica de um alvo: o caminho da porta
// serial no RTU, o host:porta (sem diferença de caixa no host) no Modbus TCP e no RTU
// sobre TCP. Dois alvos com a mesma chave disputam a mesma linha.
func TransportKey(t modbus.Target) string {
	if t.Transport == modbus.TransportRTU {
		return string(t.Transport) + ":" + t.Address
	}
	return string(t.Transport) + ":" + strings.ToLower(t.Address)
}

// SameSerial diz se dois alvos RTU usam os mesmos parâmetros seriais.
func SameSerial(a, b modbus.Target) bool {
	return a.Baud == b.Baud && a.Parity == b.Parity && a.DataBits == b.DataBits && a.StopBits == b.StopBits
}

// Registry guarda os pollers da config em execução, para as leituras avulsas
// acharem o dono de cada transporte. Seguro entre goroutines.
type Registry struct {
	mu       sync.RWMutex
	byKey    map[string]*Poller
	byDevice map[string]*Poller
}

// Set troca os pollers registrados (nil: nenhum, entre uma config e outra).
func (r *Registry) Set(ps []*Poller) {
	byKey, byDevice := map[string]*Poller{}, map[string]*Poller{}
	for _, p := range ps {
		byKey[p.key] = p
		p.mu.Lock()
		for id := range p.devices {
			byDevice[id] = p
		}
		p.mu.Unlock()
	}
	r.mu.Lock()
	r.byKey, r.byDevice = byKey, byDevice
	r.mu.Unlock()
}

// ByKey devolve o poller dono do transporte (nil: nenhum).
func (r *Registry) ByKey(key string) *Poller {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.byKey[key]
}

// ByDevice devolve o poller que lê o dispositivo (nil: nenhum).
func (r *Registry) ByDevice(id string) *Poller {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.byDevice[id]
}
