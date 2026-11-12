package modbus

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	mb "github.com/grid-x/modbus"
	"github.com/grid-x/serial"
)

// Valores padrão dos transportes (docs/rascunhos/gateway-software.md §3.5). O padrão
// da biblioteca (10 s no TCP, 5 s no serial) é longo demais: um escravo desligado
// travaria o barramento inteiro.
const (
	DefaultTCPTimeout     = 500 * time.Millisecond
	DefaultRTUTimeout     = 300 * time.Millisecond
	DefaultConnectTimeout = 2 * time.Second
	DefaultRetries        = 1
)

// Erros classificados (para backoff, saúde do dispositivo e diagnóstico).
var (
	ErrTimeout         = errors.New("modbus: timeout")
	ErrConnRefused     = errors.New("modbus: conexão recusada")
	ErrPortUnavailable = errors.New("modbus: porta serial indisponível")
	// ErrDesync é um quadro válido que não responde à requisição feita (outra função,
	// tamanho diferente): em RTU, sem id de transação, é sinal de resposta atrasada de
	// outra leitura, e a linha é escoada antes da próxima requisição.
	ErrDesync = errors.New("modbus: resposta não corresponde à requisição")
)

// ExceptionError é uma exceção Modbus devolvida pelo escravo (ex.: 02 = endereço inválido).
type ExceptionError struct {
	Function byte
	Code     byte
}

func (e *ExceptionError) Error() string {
	names := map[byte]string{
		1: "função não suportada", 2: "endereço inválido", 3: "valor inválido", 4: "falha no escravo",
		5: "reconhecido (processando)", 6: "escravo ocupado", 8: "erro de paridade de memória",
		10: "caminho do gateway indisponível", 11: "gateway sem resposta do escravo",
	}
	name := names[e.Code]
	if name == "" {
		name = "desconhecida"
	}
	return fmt.Sprintf("modbus: exceção %02d (%s) na função %02d", e.Code, name, e.Function&0x7F)
}

// Classify converte erros da biblioteca e da rede nos erros classificados deste pacote.
func Classify(err error) error {
	if err == nil {
		return nil
	}
	var mbErr *mb.Error
	if errors.As(err, &mbErr) {
		// A grid-x devolve *mb.Error para QUALQUER função diferente da pedida. Só é
		// exceção do escravo o quadro com o bit 0x80; um quadro normal de outra função é
		// resposta de outra requisição.
		if mbErr.FunctionCode&0x80 == 0 {
			return fmt.Errorf("%w: quadro da função %02d", ErrDesync, mbErr.FunctionCode)
		}
		return &ExceptionError{Function: mbErr.FunctionCode, Code: mbErr.ExceptionCode}
	}
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) ||
		errors.Is(err, serial.ErrTimeout) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return fmt.Errorf("%w: %v", ErrTimeout, err)
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return fmt.Errorf("%w: %v", ErrConnRefused, err)
	}
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EBUSY) {
		return fmt.Errorf("%w: %v", ErrPortUnavailable, err)
	}
	return err
}

// Reader lê blocos de um dispositivo ou barramento. É SOMENTE LEITURA por construção:
// não existe método de escrita (ADR-008). Uma goroutine dona por Reader; as chamadas
// são serializadas internamente por segurança.
type Reader interface {
	ReadBlock(ctx context.Context, unit uint8, s Span) (Raw, error)
	Close() error
	Info() string
}

// Transport é o tipo de ligação física/lógica.
type Transport string

// Transportes suportados.
const (
	TransportTCP        Transport = "tcp"     // Modbus TCP (MBAP)
	TransportRTU        Transport = "rtu"     // Modbus RTU em porta serial (RS-485)
	TransportRTUOverTCP Transport = "rtu+tcp" // quadros RTU num socket TCP (conversor transparente)
)

// Target descreve onde e como ler.
type Target struct {
	Transport Transport
	// Address é "host:porta" (TCP e RTU sobre TCP) ou o caminho da porta serial (RTU).
	Address string
	// Parâmetros seriais (só RTU).
	Baud     int
	Parity   string // N, E ou O
	DataBits int
	StopBits int
	// Timeout por leitura; zero = padrão do transporte. Tem de cobrir a latência de
	// pior caso do escravo: nos transportes RTU (sem id de transação), depois de um
	// erro a linha fica mais um Timeout sem requisição nova e o que chegar nesse
	// intervalo é descartado, então um escravo sempre mais lento que o Timeout não é
	// lido nunca (antes, a repetição "acertava" lendo a resposta atrasada, e as
	// leituras seguintes ficavam desalinhadas).
	Timeout time.Duration
	// ConnectTimeout do TCP; zero = DefaultConnectTimeout.
	ConnectTimeout time.Duration
	// Retries em caso de timeout (padrão 1). Exceções Modbus não são repetidas.
	Retries int
	// TurnaroundDelay é a pausa extra entre quadros no RS-485.
	TurnaroundDelay time.Duration
}

// ParseTarget interpreta o alvo da CLI:
//
//	tcp://192.168.10.23:502
//	rtu+tcp://192.168.10.50:4001
//	rtu:///dev/ttyUSB0?baud=19200&parity=E&data_bits=8&stop_bits=1
//
// A porta TCP padrão é 502.
func ParseTarget(s string) (Target, error) {
	u, err := url.Parse(s)
	if err != nil {
		return Target{}, fmt.Errorf("alvo inválido %q: %w", s, err)
	}
	t := Target{Transport: Transport(strings.ToLower(u.Scheme)), Retries: DefaultRetries}
	q := u.Query()
	if v := q.Get("timeout_ms"); v != "" {
		ms, err := strconv.Atoi(v)
		if err != nil || ms < 50 || ms > 10000 {
			return Target{}, fmt.Errorf("timeout_ms inválido %q (50–10000)", v)
		}
		t.Timeout = time.Duration(ms) * time.Millisecond
	}
	switch t.Transport {
	case TransportTCP, TransportRTUOverTCP:
		host, port := u.Hostname(), u.Port()
		if host == "" {
			return Target{}, fmt.Errorf("alvo %q sem host", s)
		}
		if port == "" {
			port = "502"
		}
		t.Address = net.JoinHostPort(host, port)
	case TransportRTU:
		t.Address = u.Path
		if t.Address == "" {
			t.Address = u.Opaque
		}
		if t.Address == "" {
			return Target{}, fmt.Errorf("alvo RTU %q sem porta serial (ex.: rtu:///dev/ttyUSB0?baud=19200)", s)
		}
		t.Baud, t.Parity, t.DataBits, t.StopBits = 19200, "E", 8, 1
		if v := q.Get("baud"); v != "" {
			if t.Baud, err = strconv.Atoi(v); err != nil {
				return Target{}, fmt.Errorf("baud inválido %q", v)
			}
		}
		if v := q.Get("parity"); v != "" {
			t.Parity = strings.ToUpper(v)
		}
		if v := q.Get("data_bits"); v != "" {
			if t.DataBits, err = strconv.Atoi(v); err != nil {
				return Target{}, fmt.Errorf("data_bits inválido %q", v)
			}
		}
		if v := q.Get("stop_bits"); v != "" {
			if t.StopBits, err = strconv.Atoi(v); err != nil {
				return Target{}, fmt.Errorf("stop_bits inválido %q", v)
			}
		}
	default:
		return Target{}, fmt.Errorf("transporte %q não suportado (use tcp://, rtu:// ou rtu+tcp://)", u.Scheme)
	}
	return t, t.validate()
}

func (t Target) validate() error {
	if t.Transport != TransportRTU {
		return nil
	}
	if t.Parity != "N" && t.Parity != "E" && t.Parity != "O" {
		return fmt.Errorf("paridade inválida %q (use N, E ou O)", t.Parity)
	}
	if t.DataBits != 8 {
		return fmt.Errorf("Modbus RTU exige 8 bits de dados (7 bits é Modbus ASCII)")
	}
	if t.StopBits != 1 && t.StopBits != 2 {
		return fmt.Errorf("stop bits inválido %d (use 1 ou 2)", t.StopBits)
	}
	if t.Baud <= 0 {
		return fmt.Errorf("velocidade inválida %d", t.Baud)
	}
	return nil
}

func (t Target) String() string {
	switch t.Transport {
	case TransportRTU:
		return fmt.Sprintf("rtu://%s@%d-%d%s%d", t.Address, t.Baud, t.DataBits, t.Parity, t.StopBits)
	default:
		return fmt.Sprintf("%s://%s", t.Transport, t.Address)
	}
}

// slaveSetter é a parte do handler da grid-x que define o unit id.
type slaveSetter interface{ SetSlave(byte) }

type closer interface{ Close() error }

// client implementa Reader sobre a grid-x/modbus. Guarda o Client da biblioteca em
// campo privado: o resto do agente só enxerga ReadBlock.
type client struct {
	mu      sync.Mutex
	target  Target
	handler slaveSetter
	conn    closer
	mbc     mb.Client
	pause   time.Duration
	// sock é o socket atual do TCP e do RTU sobre TCP, guardado no Dial (a grid-x não o
	// expõe); nil quando fechado por nós. Só é usado entre requisições: para escoar a
	// linha e para conferir se o outro lado reconheceu (ACK) o que foi enviado.
	sock net.Conn
	// discadoEm é quando sock foi discado (a escrita da requisição vem logo depois).
	discadoEm time.Time
	// quietUntil marca, depois de um erro num transporte RTU, até quando a linha fica
	// sem requisição nova (zero = livre). Ver dropAfterError.
	quietUntil time.Time
	// recolher (RTU sobre TCP) pede, antes da próxima requisição, uma passada no
	// socket para descartar o que chegou depois da espera da linha quieta.
	recolher bool
	// semACKDesde (só Modbus TCP) é quando foi escrita a requisição mais antiga que
	// expirou e pode ainda estar sem ACK; zero = nada pendente. Ver conferirACK.
	semACKDesde time.Time
	// pendentes conta os bytes enviados que o outro lado ainda não reconheceu
	// (bytesNaoReconhecidos; os testes simulam um caminho caído trocando-a).
	pendentes func(net.Conn) (int, bool)
}

// Open cria um Reader para o alvo. A conexão (ou a porta) é aberta na primeira leitura.
func Open(t Target) (Reader, error) {
	if err := t.validate(); err != nil {
		return nil, err
	}
	if t.ConnectTimeout <= 0 {
		t.ConnectTimeout = DefaultConnectTimeout
	}
	if t.Retries < 0 {
		t.Retries = 0
	}
	dial := (&net.Dialer{Timeout: t.ConnectTimeout}).DialContext
	c := &client{target: t, pause: t.TurnaroundDelay, pendentes: bytesNaoReconhecidos}
	// A discagem acontece dentro de ReadBlock (no Send da grid-x), com c.mu travado.
	discar := func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := dial(ctx, network, addr)
		if err == nil {
			c.sock, c.discadoEm, c.semACKDesde = conn, time.Now(), time.Time{}
		}
		return conn, err
	}
	switch t.Transport {
	case TransportTCP:
		if t.Timeout <= 0 {
			c.target.Timeout = DefaultTCPTimeout
		}
		h := mb.NewTCPClientHandler(t.Address, mb.WithDialer(discar))
		h.Timeout = c.target.Timeout
		h.IdleTimeout = -1 // conexão persistente, nunca expira
		h.LinkRecoveryTimeout = 0
		// Resposta que chega depois do timeout fica no socket. Com a janela de
		// recuperação de protocolo, a biblioteca a reconhece pelo id de transação, a
		// descarta e continua esperando a resposta certa dentro do mesmo Timeout; com
		// zero, a repetição lia o quadro atrasado, acusava "response stream out of
		// sync" e derrubava a conexão. O prazo conta do início do Send e só é
		// consultado enquanto a leitura não expira, então qualquer valor >= Timeout
		// cobre a tentativa inteira; 4× dá folga para o tempo de conexão.
		h.ProtocolRecoveryTimeout = 4 * c.target.Timeout
		c.handler, c.conn, c.mbc = h, h, mb.NewClient(h)
	case TransportRTUOverTCP:
		if t.Timeout <= 0 {
			c.target.Timeout = DefaultTCPTimeout
		}
		h := mb.NewRTUOverTCPClientHandler(t.Address)
		h.Dial = discar
		h.Timeout = c.target.Timeout
		h.IdleTimeout = -1
		h.LinkRecoveryTimeout = 0
		h.ProtocolRecoveryTimeout = 0
		c.handler, c.conn, c.mbc = h, h, mb.NewClient(h)
	case TransportRTU:
		if t.Timeout <= 0 {
			c.target.Timeout = DefaultRTUTimeout
		}
		h := mb.NewRTUClientHandler(t.Address)
		h.BaudRate, h.DataBits, h.Parity, h.StopBits = t.Baud, t.DataBits, t.Parity, t.StopBits
		h.Timeout = c.target.Timeout
		h.IdleTimeout = 0 // a porta nunca fecha por inatividade
		h.LinkRecoveryTimeout = 0
		// O modo RS-485 fica como o overlay do fabricante deixou ("leave"): não mexemos no TIOCSRS485.
		c.handler, c.conn, c.mbc = h, h, mb.NewClient(h)
	default:
		return nil, fmt.Errorf("transporte %q não suportado", t.Transport)
	}
	return c, nil
}

func (c *client) Info() string { return c.target.String() }

func (c *client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sock != nil {
		// Requisição ainda sem ACK (leitura interrompida antes do escoamento): o close
		// normal deixaria o kernel entregá-la depois, e a resposta iria para a conexão
		// que um conversor transparente atender em seguida (a do próximo Reader).
		if n, ok := c.pendentes(c.sock); ok && n > 0 {
			abortar(c.sock)
		}
	}
	c.sock = nil
	return c.conn.Close()
}

// ReadBlock lê uma faixa contígua. Repete só em timeout (Retries vezes).
func (c *client) ReadBlock(ctx context.Context, unit uint8, s Span) (Raw, error) {
	if err := s.Validate(); err != nil {
		return Raw{}, err
	}
	if c.target.Transport != TransportTCP && (unit < 1 || unit > 247) {
		return Raw{}, fmt.Errorf("unit id %d inválido em RTU (1–247)", unit)
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	var err error
	for attempt := 0; attempt <= c.target.Retries; attempt++ {
		// Depois de um erro num transporte RTU, nenhuma requisição (nem esta repetição)
		// sai antes de a linha ficar quieta.
		if err := c.settle(ctx); err != nil {
			return Raw{}, err
		}
		c.conferirACK()
		if c.pause > 0 {
			select {
			case <-ctx.Done():
				return Raw{}, ctx.Err()
			case <-time.After(c.pause):
			}
		}
		var raw Raw
		raw, err = c.readOnce(ctx, unit, s)
		if err == nil {
			return raw, nil
		}
		if !errors.Is(err, ErrTimeout) || ctx.Err() != nil {
			break
		}
	}
	// A linha fica quieta aqui, ainda dentro da leitura que falhou, e não no começo da
	// próxima: no barramento a próxima costuma ser de outro dispositivo, e o poller
	// mediria a espera como latência dele. Se o contexto acabar no meio, o resto da
	// espera fica para a próxima leitura (quietUntil continua marcado). No RTU sobre
	// TCP o socket segue aberto até a próxima leitura, que antes passa por ele mais uma
	// vez (a resposta de um escravo mais lento que 2 Timeouts pode chegar nesse meio).
	if !c.quietUntil.IsZero() && c.settle(ctx) == nil {
		c.recolher = c.target.Transport == TransportRTUOverTCP
	}
	return Raw{}, err
}

func (c *client) readOnce(ctx context.Context, unit uint8, s Span) (Raw, error) {
	c.handler.SetSlave(unit)
	var (
		b   []byte
		err error
		fc  byte
	)
	inicio := time.Now()
	switch s.Area {
	case Coil:
		fc = mb.FuncCodeReadCoils
		b, err = c.mbc.ReadCoils(ctx, s.Start, s.Count)
	case DiscreteInput:
		fc = mb.FuncCodeReadDiscreteInputs
		b, err = c.mbc.ReadDiscreteInputs(ctx, s.Start, s.Count)
	case InputRegister:
		fc = mb.FuncCodeReadInputRegisters
		b, err = c.mbc.ReadInputRegisters(ctx, s.Start, s.Count)
	case HoldingRegister:
		fc = mb.FuncCodeReadHoldingRegisters
		b, err = c.mbc.ReadHoldingRegisters(ctx, s.Start, s.Count)
	}
	if err != nil {
		err = Classify(err)
		// Exceção de OUTRA função é resposta atrasada de outra leitura, não desta.
		var exc *ExceptionError
		if errors.As(err, &exc) && exc.Function != fc|0x80 {
			err = fmt.Errorf("%w: exceção da função %02d numa leitura da função %02d", ErrDesync, exc.Function&0x7F, fc)
		}
		if c.target.Transport == TransportTCP && errors.Is(err, ErrTimeout) && c.semACKDesde.IsZero() {
			// A requisição foi escrita logo depois da discagem, se houve uma nesta tentativa.
			c.semACKDesde = inicio
			if c.discadoEm.After(inicio) {
				c.semACKDesde = c.discadoEm
			}
		}
		c.dropAfterError(err)
		return Raw{}, err
	}
	c.semACKDesde = time.Time{} // uma resposta reconhece tudo o que foi enviado antes
	raw := Raw{Span: s}
	if s.Area.IsBit() {
		// A grid-x não compara o número de bytes com a quantidade pedida nos bits.
		if want := (int(s.Count) + 7) / 8; len(b) != want {
			err = fmt.Errorf("%w: resposta com %d bytes (esperado %d para %d bits)", ErrDesync, len(b), want, s.Count)
		} else {
			raw.Bits, err = BitsFromBytes(b, int(s.Count))
		}
	} else {
		raw.Regs, err = RegistersFromBytes(b)
		if err == nil && len(raw.Regs) != int(s.Count) {
			err = fmt.Errorf("%w: resposta com %d registradores (esperado %d)", ErrDesync, len(raw.Regs), s.Count)
		}
	}
	if err != nil {
		c.dropAfterError(err) // quadro que não é desta requisição: fluxo desalinhado
		return Raw{}, err
	}
	return raw, nil
}

// dropAfterError prepara a linha para a próxima requisição depois de uma leitura que
// falhou sem ser exceção Modbus desta requisição.
//
// Quadro RTU não tem id de transação: a grid-x aceita como resposta o primeiro quadro
// com o mesmo unit id e função (e, no RTU sobre TCP, o tamanho esperado). Depois de um
// timeout, a resposta atrasada que ainda está na linha seria lida como resposta da
// PRÓXIMA requisição, com o valor de outro endereço, e tudo o que viesse depois ficaria
// deslocado de um quadro. Fechar e reabrir logo não resolve: a repetição sai poucos
// milissegundos depois (o poller também passa direto ao próximo grupo) e a resposta
// atrasada chega pela porta reaberta, ou pela conexão nova de um conversor
// serial↔Ethernet, que não fecha o lado serial e entrega à conexão do momento o que
// o escravo responder. Por isso a linha fica quieta por mais um Timeout (settle) antes
// de qualquer requisição nova, e o que chegar nesse intervalo é descartado:
//
//   - RTU sobre TCP: o socket fica aberto e é escoado (drain). Fechar a cada timeout só
//     criava conexões novas (um unit ausente custava uma por tentativa) sem descartar
//     nada num conversor de verdade. O socket morto (conversor reiniciou: EOF, reset,
//     "broken pipe") é percebido no escoamento e fechado; a próxima leitura disca de
//     novo, o que tira o dispositivo do NO_COMM sem reiniciar o agente. O escoamento só
//     descarta o que CHEGA: requisição escrita que o conversor não reconheceu (ACK)
//     ainda está na fila de envio do kernel, que a entregaria quando o caminho voltasse
//     (switch reiniciando, cabo solto), com as requisições seguintes atrás dela, e o
//     escravo responderia primeiro as velhas. Por isso, com a linha quieta, o
//     escoamento confere a fila (SIOCOUTQ) e, se nada foi reconhecido até o fim da
//     espera, fecha com RST, que descarta a fila. É também o que percebe o conversor
//     desligado (sem RST nem FIN): sem isso o socket ficava aberto, e só a
//     retransmissão do TCP, com espera crescente de até 2 min, encontrava o conversor
//     religado.
//   - RTU serial: a porta é fechada agora e só é reaberta depois do intervalo. A grid-x
//     não expõe o descritor (não dá para chamar tcflush); numa UART, o último close
//     descarta o buffer de entrada e, com a porta fechada, nada é recebido, então a
//     resposta que chega no intervalo se perde. Isso é comportamento do driver e só se
//     confirma no hardware (o teste com pty emula a UART).
//
// O que nenhum lado do mestre resolve é a resposta que chega depois desse intervalo
// (escravo mais lento que 2× o Timeout): timeout_ms tem de cobrir a latência do
// escravo.
//
// Exceção Modbus desta requisição é um quadro completo que responde a ela: o fluxo
// segue alinhado. Conexão recusada e porta indisponível não chegaram a escrever nada.
// No Modbus TCP a própria biblioteca casa o id de transação, descarta respostas
// atrasadas (ProtocolRecoveryTimeout) e fecha o socket quando perde o alinhamento;
// ali só conferimos o ACK (conferirACK).
func (c *client) dropAfterError(err error) {
	if c.target.Transport == TransportTCP {
		return
	}
	var exc *ExceptionError
	if errors.As(err, &exc) || errors.Is(err, ErrConnRefused) || errors.Is(err, ErrPortUnavailable) {
		return
	}
	c.quietUntil = time.Now().Add(c.target.Timeout)
	if c.target.Transport == TransportRTU {
		_ = c.conn.Close()
	}
}

// settle segura a próxima requisição até a linha ficar quieta (ver dropAfterError).
// Só devolve erro quando o contexto acaba.
func (c *client) settle(ctx context.Context) error {
	if c.quietUntil.IsZero() {
		if !c.recolher {
			return nil
		}
		// Passada rápida: até a linha ficar quieta só se algo tiver chegado.
		if err := c.drain(ctx, time.Time{}); err != nil {
			return err
		}
		c.recolher = false
		return nil
	}
	if c.target.Transport == TransportRTUOverTCP {
		if err := c.drain(ctx, c.quietUntil); err != nil {
			return err
		}
		c.recolher = false
	} else if d := time.Until(c.quietUntil); d > 0 { // serial: a porta já está fechada
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
	c.quietUntil = time.Time{}
	return nil
}

// drain lê e descarta o que chegar no socket do RTU sobre TCP até a linha ficar
// quieta: nada recebido até until e, depois de cada byte recebido, por mais um
// Timeout. Com a linha quieta, espera o conversor reconhecer (ACK) o que foi enviado.
// Socket morto é fechado (a próxima leitura disca de novo), assim como o de uma linha
// que não sossega, ou de uma requisição que ninguém reconheceu, em 2 Timeouts além
// disso.
func (c *client) drain(ctx context.Context, until time.Time) error {
	conn := c.sock
	if conn == nil {
		return nil // nada aberto: a próxima leitura disca um socket novo
	}
	guard := c.target.Timeout
	// Mesmo com o intervalo já vencido (a leitura seguinte veio bem depois do erro),
	// uma passada recolhe o que já está no buffer.
	if earliest := time.Now().Add(time.Millisecond); until.Before(earliest) {
		until = earliest
	}
	limit := until.Add(2 * guard)
	// Contexto cancelado interrompe a leitura em curso. Na saída, espera o AfterFunc
	// que já começou, para ele não mexer no prazo da próxima requisição.
	cancelado := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(cancelado)
		_ = conn.SetReadDeadline(time.Now())
	})
	defer func() {
		if !stop() {
			<-cancelado
		}
	}()
	buf := make([]byte, 256)
	esperaACK := false
	for {
		deadline := until
		if esperaACK {
			deadline = time.Now().Add(passoACK)
		}
		if limit.Before(deadline) {
			deadline = limit
		}
		if err := conn.SetReadDeadline(deadline); err != nil {
			c.closeConn()
			return nil
		}
		if err := ctx.Err(); err != nil { // depois do SetReadDeadline: o AfterFunc não se perde
			return err
		}
		n, err := conn.Read(buf)
		now := time.Now()
		if n > 0 {
			until = now.Add(guard) // a linha falou: o silêncio conta de novo
			esperaACK = false
		}
		switch {
		case err == nil:
			continue
		case !errors.Is(err, os.ErrDeadlineExceeded):
			c.closeConn() // EOF, reset: socket morto
			return nil
		case ctx.Err() != nil:
			return ctx.Err()
		case now.Before(until):
			if !now.Before(limit) {
				c.closeConn() // a linha não sossega: recomeça numa conexão nova
				return nil
			}
			continue
		}
		// Linha quieta. Sem consulta (fora do Linux), vale o silêncio.
		if pend, ok := c.pendentes(conn); !ok || pend == 0 {
			return nil
		}
		if !now.Before(limit) {
			c.closeConn() // nada reconhecido: caminho caído ou conversor desligado
			return nil
		}
		esperaACK = true // ACK atrasado (delayed ACK) ou retransmissão: espera mais um pouco
	}
}

// passoACK é o intervalo entre consultas à fila de envio enquanto o escoamento espera
// o ACK.
const passoACK = 10 * time.Millisecond

// conferirACK (Modbus TCP) fecha a conexão em que uma requisição que expirou segue sem
// ACK há mais de max(1 s, 2 Timeouts): o outro lado sumiu sem RST nem FIN (CLP
// desligado). A grid-x mantém o socket depois de um timeout limpo (para descartar a
// resposta atrasada pelo id de transação) e, sem isso, a reconexão esperava a
// retransmissão do TCP encontrar o CLP religado e receber o RST, com espera crescente
// de até 2 min (ou ~15 min sem RST). Não espera nada: só confere, antes de cada
// tentativa. Um ACK atrasado (delayed ACK, até 500 ms) fica dentro do prazo.
func (c *client) conferirACK() {
	if c.target.Transport != TransportTCP || c.sock == nil || c.semACKDesde.IsZero() {
		return
	}
	pend, ok := c.pendentes(c.sock)
	switch {
	case !ok: // sem consulta, ou socket já fechado pela grid-x (a próxima discagem zera)
	case pend == 0:
		c.semACKDesde = time.Time{}
	case time.Since(c.semACKDesde) >= max(time.Second, 2*c.target.Timeout):
		c.closeConn() // a próxima tentativa disca de novo
	}
}

// closeConn fecha a conexão TCP atual com RST (ver abortar); a próxima leitura disca
// de novo.
func (c *client) closeConn() {
	if c.sock != nil {
		abortar(c.sock)
	}
	_ = c.conn.Close()
	c.sock = nil
	c.semACKDesde = time.Time{}
}

// abortar prepara o socket para fechar com RST (SO_LINGER 0): o kernel descarta o que
// ainda não foi entregue, em vez de seguir retransmitindo e entregar requisições
// velhas quando o caminho voltar.
func abortar(conn net.Conn) {
	if tc, ok := conn.(interface{ SetLinger(int) error }); ok {
		_ = tc.SetLinger(0)
	}
}

// bytesNaoReconhecidos devolve quantos bytes escritos no socket o outro lado ainda não
// reconheceu: na fila de envio ou enviados sem ACK (ioctl SIOCOUTQ, igual a TIOCOUTQ).
// ok=false fora do Linux ou se o socket não permite a consulta (já fechado).
func bytesNaoReconhecidos(conn net.Conn) (int, bool) {
	if runtime.GOOS != "linux" {
		return 0, false
	}
	sc, ok := conn.(syscall.Conn)
	if !ok {
		return 0, false
	}
	rc, err := sc.SyscallConn()
	if err != nil {
		return 0, false
	}
	var (
		n     int32
		errno syscall.Errno
	)
	if err := rc.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, uintptr(syscall.TIOCOUTQ), uintptr(unsafe.Pointer(&n)))
	}); err != nil || errno != 0 {
		return 0, false
	}
	return int(n), true
}
