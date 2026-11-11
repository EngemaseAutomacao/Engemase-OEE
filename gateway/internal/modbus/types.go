// Package modbus reúne o que o agente precisa para ler CLPs por Modbus TCP, RTU
// (RS-485) e RTU sobre TCP: áreas, tipos, ordens de bytes, decodificação,
// planejamento de blocos e um cliente SOMENTE LEITURA sobre a github.com/grid-x/modbus.
//
// Endereços são sempre em base 0 (o "40001" da convenção é o holding register 0).
package modbus

import (
	"fmt"
	"strings"
)

// Limites do protocolo Modbus por transação.
const (
	// MaxRegistersPerRead é o máximo de registradores numa leitura FC03/FC04.
	MaxRegistersPerRead = 125
	// MaxBitsPerRead é o máximo de bits numa leitura FC01/FC02.
	MaxBitsPerRead = 2000
	// MaxOffset é o maior endereço (base 0).
	MaxOffset = 65535
)

// Area é a área de memória Modbus.
type Area uint8

// Áreas Modbus. A ordem segue a convenção 0xxxx/1xxxx/3xxxx/4xxxx.
const (
	Coil            Area = iota + 1 // FC01, 0xxxx
	DiscreteInput                   // FC02, 1xxxx
	InputRegister                   // FC04, 3xxxx
	HoldingRegister                 // FC03, 4xxxx
)

var areaNames = map[Area]string{
	Coil:            "coil",
	DiscreteInput:   "discrete_input",
	InputRegister:   "input_register",
	HoldingRegister: "holding_register",
}

// ParseArea aceita o nome do contrato ("holding_register") ou a abreviação da CLI
// ("hr", "ir", "co", "di").
func ParseArea(s string) (Area, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "coil", "co", "coils":
		return Coil, nil
	case "discrete_input", "di", "discrete_inputs":
		return DiscreteInput, nil
	case "input_register", "ir", "input_registers":
		return InputRegister, nil
	case "holding_register", "hr", "holding_registers":
		return HoldingRegister, nil
	}
	return 0, fmt.Errorf("área Modbus inválida %q (use coil, discrete_input, input_register ou holding_register)", s)
}

// String devolve o nome usado no contrato.
func (a Area) String() string {
	if n, ok := areaNames[a]; ok {
		return n
	}
	return fmt.Sprintf("area(%d)", uint8(a))
}

// Valid indica se a área é conhecida.
func (a Area) Valid() bool { _, ok := areaNames[a]; return ok }

// IsBit indica áreas de 1 bit (coils e discrete inputs).
func (a Area) IsBit() bool { return a == Coil || a == DiscreteInput }

// MaxPerRead é o limite de itens (registradores ou bits) por leitura nesta área.
func (a Area) MaxPerRead() int {
	if a.IsBit() {
		return MaxBitsPerRead
	}
	return MaxRegistersPerRead
}

// Convention devolve o endereço na convenção clássica de 5/6 dígitos (ex.: 40001),
// só para exibição. O agente nunca usa esse número para ler.
func (a Area) Convention(offset uint16) string {
	prefix := map[Area]int{Coil: 0, DiscreteInput: 1, InputRegister: 3, HoldingRegister: 4}[a]
	return fmt.Sprintf("%d%05d", prefix, int(offset)+1)
}

// DataType é o tipo de dado de uma tag.
type DataType uint8

// Tipos suportados no MVP.
const (
	Bool DataType = iota + 1
	Int16
	Uint16
	Int32
	Uint32
	Float32
)

var typeNames = map[DataType]string{
	Bool: "bool", Int16: "int16", Uint16: "uint16", Int32: "int32", Uint32: "uint32", Float32: "float32",
}

// ParseDataType converte o nome do contrato ("uint32") para DataType.
func ParseDataType(s string) (DataType, error) {
	for t, n := range typeNames {
		if n == strings.ToLower(strings.TrimSpace(s)) {
			return t, nil
		}
	}
	return 0, fmt.Errorf("tipo de dado inválido %q (use bool, int16, uint16, int32, uint32 ou float32)", s)
}

func (t DataType) String() string {
	if n, ok := typeNames[t]; ok {
		return n
	}
	return fmt.Sprintf("type(%d)", uint8(t))
}

// Valid indica se o tipo é conhecido.
func (t DataType) Valid() bool { _, ok := typeNames[t]; return ok }

// Is32Bit indica tipos que ocupam 2 registradores.
func (t DataType) Is32Bit() bool { return t == Int32 || t == Uint32 || t == Float32 }

// IsInteger indica tipos inteiros.
func (t DataType) IsInteger() bool { return t == Int16 || t == Uint16 || t == Int32 || t == Uint32 }

// Registers é a quantidade de registradores de 16 bits ocupada (bool em registrador = 1).
func (t DataType) Registers() int {
	if t.Is32Bit() {
		return 2
	}
	return 1
}

// Bits é a largura do valor bruto (16 ou 32; bool = 1).
func (t DataType) Bits() int {
	switch t {
	case Bool:
		return 1
	case Int16, Uint16:
		return 16
	default:
		return 32
	}
}

// WordOrder é a ordem dos bytes num valor de 32 bits. A é o byte mais significativo.
type WordOrder uint8

// Ordens suportadas. O zero (WordOrderNone) vale para tipos de 16 bits e bool.
const (
	WordOrderNone WordOrder = iota
	ABCD                    // big-endian: word alta primeiro
	CDAB                    // word baixa primeiro (padrão do bloco OEE Engemase)
	BADC                    // bytes trocados em cada word, word alta primeiro
	DCBA                    // little-endian
)

var orderNames = map[WordOrder]string{ABCD: "ABCD", CDAB: "CDAB", BADC: "BADC", DCBA: "DCBA"}

// ParseWordOrder converte "CDAB" etc. String vazia devolve WordOrderNone.
func ParseWordOrder(s string) (WordOrder, error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" {
		return WordOrderNone, nil
	}
	for o, n := range orderNames {
		if n == s {
			return o, nil
		}
	}
	return 0, fmt.Errorf("ordem de bytes inválida %q (use ABCD, CDAB, BADC ou DCBA)", s)
}

func (o WordOrder) String() string {
	if n, ok := orderNames[o]; ok {
		return n
	}
	return ""
}

// Span é uma faixa contígua de uma área: o que vai numa única transação.
type Span struct {
	Area  Area
	Start uint16 // base 0
	Count uint16 // registradores ou bits
}

// End devolve o último endereço da faixa (inclusive).
func (s Span) End() int { return int(s.Start) + int(s.Count) - 1 }

// Contains indica se a faixa cobre [offset, offset+n-1] na mesma área.
func (s Span) Contains(area Area, offset uint16, n int) bool {
	return s.Area == area && int(offset) >= int(s.Start) && int(offset)+n-1 <= s.End()
}

// Validate confere limites de quantidade e de endereço.
func (s Span) Validate() error {
	if !s.Area.Valid() {
		return fmt.Errorf("área inválida")
	}
	if s.Count < 1 || int(s.Count) > s.Area.MaxPerRead() {
		return fmt.Errorf("quantidade %d fora do limite de %d por leitura em %s", s.Count, s.Area.MaxPerRead(), s.Area)
	}
	if s.End() > MaxOffset {
		return fmt.Errorf("faixa %d..%d passa do endereço %d", s.Start, s.End(), MaxOffset)
	}
	return nil
}

func (s Span) String() string {
	return fmt.Sprintf("%s[%d..%d]", s.Area, s.Start, s.End())
}

// TagSpec descreve como extrair um valor de uma leitura.
type TagSpec struct {
	Area      Area
	Offset    uint16
	Bit       int // -1 = sem bit; 0–15 = bit do registrador (só para Bool em registrador)
	Type      DataType
	WordOrder WordOrder
}

// Span devolve a faixa ocupada pela tag.
func (t TagSpec) Span() Span {
	n := 1
	if !t.Area.IsBit() {
		n = t.Type.Registers()
	}
	return Span{Area: t.Area, Start: t.Offset, Count: uint16(n)}
}
