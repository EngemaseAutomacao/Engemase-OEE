package modbus

import (
	"math"
	"testing"
)

func TestCombine32AllOrders(t *testing.T) {
	// Valor de referência 0xA1B2C3D4: A=0xA1, B=0xB2, C=0xC3, D=0xD4.
	const want = uint32(0xA1B2C3D4)
	cases := []struct {
		order  WordOrder
		r0, r1 uint16 // como o CLP guarda (endereço menor primeiro)
	}{
		{ABCD, 0xA1B2, 0xC3D4},
		{CDAB, 0xC3D4, 0xA1B2},
		{BADC, 0xB2A1, 0xD4C3},
		{DCBA, 0xD4C3, 0xB2A1},
	}
	for _, c := range cases {
		t.Run(c.order.String(), func(t *testing.T) {
			got, err := Combine32(c.r0, c.r1, c.order)
			if err != nil {
				t.Fatal(err)
			}
			if got != want {
				t.Fatalf("Combine32 = %#08x, quer %#08x", got, want)
			}
			regs, err := Split32(want, c.order)
			if err != nil {
				t.Fatal(err)
			}
			if regs != [2]uint16{c.r0, c.r1} {
				t.Fatalf("Split32 = %#04x, quer [%#04x %#04x]", regs, c.r0, c.r1)
			}
		})
	}
	if _, err := Combine32(1, 2, WordOrderNone); err == nil {
		t.Fatal("ordem vazia deveria falhar")
	}
}

func TestDecodeRegistersTable(t *testing.T) {
	f32 := func(f float32, o WordOrder) []uint16 {
		r, _ := Split32(math.Float32bits(f), o)
		return r[:]
	}
	u32 := func(v uint32, o WordOrder) []uint16 {
		r, _ := Split32(v, o)
		return r[:]
	}
	cases := []struct {
		name    string
		regs    []uint16
		typ     DataType
		order   WordOrder
		bit     int
		wantI   int64
		wantF   float64
		wantB   bool
		wantRaw uint32
	}{
		{"uint16 máximo", []uint16{0xFFFF}, Uint16, WordOrderNone, -1, 65535, 65535, true, 0xFFFF},
		{"uint16 zero", []uint16{0}, Uint16, WordOrderNone, -1, 0, 0, false, 0},
		{"int16 negativo", []uint16{0xFFFE}, Int16, WordOrderNone, -1, -2, -2, true, 0xFFFE},
		{"int16 mínimo", []uint16{0x8000}, Int16, WordOrderNone, -1, -32768, -32768, true, 0x8000},
		{"uint32 CDAB 100000", u32(100000, CDAB), Uint32, CDAB, -1, 100000, 100000, true, 100000},
		{"uint32 ABCD 100000", u32(100000, ABCD), Uint32, ABCD, -1, 100000, 100000, true, 100000},
		{"uint32 BADC máximo", u32(math.MaxUint32, BADC), Uint32, BADC, -1, math.MaxUint32, math.MaxUint32, true, math.MaxUint32},
		{"uint32 DCBA 0x01020304", u32(0x01020304, DCBA), Uint32, DCBA, -1, 0x01020304, 0x01020304, true, 0x01020304},
		{"int32 CDAB -1", u32(0xFFFFFFFF, CDAB), Int32, CDAB, -1, -1, -1, true, 0xFFFFFFFF},
		{"int32 ABCD mínimo", u32(0x80000000, ABCD), Int32, ABCD, -1, math.MinInt32, math.MinInt32, true, 0x80000000},
		{"float32 ABCD 212.5", f32(212.5, ABCD), Float32, ABCD, -1, 212, 212.5, true, math.Float32bits(212.5)},
		{"float32 CDAB -1.25", f32(-1.25, CDAB), Float32, CDAB, -1, -1, -1.25, true, math.Float32bits(-1.25)},
		{"float32 BADC 3.5", f32(3.5, BADC), Float32, BADC, -1, 3, 3.5, true, math.Float32bits(3.5)},
		{"float32 DCBA 0", f32(0, DCBA), Float32, DCBA, -1, 0, 0, false, 0},
		{"bool bit 3 ligado", []uint16{0x0008}, Bool, WordOrderNone, 3, 1, 1, true, 1},
		{"bool bit 3 desligado", []uint16{0xFFF7}, Bool, WordOrderNone, 3, 0, 0, false, 0},
		{"bool bit 15", []uint16{0x8000}, Bool, WordOrderNone, 15, 1, 1, true, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v, err := DecodeRegisters(c.regs, c.typ, c.order, c.bit)
			if err != nil {
				t.Fatal(err)
			}
			if v.Int64() != c.wantI || v.Float64() != c.wantF || v.Bool() != c.wantB || v.Raw() != c.wantRaw {
				t.Fatalf("got int=%d float=%g bool=%v raw=%#x; quer int=%d float=%g bool=%v raw=%#x",
					v.Int64(), v.Float64(), v.Bool(), v.Raw(), c.wantI, c.wantF, c.wantB, c.wantRaw)
			}
		})
	}
}

func TestDecodeRegistersErrors(t *testing.T) {
	if _, err := DecodeRegisters([]uint16{1}, Uint32, CDAB, -1); err == nil {
		t.Fatal("uint32 com 1 registrador deveria falhar")
	}
	if _, err := DecodeRegisters([]uint16{1, 2}, Float32, WordOrderNone, -1); err == nil {
		t.Fatal("float32 sem ordem deveria falhar")
	}
	if _, err := DecodeRegisters([]uint16{1}, Bool, WordOrderNone, -1); err == nil {
		t.Fatal("bool em registrador sem bit deveria falhar")
	}
	if _, err := DecodeRegisters([]uint16{1}, Bool, WordOrderNone, 16); err == nil {
		t.Fatal("bit 16 deveria falhar")
	}
}

// Propriedade: decodificar(codificar(x)) = x, para várias amostras e todas as ordens.
func TestRoundTrip32(t *testing.T) {
	samples := []uint32{0, 1, 255, 256, 65535, 65536, 0x12345678, 0x7FFFFFFF, 0x80000000, math.MaxUint32}
	for v := uint32(1); v < 1<<31; v = v*7 + 3 {
		samples = append(samples, v)
	}
	for _, o := range []WordOrder{ABCD, CDAB, BADC, DCBA} {
		for _, x := range samples {
			regs, err := Split32(x, o)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Combine32(regs[0], regs[1], o)
			if err != nil || got != x {
				t.Fatalf("%s: %#x → %#x → %#x (%v)", o, x, regs, got, err)
			}
		}
	}
}

func TestRawDecodeBlock(t *testing.T) {
	// Bloco OEE padrão a partir do HR 1000: estado em 1002, contador uint32 CDAB em 1004.
	regs := make([]uint16, 14)
	regs[2] = 1
	c, _ := Split32(1048213, CDAB)
	regs[4], regs[5] = c[0], c[1]
	raw := Raw{Span: Span{Area: HoldingRegister, Start: 1000, Count: 14}, Regs: regs}

	v, err := raw.Decode(TagSpec{Area: HoldingRegister, Offset: 1004, Bit: -1, Type: Uint32, WordOrder: CDAB})
	if err != nil || v.Int64() != 1048213 {
		t.Fatalf("contador = %v (%v)", v, err)
	}
	v, err = raw.Decode(TagSpec{Area: HoldingRegister, Offset: 1002, Bit: -1, Type: Uint16})
	if err != nil || v.Int64() != 1 {
		t.Fatalf("estado = %v (%v)", v, err)
	}
	if _, err := raw.Decode(TagSpec{Area: HoldingRegister, Offset: 1013, Bit: -1, Type: Uint32, WordOrder: CDAB}); err == nil {
		t.Fatal("tag parcialmente fora do bloco deveria falhar")
	}
	if _, err := raw.Decode(TagSpec{Area: InputRegister, Offset: 1002, Bit: -1, Type: Uint16}); err == nil {
		t.Fatal("área diferente deveria falhar")
	}

	bits := Raw{Span: Span{Area: DiscreteInput, Start: 0, Count: 8}, Bits: []bool{false, true, false, false, false, false, false, true}}
	if v, err := bits.Decode(TagSpec{Area: DiscreteInput, Offset: 7, Bit: -1, Type: Bool}); err != nil || !v.Bool() {
		t.Fatalf("bit 7 = %v (%v)", v, err)
	}
}

func TestBytesConversion(t *testing.T) {
	regs, err := RegistersFromBytes([]byte{0x12, 0x34, 0xAB, 0xCD})
	if err != nil || regs[0] != 0x1234 || regs[1] != 0xABCD {
		t.Fatalf("regs = %#x (%v)", regs, err)
	}
	if _, err := RegistersFromBytes([]byte{1}); err == nil {
		t.Fatal("número ímpar de bytes deveria falhar")
	}
	bits, err := BitsFromBytes([]byte{0b0000_0101, 0b1}, 9)
	if err != nil {
		t.Fatal(err)
	}
	want := []bool{true, false, true, false, false, false, false, false, true}
	for i := range want {
		if bits[i] != want[i] {
			t.Fatalf("bit %d = %v, quer %v", i, bits[i], want[i])
		}
	}
}

func TestParseNames(t *testing.T) {
	for _, s := range []string{"hr", "holding_register"} {
		if a, err := ParseArea(s); err != nil || a != HoldingRegister {
			t.Fatalf("ParseArea(%q) = %v, %v", s, a, err)
		}
	}
	if _, err := ParseArea("xx"); err == nil {
		t.Fatal("área inválida deveria falhar")
	}
	if typ, err := ParseDataType("float32"); err != nil || typ != Float32 {
		t.Fatalf("ParseDataType = %v, %v", typ, err)
	}
	if o, err := ParseWordOrder("cdab"); err != nil || o != CDAB {
		t.Fatalf("ParseWordOrder = %v, %v", o, err)
	}
	if HoldingRegister.Convention(0) != "400001" || Coil.Convention(9) != "000010" {
		t.Fatalf("convenção: %s %s", HoldingRegister.Convention(0), Coil.Convention(9))
	}
}

func TestDecodeOEEBlock(t *testing.T) {
	regs := make([]uint16, 14)
	regs[0], regs[1], regs[2], regs[3] = 1, 77, 2, 520
	for i, v := range []uint32{100000, 12, 99988} {
		r, _ := Split32(v, CDAB)
		regs[4+2*i], regs[5+2*i] = r[0], r[1]
	}
	regs[10], regs[11], regs[12], regs[13] = 1001, 600, 5865, 0b101
	b, err := DecodeOEEBlock(regs, CDAB)
	if err != nil {
		t.Fatal(err)
	}
	want := OEEBlock{Version: 1, Heartbeat: 77, State: 2, FaultCode: 520, Total: 100000, Reject: 12, Good: 99988, Product: 1001, Speed: 600, LastCycleMS: 5865, StatusBits: 5}
	if b != want || b.StateName() != "falha" {
		t.Fatalf("bloco = %+v (%s)", b, b.StateName())
	}
	if _, err := DecodeOEEBlock(regs[:13], CDAB); err == nil {
		t.Fatal("bloco curto deveria falhar")
	}
}
