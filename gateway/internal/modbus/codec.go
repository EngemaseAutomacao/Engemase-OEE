package modbus

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
)

// Value é um valor decodificado de uma tag.
//
// Inteiros com sinal guardam o valor com extensão de sinal; sem sinal, com extensão
// de zeros. Raw guarda os bits brutos na largura do tipo (útil para contadores, que
// tratam int16/int32 como sem sinal da mesma largura).
type Value struct {
	Type DataType
	b    bool
	i    int64
	f    float64
	raw  uint32
}

// BoolValue cria um Value booleano.
func BoolValue(v bool) Value {
	var r uint32
	if v {
		r = 1
	}
	return Value{Type: Bool, b: v, i: int64(r), f: float64(r), raw: r}
}

// Bool devolve o booleano (para números: diferente de zero).
func (v Value) Bool() bool {
	if v.Type == Bool {
		return v.b
	}
	if v.Type == Float32 {
		return v.f != 0
	}
	return v.i != 0
}

// Int64 devolve o valor inteiro (float32 é truncado).
func (v Value) Int64() int64 {
	if v.Type == Float32 {
		return int64(v.f)
	}
	return v.i
}

// Float64 devolve o valor como float64.
func (v Value) Float64() float64 { return v.f }

// Raw devolve os bits brutos na largura do tipo (16 ou 32 bits; bool = 0/1).
func (v Value) Raw() uint32 { return v.raw }

// String formata o valor para a CLI e logs.
func (v Value) String() string {
	switch v.Type {
	case Bool:
		return strconv.FormatBool(v.b)
	case Float32:
		return strconv.FormatFloat(v.f, 'g', -1, 32)
	default:
		return strconv.FormatInt(v.i, 10)
	}
}

// Scaled aplica a escala linear (valor × mul + add). mul = 0 é tratado como 1.
func (v Value) Scaled(mul, add float64) float64 {
	if mul == 0 {
		mul = 1
	}
	return v.f*mul + add
}

// RegistersFromBytes converte a resposta de FC03/FC04 (big-endian) em registradores.
func RegistersFromBytes(b []byte) ([]uint16, error) {
	if len(b)%2 != 0 {
		return nil, fmt.Errorf("resposta com %d bytes (precisa ser par)", len(b))
	}
	regs := make([]uint16, len(b)/2)
	for i := range regs {
		regs[i] = binary.BigEndian.Uint16(b[2*i:])
	}
	return regs, nil
}

// BitsFromBytes converte a resposta de FC01/FC02 (bit menos significativo primeiro).
func BitsFromBytes(b []byte, count int) ([]bool, error) {
	if len(b)*8 < count {
		return nil, fmt.Errorf("resposta com %d bytes não cobre %d bits", len(b), count)
	}
	bits := make([]bool, count)
	for i := range bits {
		bits[i] = b[i/8]&(1<<(uint(i)%8)) != 0
	}
	return bits, nil
}

// Combine32 monta os 32 bits a partir de dois registradores lidos em sequência
// (regs[0] no endereço menor), segundo a ordem de bytes.
func Combine32(r0, r1 uint16, order WordOrder) (uint32, error) {
	swap := func(w uint16) uint16 { return w<<8 | w>>8 }
	switch order {
	case ABCD:
		return uint32(r0)<<16 | uint32(r1), nil
	case CDAB:
		return uint32(r1)<<16 | uint32(r0), nil
	case BADC:
		return uint32(swap(r0))<<16 | uint32(swap(r1)), nil
	case DCBA:
		return uint32(swap(r1))<<16 | uint32(swap(r0)), nil
	}
	return 0, fmt.Errorf("tipo de 32 bits exige ordem de bytes (ABCD, CDAB, BADC ou DCBA)")
}

// Split32 é o inverso de Combine32: os dois registradores, na ordem em que o CLP os guarda.
func Split32(v uint32, order WordOrder) ([2]uint16, error) {
	swap := func(w uint16) uint16 { return w<<8 | w>>8 }
	hi, lo := uint16(v>>16), uint16(v)
	switch order {
	case ABCD:
		return [2]uint16{hi, lo}, nil
	case CDAB:
		return [2]uint16{lo, hi}, nil
	case BADC:
		return [2]uint16{swap(hi), swap(lo)}, nil
	case DCBA:
		return [2]uint16{swap(lo), swap(hi)}, nil
	}
	return [2]uint16{}, fmt.Errorf("ordem de bytes inválida")
}

// DecodeRegisters decodifica um valor a partir dos registradores da própria tag
// (1 registrador para 16 bits e bool com bit; 2 para 32 bits).
func DecodeRegisters(regs []uint16, typ DataType, order WordOrder, bit int) (Value, error) {
	if len(regs) < typ.Registers() {
		return Value{}, fmt.Errorf("%s precisa de %d registrador(es), recebeu %d", typ, typ.Registers(), len(regs))
	}
	switch typ {
	case Bool:
		if bit < 0 || bit > 15 {
			return Value{}, fmt.Errorf("bool em registrador exige bit entre 0 e 15")
		}
		return BoolValue(regs[0]&(1<<uint(bit)) != 0), nil
	case Uint16:
		r := uint32(regs[0])
		return Value{Type: typ, i: int64(r), f: float64(r), raw: r}, nil
	case Int16:
		s := int16(regs[0])
		return Value{Type: typ, i: int64(s), f: float64(s), raw: uint32(regs[0])}, nil
	case Uint32, Int32, Float32:
		r, err := Combine32(regs[0], regs[1], order)
		if err != nil {
			return Value{}, err
		}
		switch typ {
		case Uint32:
			return Value{Type: typ, i: int64(r), f: float64(r), raw: r}, nil
		case Int32:
			s := int32(r)
			return Value{Type: typ, i: int64(s), f: float64(s), raw: r}, nil
		default:
			f := float64(math.Float32frombits(r))
			return Value{Type: typ, i: int64(f), f: f, raw: r}, nil
		}
	}
	return Value{}, fmt.Errorf("tipo de dado inválido")
}

// Raw é o resultado de uma leitura em bloco.
type Raw struct {
	Span Span
	Regs []uint16 // áreas de registradores
	Bits []bool   // áreas de bits
}

// Decode extrai o valor de uma tag de uma leitura em bloco que a contenha.
func (r Raw) Decode(t TagSpec) (Value, error) {
	sp := t.Span()
	if !r.Span.Contains(sp.Area, sp.Start, int(sp.Count)) {
		return Value{}, fmt.Errorf("tag %s fora do bloco lido %s", sp, r.Span)
	}
	idx := int(t.Offset) - int(r.Span.Start)
	if t.Area.IsBit() {
		if t.Type != Bool {
			return Value{}, fmt.Errorf("%s só aceita bool", t.Area)
		}
		if idx >= len(r.Bits) {
			return Value{}, fmt.Errorf("leitura incompleta")
		}
		return BoolValue(r.Bits[idx]), nil
	}
	if idx+t.Type.Registers() > len(r.Regs) {
		return Value{}, fmt.Errorf("leitura incompleta")
	}
	return DecodeRegisters(r.Regs[idx:idx+t.Type.Registers()], t.Type, t.WordOrder, t.Bit)
}
