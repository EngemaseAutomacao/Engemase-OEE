package modbus

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

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
	// Timeout por leitura; zero = padrão do transporte.
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
	c := &client{target: t, pause: t.TurnaroundDelay}
	switch t.Transport {
	case TransportTCP:
		if t.Timeout <= 0 {
			c.target.Timeout = DefaultTCPTimeout
		}
		h := mb.NewTCPClientHandler(t.Address, mb.WithDialer(dial))
		h.Timeout = c.target.Timeout
		h.IdleTimeout = -1 // conexão persistente, nunca expira
		h.LinkRecoveryTimeout = 0
		h.ProtocolRecoveryTimeout = 0
		c.handler, c.conn, c.mbc = h, h, mb.NewClient(h)
	case TransportRTUOverTCP:
		if t.Timeout <= 0 {
			c.target.Timeout = DefaultTCPTimeout
		}
		h := mb.NewRTUOverTCPClientHandler(t.Address)
		h.Dial = dial
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
	return Raw{}, err
}

func (c *client) readOnce(ctx context.Context, unit uint8, s Span) (Raw, error) {
	c.handler.SetSlave(unit)
	var (
		b   []byte
		err error
	)
	switch s.Area {
	case Coil:
		b, err = c.mbc.ReadCoils(ctx, s.Start, s.Count)
	case DiscreteInput:
		b, err = c.mbc.ReadDiscreteInputs(ctx, s.Start, s.Count)
	case InputRegister:
		b, err = c.mbc.ReadInputRegisters(ctx, s.Start, s.Count)
	case HoldingRegister:
		b, err = c.mbc.ReadHoldingRegisters(ctx, s.Start, s.Count)
	}
	if err != nil {
		return Raw{}, Classify(err)
	}
	raw := Raw{Span: s}
	if s.Area.IsBit() {
		raw.Bits, err = BitsFromBytes(b, int(s.Count))
	} else {
		raw.Regs, err = RegistersFromBytes(b)
		if err == nil && len(raw.Regs) != int(s.Count) {
			err = fmt.Errorf("resposta com %d registradores (esperado %d)", len(raw.Regs), s.Count)
		}
	}
	if err != nil {
		return Raw{}, err
	}
	return raw, nil
}
