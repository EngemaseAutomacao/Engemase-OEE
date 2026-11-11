package plcserver

import (
	"github.com/simonvetter/modbus"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/sim"
)

// handler atende as requisições Modbus. Com machine >= 0 (modo port) atende
// uma máquina e aceita qualquer unit id; com machine < 0 (modo unit) escolhe a
// máquina pelo unit id.
//
// A biblioteca converte os erros sentinela (modbus.Err*) em códigos de exceção
// comparando por igualdade: devolva-os sem embrulhar.
type handler struct {
	s       *Server
	machine int
}

var _ modbus.RequestHandler = (*handler)(nil)

// lookup encontra a máquina e confere se ela responde. Chamar com s.mu travado.
func (h *handler) lookup(unitID uint8) (*sim.Machine, error) {
	idx := h.machine
	if idx < 0 {
		start := h.s.opts.UnitStart
		if unitID < start || int(unitID-start) >= len(h.s.machines) {
			// Igual a um conversor TCP→RTU sem rota para esse escravo.
			return nil, modbus.ErrGWPathUnavailable
		}
		idx = int(unitID - start)
	}
	m := h.s.machines[idx]
	if !m.Online() {
		// Exceção 0x0B: escravo não respondeu (no modo close a porta já estaria fechada).
		return nil, modbus.ErrGWTargetFailedToRespond
	}
	return m, nil
}

// HandleHoldingRegisters atende FC03 (leitura) e recusa FC06/FC16: o bloco é
// somente leitura para o gateway (docs/11, seção 3).
func (h *handler) HandleHoldingRegisters(req *modbus.HoldingRegistersRequest) ([]uint16, error) {
	h.s.mu.Lock()
	defer h.s.mu.Unlock()
	m, err := h.lookup(req.UnitId)
	if err != nil {
		return nil, err
	}
	if req.IsWrite {
		return nil, modbus.ErrIllegalFunction
	}
	base := uint32(h.s.opts.Base)
	start := uint32(req.Addr)
	end := start + uint32(req.Quantity)
	if start < base || end > base+block.Size {
		return nil, modbus.ErrIllegalDataAddress
	}
	regs := m.Block().Registers(h.s.opts.WordOrder)
	out := make([]uint16, req.Quantity)
	copy(out, regs[start-base:end-base])
	return out, nil
}

// HandleCoils atende FC01 nas coils 0 (rodando) e 1 (falha); escrita é recusada.
func (h *handler) HandleCoils(req *modbus.CoilsRequest) ([]bool, error) {
	h.s.mu.Lock()
	defer h.s.mu.Unlock()
	m, err := h.lookup(req.UnitId)
	if err != nil {
		return nil, err
	}
	if req.IsWrite {
		return nil, modbus.ErrIllegalFunction
	}
	end := uint32(req.Addr) + uint32(req.Quantity)
	if end > block.CoilCount {
		return nil, modbus.ErrIllegalDataAddress
	}
	coils := m.Coils()
	out := make([]bool, req.Quantity)
	copy(out, coils[req.Addr:end])
	return out, nil
}

// HandleDiscreteInputs: área não mapeada no simulador.
func (h *handler) HandleDiscreteInputs(req *modbus.DiscreteInputsRequest) ([]bool, error) {
	h.s.mu.Lock()
	defer h.s.mu.Unlock()
	if _, err := h.lookup(req.UnitId); err != nil {
		return nil, err
	}
	return nil, modbus.ErrIllegalDataAddress
}

// HandleInputRegisters: área não mapeada no simulador.
func (h *handler) HandleInputRegisters(req *modbus.InputRegistersRequest) ([]uint16, error) {
	h.s.mu.Lock()
	defer h.s.mu.Unlock()
	if _, err := h.lookup(req.UnitId); err != nil {
		return nil, err
	}
	return nil, modbus.ErrIllegalDataAddress
}
