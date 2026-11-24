package commands

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
)

// Access é o caminho das leituras dos comandos até o CLP (docs/16 §1, "um mestre por
// barramento"): pelo poller dono do transporte quando a config em execução tem um, e
// só sem dono por uma conexão avulsa, uma por linha de cada vez.
type Access struct {
	// Pollers são os da config em execução (nil: nenhum).
	Pollers *poller.Registry
	// Open abre um transporte avulso (padrão modbus.Open).
	Open func(modbus.Target) (modbus.Reader, error)
	// Dial abre a conexão TCP do teste "só conectar" (padrão net.Dialer).
	Dial func(ctx context.Context, network, addr string) (net.Conn, error)

	mu    sync.Mutex
	lines map[string]*sync.Mutex
}

// errBusPause: o barramento é de um poller com outros parâmetros seriais.
var errBusPause = errors.New("barramento em uso com outros parâmetros seriais")

func (m *Access) owner(key string) *poller.Poller {
	if m.Pollers == nil {
		return nil
	}
	return m.Pollers.ByKey(key)
}

func (m *Access) byDevice(id string) *poller.Poller {
	if m.Pollers == nil {
		return nil
	}
	return m.Pollers.ByDevice(id)
}

// line serializa as conexões avulsas de uma mesma linha.
func (m *Access) line(key string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lines == nil {
		m.lines = map[string]*sync.Mutex{}
	}
	l := m.lines[key]
	if l == nil {
		l = &sync.Mutex{}
		m.lines[key] = l
	}
	return l
}

// Read lê uma faixa do alvo: pelo dono do transporte (com os mesmos parâmetros
// seriais; senão errBusPause) ou por uma conexão avulsa.
func (m *Access) Read(ctx context.Context, t modbus.Target, unit uint8, s modbus.Span) (modbus.Raw, time.Duration, error) {
	key := poller.TransportKey(t)
	if p := m.owner(key); p != nil {
		if t.Transport == modbus.TransportRTU && !poller.SameSerial(p.Target(), t) {
			return modbus.Raw{}, 0, errBusPause
		}
		return p.Read(ctx, unit, s)
	}
	return m.readAlone(ctx, t, unit, s)
}

// ReadPaused lê com outros parâmetros seriais, pausando o poller dono do barramento
// (allow_bus_pause). A pausa vai até o fim do contexto.
func (m *Access) ReadPaused(ctx context.Context, t modbus.Target, unit uint8, s modbus.Span) (raw modbus.Raw, rtt time.Duration, err error) {
	p := m.owner(poller.TransportKey(t))
	if p == nil {
		return m.readAlone(ctx, t, unit, s)
	}
	xerr := p.Exclusive(ctx, func(ctx context.Context) error {
		raw, rtt, err = m.readOnce(ctx, t, unit, s)
		return nil
	})
	if xerr != nil {
		return modbus.Raw{}, 0, xerr
	}
	return raw, rtt, err
}

func (m *Access) readAlone(ctx context.Context, t modbus.Target, unit uint8, s modbus.Span) (modbus.Raw, time.Duration, error) {
	l := m.line(poller.TransportKey(t))
	l.Lock()
	defer l.Unlock()
	return m.readOnce(ctx, t, unit, s)
}

func (m *Access) readOnce(ctx context.Context, t modbus.Target, unit uint8, s modbus.Span) (modbus.Raw, time.Duration, error) {
	open := m.Open
	if open == nil {
		open = modbus.Open
	}
	r, err := open(t)
	if err != nil {
		return modbus.Raw{}, 0, err
	}
	defer r.Close()
	start := time.Now()
	raw, err := r.ReadBlock(ctx, unit, s)
	return raw, time.Since(start), err
}

// Connect só abre (e fecha) uma conexão TCP com o alvo: o device.test sem leitura
// num Modbus TCP sem dono. Devolve o tempo de conexão.
func (m *Access) Connect(ctx context.Context, t modbus.Target) (time.Duration, error) {
	dial := m.Dial
	if dial == nil {
		dial = (&net.Dialer{Timeout: modbus.DefaultConnectTimeout}).DialContext
	}
	l := m.line(poller.TransportKey(t))
	l.Lock()
	defer l.Unlock()
	start := time.Now()
	c, err := dial(ctx, "tcp", t.Address)
	if err != nil {
		return 0, err
	}
	took := time.Since(start)
	_ = c.Close()
	return took, nil
}

// TargetFor monta o alvo de um dispositivo (parâmetros dele, timeout próprio). bus é
// o barramento do dispositivo RTU (nil nos outros protocolos).
func TargetFor(protocol string, params config.DeviceParams, bus *config.SerialBus, local *config.Local) (modbus.Target, error) {
	d := config.Device{Protocol: protocol, Params: params}
	timeout := time.Duration(d.Timeout()) * time.Millisecond
	addr := net.JoinHostPort(params.Host, strconv.Itoa(params.Port))
	switch protocol {
	case config.ProtocolTCP:
		return modbus.Target{Transport: modbus.TransportTCP, Address: addr, Timeout: timeout, Retries: modbus.DefaultRetries}, nil
	case config.ProtocolRTUOverTCP:
		return modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: addr, Timeout: timeout, Retries: modbus.DefaultRetries}, nil
	case config.ProtocolRTU:
		if bus == nil {
			return modbus.Target{}, Fail(CodeBusNotFound, "Barramento %s não existe na config aplicada nem no comando.", params.Bus)
		}
		path, err := local.ResolveSerialPort(bus.Port)
		if err != nil {
			return modbus.Target{}, Fail(CodePortUnavailable, "%v", err)
		}
		turn := time.Duration(config.DefaultRTUTurnaroundMS) * time.Millisecond
		if params.TurnaroundMS != nil {
			turn = max(turn, time.Duration(*params.TurnaroundMS)*time.Millisecond)
		}
		return modbus.Target{Transport: modbus.TransportRTU, Address: path, Baud: bus.Baud, Parity: bus.Parity,
			DataBits: bus.DataBits, StopBits: bus.StopBits, Timeout: timeout, Retries: modbus.DefaultRetries, TurnaroundDelay: turn}, nil
	}
	return modbus.Target{}, Fail(CodeInvalidPayload, "protocolo %q não suportado", protocol)
}

// modbusError converte o erro de uma leitura no código do contrato.
func modbusError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if errors.Is(err, poller.ErrUnavailable) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return Fail(CodeTimeout, "O comando passou do prazo de execução: %v", err)
	}
	err = modbus.Classify(err)
	var exc *modbus.ExceptionError
	switch {
	case errors.As(err, &exc):
		return &Error{Code: CodeModbusException, Message: exc.Error(), ModbusException: int(exc.Code)}
	case errors.Is(err, errBusPause):
		return Fail(CodeBusPauseRequired, "O barramento está em uso com outros parâmetros seriais: o teste exige allow_bus_pause.")
	case errors.Is(err, modbus.ErrTimeout):
		return Fail(CodeReadTimeout, "O dispositivo não respondeu dentro do timeout: %v", err)
	case errors.Is(err, modbus.ErrPortUnavailable):
		return Fail(CodePortUnavailable, "%v", err)
	case errors.Is(err, modbus.ErrConnRefused):
		return Fail(CodeConnectionFailed, "%v", err)
	case errors.Is(err, modbus.ErrDesync):
		return Fail(CodeDecodeError, "%v", err)
	}
	return Fail(CodeConnectionFailed, "%v", err)
}
