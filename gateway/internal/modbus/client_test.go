package modbus_test

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
)

func startServer(t *testing.T, f mbtest.Framing) *mbtest.Server {
	t.Helper()
	srv, err := mbtest.Start(f)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func TestTCPReadBlockAndDecode(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	srv.SetHolding(1000, 1, 42, 1, 0, cnt[0], cnt[1])
	srv.Coils[3] = true

	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: srv.Addr()})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()

	raw, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.HoldingRegister, Start: 1000, Count: 14})
	if err != nil {
		t.Fatal(err)
	}
	v, err := raw.Decode(modbus.TagSpec{Area: modbus.HoldingRegister, Offset: 1004, Bit: -1, Type: modbus.Uint32, WordOrder: modbus.CDAB})
	if err != nil || v.Int64() != 100000 {
		t.Fatalf("contador = %v (%v)", v, err)
	}

	bits, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.Coil, Start: 0, Count: 10})
	if err != nil || len(bits.Bits) != 10 || !bits.Bits[3] || bits.Bits[2] {
		t.Fatalf("coils = %v (%v)", bits.Bits, err)
	}

	// A conexão é persistente: duas leituras, uma conexão (o servidor só conta requisições).
	if srv.RequestCount() != 2 {
		t.Fatalf("requisições = %d", srv.RequestCount())
	}
}

func TestExceptionIsClassified(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	r, _ := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: srv.Addr()})
	defer r.Close()

	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 2040, Count: 20})
	var exc *modbus.ExceptionError
	if !errors.As(err, &exc) || exc.Code != 2 {
		t.Fatalf("esperava exceção 02, veio %v", err)
	}
	// Exceção não é repetida.
	if srv.RequestCount() != 1 {
		t.Fatalf("requisições = %d (exceção não deve ser repetida)", srv.RequestCount())
	}
}

func TestTimeoutIsShortAndRetriedOnce(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	srv.SetDelay(400 * time.Millisecond)
	r, _ := modbus.Open(modbus.Target{
		Transport: modbus.TransportTCP, Address: srv.Addr(),
		Timeout: 100 * time.Millisecond, Retries: 1,
	})
	defer r.Close()

	start := time.Now()
	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 1})
	if !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("esperava ErrTimeout, veio %v", err)
	}
	if el := time.Since(start); el > 1500*time.Millisecond {
		t.Fatalf("timeout demorou %v", el)
	}
}

func TestConnectionRefused(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	addr := srv.Addr()
	_ = srv.Close()
	r, _ := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: addr, Retries: 0})
	defer r.Close()
	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 1})
	if !errors.Is(err, modbus.ErrConnRefused) {
		t.Fatalf("esperava ErrConnRefused, veio %v", err)
	}
}

func TestRTUOverTCPWithSeveralUnits(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.Units = map[uint8]bool{1: true, 2: true}
	srv.Input[16] = 7

	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: srv.Addr(), Timeout: 150 * time.Millisecond, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	for _, unit := range []uint8{1, 2} {
		raw, err := r.ReadBlock(ctx, unit, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 2})
		if err != nil || raw.Regs[0] != 7 {
			t.Fatalf("unit %d: %v (%v)", unit, raw.Regs, err)
		}
	}
	// Escravo ausente: timeout curto, sem travar os outros.
	if _, err := r.ReadBlock(ctx, 3, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 1}); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("unit 3 ausente: esperava timeout, veio %v", err)
	}
	if _, err := r.ReadBlock(ctx, 0, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 1}); err == nil {
		t.Fatal("unit id 0 (broadcast) nunca deve ser lido em RTU")
	}
}

func TestParseTarget(t *testing.T) {
	cases := []struct {
		in      string
		want    modbus.Target
		wantErr bool
	}{
		{in: "tcp://192.168.10.23", want: modbus.Target{Transport: modbus.TransportTCP, Address: "192.168.10.23:502", Retries: 1}},
		{in: "tcp://plc.local:1502?timeout_ms=800", want: modbus.Target{Transport: modbus.TransportTCP, Address: "plc.local:1502", Retries: 1, Timeout: 800 * time.Millisecond}},
		{in: "rtu+tcp://10.0.0.5:4001", want: modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: "10.0.0.5:4001", Retries: 1}},
		{in: "rtu:///dev/ttyUSB0?baud=9600&parity=N&stop_bits=2", want: modbus.Target{Transport: modbus.TransportRTU, Address: "/dev/ttyUSB0", Baud: 9600, Parity: "N", DataBits: 8, StopBits: 2, Retries: 1}},
		{in: "rtu:///dev/ttyAMA2", want: modbus.Target{Transport: modbus.TransportRTU, Address: "/dev/ttyAMA2", Baud: 19200, Parity: "E", DataBits: 8, StopBits: 1, Retries: 1}},
		{in: "rtu:///dev/ttyUSB0?data_bits=7", wantErr: true},
		{in: "rtu:///dev/ttyUSB0?parity=X", wantErr: true},
		{in: "udp://1.2.3.4", wantErr: true},
		{in: "tcp://", wantErr: true},
		{in: "tcp://1.2.3.4?timeout_ms=5", wantErr: true},
	}
	for _, c := range cases {
		got, err := modbus.ParseTarget(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("%s: esperava erro", c.in)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s: got %+v (%v), quer %+v", c.in, got, err, c.want)
		}
	}
}

// lerHR lê um holding register do unit 1.
func lerHR(r modbus.Reader, offset uint16) (uint16, error) {
	raw, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: offset, Count: 1})
	if err != nil {
		return 0, err
	}
	return raw.Regs[0], nil
}

// proxyTCP fica entre o cliente e o mbtest.Server, no papel do conversor
// serial↔Ethernet (ou do switch): conta as conexões aceitas e derruba todas de uma
// vez, como num reinício do conversor, sem parar de aceitar novas.
type proxyTCP struct {
	ln      net.Listener
	backend string
	mu      sync.Mutex
	conns   []net.Conn
	aceitas int
	wg      sync.WaitGroup
}

func startProxy(t *testing.T, backend string) *proxyTCP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &proxyTCP{ln: ln, backend: backend}
	p.wg.Add(1)
	go p.accept()
	t.Cleanup(func() {
		_ = ln.Close()
		p.derrubar()
		p.wg.Wait()
	})
	return p
}

func (p *proxyTCP) Addr() string { return p.ln.Addr().String() }

func (p *proxyTCP) accept() {
	defer p.wg.Done()
	for {
		c, err := p.ln.Accept()
		if err != nil {
			return
		}
		b, err := net.Dial("tcp", p.backend)
		if err != nil {
			_ = c.Close()
			continue
		}
		p.mu.Lock()
		p.aceitas++
		p.conns = append(p.conns, c, b)
		p.mu.Unlock()
		p.wg.Add(2)
		go func() { defer p.wg.Done(); _, _ = io.Copy(b, c); _ = b.Close() }()
		go func() { defer p.wg.Done(); _, _ = io.Copy(c, b); _ = c.Close() }()
	}
}

// derrubar fecha todas as conexões abertas; o listener continua aceitando.
func (p *proxyTCP) derrubar() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.conns {
		_ = c.Close()
	}
	p.conns = nil
}

func (p *proxyTCP) Aceitas() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.aceitas
}

// RTU sobre TCP não tem id de transação: depois de um timeout, a resposta atrasada
// fica no socket e era aceita como resposta da PRÓXIMA requisição de mesma função e
// tamanho (a leitura do HR200 devolvia o valor do HR100). O cliente tem de descartar
// a conexão no timeout para que o quadro atrasado se perca.
func TestRTUOverTCPDescartaRespostaAtrasadaAposTimeout(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.SetHolding(100, 111)
	srv.SetHolding(200, 222)
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: srv.Addr(), Timeout: 100 * time.Millisecond, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	srv.SetDelay(300 * time.Millisecond)
	if _, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("esperava ErrTimeout na leitura lenta, veio %v", err)
	}
	srv.SetDelay(0)
	time.Sleep(350 * time.Millisecond) // a resposta atrasada do HR100 já saiu do escravo

	v, err := lerHR(r, 200)
	if err != nil {
		t.Fatalf("HR200 depois do timeout: %v", err)
	}
	if v != 222 {
		t.Fatalf("HR200 = %d, quer 222 (111 é a resposta atrasada do HR100)", v)
	}
}

// Quando o conversor serial↔Ethernet reinicia, o socket antigo morre ("broken pipe",
// EOF). A biblioteca não fecha o socket em erro no RTU sobre TCP e o agente usa
// IdleTimeout=-1: sem o Close no erro o dispositivo ficava em NO_COMM até reiniciar o
// agente. A leitura seguinte tem de discar de novo.
func TestRTUOverTCPReconectaAposConversorReiniciar(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.SetHolding(100, 111)
	px := startProxy(t, srv.Addr())
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: px.Addr(), Timeout: 200 * time.Millisecond, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	px.derrubar() // conversor reiniciou: a conexão TCP antiga morreu
	srv.SetHolding(100, 333)
	var (
		v    uint16
		lerr error
		ok   bool
	)
	for i := 0; i < 5 && !ok; i++ {
		v, lerr = lerHR(r, 100)
		ok = lerr == nil && v == 333
		if !ok {
			time.Sleep(20 * time.Millisecond)
		}
	}
	if !ok {
		t.Fatalf("não reconectou depois do reinício do conversor: último resultado %d (%v)", v, lerr)
	}
	if n := px.Aceitas(); n != 2 {
		t.Fatalf("conexões aceitas = %d, quer 2 (a original e a nova)", n)
	}
}

// Modbus TCP: o escravo responde depois do timeout e a repetição (Retries=1) lê o
// quadro atrasado. Com ProtocolRecoveryTimeout=0 a biblioteca acusava "response stream
// out of sync" e derrubava a conexão; o certo é descartar o quadro atrasado pelo id de
// transação, relatar timeout limpo e manter a conexão.
func TestTCPRepeticaoDescartaRespostaAtrasadaEMantemConexao(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	srv.SetHolding(100, 111)
	px := startProxy(t, srv.Addr())
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: px.Addr(), Timeout: 200 * time.Millisecond, Retries: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	// 1ª tentativa expira em 200 ms; a resposta dela chega aos 300 ms, durante a 2ª.
	srv.SetDelay(300 * time.Millisecond)
	if _, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("esperava ErrTimeout (quadro atrasado descartado), veio %v", err)
	}
	srv.SetDelay(0)
	time.Sleep(400 * time.Millisecond)

	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura seguinte: %d (%v)", v, err)
	}
	if n := px.Aceitas(); n != 1 {
		t.Fatalf("conexões aceitas = %d, quer 1 (a conexão deve sobreviver ao quadro atrasado)", n)
	}
}
