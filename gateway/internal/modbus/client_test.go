package modbus_test

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	mb "github.com/grid-x/modbus"

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
// o que chegar no socket (escoar a linha) antes da próxima requisição.
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
// IdleTimeout=-1: sem fechar o socket morto o dispositivo ficava em NO_COMM até
// reiniciar o agente. A leitura seguinte tem de perceber isso e discar de novo.
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

// conversorSerial imita um conversor serial↔Ethernet transparente de verdade: UMA
// linha serial (aqui, uma conexão persistente com o mbtest.Server em modo RTU)
// compartilhada pelas conexões TCP que chegam. O lado serial não fecha quando o
// cliente TCP sai, e o que o escravo responde vai para o cliente conectado naquele
// instante, inclusive a resposta atrasada de uma requisição feita numa conexão
// anterior. O escravo atende uma requisição por vez, como no RS-485.
type conversorSerial struct {
	ln      net.Listener
	linha   net.Conn
	mu      sync.Mutex
	atual   net.Conn
	conns   []net.Conn
	aceitas int
	wg      sync.WaitGroup
}

func startConversor(t *testing.T, escravo string) *conversorSerial {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	linha, err := net.Dial("tcp", escravo)
	if err != nil {
		_ = ln.Close()
		t.Fatal(err)
	}
	cv := &conversorSerial{ln: ln, linha: linha}
	cv.wg.Add(2)
	go func() { // linha → cliente atual
		defer cv.wg.Done()
		buf := make([]byte, 256)
		for {
			n, err := linha.Read(buf)
			if err != nil {
				return
			}
			cv.mu.Lock()
			c := cv.atual
			cv.mu.Unlock()
			if c != nil {
				_, _ = c.Write(buf[:n])
			}
		}
	}()
	go func() {
		defer cv.wg.Done()
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			cv.mu.Lock()
			cv.atual = c
			cv.conns = append(cv.conns, c)
			cv.aceitas++
			cv.mu.Unlock()
			cv.wg.Add(1)
			go func() { defer cv.wg.Done(); _, _ = io.Copy(linha, c) }() // cliente → linha
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		_ = linha.Close()
		cv.mu.Lock()
		for _, c := range cv.conns {
			_ = c.Close()
		}
		cv.mu.Unlock()
		cv.wg.Wait()
	})
	return cv
}

func (cv *conversorSerial) Addr() string { return cv.ln.Addr().String() }

func (cv *conversorSerial) Aceitas() int {
	cv.mu.Lock()
	defer cv.mu.Unlock()
	return cv.aceitas
}

// lerAlternado faz n leituras seguidas de HR200 e HR100, sem pausa entre elas (o
// poller passa direto ao próximo grupo vencido), e conta as que voltaram com o valor
// de OUTRO endereço (resposta atrasada aceita no lugar da certa). O escravo guarda
// HR100=111 e HR200=222.
func lerAlternado(r modbus.Reader, n int) (certas, trocadas, falhas int, ultimoErr error) {
	for i := 0; i < n; i++ {
		off, quer := uint16(200), uint16(222)
		if i%2 == 1 {
			off, quer = 100, 111
		}
		v, err := lerHR(r, off)
		switch {
		case err != nil:
			falhas++
			ultimoErr = err
		case v == quer:
			certas++
		default:
			trocadas++
		}
	}
	return
}

// Com Retries=1 (o padrão do poller) a repetição sai logo depois do timeout. Fechar e
// rediscar não basta num conversor de verdade: a resposta atrasada da 1ª tentativa
// ainda está na linha, chega pela conexão nova e era aceita como resposta da
// repetição; a resposta da repetição ficava na fila e cada leitura seguinte devolvia
// o valor da anterior (HR200 → 111, HR100 → 222). Depois de um erro a linha tem de
// ficar quieta (o que chega é descartado) antes da próxima requisição.
func TestRTUOverTCPPicoDeLatenciaNaoDesalinhaRespostas(t *testing.T) {
	for _, retries := range []int{0, modbus.DefaultRetries} {
		t.Run(fmt.Sprintf("retries=%d", retries), func(t *testing.T) {
			srv := startServer(t, mbtest.RTU)
			srv.SetHolding(100, 111)
			srv.SetHolding(200, 222)
			cv := startConversor(t, srv.Addr())
			r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(), Timeout: 100 * time.Millisecond, Retries: retries})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			if v, err := lerHR(r, 100); err != nil || v != 111 {
				t.Fatalf("leitura inicial: %d (%v)", v, err)
			}

			srv.SetDelay(150 * time.Millisecond) // um pico: responde 50 ms depois do timeout
			if v, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
				t.Fatalf("leitura lenta: esperava ErrTimeout, veio %d (%v)", v, err)
			}
			srv.SetDelay(0)

			if certas, trocadas, falhas, ultimo := lerAlternado(r, 8); certas != 8 {
				t.Fatalf("depois do pico: %d certas, %d com valor de outro endereço, %d falhas (último erro %v); quer 8 certas", certas, trocadas, falhas, ultimo)
			}
			if n := cv.Aceitas(); n != 1 {
				t.Fatalf("conexões aceitas = %d, quer 1 (timeout não derruba a conexão com o conversor)", n)
			}
		})
	}
}

// Escravo sempre mais lento que o timeout (timeout_ms mal configurado): as leituras
// podem falhar, mas nunca devolver o valor de outro endereço.
func TestRTUOverTCPEscravoLentoNuncaDevolveValorDeOutroEndereco(t *testing.T) {
	for _, retries := range []int{0, modbus.DefaultRetries} {
		t.Run(fmt.Sprintf("retries=%d", retries), func(t *testing.T) {
			srv := startServer(t, mbtest.RTU)
			srv.SetHolding(100, 111)
			srv.SetHolding(200, 222)
			cv := startConversor(t, srv.Addr())
			r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(), Timeout: 100 * time.Millisecond, Retries: retries})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			if v, err := lerHR(r, 100); err != nil || v != 111 {
				t.Fatalf("leitura inicial: %d (%v)", v, err)
			}
			srv.SetDelay(150 * time.Millisecond)
			if _, trocadas, _, _ := lerAlternado(r, 4); trocadas != 0 {
				t.Fatalf("%d leituras devolveram o valor de outro endereço", trocadas)
			}
		})
	}
}

// Unit ausente atrás do conversor: os timeouts dele não podem custar uma conexão nova
// por tentativa (conversores aceitam poucos clientes e discam devagar).
func TestRTUOverTCPUnitAusenteNaoReconecta(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.Units = map[uint8]bool{1: true}
	srv.SetHolding(100, 111)
	px := startProxy(t, srv.Addr())
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: px.Addr(), Timeout: 80 * time.Millisecond, Retries: modbus.DefaultRetries})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for i := 0; i < 3; i++ {
		if _, err := r.ReadBlock(context.Background(), 2, modbus.Span{Area: modbus.HoldingRegister, Start: 100, Count: 1}); !errors.Is(err, modbus.ErrTimeout) {
			t.Fatalf("unit 2 ausente: esperava ErrTimeout, veio %v", err)
		}
		if v, err := lerHR(r, 100); err != nil || v != 111 {
			t.Fatalf("unit 1: %d (%v)", v, err)
		}
	}
	if n := px.Aceitas(); n != 1 {
		t.Fatalf("conexões aceitas = %d, quer 1", n)
	}
}

// quadroRTU monta um quadro RTU com CRC.
func quadroRTU(unit, fc byte, dados ...byte) []byte {
	q := append([]byte{unit, fc}, dados...)
	return binary.LittleEndian.AppendUint16(q, mbtest.CRC16(q))
}

// escravoRoteiro é um escravo RTU sobre TCP que responde cada requisição (em ordem,
// n começa em 0) com o que o roteiro escrever. Serve para injetar quadros válidos,
// com CRC certo, que não são a resposta da requisição.
func startEscravoRoteiro(t *testing.T, roteiro func(n int, req []byte, escrever func(atraso time.Duration, quadro []byte))) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		conns []net.Conn
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		n := 0
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
			for {
				req := make([]byte, 8)
				if _, err := io.ReadFull(c, req); err != nil {
					break
				}
				roteiro(n, req, func(atraso time.Duration, quadro []byte) {
					time.Sleep(atraso)
					_, _ = c.Write(quadro)
				})
				n++
			}
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		mu.Lock()
		for _, c := range conns {
			_ = c.Close()
		}
		mu.Unlock()
		wg.Wait()
	})
	return ln.Addr().String()
}

// respostaHR responde FC03 de 1 registrador com o valor do mapa.
func respostaHR(req []byte, valores map[uint16]uint16) []byte {
	v := valores[binary.BigEndian.Uint16(req[2:])]
	return quadroRTU(req[0], 0x03, 2, byte(v>>8), byte(v))
}

// A grid-x devolve *mb.Error para QUALQUER função diferente da pedida, inclusive um
// quadro normal de outra função (ou a exceção de outra função), que é como chega uma
// resposta atrasada de outra leitura. Isso era classificado como exceção do escravo:
// a conexão ficava, a resposta certa seguia na fila e era lida pela próxima
// requisição, e o contador de exceções do dispositivo ganhava exceções falsas.
func TestRTUOverTCPQuadroDeOutraFuncaoNaoEExcecao(t *testing.T) {
	casos := []struct {
		nome    string
		intruso []byte
	}{
		{"resposta normal da função 04", quadroRTU(1, 0x04, 2, 0x01, 0xBC)},
		{"exceção da função 04", quadroRTU(1, 0x84, 0x02)},
	}
	valores := map[uint16]uint16{100: 111, 200: 222}
	for _, cs := range casos {
		t.Run(cs.nome, func(t *testing.T) {
			addr := startEscravoRoteiro(t, func(n int, req []byte, escrever func(time.Duration, []byte)) {
				if n == 0 { // quadro intruso e, 30 ms depois, a resposta certa
					escrever(0, cs.intruso)
					escrever(30*time.Millisecond, respostaHR(req, valores))
					return
				}
				escrever(0, respostaHR(req, valores))
			})
			r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr, Timeout: 100 * time.Millisecond, Retries: 0})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()

			_, err = lerHR(r, 100)
			var exc *modbus.ExceptionError
			if err == nil || errors.As(err, &exc) {
				t.Fatalf("quadro de outra função: esperava erro de fluxo desalinhado, veio %v", err)
			}
			if !errors.Is(err, modbus.ErrDesync) {
				t.Fatalf("esperava ErrDesync, veio %v", err)
			}
			if v, err := lerHR(r, 200); err != nil || v != 222 {
				t.Fatalf("HR200 = %d (%v), quer 222 (111 é a resposta do HR100 que ficou na fila)", v, err)
			}
		})
	}
}

// Leitura de bits: a grid-x não compara o número de bytes com a quantidade pedida, e
// um quadro de uma leitura maior (resposta atrasada de outro grupo) era aceito em
// silêncio, com bits que não são os pedidos.
func TestRTUOverTCPLeituraDeBitsRecusaTamanhoErrado(t *testing.T) {
	addr := startEscravoRoteiro(t, func(n int, req []byte, escrever func(time.Duration, []byte)) {
		if n == 0 { // 3 bytes (24 bits) para um pedido de 10 coils (2 bytes)
			escrever(0, quadroRTU(1, 0x01, 3, 0xFF, 0xFF, 0xFF))
			return
		}
		escrever(0, quadroRTU(1, 0x01, 2, 0x08, 0x00))
	})
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr, Timeout: 100 * time.Millisecond, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	span := modbus.Span{Area: modbus.Coil, Start: 0, Count: 10}
	raw, err := r.ReadBlock(context.Background(), 1, span)
	if !errors.Is(err, modbus.ErrDesync) {
		t.Fatalf("resposta com 3 bytes para 10 coils: esperava ErrDesync, veio %v (bits %v)", err, raw.Bits)
	}
	raw, err = r.ReadBlock(context.Background(), 1, span)
	if err != nil || len(raw.Bits) != 10 || !raw.Bits[3] || raw.Bits[0] {
		t.Fatalf("leitura seguinte: %v (%v)", raw.Bits, err)
	}
}

// Só é exceção o quadro com o bit 0x80 na função; *mb.Error com função normal é
// fluxo desalinhado.
func TestClassifySoTrataComoExcecaoFuncaoComBit80(t *testing.T) {
	var exc *modbus.ExceptionError
	if err := modbus.Classify(&mb.Error{FunctionCode: 0x83, ExceptionCode: 2}); !errors.As(err, &exc) || exc.Code != 2 {
		t.Fatalf("0x83/02: esperava ExceptionError, veio %v", err)
	}
	err := modbus.Classify(&mb.Error{FunctionCode: 0x04, ExceptionCode: 2})
	if errors.As(err, &exc) || !errors.Is(err, modbus.ErrDesync) {
		t.Fatalf("função 04 sem bit 0x80: esperava ErrDesync, veio %v", err)
	}
}

// A espera pela linha quieta depois de um erro pode durar alguns Timeouts (até 10 s
// cada): o desligamento do agente não pode ficar preso nela.
func TestRTUOverTCPEsperaDaLinhaRespeitaContexto(t *testing.T) {
	addr := startEscravoRoteiro(t, func(n int, req []byte, escrever func(time.Duration, []byte)) {
		q := respostaHR(req, nil)
		q[len(q)-1] ^= 0xFF // CRC errado: erro que não é timeout nem exceção
		escrever(0, q)
	})
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr, Timeout: 2 * time.Second, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := lerHR(r, 100); err == nil {
		t.Fatal("esperava erro de CRC")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.HoldingRegister, Start: 100, Count: 1})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("esperava o erro do contexto, veio %v", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Fatalf("ReadBlock demorou %v depois do fim do contexto", el)
	}
}
