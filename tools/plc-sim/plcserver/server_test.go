package plcserver

import (
	"errors"
	"fmt"
	"math"
	"net"
	"testing"
	"time"

	"github.com/simonvetter/modbus"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/sim"
)

// freePort pede ao sistema uma porta TCP livre em 127.0.0.1.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func newMachines(t *testing.T, n int, seed int64, cfg sim.Config) []*sim.Machine {
	t.Helper()
	ms := make([]*sim.Machine, n)
	for i := range ms {
		m, err := sim.NewMachine(i, seed, cfg)
		if err != nil {
			t.Fatal(err)
		}
		ms[i] = m
	}
	return ms
}

func startServer(t *testing.T, ms []*sim.Machine, opts Options) *Server {
	t.Helper()
	if opts.Host == "" {
		opts.Host = "127.0.0.1"
	}
	if opts.Port == 0 && len(opts.Ports) == 0 {
		opts.Port = freePort(t)
	}
	if opts.Base == 0 {
		opts.Base = block.DefaultBase
	}
	s, err := New(ms, opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Stop)
	return s
}

func dial(t *testing.T, addr string, unit uint8) *modbus.ModbusClient {
	t.Helper()
	c, err := modbus.NewClient(&modbus.ClientConfiguration{URL: "tcp://" + addr, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Open(); err != nil {
		t.Fatalf("conectar em %s: %v", addr, err)
	}
	if err := c.SetUnitId(unit); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func readBlock(t *testing.T, c *modbus.ModbusClient, base uint16, order block.WordOrder) block.Block {
	t.Helper()
	regs, err := c.ReadRegisters(base, block.Size, modbus.HOLDING_REGISTER)
	if err != nil {
		t.Fatalf("ler bloco: %v", err)
	}
	b, err := block.Decode(regs, order)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func mustAdvance(t *testing.T, s *Server, at time.Duration) []sim.Event {
	t.Helper()
	evs, err := s.Advance(at)
	if err != nil {
		t.Fatalf("Advance(%s): %v", at, err)
	}
	return evs
}

func TestUnitModeReadsBlockWithTypesAndWordOrder(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.StartTotal = 100000 // valor conhecido: 0x000186A0 (docs/11 §6)
	s := startServer(t, newMachines(t, 3, 42, cfg), Options{Mode: ModeUnit})

	eps := s.Endpoints()
	if len(eps) != 3 {
		t.Fatalf("%d endpoints, esperado 3", len(eps))
	}
	for i, ep := range eps {
		if ep.UnitID != uint8(i+1) {
			t.Fatalf("M%d no unit id %d, esperado %d", i+1, ep.UnitID, i+1)
		}
		c := dial(t, ep.Addr, ep.UnitID)

		regs, err := c.ReadRegisters(block.DefaultBase, block.Size, modbus.HOLDING_REGISTER)
		if err != nil {
			t.Fatal(err)
		}
		// Ordem CDAB: word baixa primeiro.
		if regs[block.OffsetTotal] != 0x86A0 || regs[block.OffsetTotal+1] != 0x0001 {
			t.Fatalf("M%d contador_total em CDAB = [%#04x %#04x], esperado [0x86a0 0x0001]",
				i+1, regs[block.OffsetTotal], regs[block.OffsetTotal+1])
		}
		for off := block.UsedSize; off < block.Size; off++ {
			if regs[off] != 0 {
				t.Fatalf("offset reservado %d = %d", off, regs[off])
			}
		}

		// Conferência independente com o decodificador da biblioteca (word baixa primeiro).
		if err := c.SetEncoding(modbus.BIG_ENDIAN, modbus.LOW_WORD_FIRST); err != nil {
			t.Fatal(err)
		}
		u32, err := c.ReadUint32s(block.DefaultBase+block.OffsetTotal, 3, modbus.HOLDING_REGISTER)
		if err != nil {
			t.Fatal(err)
		}
		if u32[0] != 100000 || u32[1] != 0 || u32[2] != 100000 {
			t.Fatalf("M%d total/refugo/bons via biblioteca = %v, esperado [100000 0 100000]", i+1, u32)
		}

		b, err := block.Decode(regs, block.CDAB)
		if err != nil {
			t.Fatal(err)
		}
		if b.Version != 1 || sim.State(b.State) != sim.StateProducing || b.FaultCode != 0 {
			t.Fatalf("M%d bloco inicial inesperado: %+v", i+1, b)
		}
		if b.Product != sim.FirstProduct+uint16(i) {
			t.Fatalf("M%d produto = %d", i+1, b.Product)
		}
		if b.StatusBits != block.StatusAutomatic {
			t.Fatalf("M%d bits_status = %b, esperado automático", i+1, b.StatusBits)
		}
	}
}

func TestCounterAdvancesThroughModbus(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Cycle = time.Second
	cfg.MeanRunCycles = 1e9 // sem paradas: o contador avança com certeza
	s := startServer(t, newMachines(t, 2, 42, cfg), Options{Mode: ModeUnit})
	ep := s.Endpoints()[1]
	c := dial(t, ep.Addr, ep.UnitID)

	before := readBlock(t, c, block.DefaultBase, block.CDAB)
	mustAdvance(t, s, 30*time.Second)
	after := readBlock(t, c, block.DefaultBase, block.CDAB)

	if after.Heartbeat != before.Heartbeat+30 {
		t.Fatalf("heartbeat %d → %d, esperado +30", before.Heartbeat, after.Heartbeat)
	}
	if after.Total < 25 || after.Total > 31 {
		t.Fatalf("total após 30 ciclos de ~1 s = %d", after.Total)
	}
	if after.Good+after.Reject != after.Total {
		t.Fatal("bons + refugo != total")
	}
	if after.LastCycleMs < 900 || after.LastCycleMs > 1200 {
		t.Fatalf("ciclo_ultimo_ms = %d", after.LastCycleMs)
	}
	if after.Speed < 3000 || after.Speed > 4000 {
		t.Fatalf("velocidade = %d peças/h, esperado ~3600", after.Speed)
	}

	coils, err := c.ReadCoils(block.CoilRunning, block.CoilCount)
	if err != nil {
		t.Fatal(err)
	}
	if !coils[0] || coils[1] {
		t.Fatalf("coils = %v, esperado [true false]", coils)
	}
}

func TestOverflowScenarioThroughModbus(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Cycle = time.Second
	cfg.MeanRunCycles = 1e9
	cfg.Scenarios.Overflow = true
	cfg.OverflowMargin = 5
	s := startServer(t, newMachines(t, 1, 42, cfg), Options{Mode: ModeUnit})
	ep := s.Endpoints()[0]
	c := dial(t, ep.Addr, ep.UnitID)

	before := readBlock(t, c, block.DefaultBase, block.CDAB)
	if before.Total != math.MaxUint32-5 {
		t.Fatalf("total inicial = %d, esperado %d", before.Total, uint32(math.MaxUint32-5))
	}
	regs, err := c.ReadRegisters(block.DefaultBase+block.OffsetTotal, 2, modbus.HOLDING_REGISTER)
	if err != nil {
		t.Fatal(err)
	}
	if regs[0] != 0xFFFA || regs[1] != 0xFFFF { // 4294967290 em CDAB
		t.Fatalf("words do total = [%#04x %#04x], esperado [0xfffa 0xffff]", regs[0], regs[1])
	}

	var wrapped bool
	for _, e := range mustAdvance(t, s, 20*time.Second) {
		if e.Kind == sim.EventCounterWrap && e.Counter == sim.CounterTotal {
			wrapped = true
		}
	}
	if !wrapped {
		t.Fatal("contador_total não deu a volta")
	}
	after := readBlock(t, c, block.DefaultBase, block.CDAB)
	if after.Total >= before.Total || after.Total > 20 {
		t.Fatalf("total após a volta = %d", after.Total)
	}
	// Delta pelo método do gateway: (max − anterior) + atual + 1.
	delta := uint64(math.MaxUint32-before.Total) + uint64(after.Total) + 1
	if delta < 15 || delta > 22 {
		t.Fatalf("delta com overflow = %d peças em ~20 ciclos", delta)
	}
}

func TestCounterResetScenarioThroughModbus(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Cycle = time.Second
	cfg.MeanRunCycles = 1e9
	cfg.Scenarios.CounterReset = true
	cfg.ResetEvery = time.Minute
	cfg.StartTotal = 5000
	s := startServer(t, newMachines(t, 1, 42, cfg), Options{Mode: ModeUnit})
	ep := s.Endpoints()[0]
	c := dial(t, ep.Addr, ep.UnitID)

	// Avança de 1 em 1 s até o primeiro reset.
	var reset *sim.Event
	for at := time.Second; at <= 2*time.Minute && reset == nil; at += time.Second {
		for _, e := range mustAdvance(t, s, at) {
			if e.Kind == sim.EventCounterReset {
				e := e
				reset = &e
			}
		}
	}
	if reset == nil {
		t.Fatal("nenhum reset em 2 min")
	}
	if reset.Total < 5000 {
		t.Fatalf("total antes do reset = %d, esperado >= 5000", reset.Total)
	}
	b := readBlock(t, c, block.DefaultBase, block.CDAB)
	if b.Total > 1 || b.Total >= reset.Total {
		t.Fatalf("total logo após o reset = %d (antes %d)", b.Total, reset.Total)
	}
}

func TestPortModeEachMachineOnItsOwnPort(t *testing.T) {
	ports := []int{freePort(t), freePort(t), freePort(t)}
	cfg := sim.DefaultConfig()
	s := startServer(t, newMachines(t, 3, 42, cfg), Options{Mode: ModePort, Ports: ports})

	for i, ep := range s.Endpoints() {
		if ep.Addr != fmt.Sprintf("127.0.0.1:%d", ports[i]) || ep.UnitID != 0 {
			t.Fatalf("endpoint M%d = %+v", i+1, ep)
		}
		// Qualquer unit id é aceito no modo port.
		c := dial(t, ep.Addr, 17)
		b := readBlock(t, c, block.DefaultBase, block.CDAB)
		if b.Product != sim.FirstProduct+uint16(i) {
			t.Fatalf("porta %d devolveu o produto %d: máquina errada?", ports[i], b.Product)
		}
	}
}

func TestOfflineUnitModeAnswersException0B(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Scenarios.Offline = true
	cfg.OfflineEvery = 10 * time.Second
	cfg.OfflineFor = 5 * time.Second
	ms := newMachines(t, 2, 42, cfg)
	s := startServer(t, ms, Options{Mode: ModeUnit})
	eps := s.Endpoints()
	c1 := dial(t, eps[0].Addr, eps[0].UnitID)

	_, onAt := findOfflineWindow(t, s, 0)
	if _, online := s.Snapshot(0); online {
		t.Fatal("M1 deveria estar offline")
	}
	_, err := c1.ReadRegisters(block.DefaultBase, block.Size, modbus.HOLDING_REGISTER)
	if !errors.Is(err, modbus.ErrGWTargetFailedToRespond) {
		t.Fatalf("leitura offline: erro %v, esperado exceção 0x0B", err)
	}
	_, err = c1.ReadCoils(0, 2)
	if !errors.Is(err, modbus.ErrGWTargetFailedToRespond) {
		t.Fatalf("coils offline: erro %v, esperado exceção 0x0B", err)
	}

	// As outras máquinas da mesma porta continuam respondendo (se estiverem online).
	if _, online := s.Snapshot(1); online {
		c2 := dial(t, eps[1].Addr, eps[1].UnitID)
		readBlock(t, c2, block.DefaultBase, block.CDAB)
	}

	mustAdvance(t, s, onAt)
	readBlock(t, c1, block.DefaultBase, block.CDAB) // voltou
}

// findOfflineWindow avança a simulação em passos de 100 ms até a máquina i
// cair e devolve o instante da queda e o da volta (ainda não alcançado).
func findOfflineWindow(t *testing.T, s *Server, i int) (offAt, onAt time.Duration) {
	t.Helper()
	for at := 100 * time.Millisecond; at < time.Hour; at += 100 * time.Millisecond {
		for _, e := range mustAdvance(t, s, at) {
			if e.Machine == i && e.Kind == sim.EventOffline {
				return e.At, e.At + e.Duration
			}
		}
	}
	t.Fatal("a máquina não caiu em 1 h")
	return 0, 0
}

func TestOfflinePortModeClosesPort(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Scenarios.Offline = true
	cfg.OfflineEvery = 10 * time.Second
	cfg.OfflineFor = 5 * time.Second
	ports := []int{freePort(t), freePort(t)}
	s := startServer(t, newMachines(t, 2, 42, cfg), Options{Mode: ModePort, Ports: ports})
	if s.Options().OfflineMode != OfflineClose {
		t.Fatalf("modo offline efetivo = %s, esperado close", s.Options().OfflineMode)
	}
	addr := s.Endpoints()[0].Addr
	c := dial(t, addr, 1)
	readBlock(t, c, block.DefaultBase, block.CDAB)

	_, onAt := findOfflineWindow(t, s, 0)

	if _, err := c.ReadRegisters(block.DefaultBase, block.Size, modbus.HOLDING_REGISTER); err == nil {
		t.Fatal("a conexão existente deveria ter sido derrubada")
	}
	if conn, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
		conn.Close()
		t.Fatal("a porta deveria estar fechada (conexão recusada)")
	}

	mustAdvance(t, s, onAt)
	c2 := dial(t, addr, 1)
	readBlock(t, c2, block.DefaultBase, block.CDAB)
}

func TestFrozenScenarioThroughModbus(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.Cycle = time.Second
	cfg.Scenarios.Frozen = true
	cfg.FreezeEvery = 10 * time.Second
	cfg.FreezeFor = 8 * time.Second
	s := startServer(t, newMachines(t, 1, 42, cfg), Options{Mode: ModeUnit})
	ep := s.Endpoints()[0]
	c := dial(t, ep.Addr, ep.UnitID)

	var freeze *sim.Event
	for at := time.Second; at < time.Hour && freeze == nil; at += time.Second {
		for _, e := range mustAdvance(t, s, at) {
			if e.Kind == sim.EventFreeze {
				e := e
				freeze = &e
			}
		}
	}
	if freeze == nil {
		t.Fatal("nenhum congelamento")
	}
	first := readBlock(t, c, block.DefaultBase, block.CDAB)
	mustAdvance(t, s, freeze.At+freeze.Duration-time.Millisecond)
	if again := readBlock(t, c, block.DefaultBase, block.CDAB); again != first {
		t.Fatal("o bloco mudou enquanto congelado")
	}
	mustAdvance(t, s, freeze.At+freeze.Duration+2*time.Second)
	if after := readBlock(t, c, block.DefaultBase, block.CDAB); after.Heartbeat == first.Heartbeat {
		t.Fatal("o heartbeat deveria voltar a andar")
	}
}

func TestExceptionsForInvalidRequests(t *testing.T) {
	s := startServer(t, newMachines(t, 2, 1, sim.DefaultConfig()), Options{Mode: ModeUnit})
	addr := s.Endpoints()[0].Addr
	c := dial(t, addr, 1)

	cases := []struct {
		name string
		do   func() error
		want error
	}{
		{"antes do bloco", func() error {
			_, err := c.ReadRegisters(block.DefaultBase-1, 2, modbus.HOLDING_REGISTER)
			return err
		}, modbus.ErrIllegalDataAddress},
		{"depois do bloco", func() error {
			_, err := c.ReadRegisters(block.DefaultBase+block.Size-1, 2, modbus.HOLDING_REGISTER)
			return err
		}, modbus.ErrIllegalDataAddress},
		{"escrita no bloco", func() error {
			return c.WriteRegister(block.DefaultBase, 7)
		}, modbus.ErrIllegalFunction},
		{"escrita de coil", func() error {
			return c.WriteCoil(0, true)
		}, modbus.ErrIllegalFunction},
		{"coil inexistente", func() error {
			_, err := c.ReadCoils(1, 2)
			return err
		}, modbus.ErrIllegalDataAddress},
		{"input registers", func() error {
			_, err := c.ReadRegisters(0, 1, modbus.INPUT_REGISTER)
			return err
		}, modbus.ErrIllegalDataAddress},
		{"discrete inputs", func() error {
			_, err := c.ReadDiscreteInputs(0, 1)
			return err
		}, modbus.ErrIllegalDataAddress},
	}
	for _, tc := range cases {
		if err := tc.do(); !errors.Is(err, tc.want) {
			t.Errorf("%s: erro %v, esperado %v", tc.name, err, tc.want)
		}
	}

	// Leitura parcial dentro do bloco funciona (ex.: só os 14 registradores usados).
	regs, err := c.ReadRegisters(block.DefaultBase+block.OffsetState, 2, modbus.HOLDING_REGISTER)
	if err != nil || len(regs) != 2 {
		t.Fatalf("leitura parcial: %v %v", regs, err)
	}

	// Unit id sem máquina: exceção 0x0A (caminho indisponível).
	if err := c.SetUnitId(3); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ReadRegisters(block.DefaultBase, 1, modbus.HOLDING_REGISTER); !errors.Is(err, modbus.ErrGWPathUnavailable) {
		t.Fatalf("unit id 3: erro %v, esperado exceção 0x0A", err)
	}
}

func TestCustomBaseAndWordOrder(t *testing.T) {
	cfg := sim.DefaultConfig()
	cfg.StartTotal = 0xA1B2C3D4
	s := startServer(t, newMachines(t, 1, 1, cfg), Options{Mode: ModeUnit, Base: 200, WordOrder: block.ABCD, UnitStart: 10})
	ep := s.Endpoints()[0]
	if ep.UnitID != 10 {
		t.Fatalf("unit id = %d, esperado 10", ep.UnitID)
	}
	c := dial(t, ep.Addr, ep.UnitID)
	regs, err := c.ReadRegisters(200+block.OffsetTotal, 2, modbus.HOLDING_REGISTER)
	if err != nil {
		t.Fatal(err)
	}
	if regs[0] != 0xA1B2 || regs[1] != 0xC3D4 {
		t.Fatalf("ABCD = [%#04x %#04x], esperado [0xa1b2 0xc3d4]", regs[0], regs[1])
	}
	if b := readBlock(t, c, 200, block.ABCD); b.Total != 0xA1B2C3D4 {
		t.Fatalf("total = %#x", b.Total)
	}
}

func TestNewValidatesOptions(t *testing.T) {
	ms := newMachines(t, 2, 1, sim.DefaultConfig())
	bad := []Options{
		{Mode: "bus", Port: 1502},
		{Mode: ModeUnit, Port: 0},
		{Mode: ModeUnit, Port: 1502, OfflineMode: OfflineClose},
		{Mode: ModeUnit, Port: 1502, OfflineMode: "drop"},
		{Mode: ModeUnit, Port: 1502, UnitStart: 247},
		{Mode: ModePort, Ports: []int{1502}},
		{Mode: ModePort, Port: 65535},
		{Mode: ModeUnit, Port: 1502, Base: 65520},
	}
	for i, o := range bad {
		if _, err := New(ms, o); err == nil {
			t.Errorf("caso %d (%+v): esperava erro", i, o)
		}
	}
	if _, err := New(nil, Options{Port: 1502}); err == nil {
		t.Error("esperava erro sem máquinas")
	}
}

func TestStartFailsWhenPortBusy(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	s, err := New(newMachines(t, 1, 1, sim.DefaultConfig()), Options{Host: "127.0.0.1", Port: l.Addr().(*net.TCPAddr).Port})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(); err == nil {
		s.Stop()
		t.Fatal("esperava erro com a porta ocupada")
	}
}

func TestAdvanceReturnsEventsInTimeOrder(t *testing.T) {
	s, err := New(newMachines(t, 3, 42, sim.DefaultConfig()), Options{Port: 1502})
	if err != nil {
		t.Fatal(err)
	}
	// Sem Start: Advance funciona sem abrir portas.
	evs := mustAdvance(t, s, time.Hour)
	if len(evs) == 0 {
		t.Fatal("nenhum evento")
	}
	machinesSeen := map[int]bool{}
	for i, e := range evs {
		machinesSeen[e.Machine] = true
		if i > 0 && e.At < evs[i-1].At {
			t.Fatalf("evento %d em %s antes do anterior (%s)", i, e.At, evs[i-1].At)
		}
	}
	if len(machinesSeen) != 3 {
		t.Fatalf("eventos de %d máquinas, esperado 3", len(machinesSeen))
	}
}
