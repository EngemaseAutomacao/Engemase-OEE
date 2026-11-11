// Package plcserver expõe máquinas simuladas como servidores Modbus TCP
// (github.com/simonvetter/modbus), com o bloco OEE padrão Engemase em holding
// registers e as coils 0 (rodando) e 1 (falha).
//
// Dois modos de endereçamento:
//   - unit: todas as máquinas numa porta só, uma por unit id (como um conversor
//     Modbus TCP→RTU com vários escravos);
//   - port: uma porta por máquina, aceitando qualquer unit id (como CLPs com
//     Ethernet própria).
package plcserver

import (
	"cmp"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/simonvetter/modbus"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/sim"
)

// Mode é o modo de endereçamento das máquinas.
type Mode string

const (
	// ModeUnit: uma porta, uma máquina por unit id.
	ModeUnit Mode = "unit"
	// ModePort: uma porta por máquina.
	ModePort Mode = "port"
)

// OfflineMode define como uma máquina offline (cenário offline) se comporta.
type OfflineMode string

const (
	// OfflineAuto: "close" no modo port e "exception" no modo unit.
	OfflineAuto OfflineMode = "auto"
	// OfflineClose: fecha a porta da máquina (conexão recusada). Só no modo port.
	OfflineClose OfflineMode = "close"
	// OfflineException: responde com a exceção 0x0B (gateway sem resposta do escravo).
	OfflineException OfflineMode = "exception"
)

// Options configura o servidor.
type Options struct {
	// Host é o endereço de escuta (ex.: "127.0.0.1" ou "0.0.0.0").
	Host string
	// Port é a porta única (modo unit) ou a porta da M1 (modo port: Mi usa Port+i-1).
	Port int
	// Ports, se informado no modo port, define a porta de cada máquina.
	Ports []int
	// Mode é o modo de endereçamento (padrão: unit).
	Mode Mode
	// UnitStart é o unit id da M1 no modo unit (padrão 1).
	UnitStart uint8
	// Base é o endereço (base 0) do primeiro holding register do bloco.
	Base uint16
	// WordOrder é a ordem das words dos contadores de 32 bits.
	WordOrder block.WordOrder
	// OfflineMode define o comportamento de máquina offline (padrão: auto).
	OfflineMode OfflineMode
	// MaxClients limita conexões simultâneas por porta (padrão 10).
	MaxClients uint
	// IdleTimeout fecha conexões ociosas (padrão 120 s).
	IdleTimeout time.Duration
	// LibLogger recebe os logs internos da biblioteca Modbus (nil = descartar).
	LibLogger *log.Logger
}

// Endpoint descreve onde uma máquina pode ser lida.
type Endpoint struct {
	Machine int    // índice da máquina (0 = M1)
	Addr    string // host:porta
	UnitID  uint8  // unit id esperado (0 = qualquer, no modo port)
}

// Server publica as máquinas simuladas via Modbus TCP.
type Server struct {
	opts     Options
	machines []*sim.Machine
	urls     []string // uma URL (unit) ou uma por máquina (port)

	mu sync.Mutex // protege machines

	srvMu   sync.Mutex
	servers []*modbus.ModbusServer // nil = porta fechada
	started bool
}

// New valida as opções e prepara o servidor (sem abrir portas).
func New(machines []*sim.Machine, opts Options) (*Server, error) {
	if len(machines) == 0 {
		return nil, errors.New("nenhuma máquina para simular")
	}
	if opts.Mode == "" {
		opts.Mode = ModeUnit
	}
	if opts.OfflineMode == "" {
		opts.OfflineMode = OfflineAuto
	}
	if opts.UnitStart == 0 && opts.Mode == ModeUnit {
		opts.UnitStart = 1
	}
	if opts.MaxClients == 0 {
		opts.MaxClients = 10
	}
	if opts.IdleTimeout == 0 {
		opts.IdleTimeout = 120 * time.Second
	}
	if opts.LibLogger == nil {
		opts.LibLogger = log.New(io.Discard, "", 0)
	}
	if uint32(opts.Base)+block.Size > 1<<16 {
		return nil, fmt.Errorf("endereço base %d não cabe: o bloco vai até %d (máximo 65535)", opts.Base, uint32(opts.Base)+block.Size-1)
	}
	if opts.Host == "" {
		opts.Host = "127.0.0.1"
	}

	s := &Server{opts: opts, machines: machines}
	switch opts.Mode {
	case ModeUnit:
		if int(opts.UnitStart)+len(machines)-1 > 247 {
			return nil, fmt.Errorf("unit ids de %d a %d: o máximo é 247", opts.UnitStart, int(opts.UnitStart)+len(machines)-1)
		}
		if opts.OfflineMode == OfflineAuto {
			s.opts.OfflineMode = OfflineException
		}
		if s.opts.OfflineMode == OfflineClose {
			return nil, errors.New("offline \"close\" só existe no modo port (no modo unit as outras máquinas usam a mesma porta)")
		}
		if err := validPort(opts.Port); err != nil {
			return nil, err
		}
		s.urls = []string{tcpURL(opts.Host, opts.Port)}
	case ModePort:
		if s.opts.OfflineMode == OfflineAuto {
			s.opts.OfflineMode = OfflineClose
		}
		ports := opts.Ports
		if len(ports) == 0 {
			for i := range machines {
				ports = append(ports, opts.Port+i)
			}
		}
		if len(ports) != len(machines) {
			return nil, fmt.Errorf("%d portas para %d máquinas", len(ports), len(machines))
		}
		for _, p := range ports {
			if err := validPort(p); err != nil {
				return nil, err
			}
			s.urls = append(s.urls, tcpURL(opts.Host, p))
		}
	default:
		return nil, fmt.Errorf("modo desconhecido %q (use unit ou port)", opts.Mode)
	}
	switch s.opts.OfflineMode {
	case OfflineClose, OfflineException:
	default:
		return nil, fmt.Errorf("modo offline desconhecido %q (use auto, close ou exception)", opts.OfflineMode)
	}
	s.servers = make([]*modbus.ModbusServer, len(s.urls))
	return s, nil
}

func validPort(p int) error {
	if p < 1 || p > 65535 {
		return fmt.Errorf("porta inválida %d", p)
	}
	return nil
}

func tcpURL(host string, port int) string {
	return "tcp://" + net.JoinHostPort(host, strconv.Itoa(port))
}

// Options devolve as opções efetivas (com padrões aplicados).
func (s *Server) Options() Options { return s.opts }

// Endpoints lista onde cada máquina pode ser lida.
func (s *Server) Endpoints() []Endpoint {
	eps := make([]Endpoint, len(s.machines))
	for i := range s.machines {
		switch s.opts.Mode {
		case ModeUnit:
			eps[i] = Endpoint{Machine: i, Addr: hostPort(s.urls[0]), UnitID: s.opts.UnitStart + uint8(i)}
		default:
			eps[i] = Endpoint{Machine: i, Addr: hostPort(s.urls[i])}
		}
	}
	return eps
}

func hostPort(url string) string { return url[len("tcp://"):] }

// Start abre as portas. No modo port, máquinas offline (com OfflineClose)
// ficam com a porta fechada até voltarem.
func (s *Server) Start() error {
	s.srvMu.Lock()
	defer s.srvMu.Unlock()
	if s.started {
		return nil
	}
	s.started = true
	if err := s.syncListenersLocked(); err != nil {
		s.stopAllLocked()
		s.started = false
		return err
	}
	return nil
}

// Stop fecha todas as portas e conexões.
func (s *Server) Stop() {
	s.srvMu.Lock()
	defer s.srvMu.Unlock()
	s.stopAllLocked()
	s.started = false
}

func (s *Server) stopAllLocked() {
	for i, srv := range s.servers {
		if srv != nil {
			_ = srv.Stop()
			s.servers[i] = nil
		}
	}
}

// Advance avança todas as máquinas até o instante simulado t e devolve os
// eventos ocorridos. No modo port com OfflineClose, abre/fecha as portas das
// máquinas que caíram ou voltaram.
func (s *Server) Advance(t time.Duration) ([]sim.Event, error) {
	s.mu.Lock()
	var evs []sim.Event
	for _, m := range s.machines {
		evs = append(evs, m.AdvanceTo(t)...)
	}
	s.mu.Unlock()
	// Intercala as máquinas em ordem de tempo (estável: no empate, M1 antes de M2).
	slices.SortStableFunc(evs, func(a, b sim.Event) int { return cmp.Compare(a.At, b.At) })

	s.srvMu.Lock()
	defer s.srvMu.Unlock()
	if !s.started {
		return evs, nil
	}
	return evs, s.syncListenersLocked()
}

// syncListenersLocked deixa abertas exatamente as portas que devem estar.
func (s *Server) syncListenersLocked() error {
	var errs []error
	for i, url := range s.urls {
		want := true
		if s.opts.Mode == ModePort && s.opts.OfflineMode == OfflineClose {
			s.mu.Lock()
			want = s.machines[i].Online()
			s.mu.Unlock()
		}
		have := s.servers[i] != nil
		switch {
		case want && !have:
			// Um servidor novo a cada abertura: a biblioteca não foi feita para
			// reiniciar a mesma instância.
			srv, err := modbus.NewServer(&modbus.ServerConfiguration{
				URL:        url,
				Timeout:    s.opts.IdleTimeout,
				MaxClients: s.opts.MaxClients,
				Logger:     s.opts.LibLogger,
			}, s.handlerFor(i))
			if err != nil {
				errs = append(errs, fmt.Errorf("criar servidor %s: %w", hostPort(url), err))
				continue
			}
			if err := srv.Start(); err != nil {
				errs = append(errs, fmt.Errorf("abrir %s: %w", hostPort(url), err))
				continue
			}
			s.servers[i] = srv
		case !want && have:
			_ = s.servers[i].Stop()
			s.servers[i] = nil
		}
	}
	return errors.Join(errs...)
}

func (s *Server) handlerFor(i int) modbus.RequestHandler {
	if s.opts.Mode == ModeUnit {
		return &handler{s: s, machine: -1}
	}
	return &handler{s: s, machine: i}
}

// Snapshot devolve o bloco exposto e se a máquina está online.
func (s *Server) Snapshot(i int) (block.Block, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.machines[i]
	return m.Block(), m.Online()
}

// MachineStatus devolve o estado real da máquina, se está congelada e se está online.
func (s *Server) MachineStatus(i int) (state sim.State, frozen, online bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.machines[i]
	return m.State(), m.Frozen(), m.Online()
}

// MachineCount devolve o número de máquinas.
func (s *Server) MachineCount() int { return len(s.machines) }
