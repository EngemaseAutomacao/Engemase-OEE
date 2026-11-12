package modbus_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
)

// caminhoTCP fica entre o cliente e o escravo, no papel da rede e do conversor, e
// simula o que um proxy comum não simula: requisições que o cliente escreveu e que não
// chegaram (switch reiniciando, cabo solto, conversor desligado). Com o caminho
// cortado, o que o cliente envia fica retido, como na fila de envio do kernel do
// cliente, sem ACK; ao religar, é entregue em ordem, como na retransmissão do TCP. O
// kernel do proxy reconhece tudo na hora, então a contagem de bytes não reconhecidos
// que o cliente consulta vem daqui (pendentes, via modbus.AbrirComPendentes).
//
// Fechamento pelo cliente: com RST (SO_LINGER 0) o kernel dele descarta a fila e o
// retido se perde; com FIN o kernel ainda entrega a fila antes do FIN, e o retido é
// entregue ao religar.
type caminhoTCP struct {
	ln net.Listener
	// linha, quando não nula, é a linha serial de um conversor transparente: todas as
	// conexões escrevem nela e o que o escravo responde vai para a conexão do momento
	// (atual). Nula: cada conexão tem o seu escravo (backend), como no Modbus TCP.
	linha   net.Conn
	backend string
	mu      sync.Mutex
	cortado bool
	atual   *trechoTCP
	trechos []*trechoTCP
	wg      sync.WaitGroup
}

type trechoTCP struct {
	cli     net.Conn
	destino net.Conn // a linha do conversor ou o escravo desta conexão
	retido  []byte   // escrito pelo cliente e não entregue (sem ACK)
	// mudo: conexão esquecida pelo conversor que reiniciou; nada mais é entregue e o
	// cliente não recebe RST nem FIN.
	mudo      bool
	rst       bool          // o cliente fechou com RST
	encerrado chan struct{} // fechado quando o cliente fecha a conexão
}

// startConversorCaminho é um conversor serial↔Ethernet transparente (como
// conversorSerial) com o caminho de rede controlável.
func startConversorCaminho(t *testing.T, escravo string) *caminhoTCP {
	t.Helper()
	linha, err := net.Dial("tcp", escravo)
	if err != nil {
		t.Fatal(err)
	}
	cm := startCaminho(t, linha, "")
	cm.wg.Add(1)
	go func() { // linha → cliente atual
		defer cm.wg.Done()
		buf := make([]byte, 256)
		for {
			n, err := linha.Read(buf)
			if err != nil {
				return
			}
			cm.mu.Lock()
			if a := cm.atual; a != nil && !a.mudo {
				_, _ = a.cli.Write(buf[:n])
			}
			cm.mu.Unlock()
		}
	}()
	return cm
}

// startCaminhoDireto liga cada conexão do cliente a uma conexão própria com o escravo
// (Modbus TCP).
func startCaminhoDireto(t *testing.T, escravo string) *caminhoTCP {
	t.Helper()
	return startCaminho(t, nil, escravo)
}

func startCaminho(t *testing.T, linha net.Conn, backend string) *caminhoTCP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cm := &caminhoTCP{ln: ln, linha: linha, backend: backend}
	cm.wg.Add(1)
	go cm.aceitar()
	t.Cleanup(func() {
		_ = ln.Close()
		cm.mu.Lock()
		if cm.linha != nil {
			_ = cm.linha.Close()
		}
		for _, tr := range cm.trechos {
			_ = tr.cli.Close()
			_ = tr.destino.Close()
		}
		cm.mu.Unlock()
		cm.wg.Wait()
	})
	return cm
}

func (cm *caminhoTCP) Addr() string { return cm.ln.Addr().String() }

func (cm *caminhoTCP) aceitar() {
	defer cm.wg.Done()
	for {
		c, err := cm.ln.Accept()
		if err != nil {
			return
		}
		tr := &trechoTCP{cli: c, destino: cm.linha, encerrado: make(chan struct{})}
		if cm.linha == nil {
			b, err := net.Dial("tcp", cm.backend)
			if err != nil {
				_ = c.Close()
				continue
			}
			tr.destino = b
			cm.wg.Add(1)
			go func() { defer cm.wg.Done(); _, _ = io.Copy(c, b) }()
		}
		cm.mu.Lock()
		cm.trechos = append(cm.trechos, tr)
		cm.atual = tr
		cm.mu.Unlock()
		cm.wg.Add(1)
		go cm.encaminhar(tr)
	}
}

// encaminhar leva o que o cliente escreve até o destino, ou o retém com o caminho
// cortado.
func (cm *caminhoTCP) encaminhar(tr *trechoTCP) {
	defer cm.wg.Done()
	defer close(tr.encerrado)
	buf := make([]byte, 256)
	for {
		n, err := tr.cli.Read(buf)
		cm.mu.Lock()
		if n > 0 {
			if tr.mudo || cm.cortado {
				tr.retido = append(tr.retido, buf[:n]...)
			} else {
				_, _ = tr.destino.Write(buf[:n])
			}
		}
		if err != nil {
			if errors.Is(err, syscall.ECONNRESET) {
				tr.rst, tr.retido = true, nil // o kernel do cliente descartou a fila de envio
			}
			cm.mu.Unlock()
			return
		}
		cm.mu.Unlock()
	}
}

// cortar para de entregar o que o cliente envia (fica retido, sem ACK).
func (cm *caminhoTCP) cortar() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.cortado = true
}

// religar entrega o retido em ordem e volta a encaminhar. Antes, espera o proxy
// processar o fechamento das conexões antigas que o cliente já fechou (o RST descarta
// o retido), para o resultado não depender do escalonamento.
func (cm *caminhoTCP) religar() {
	cm.mu.Lock()
	var antigos []*trechoTCP
	for _, tr := range cm.trechos {
		if tr != cm.atual {
			antigos = append(antigos, tr)
		}
	}
	cm.mu.Unlock()
	for _, tr := range antigos {
		select {
		case <-tr.encerrado:
		case <-time.After(300 * time.Millisecond):
		}
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.cortado = false
	for _, tr := range cm.trechos {
		if !tr.mudo && len(tr.retido) > 0 {
			_, _ = tr.destino.Write(tr.retido)
			tr.retido = nil
		}
	}
}

// reiniciarConversor: o conversor (ou o CLP) desligado religa sem lembrar das conexões
// antigas. Elas ficam mudas (o que o cliente envia nelas nunca chega, sem RST nem FIN)
// e as novas funcionam.
func (cm *caminhoTCP) reiniciarConversor() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	for _, tr := range cm.trechos {
		tr.mudo = true
	}
	cm.atual = nil
	cm.cortado = false
}

// esperarRetido espera até alguma conexão ter q retido.
func (cm *caminhoTCP) esperarRetido(t *testing.T, q []byte) {
	t.Helper()
	for limite := time.Now().Add(5 * time.Second); time.Now().Before(limite); time.Sleep(time.Millisecond) {
		cm.mu.Lock()
		for _, tr := range cm.trechos {
			if bytes.Contains(tr.retido, q) {
				cm.mu.Unlock()
				return
			}
		}
		cm.mu.Unlock()
	}
	t.Fatalf("a requisição % x não foi escrita", q)
}

// pendentes faz o papel do SIOCOUTQ no cliente: os bytes retidos da conexão dele.
func (cm *caminhoTCP) pendentes(conn net.Conn) (int, bool) {
	local := conn.LocalAddr().String()
	cm.mu.Lock()
	defer cm.mu.Unlock()
	for _, tr := range cm.trechos {
		if tr.cli.RemoteAddr().String() == local {
			return len(tr.retido), true
		}
	}
	return 0, true
}

func (cm *caminhoTCP) Aceitas() int {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	return len(cm.trechos)
}

// esperarFechamentos espera o proxy processar o fechamento de todas as conexões.
func (cm *caminhoTCP) esperarFechamentos(t *testing.T) {
	t.Helper()
	cm.mu.Lock()
	trechos := append([]*trechoTCP(nil), cm.trechos...)
	cm.mu.Unlock()
	for _, tr := range trechos {
		select {
		case <-tr.encerrado:
		case <-time.After(5 * time.Second):
			t.Fatal("o cliente não fechou a conexão")
		}
	}
}

// fechadasComRST conta as conexões que o cliente fechou com RST.
func (cm *caminhoTCP) fechadasComRST() int {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	n := 0
	for _, tr := range cm.trechos {
		if tr.rst {
			n++
		}
	}
	return n
}

// O escoamento só descarta o que chega. Com o caminho até o conversor caído por mais
// que o Timeout (switch reiniciando, cabo solto), as requisições escritas ficavam na
// fila de envio do kernel, sem ACK: o escoamento via silêncio, mantinha o socket e
// escrevia a próxima atrás delas. Quando o caminho voltava, o TCP entregava tudo, o
// escravo respondia primeiro as velhas e a leitura do HR200 devolvia o valor do HR100.
// Requisição sem ACK no fim da espera tem de derrubar a conexão com RST (que descarta
// a fila; o FIN ainda a entregaria).
func TestRTUOverTCPCaminhoCaidoNaoEntregaRequisicoesVelhas(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.SetHolding(100, 111)
	srv.SetHolding(200, 222)
	srv.SetDelay(15 * time.Millisecond) // respostas em quadros separados
	cv := startConversorCaminho(t, srv.Addr())
	r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(),
		Timeout: 200 * time.Millisecond, Retries: modbus.DefaultRetries}, cv.pendentes)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	cv.cortar()
	if v, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("com o caminho caído: esperava ErrTimeout, veio %d (%v)", v, err)
	}
	type resultado struct {
		v   uint16
		err error
	}
	res := make(chan resultado, 1)
	go func() {
		v, err := lerHR(r, 200)
		res <- resultado{v, err}
	}()
	// O caminho volta com a requisição do HR200 já escrita.
	cv.esperarRetido(t, quadroRTU(1, 0x03, 0, 200, 0, 1))
	cv.religar()
	if got := <-res; got.err != nil || got.v != 222 {
		t.Fatalf("HR200 = %d (%v), quer 222 (111 é a resposta de uma requisição do HR100 retida na queda)", got.v, got.err)
	}
	if certas, trocadas, falhas, ultimo := lerAlternado(r, 10); certas != 10 {
		t.Fatalf("depois da queda: %d certas, %d com valor de outro endereço, %d falhas (último erro %v)", certas, trocadas, falhas, ultimo)
	}
}

// O caminho volta DURANTE o escoamento (queda mais curta que a espera do ACK, ou que
// termina pouco antes do fim da linha quieta): a retransmissão entrega a requisição
// retida e o ACK volta, mas o escravo ainda vai responder. O escoamento tomava o ACK
// por linha quieta e devolvia a linha na hora; a próxima requisição saía, a resposta
// atrasada da antiga era aceita no lugar da dela (mesmo unit, função e tamanho) e
// todas as leituras seguintes ficavam deslocadas de uma (HR200 → 111, HR100 → 222). O
// silêncio tem de recomeçar no ACK.
func TestRTUOverTCPCaminhoVoltaNoEscoamentoNaoDesalinhaRespostas(t *testing.T) {
	const timeout = 200 * time.Millisecond
	casos := []struct {
		nome    string
		religar time.Duration // depois da escrita da requisição
		atraso  time.Duration // latência do escravo
	}{
		{"na espera do ACK", 5 * timeout / 2, 15 * time.Millisecond},
		{"pouco antes do fim da linha quieta", 2*timeout - 20*time.Millisecond, 60 * time.Millisecond},
		// A resposta chega depois do limite original do escoamento: fechar ali (RST) e
		// rediscar entregaria a resposta à conexão nova.
		{"perto do limite da espera do ACK", 4*timeout - 40*time.Millisecond, 80 * time.Millisecond},
	}
	for _, cs := range casos {
		for _, retries := range []int{0, modbus.DefaultRetries} {
			t.Run(fmt.Sprintf("%s/retries=%d", cs.nome, retries), func(t *testing.T) {
				srv := startServer(t, mbtest.RTU)
				srv.SetHolding(100, 111)
				srv.SetHolding(200, 222)
				srv.SetDelay(cs.atraso)
				cv := startConversorCaminho(t, srv.Addr())
				r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(),
					Timeout: timeout, Retries: retries}, cv.pendentes)
				if err != nil {
					t.Fatal(err)
				}
				defer r.Close()
				if v, err := lerHR(r, 100); err != nil || v != 111 {
					t.Fatalf("leitura inicial: %d (%v)", v, err)
				}

				cv.cortar()
				type resultado struct {
					v   uint16
					err error
				}
				res := make(chan resultado, 1)
				go func() {
					v, err := lerHR(r, 100)
					res <- resultado{v, err}
				}()
				cv.esperarRetido(t, quadroRTU(1, 0x03, 0, 100, 0, 1))
				time.Sleep(cs.religar)
				cv.religar()
				if got := <-res; got.err == nil && got.v != 111 {
					t.Fatalf("HR100 = %d, quer 111 ou erro", got.v)
				}
				if certas, trocadas, falhas, ultimo := lerAlternado(r, 10); certas != 10 {
					t.Fatalf("depois da volta do caminho: %d certas, %d com valor de outro endereço, %d falhas (último erro %v); quer 10 certas",
						certas, trocadas, falhas, ultimo)
				}
			})
		}
	}
}

// Conversor desligado e religado: não chega RST nem FIN, e a fila de envio fica sem
// ACK. O socket antigo não pode ficar aberto à espera da retransmissão do TCP (até
// 2 min entre tentativas): a leitura seguinte à volta do conversor tem de discar de
// novo.
func TestRTUOverTCPReconectaAposConversorDesligado(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.SetHolding(100, 111)
	cv := startConversorCaminho(t, srv.Addr())
	r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(),
		Timeout: 100 * time.Millisecond, Retries: 0}, cv.pendentes)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	cv.cortar() // desligado
	if v, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("conversor desligado: esperava ErrTimeout, veio %d (%v)", v, err)
	}
	cv.reiniciarConversor()
	srv.SetHolding(100, 333)
	if v, err := lerHR(r, 100); err != nil || v != 333 {
		t.Fatalf("primeira leitura com o conversor de volta: %d (%v), quer 333", v, err)
	}
	if n := cv.Aceitas(); n != 2 {
		t.Fatalf("conexões aceitas = %d, quer 2 (a original e a nova)", n)
	}
}

// Modbus TCP: a grid-x mantém o socket depois de um timeout limpo. Com o CLP desligado
// e religado (sem RST nem FIN), o dispositivo ficava em NO_COMM até a retransmissão do
// TCP achar o CLP de volta. Requisição sem ACK por mais de max(1 s, 2 Timeouts)
// derruba a conexão.
func TestTCPReconectaAposCLPDesligado(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	srv.SetHolding(100, 111)
	cm := startCaminhoDireto(t, srv.Addr())
	r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportTCP, Address: cm.Addr(),
		Timeout: 100 * time.Millisecond, Retries: modbus.DefaultRetries}, cm.pendentes)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	cm.cortar() // desligado
	if v, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("CLP desligado: esperava ErrTimeout, veio %d (%v)", v, err)
	}
	if n := cm.Aceitas(); n != 1 {
		t.Fatalf("conexões aceitas = %d, quer 1 (sem ACK há menos de 1 s, a conexão fica)", n)
	}
	cm.reiniciarConversor()
	srv.SetHolding(100, 333)
	var (
		v    uint16
		lerr error
	)
	for limite := time.Now().Add(3 * time.Second); time.Now().Before(limite); {
		if v, lerr = lerHR(r, 100); lerr == nil {
			break
		}
	}
	if lerr != nil || v != 333 {
		t.Fatalf("não reconectou depois de o CLP religar: %d (%v)", v, lerr)
	}
	if n := cm.Aceitas(); n != 2 {
		t.Fatalf("conexões aceitas = %d, quer 2 (a original e a nova)", n)
	}
}

// Leitura interrompida (contexto) antes do escoamento, com a requisição ainda sem ACK:
// o Close tem de usar RST. Com FIN o kernel ainda entregaria a requisição, e o
// conversor mandaria a resposta para a conexão do próximo Reader (recarga da config).
// O Close termina a espera da linha quieta, mas não espera o ACK depois dela: o socket
// vai fechar de qualquer jeito, e a parada do agente não deve esperar um caminho caído.
func TestRTUOverTCPCloseDescartaRequisicaoSemACK(t *testing.T) {
	const timeout = 200 * time.Millisecond
	srv := startServer(t, mbtest.RTU)
	cv := startConversorCaminho(t, srv.Addr())
	r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: cv.Addr(),
		Timeout: timeout, Retries: 0}, cv.pendentes)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lerHR(r, 100); err != nil {
		t.Fatalf("leitura inicial: %v", err)
	}
	cv.cortar()
	ctx, cancel := context.WithTimeout(context.Background(), 3*timeout/2) // acaba no escoamento
	defer cancel()
	if _, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.HoldingRegister, Start: 100, Count: 1}); err == nil {
		t.Fatal("esperava erro com o caminho caído")
	}
	start := time.Now()
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	// Resta meio Timeout de linha quieta; a espera do ACK iria a 2 Timeouts além dela.
	if el := time.Since(start); el > 3*timeout/2 {
		t.Fatalf("Close levou %v com o caminho caído: esperou o ACK depois da linha quieta", el)
	}
	cv.esperarFechamentos(t)
	if n := cv.fechadasComRST(); n != 1 {
		t.Fatalf("conexões fechadas com RST = %d, quer 1", n)
	}
}

// conversorTagarela é um conversor RTU sobre TCP com o escravo mudo e a linha falando:
// depois da primeira requisição de cada conexão, um byte de lixo a cada intervalo
// (menos que o Timeout: a linha nunca fica quieta). reqs recebe um aviso a cada
// conexão, quando chega a primeira requisição.
func conversorTagarela(t *testing.T, intervalo time.Duration) (string, <-chan struct{}) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	reqs := make(chan struct{}, 16)
	fim := make(chan struct{})
	var (
		mu    sync.Mutex
		conns []net.Conn
		wg    sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
			wg.Add(1)
			go func() {
				defer wg.Done()
				buf := make([]byte, 8)
				if _, err := io.ReadFull(c, buf); err != nil {
					return
				}
				select {
				case reqs <- struct{}{}:
				default:
				}
				wg.Add(1)
				go func() { // outras requisições, até o fechamento
					defer wg.Done()
					_, _ = io.Copy(io.Discard, c)
				}()
				tk := time.NewTicker(intervalo)
				defer tk.Stop()
				for {
					select {
					case <-tk.C:
					case <-fim:
						return
					}
					if _, err := c.Write([]byte{0}); err != nil {
						return // o cliente fechou
					}
				}
			}()
		}
	}()
	t.Cleanup(func() {
		close(fim)
		_ = ln.Close()
		mu.Lock()
		for _, c := range conns {
			_ = c.Close()
		}
		mu.Unlock()
		wg.Wait()
	})
	return ln.Addr().String(), reqs
}

// Close com a leitura interrompida pelo contexto (recarga da config), a linha falando e
// o ACK da requisição chegando antes do limite do escoamento (3 Timeouts depois do
// erro), como num caminho que volta no fim de uma queda: o ACK é a requisição chegando
// ao conversor, o escravo ainda vai responder, e o silêncio recomeça nele também no
// Close. O Close vai além de until + 2 Timeouts (3 depois do erro: o que a documentação
// dizia antes) e fica dentro de until + 4 (5 depois do erro), que o poller.StopBound
// (6T, com a leitura em curso) cobre.
func TestRTUOverTCPCloseComACKTardioEALinhaFalando(t *testing.T) {
	const timeout = 200 * time.Millisecond
	addr, reqs := conversorTagarela(t, 3*timeout/5)
	var ackEm atomic.Int64 // UnixNano a partir do qual a requisição está reconhecida (0: nunca)
	pendentes := func(net.Conn) (int, bool) {
		if at := ackEm.Load(); at != 0 && time.Now().UnixNano() >= at {
			return 0, true
		}
		return 8, true
	}
	r, err := modbus.AbrirComPendentes(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr,
		Timeout: timeout, Retries: 0}, pendentes)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { // o contexto acaba com a leitura em curso
		select {
		case <-reqs:
			cancel()
		case <-ctx.Done():
		}
	}()
	if _, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.HoldingRegister, Start: 100, Count: 1}); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("escravo mudo: esperava ErrTimeout, veio %v", err)
	}
	if ctx.Err() == nil {
		t.Fatal("a requisição não chegou ao conversor")
	}
	erro := time.Now() // a leitura expirou e o escoamento parou com o contexto
	ackEm.Store(erro.Add(5 * timeout / 2).UnixNano())
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	el := time.Since(erro)
	t.Logf("Close: %v (until + 4 Timeouts = %v depois do erro)", el, 5*timeout)
	if el < 4*timeout {
		t.Fatalf("Close levou %v: o ACK não estendeu o escoamento (fecharia em 3 Timeouts depois do erro)", el)
	}
	if el > 5*timeout+timeout/4 {
		t.Fatalf("Close levou %v, além de until + 4 Timeouts (5 depois do erro)", el)
	}
}

// A espera pela linha quieta depois de um erro fica na leitura que falhou. No começo
// da leitura seguinte (no barramento, a de outro escravo, saudável) ela entrava no
// tempo medido pelo poller como latência desse outro escravo.
func TestRTUOverTCPEsperaDaLinhaNaoContaNaLeituraSeguinte(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.Units = map[uint8]bool{1: true}
	srv.SetHolding(100, 111)
	const timeout = 100 * time.Millisecond
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: srv.Addr(), Timeout: timeout, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}
	if _, err := r.ReadBlock(context.Background(), 2, modbus.Span{Area: modbus.HoldingRegister, Start: 100, Count: 1}); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("unit 2 ausente: esperava ErrTimeout, veio %v", err)
	}
	start := time.Now()
	v, err := lerHR(r, 100)
	el := time.Since(start)
	if err != nil || v != 111 {
		t.Fatalf("unit 1 depois do timeout do unit 2: %d (%v)", v, err)
	}
	if el > timeout/2 {
		t.Fatalf("leitura do unit 1 levou %v: a espera da linha depois do erro do unit 2 entrou no tempo dela", el)
	}
}
