package poller

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// cmdSpan é a faixa das leituras avulsas nos testes (a coleta lê HR 1000).
var cmdSpan = modbus.Span{Area: modbus.HoldingRegister, Start: 5000, Count: 2}

// Read usa o transporte da coleta (um Reader só, aberto uma vez) e devolve a leitura.
func TestReadUsesTheCollectorTransport(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 200))
	var opens atomic.Int64
	p.open = func(modbus.Target) (modbus.Reader, error) {
		opens.Add(1)
		return &fakeReader{read: func(_ context.Context, s modbus.Span) (modbus.Raw, error) {
			raw := okRaw(s)
			if s.Start == cmdSpan.Start {
				raw.Regs[0], raw.Regs[1] = 7, 8
			}
			return raw, nil
		}}, nil
	}
	runPoller(t, p)
	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		raw, _, err := p.Read(ctx, 1, cmdSpan)
		cancel()
		if err != nil || raw.Regs[0] != 7 || raw.Regs[1] != 8 {
			t.Fatalf("leitura avulsa: %+v (%v)", raw, err)
		}
	}
	if n := opens.Load(); n != 1 {
		t.Fatalf("transporte aberto %d vezes; a leitura avulsa não abre outro", n)
	}
}

// Pedidos avulsos em rajada, com leituras mais lentas que o poll: cada pedido que
// ocupa a linha além do próximo prazo deixa a coleta atrasada, e a leitura da coleta
// vem antes do pedido seguinte (nunca dois avulsos seguidos). A coleta não para.
func TestReadDoesNotStarvePolling(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	var mu sync.Mutex
	var seq []string
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(_ context.Context, s modbus.Span) (modbus.Raw, error) {
			time.Sleep(110 * time.Millisecond) // a coleta está sempre atrasada
			mu.Lock()
			if s.Start == cmdSpan.Start {
				seq = append(seq, "cmd")
			} else {
				seq = append(seq, "poll")
			}
			mu.Unlock()
			return okRaw(s), nil
		}}, nil
	}
	runPoller(t, p)
	time.Sleep(250 * time.Millisecond)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, _, err := p.Read(ctx, 1, cmdSpan); err != nil {
				t.Errorf("leitura avulsa: %v", err)
			}
		}()
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	cmds := 0
	for i, s := range seq {
		if s != "cmd" {
			continue
		}
		cmds++
		if i > 0 && seq[i-1] == "cmd" {
			t.Fatalf("pedidos avulsos seguidos com a coleta atrasada: %v", seq)
		}
	}
	if cmds != 4 {
		t.Fatalf("pedidos atendidos: %d (%v)", cmds, seq)
	}
}

// Exclusive fecha o transporte, roda a função e o reabre; a coleta continua depois.
func TestExclusiveReleasesTheLine(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	var opens, closes, reads atomic.Int64
	open := atomic.Bool{}
	p.open = func(modbus.Target) (modbus.Reader, error) {
		opens.Add(1)
		open.Store(true)
		return &closingReader{fakeReader: fakeReader{read: func(_ context.Context, s modbus.Span) (modbus.Raw, error) {
			reads.Add(1)
			return okRaw(s), nil
		}}, onClose: func() { closes.Add(1); open.Store(false) }}, nil
	}
	runPoller(t, p)
	time.Sleep(150 * time.Millisecond)
	ran := false
	err := p.Exclusive(context.Background(), func(context.Context) error {
		ran = true
		if open.Load() {
			t.Error("a função rodou com o transporte da coleta aberto")
		}
		return nil
	})
	if err != nil || !ran || opens.Load() != 2 || closes.Load() != 1 {
		t.Fatalf("exclusive: err=%v ran=%v opens=%d closes=%d", err, ran, opens.Load(), closes.Load())
	}
	before := reads.Load()
	time.Sleep(300 * time.Millisecond)
	if reads.Load() <= before {
		t.Fatal("a coleta não voltou depois do uso exclusivo")
	}
}

type closingReader struct {
	fakeReader
	onClose func()
}

func (c *closingReader) Close() error { c.onClose(); return nil }

// Sem o laço rodando (troca de config), o pedido avulso termina no prazo dele.
func TestReadOnStoppedPoller(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, _, err := p.Read(ctx, 1, cmdSpan); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("esperava ErrUnavailable: %v", err)
	}
}

func TestRegistry(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	var r Registry
	if r.ByKey(p.Key()) != nil || r.ByDevice(devID) != nil {
		t.Fatal("registro vazio")
	}
	r.Set([]*Poller{p})
	if r.ByKey("tcp:127.0.0.1:1502") != p || r.ByDevice(devID) != p || !p.HasDevice(devID) {
		t.Fatalf("chave %q", p.Key())
	}
	if TransportKey(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: "CONV.local:4001"}) != "rtu+tcp:conv.local:4001" ||
		TransportKey(modbus.Target{Transport: modbus.TransportRTU, Address: "/dev/ttyAMA2"}) != "rtu:/dev/ttyAMA2" {
		t.Fatal("chaves de transporte")
	}
	r.Set(nil)
	if r.ByKey(p.Key()) != nil {
		t.Fatal("registro deveria esvaziar")
	}
}
