package poller

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
)

const (
	protoTCP    = config.ProtocolTCP
	protoRTUTCP = config.ProtocolRTUOverTCP
)

// netDev é um dispositivo de rede (modbus-tcp ou modbus-rtu-over-tcp) com um bloco
// HR 0–1 e uma tag uint16 em HR 0.
type netDev struct {
	protocol  string
	host      string
	port      int
	unit      int
	timeoutMS int
	pollMS    int
}

func netDevID(i int) string { return fmt.Sprintf("01a1599e-7f90-7b47-976d-2b40a6cb25%02x", i) }
func netTagID(i int) string { return fmt.Sprintf("01a159ab-0000-7000-8000-0000000002%02x", i) }

func netConfig(t *testing.T, devs ...netDev) *config.GatewayConfig {
	t.Helper()
	parts := make([]string, len(devs))
	for i, d := range devs {
		parts[i] = fmt.Sprintf(`{"id":"%s","name":"Escravo %d","protocol":"%s",
			"params":{"host":"%s","port":%d,"unit_id":%d,"timeout_ms":%d},
			"blocks":[{"area":"holding_register","start":0,"count":2,"poll_ms":%d}],
			"tags":[{"id":"%s","address":{"area":"holding_register","offset":0},"type":"uint16","role":"custom"}]}`,
			netDevID(i), i, d.protocol, d.host, d.port, d.unit, d.timeoutMS, d.pollMS, netTagID(i))
	}
	body := `{"config_version":1,"serial_buses":[],"devices":[` + strings.Join(parts, ",") +
		`],"machines":[],"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// unitsOf devolve o unit id de cada dispositivo do poller (pelos grupos de leitura).
func unitsOf(p *Poller) map[string]uint8 {
	out := map[string]uint8{}
	for _, g := range p.groups {
		out[g.deviceID] = g.unit
	}
	return out
}

// Escravos atrás do mesmo conversor RTU sobre TCP (host sem diferença de caixa e
// porta) ficam num poller só, com um alvo (um socket), o maior timeout deles e o unit
// id de cada um nos grupos; outra porta é outro conversor. Dispositivos Modbus TCP
// seguem com um poller cada, mesmo no mesmo host:porta.
func TestBuildGroupsRTUOverTCPByConverter(t *testing.T) {
	cfg := netConfig(t,
		netDev{protoRTUTCP, "conv-a.planta", 4001, 1, 300, 1000},
		netDev{protoTCP, "conv-a.planta", 502, 1, 500, 1000},
		netDev{protoRTUTCP, "CONV-A.Planta", 4001, 2, 800, 1000}, // mesmo conversor, outra caixa
		netDev{protoRTUTCP, "conv-a.planta", 4002, 1, 300, 1000}, // outra porta: outro conversor
		netDev{protoTCP, "conv-a.planta", 502, 2, 500, 1000},
	)
	ps, err := Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 4 {
		names := make([]string, len(ps))
		for i, p := range ps {
			names[i] = p.Name
		}
		t.Fatalf("pollers: %d %q; quer 4 (um conversor com 2 escravos, outro com 1, 2 Modbus TCP)", len(ps), names)
	}
	conv := ps[0]
	want := modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: "conv-a.planta:4001", Timeout: 800 * time.Millisecond, Retries: modbus.DefaultRetries}
	if conv.Name != "rtu-tcp conv-a.planta:4001" || conv.target != want {
		t.Fatalf("conversor: %q %s timeout %v retries %d pausa %v; quer %s timeout %v retries %d", conv.Name, conv.target,
			conv.target.Timeout, conv.target.Retries, conv.target.TurnaroundDelay, want, want.Timeout, want.Retries)
	}
	if u := unitsOf(conv); len(conv.devices) != 2 || len(u) != 2 || u[netDevID(0)] != 1 || u[netDevID(2)] != 2 {
		t.Fatalf("escravos do conversor: %d dispositivos, units %v", len(conv.devices), u)
	}
	other := ps[2]
	if other.target.Transport != modbus.TransportRTUOverTCP || other.target.Address != "conv-a.planta:4002" ||
		other.target.Timeout != 300*time.Millisecond || len(other.devices) != 1 || other.devices[netDevID(3)] == nil {
		t.Fatalf("conversor da porta 4002: %+v (%d dispositivos)", other.target, len(other.devices))
	}
	for _, c := range []struct {
		p    *Poller
		dev  int
		unit uint8
	}{{ps[1], 1, 1}, {ps[3], 4, 2}} {
		if c.p.target.Transport != modbus.TransportTCP || c.p.target.Address != "conv-a.planta:502" ||
			len(c.p.devices) != 1 || unitsOf(c.p)[netDevID(c.dev)] != c.unit {
			t.Fatalf("Modbus TCP %d: %q %+v units %v", c.dev, c.p.Name, c.p.target, unitsOf(c.p))
		}
	}
}

// O prazo do laço de um conversor cobre todos os escravos: o maior poll entre os
// grupos de todos e o maior timeout (o do alvo).
func TestLivenessBoundRTUOverTCPCoversAllSlaves(t *testing.T) {
	p := onePoller(t, netConfig(t,
		netDev{protoRTUTCP, "10.0.0.9", 4001, 1, 100, 10_000},
		netDev{protoRTUTCP, "10.0.0.9", 4001, 2, 5000, 100},
	))
	// Poll de um, timeout do outro: 3 × (10 s + 2 × 5 s + 2 × (2 s + 6 × 5 s)) = 252 s.
	if b := p.LivenessBound(); b != 252*time.Second {
		t.Fatalf("prazo %v, quer 252s", b)
	}
}

// conversor é um conversor serial↔Ethernet transparente falso: aceita várias
// conexões, mas atrás dele há uma linha RS-485 só. Cada requisição ocupa a linha
// enquanto o escravo responde (ou o conversor desiste do escravo ausente); requisição
// que chega com a linha ocupada é colisão. O escravo n responde n×1000 + endereço em
// cada holding register.
type conversor struct {
	ln       net.Listener
	resposta time.Duration
	ausentes map[byte]bool

	linha    atomic.Int64 // requisições em curso na linha
	colisoes atomic.Int64
	conexoes atomic.Int64

	mu    sync.Mutex
	conns []net.Conn
	wg    sync.WaitGroup
}

func startConversor(t *testing.T, resposta time.Duration, ausentes ...byte) *conversor {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	c := &conversor{ln: ln, resposta: resposta, ausentes: map[byte]bool{}}
	for _, u := range ausentes {
		c.ausentes[u] = true
	}
	c.wg.Add(1)
	go c.accept()
	t.Cleanup(c.close)
	return c
}

func (c *conversor) hostPort(t *testing.T) (string, int) {
	t.Helper()
	host, port, _ := strings.Cut(c.ln.Addr().String(), ":")
	n, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	return host, n
}

func (c *conversor) accept() {
	defer c.wg.Done()
	for {
		conn, err := c.ln.Accept()
		if err != nil {
			return
		}
		c.conexoes.Add(1)
		c.mu.Lock()
		c.conns = append(c.conns, conn)
		c.mu.Unlock()
		c.wg.Add(1)
		go func() {
			defer c.wg.Done()
			defer conn.Close()
			c.serve(conn)
		}()
	}
}

func (c *conversor) serve(conn net.Conn) {
	req := make([]byte, 8)
	for {
		if _, err := io.ReadFull(conn, req); err != nil {
			return
		}
		if mbtest.CRC16(req[:6]) != binary.LittleEndian.Uint16(req[6:]) {
			return // fluxo desalinhado: não acontece numa conversa limpa
		}
		if c.linha.Add(1) > 1 {
			c.colisoes.Add(1)
		}
		time.Sleep(c.resposta)
		c.linha.Add(-1) // linha livre a partir da resposta (ou da desistência)
		unit, fc := req[0], req[1]
		addr, qty := binary.BigEndian.Uint16(req[2:]), binary.BigEndian.Uint16(req[4:])
		if c.ausentes[unit] {
			continue
		}
		out := []byte{unit, fc | 0x80, 1} // função não suportada
		if fc == 0x03 {
			out = []byte{unit, fc, byte(2 * qty)}
			for i := uint16(0); i < qty; i++ {
				out = binary.BigEndian.AppendUint16(out, uint16(unit)*1000+addr+i)
			}
		}
		out = binary.LittleEndian.AppendUint16(out, mbtest.CRC16(out))
		if _, err := conn.Write(out); err != nil {
			return
		}
	}
}

func (c *conversor) close() {
	_ = c.ln.Close()
	c.mu.Lock()
	for _, conn := range c.conns {
		_ = conn.Close()
	}
	c.mu.Unlock()
	c.wg.Wait()
}

// runAll roda os pollers até o fim do teste, com as leituras de todos em out.
func runAll(t *testing.T, ps []*Poller, out chan<- Reading) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, len(ps))
	for _, p := range ps {
		go func() { done <- p.Run(ctx, out) }()
	}
	t.Cleanup(func() {
		cancel()
		for range ps {
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Errorf("Run: %v", err)
			}
		}
	})
}

// Dois escravos atrás de um conversor RTU sobre TCP: as leituras dos dois saem por um
// socket só, uma de cada vez (nenhuma requisição chega com a linha RS-485 ocupada), e
// cada leitura traz o valor do seu escravo.
func TestRTUOverTCPConverterOneRequestAtATime(t *testing.T) {
	conv := startConversor(t, 20*time.Millisecond)
	host, port := conv.hostPort(t)
	ps, err := Build(netConfig(t,
		netDev{protoRTUTCP, host, port, 1, 300, 100},
		netDev{protoRTUTCP, host, port, 2, 300, 100},
	), config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	out := make(chan Reading, 1024)
	runAll(t, ps, out)

	ok := map[string]int{}
	deadline := time.After(5 * time.Second)
	for ok[netDevID(0)] < 5 || ok[netDevID(1)] < 5 {
		select {
		case r := <-out:
			if r.Err != nil {
				t.Fatalf("leitura de %s: %v", r.DeviceID, r.Err)
			}
			want := int64(1000) // unit 1
			if r.DeviceID == netDevID(1) {
				want = 2000
			}
			if len(r.Samples) != 1 || r.Samples[0].Value.Int64() != want {
				t.Fatalf("leitura de %s com o valor de outro escravo: %+v, quer %d", r.DeviceID, r.Samples, want)
			}
			ok[r.DeviceID]++
		case <-deadline:
			t.Fatalf("leituras boas: %v", ok)
		}
	}
	if n := conv.colisoes.Load(); n != 0 {
		t.Fatalf("%d requisições chegaram com a linha RS-485 ocupada: escravos do mesmo conversor lidos em paralelo", n)
	}
	if n := conv.conexoes.Load(); n != 1 || len(ps) != 1 {
		t.Fatalf("%d conexões com o conversor, %d pollers; quer 1 de cada", n, len(ps))
	}
	for _, h := range ps[0].Health(time.Now()) {
		if h.Status != contracts.DeviceConnected || h.Errors1m != 0 {
			t.Fatalf("saúde de %s: %+v", h.ID, h)
		}
	}
}

// timedReader mede cada leitura em bloco, por unit id.
type timedReader struct {
	modbus.Reader
	mu      sync.Mutex
	longest map[uint8]time.Duration
}

func (r *timedReader) ReadBlock(ctx context.Context, unit uint8, s modbus.Span) (modbus.Raw, error) {
	start := time.Now()
	raw, err := r.Reader.ReadBlock(ctx, unit, s)
	d := time.Since(start)
	r.mu.Lock()
	r.longest[unit] = max(r.longest[unit], d)
	r.mu.Unlock()
	return raw, err
}

func (r *timedReader) longestRead(unit uint8) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.longest[unit]
}

// Escravo ausente atrás do conversor: depois de cada falha a linha fica quieta (para a
// resposta atrasada não ser lida como a da próxima requisição), e essa espera conta na
// leitura que falhou, não na do outro escravo, lida em seguida pelo mesmo socket. A
// latência e a saúde de cada um ficam com o seu dispositivo.
func TestRTUOverTCPConverterLatencyPerDevice(t *testing.T) {
	const timeout = 200 * time.Millisecond
	conv := startConversor(t, 5*time.Millisecond, 2) // unit 2 não responde
	host, port := conv.hostPort(t)
	p := onePoller(t, netConfig(t,
		netDev{protoRTUTCP, host, port, 1, int(timeout / time.Millisecond), 100},
		netDev{protoRTUTCP, host, port, 2, int(timeout / time.Millisecond), 100},
	))
	tr := &timedReader{longest: map[uint8]time.Duration{}}
	var opens atomic.Int64
	p.open = func(tg modbus.Target) (modbus.Reader, error) {
		opens.Add(1)
		r, err := modbus.Open(tg)
		tr.Reader = r
		return tr, err
	}
	out := make(chan Reading, 1024)
	runAll(t, []*Poller{p}, out)

	// Espera 2 falhas do unit 2 e uma leitura boa do unit 1 depois da última.
	fails, okAfter := 0, 0
	deadline := time.After(10 * time.Second)
	for fails < 2 || okAfter < 1 {
		select {
		case r := <-out:
			switch {
			case r.DeviceID == netDevID(1) && r.Err != nil:
				fails++
				okAfter = 0
			case r.DeviceID == netDevID(0) && r.Err == nil:
				okAfter++
			default:
				t.Fatalf("leitura inesperada de %s: %v", r.DeviceID, r.Err)
			}
		case <-deadline:
			t.Fatalf("falhas do unit 2: %d; leituras boas do unit 1 depois da última: %d", fails, okAfter)
		}
	}
	// A leitura que falhou inclui as 2 tentativas e a linha quieta depois de cada uma.
	if d := tr.longestRead(2); d < 3*timeout {
		t.Fatalf("leitura do unit ausente levou %v; quer ≥ %v (tentativas + linha quieta)", d, 3*timeout)
	}
	if d := tr.longestRead(1); d >= timeout/2 {
		t.Fatalf("leitura do unit 1 levou até %v: a espera da linha quieta depois da falha do unit 2 foi contada nela", d)
	}
	h := p.Health(time.Now())
	byID := map[string]contracts.DeviceHealth{}
	for _, x := range h {
		byID[x.ID] = x
	}
	good, bad := byID[netDevID(0)], byID[netDevID(1)]
	if good.Status != contracts.DeviceConnected || good.Errors1m != 0 || good.LatencyMS == nil || *good.LatencyMS >= int64(timeout/2/time.Millisecond) {
		t.Fatalf("saúde do unit 1: %+v (latência %v)", good, good.LatencyMS)
	}
	if bad.Status == contracts.DeviceConnected || bad.Timeouts1m == nil || *bad.Timeouts1m < 2 || bad.LatencyMS != nil {
		t.Fatalf("saúde do unit 2: %+v", bad)
	}
	if n := conv.colisoes.Load(); n != 0 || conv.conexoes.Load() != 1 || opens.Load() != 1 {
		t.Fatalf("colisões %d, conexões %d, aberturas %d; quer 0, 1 e 1", n, conv.conexoes.Load(), opens.Load())
	}
}
