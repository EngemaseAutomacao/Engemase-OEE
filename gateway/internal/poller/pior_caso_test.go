package poller

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// Pior leitura em bloco de cada transporte (T timeout, C conexão, P pausa, R
// repetições): TCP (R+1)(C+P+T); RTU serial (R+1)(P+E+3T), E a espera do quadro da
// grid-x; RTU sobre TCP 2T + (R+1)(C+P+6T), com o escoamento até 5T depois do erro
// quando o ACK chega no limite.
func TestReadWorstPorTransporte(t *testing.T) {
	casos := []struct {
		nome string
		alvo modbus.Target
		quer time.Duration
	}{
		// 2 × (3 s + 1 s): só o prazo da resposta, sem linha quieta.
		{"tcp", modbus.Target{Transport: modbus.TransportTCP, Timeout: time.Second, ConnectTimeout: 3 * time.Second,
			Retries: 1}, 8 * time.Second},
		// Timeout e conexão zerados: os padrões (500 ms e 2 s); uma tentativa.
		{"tcp padrão", modbus.Target{Transport: modbus.TransportTCP}, 2500 * time.Millisecond},
		// E a 9600 bauds, 263 bytes: 1562 µs × 263 + 3645 µs = 414,451 ms.
		// 2 × (5 ms + 414,451 ms + 3 s).
		{"rtu 9600", modbus.Target{Transport: modbus.TransportRTU, Baud: 9600, Timeout: time.Second, Retries: 1,
			TurnaroundDelay: 5 * time.Millisecond}, 6838902 * time.Microsecond},
		// Acima de 19200 bauds: 750 µs × 263 + 1750 µs = 199 ms. 199 ms + 900 ms.
		{"rtu 115200", modbus.Target{Transport: modbus.TransportRTU, Baud: 115200, Timeout: 300 * time.Millisecond},
			1099 * time.Millisecond},
		// 2 s + 2 × (2 s + 6 s).
		{"rtu+tcp", modbus.Target{Transport: modbus.TransportRTUOverTCP, Timeout: time.Second, Retries: 1}, 18 * time.Second},
		// 2 s + (2 s + 6 s).
		{"rtu+tcp sem repetição", modbus.Target{Transport: modbus.TransportRTUOverTCP, Timeout: time.Second}, 10 * time.Second},
	}
	for _, c := range casos {
		if got := readWorst(c.alvo); got != c.quer {
			t.Errorf("%s: pior leitura %v, quer %v", c.nome, got, c.quer)
		}
	}
}

// Parada (fim do contexto até Run voltar): TCP T, RTU serial 3T, RTU sobre TCP 6T.
func TestStopBoundPorTransporte(t *testing.T) {
	const T = 10 * time.Second
	casos := []struct {
		alvo modbus.Target
		quer time.Duration
	}{
		{modbus.Target{Transport: modbus.TransportTCP, Timeout: T}, T},
		{modbus.Target{Transport: modbus.TransportRTU, Timeout: T}, 3 * T},
		{modbus.Target{Transport: modbus.TransportRTUOverTCP, Timeout: T}, 6 * T},
		{modbus.Target{Transport: modbus.TransportRTUOverTCP}, 6 * modbus.DefaultTCPTimeout},
	}
	for _, c := range casos {
		if got := newPoller("p", c.alvo).StopBound(); got != c.quer {
			t.Errorf("%s timeout %v: parada %v, quer %v", c.alvo.Transport, c.alvo.Timeout, got, c.quer)
		}
	}
}

// A parada é a leitura em curso e o escoamento dela no Close: uma tentativa de
// readWorst sem o que acaba com o contexto (a conexão, a pausa entre quadros e a espera
// do quadro serial). A tentativa sai da diferença entre uma e duas tentativas, sem a
// passada que segue o erro da leitura anterior (uma por leitura em bloco; o Close não
// a faz). No RTU sobre TCP, o escoamento com o ACK no limite (5T depois do erro) vale
// para o Close também: a parada é 6T, não 4T.
func TestStopBoundEhUmaTentativaDeReadWorst(t *testing.T) {
	const T = 10 * time.Second
	for _, tr := range []modbus.Transport{modbus.TransportTCP, modbus.TransportRTU, modbus.TransportRTUOverTCP} {
		alvo := modbus.Target{Transport: tr, Timeout: T, ConnectTimeout: 3 * time.Second, Baud: 9600,
			TurnaroundDelay: 5 * time.Millisecond}
		duas := alvo
		duas.Retries = 1
		tentativa := readWorst(duas) - readWorst(alvo) - alvo.TurnaroundDelay
		if tr == modbus.TransportRTU {
			tentativa -= esperaQuadroRTU(alvo.Baud, quadroRTUMax)
		} else {
			tentativa -= alvo.ConnectTimeout
		}
		if got := newPoller("p", alvo).StopBound(); got != tentativa {
			t.Errorf("%s: parada %v, mas a leitura em curso e o escoamento dela em readWorst vão a %v", tr, got, tentativa)
		}
	}
}

// configTimeout é uma config com um dispositivo de cada transporte, todos com o mesmo
// timeout_ms.
func configTimeout(timeoutMS int) string {
	dev := func(i int, protocol, params string) string {
		return fmt.Sprintf(`{"id":"%s","name":"Escravo %d","protocol":"%s","params":{%s,"timeout_ms":%d},
			"blocks":[{"area":"holding_register","start":0,"count":2,"poll_ms":1000}],
			"tags":[{"id":"%s","address":{"area":"holding_register","offset":0},"type":"uint16","role":"custom"}]}`,
			netDevID(i), i, protocol, params, timeoutMS, netTagID(i))
	}
	return `{"config_version":1,
		"serial_buses":[{"id":"01a1599d-9148-75c2-9673-d03229272dbb","port":"/dev/ttyAMA2","baud":19200,"parity":"E","data_bits":8,"stop_bits":1}],
		"devices":[` + strings.Join([]string{
		dev(0, config.ProtocolTCP, `"host":"10.0.0.1","port":502,"unit_id":1`),
		dev(1, config.ProtocolRTUOverTCP, `"host":"10.0.0.2","port":4001,"unit_id":1`),
		dev(2, config.ProtocolRTU, `"bus":"01a1599d-9148-75c2-9673-d03229272dbb","unit_id":1`),
	}, ",") + `],"machines":[],"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`
}

// gravacaoFinal é o que sobra da parada do agente depois de os pollers voltarem: o
// último tick (leituras na fila e gravação do que fechou), o agent_stop e o fechamento
// do buffer. São os 20 s que a unit dava à parada inteira antes de o Close do
// transporte esperar a linha quieta.
const gravacaoFinal = 20 * time.Second

// Na parada do agente (SIGTERM), os pollers voltam em paralelo antes da gravação final.
// Com timeout_ms no máximo do contrato, o TimeoutStopSec da unit tem de cobrir o
// poller mais lento e a gravação final; senão o systemd mata o agente no meio do
// Close (parada suja, sem agent_stop).
func TestTimeoutStopSecCobreAParadaDosPollers(t *testing.T) {
	const timeoutMax = 10_000 // TimeoutMsSchema (contracts) e config.validate
	if _, err := config.ParseRemote([]byte(configTimeout(timeoutMax + 1))); err == nil {
		t.Fatalf("timeout_ms %d aceito: o máximo do contrato mudou, reveja o TimeoutStopSec da unit", timeoutMax+1)
	}
	cfg, err := config.ParseRemote([]byte(configTimeout(timeoutMax)))
	if err != nil {
		t.Fatal(err)
	}
	ps, err := Build(cfg, config.DefaultLocal())
	if err != nil || len(ps) != 3 {
		t.Fatalf("pollers: %d (%v)", len(ps), err)
	}
	var parada time.Duration
	for _, p := range ps {
		parada = max(parada, p.StopBound())
	}
	if parada != 60*time.Second {
		t.Fatalf("parada mais lenta com timeout_ms %d: %v, quer 60s (RTU sobre TCP)", timeoutMax, parada)
	}

	unit := filepath.Join("..", "..", "..", "deploy", "gateway", "systemd", "oee-gateway.service")
	f, err := os.Open(unit)
	if errors.Is(err, os.ErrNotExist) {
		t.Skipf("unit fora da árvore: %v", err)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var stop string
	for sc := bufio.NewScanner(f); sc.Scan(); {
		if v, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "TimeoutStopSec="); ok {
			stop = v
		}
	}
	d, err := time.ParseDuration(stop)
	if err != nil {
		t.Fatalf("TimeoutStopSec=%q na unit: %v", stop, err)
	}
	if quer := parada + gravacaoFinal; d < quer {
		t.Fatalf("TimeoutStopSec=%v: a parada pode levar %v (pollers %v + gravação final %v)", d, quer, parada, gravacaoFinal)
	}
}

// linhaTagarela é um conversor RTU sobre TCP falso com o escravo mudo e a linha
// falando: depois de falar(), cada conexão (já aberta ou aceita depois) recebe um byte
// de lixo logo e outro a cada intervalo. Com o intervalo menor que o timeout, a linha
// nunca fica quieta e todo escoamento vai ao limite; com ele maior que metade do
// timeout, nenhuma leitura junta os 4 bytes do menor quadro e toda leitura expira. Os
// testes usam 3/5 do timeout: a linha só sossegaria com um atraso de 2/5 dele.
type linhaTagarela struct {
	ln        net.Listener
	intervalo time.Duration
	fala      chan struct{}
	falaOnce  sync.Once
	fim       chan struct{}
	reqs      chan time.Time // quando cada requisição chegou
	mu        sync.Mutex
	conns     []net.Conn
	fechada   bool
	wg        sync.WaitGroup
}

func iniciarLinhaTagarela(t *testing.T, intervalo time.Duration) *linhaTagarela {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	l := &linhaTagarela{ln: ln, intervalo: intervalo, fala: make(chan struct{}), fim: make(chan struct{}),
		reqs: make(chan time.Time, 64)}
	l.wg.Add(1)
	go l.aceitar()
	t.Cleanup(func() {
		_ = ln.Close()
		l.mu.Lock()
		l.fechada = true
		for _, c := range l.conns {
			_ = c.Close()
		}
		l.mu.Unlock()
		close(l.fim)
		l.wg.Wait()
	})
	return l
}

func (l *linhaTagarela) Addr() string { return l.ln.Addr().String() }

func (l *linhaTagarela) falar() { l.falaOnce.Do(func() { close(l.fala) }) }

func (l *linhaTagarela) aceitar() {
	defer l.wg.Done()
	for {
		c, err := l.ln.Accept()
		if err != nil {
			return
		}
		l.mu.Lock()
		if l.fechada {
			l.mu.Unlock()
			_ = c.Close()
			return
		}
		l.conns = append(l.conns, c)
		l.wg.Add(2)
		l.mu.Unlock()
		go func() { // requisições RTU de leitura: 8 bytes cada
			defer l.wg.Done()
			buf := make([]byte, 8)
			for {
				if _, err := io.ReadFull(c, buf); err != nil {
					return
				}
				select {
				case l.reqs <- time.Now():
				default:
				}
			}
		}()
		go func() { // lixo na linha
			defer l.wg.Done()
			select {
			case <-l.fala:
			case <-l.fim:
				return
			}
			tk := time.NewTicker(l.intervalo)
			defer tk.Stop()
			for {
				if _, err := c.Write([]byte{0}); err != nil {
					return // o leitor fechou (RST no escoamento)
				}
				select {
				case <-tk.C:
				case <-l.fim:
					return
				}
			}
		}()
	}
}

// pollerDeAlvo é um poller com um dispositivo e um grupo (HR 0–1, a cada segundo) no alvo.
func pollerDeAlvo(t modbus.Target) *Poller {
	p := newPoller("teste "+t.Address, t)
	p.devices["d"] = &devState{id: "d", status: contracts.DeviceDisconnected, exceptions: map[byte][]time.Time{}}
	p.groups = []*group{{deviceID: "d", unit: 1, span: modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 2},
		every: time.Second}}
	return p
}

// RTU sobre TCP com o escravo mudo e a linha falando lixo: a passada no socket que
// segue o erro da leitura anterior vai ao limite (2T), e o escoamento depois de cada
// tentativa também (3T depois do erro), com uma conexão nova por tentativa. A leitura
// em bloco leva 2T + (R+1)(C'+4T), mais que o (R+1)(C+4T) de antes, e cabe em
// readWorst (que ainda cobre o ACK no limite do escoamento, não simulável aqui).
func TestReadWorstCobreRTUSobreTCPComALinhaFalando(t *testing.T) {
	const timeout = 150 * time.Millisecond
	l := iniciarLinhaTagarela(t, 3*timeout/5)
	alvo := modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: l.Addr(), Timeout: timeout,
		ConnectTimeout: 20 * time.Millisecond, Retries: modbus.DefaultRetries}
	r, err := modbus.Open(alvo)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	span := modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 2}
	// Com a linha muda, a leitura falha em silêncio e deixa a passada para a próxima.
	if _, err := r.ReadBlock(context.Background(), 1, span); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("escravo mudo: esperava ErrTimeout, veio %v", err)
	}
	l.falar()
	time.Sleep(timeout / 2) // o primeiro byte de lixo já está no socket

	start := time.Now()
	_, err = r.ReadBlock(context.Background(), 1, span)
	el := time.Since(start)
	if !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("linha falando: esperava ErrTimeout, veio %v", err)
	}
	t.Logf("leitura em bloco: %v (pior calculada %v)", el, readWorst(alvo))
	if el < 9*timeout {
		t.Fatalf("leitura levou %v: o cenário não levou os escoamentos ao limite (quer ~%v)", el, 10*timeout)
	}
	if w := readWorst(alvo); el > w {
		t.Fatalf("leitura levou %v, além da pior leitura calculada %v", el, w)
	}
}

// Contexto cancelado logo depois de a requisição sair, no RTU sobre TCP: a grid-x
// espera o prazo da leitura (T) e o Close escoa a linha até 3T depois do erro (a
// linha falando, aqui, leva o escoamento ao limite). Run volta em ~4T, dentro do
// StopBound (6T, que ainda cobre o ACK no limite do escoamento, não simulável aqui).
func TestStopBoundRTUSobreTCPLeituraEmCursoEEscoamento(t *testing.T) {
	const timeout = 200 * time.Millisecond
	l := iniciarLinhaTagarela(t, 3*timeout/5)
	l.falar()
	p := pollerDeAlvo(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: l.Addr(), Timeout: timeout,
		Retries: modbus.DefaultRetries})
	medirParada(t, p, l.reqs, 0, 7*timeout/2)
}

// medirParada roda p, cancela o contexto quando passa espera desde a chegada da
// primeira requisição (reqs) e confere o tempo até Run voltar: pelo menos minimo (o
// cenário exercitou o pior caso) e no máximo StopBound, com 1/8 dele de folga para o
// agendamento.
func medirParada(t *testing.T, p *Poller, reqs <-chan time.Time, espera, minimo time.Duration) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type fim struct {
		at  time.Time
		err error
	}
	done := make(chan fim, 1)
	go func() {
		err := p.Run(ctx, make(chan Reading, 16))
		done <- fim{time.Now(), err}
	}()
	select {
	case at := <-reqs:
		time.Sleep(time.Until(at.Add(espera)))
	case <-time.After(5 * time.Second):
		t.Fatal("a requisição não chegou")
	}
	cancel()
	cancelado := time.Now()
	var f fim
	select {
	case f = <-done:
	case <-time.After(10 * p.StopBound()):
		t.Fatal("Run não voltou depois do cancelamento")
	}
	if !errors.Is(f.err, context.Canceled) {
		t.Fatalf("Run: %v", f.err)
	}
	el, bound := f.at.Sub(cancelado), p.StopBound()
	t.Logf("parada: %v (StopBound %v)", el, bound)
	if el < minimo {
		t.Fatalf("parada levou %v: o cenário não exercitou o pior caso (quer >= %v)", el, minimo)
	}
	if el > bound+bound/8 {
		t.Fatalf("parada levou %v, além do StopBound %v", el, bound)
	}
}
