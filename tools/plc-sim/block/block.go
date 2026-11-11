// Package block define o layout do bloco OEE padrão Engemase (docs/11, seção 3)
// e a codificação/decodificação dos holding registers, incluindo a ordem das
// words de 32 bits (ABCD, CDAB, BADC, DCBA).
package block

import (
	"fmt"
	"strings"
)

// Version é o valor de versao_bloco exposto pelo simulador.
const Version uint16 = 1

// Size é o tamanho do bloco em holding registers (offsets 0–31; 14–31 reservados).
const Size = 32

// UsedSize é a quantidade de registradores com significado (offsets 0–13).
const UsedSize = 14

// DefaultBase é o endereço base padrão do bloco (endereço de protocolo, base 0).
const DefaultBase uint16 = 1000

// Offsets dos campos dentro do bloco.
const (
	OffsetVersion     = 0
	OffsetHeartbeat   = 1
	OffsetState       = 2
	OffsetFaultCode   = 3
	OffsetTotal       = 4 // uint32: offsets 4–5
	OffsetReject      = 6 // uint32: offsets 6–7
	OffsetGood        = 8 // uint32: offsets 8–9
	OffsetProduct     = 10
	OffsetSpeed       = 11
	OffsetLastCycleMs = 12
	OffsetStatusBits  = 13
)

// Coils expostas pelo simulador.
const (
	CoilRunning = 0 // rodando
	CoilFault   = 1 // falha
	CoilCount   = 2
)

// Bits de bits_status.
const (
	StatusAutomatic    uint16 = 1 << 0 // automático
	StatusDoorOpen     uint16 = 1 << 1 // porta aberta
	StatusNoMaterial   uint16 = 1 << 2 // falta material
	StatusMaintenance  uint16 = 1 << 3 // manutenção
	knownStatusBitMask        = StatusAutomatic | StatusDoorOpen | StatusNoMaterial | StatusMaintenance
)

// Block é o conteúdo decodificado do bloco OEE padrão.
type Block struct {
	Version     uint16 // versao_bloco
	Heartbeat   uint16 // heartbeat
	State       uint16 // estado
	FaultCode   uint16 // codigo_falha
	Total       uint32 // contador_total
	Reject      uint32 // contador_refugo
	Good        uint32 // contador_bons
	Product     uint16 // produto
	Speed       uint16 // velocidade
	LastCycleMs uint16 // ciclo_ultimo_ms
	StatusBits  uint16 // bits_status
}

// WordOrder é a ordem dos bytes/words de um valor de 32 bits nos registradores.
// As letras representam os bytes do valor, de A (mais significativo) a D.
// O valor zero é CDAB, o padrão do bloco Engemase.
type WordOrder int

const (
	// CDAB: word baixa primeiro (padrão do bloco Engemase; valor zero do tipo).
	CDAB WordOrder = iota
	// ABCD: word alta primeiro, bytes em big-endian.
	ABCD
	// BADC: word alta primeiro, bytes trocados dentro de cada word.
	BADC
	// DCBA: word baixa primeiro, bytes trocados dentro de cada word.
	DCBA
)

// DefaultWordOrder é a ordem padrão do bloco OEE (docs/11, seção 3).
const DefaultWordOrder = CDAB

func (o WordOrder) String() string {
	switch o {
	case ABCD:
		return "ABCD"
	case CDAB:
		return "CDAB"
	case BADC:
		return "BADC"
	case DCBA:
		return "DCBA"
	default:
		return fmt.Sprintf("WordOrder(%d)", int(o))
	}
}

// ParseWordOrder interpreta "ABCD", "CDAB", "BADC" ou "DCBA" (sem diferenciar maiúsculas).
func ParseWordOrder(s string) (WordOrder, error) {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "ABCD":
		return ABCD, nil
	case "CDAB":
		return CDAB, nil
	case "BADC":
		return BADC, nil
	case "DCBA":
		return DCBA, nil
	default:
		return 0, fmt.Errorf("ordem de words inválida %q (use ABCD, CDAB, BADC ou DCBA)", s)
	}
}

func swapBytes(w uint16) uint16 { return w<<8 | w>>8 }

// PutUint32 grava v em dst[0] e dst[1] na ordem informada.
func PutUint32(dst []uint16, v uint32, order WordOrder) {
	hi := uint16(v >> 16)
	lo := uint16(v)
	switch order {
	case ABCD:
		dst[0], dst[1] = hi, lo
	case CDAB:
		dst[0], dst[1] = lo, hi
	case BADC:
		dst[0], dst[1] = swapBytes(hi), swapBytes(lo)
	case DCBA:
		dst[0], dst[1] = swapBytes(lo), swapBytes(hi)
	default:
		panic(fmt.Sprintf("block: ordem de words desconhecida %d", int(order)))
	}
}

// Uint32 lê um valor de 32 bits de src[0] e src[1] na ordem informada.
func Uint32(src []uint16, order WordOrder) uint32 {
	var hi, lo uint16
	switch order {
	case ABCD:
		hi, lo = src[0], src[1]
	case CDAB:
		lo, hi = src[0], src[1]
	case BADC:
		hi, lo = swapBytes(src[0]), swapBytes(src[1])
	case DCBA:
		lo, hi = swapBytes(src[0]), swapBytes(src[1])
	default:
		panic(fmt.Sprintf("block: ordem de words desconhecida %d", int(order)))
	}
	return uint32(hi)<<16 | uint32(lo)
}

// Registers codifica o bloco nos 32 holding registers (reservados em zero).
func (b Block) Registers(order WordOrder) [Size]uint16 {
	var r [Size]uint16
	r[OffsetVersion] = b.Version
	r[OffsetHeartbeat] = b.Heartbeat
	r[OffsetState] = b.State
	r[OffsetFaultCode] = b.FaultCode
	PutUint32(r[OffsetTotal:], b.Total, order)
	PutUint32(r[OffsetReject:], b.Reject, order)
	PutUint32(r[OffsetGood:], b.Good, order)
	r[OffsetProduct] = b.Product
	r[OffsetSpeed] = b.Speed
	r[OffsetLastCycleMs] = b.LastCycleMs
	r[OffsetStatusBits] = b.StatusBits
	return r
}

// Decode decodifica os registradores lidos a partir do offset 0 do bloco.
// Exige pelo menos UsedSize registradores.
func Decode(regs []uint16, order WordOrder) (Block, error) {
	if len(regs) < UsedSize {
		return Block{}, fmt.Errorf("bloco OEE incompleto: %d registradores (mínimo %d)", len(regs), UsedSize)
	}
	return Block{
		Version:     regs[OffsetVersion],
		Heartbeat:   regs[OffsetHeartbeat],
		State:       regs[OffsetState],
		FaultCode:   regs[OffsetFaultCode],
		Total:       Uint32(regs[OffsetTotal:], order),
		Reject:      Uint32(regs[OffsetReject:], order),
		Good:        Uint32(regs[OffsetGood:], order),
		Product:     regs[OffsetProduct],
		Speed:       regs[OffsetSpeed],
		LastCycleMs: regs[OffsetLastCycleMs],
		StatusBits:  regs[OffsetStatusBits],
	}, nil
}

// HoldingRegisterConvention devolve o endereço na convenção 4xxxx (base 1)
// para um endereço de protocolo (base 0). Ex.: 1000 → "41001".
func HoldingRegisterConvention(addr uint16) string {
	return fmt.Sprintf("4%04d", uint32(addr)+1)
}

// KnownStatusBits indica se só bits documentados estão ligados.
func KnownStatusBits(bits uint16) bool { return bits&^knownStatusBitMask == 0 }
