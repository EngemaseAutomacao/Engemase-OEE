package modbus

import "fmt"

// OEEBlockRegisters é o tamanho usado do bloco OEE padrão Engemase (offsets 0–13;
// 14–31 são reservados). Ver docs/11 §3.
const OEEBlockRegisters = 14

// OEEBlock é o bloco OEE padrão Engemase decodificado.
type OEEBlock struct {
	Version     uint16 // versao_bloco
	Heartbeat   uint16 // heartbeat
	State       uint16 // estado: 0 parada · 1 produzindo · 2 falha · 3 setup · 4 manual · 5 emergência
	FaultCode   uint16 // codigo_falha
	Total       uint32 // contador_total
	Reject      uint32 // contador_refugo
	Good        uint32 // contador_bons (informativo: o template padrão não o lê; boas = total − refugo, docs/11 §3)
	Product     uint16 // produto
	Speed       uint16 // velocidade
	LastCycleMS uint16 // ciclo_ultimo_ms
	StatusBits  uint16 // bits_status
}

// StateName traduz o código de estado do bloco.
func (b OEEBlock) StateName() string {
	names := []string{"parada", "produzindo", "falha", "setup", "manual", "emergência"}
	if int(b.State) < len(names) {
		return names[b.State]
	}
	return fmt.Sprintf("desconhecido (%d)", b.State)
}

// DecodeOEEBlock decodifica os 14 primeiros registradores do bloco (32 bits na
// ordem informada; o padrão do bloco é CDAB).
func DecodeOEEBlock(regs []uint16, order WordOrder) (OEEBlock, error) {
	if len(regs) < OEEBlockRegisters {
		return OEEBlock{}, fmt.Errorf("bloco OEE precisa de %d registradores, veio %d", OEEBlockRegisters, len(regs))
	}
	u32 := func(i int) (uint32, error) { return Combine32(regs[i], regs[i+1], order) }
	b := OEEBlock{
		Version: regs[0], Heartbeat: regs[1], State: regs[2], FaultCode: regs[3],
		Product: regs[10], Speed: regs[11], LastCycleMS: regs[12], StatusBits: regs[13],
	}
	var err error
	if b.Total, err = u32(4); err != nil {
		return OEEBlock{}, err
	}
	if b.Reject, err = u32(6); err != nil {
		return OEEBlock{}, err
	}
	if b.Good, err = u32(8); err != nil {
		return OEEBlock{}, err
	}
	return b, nil
}
