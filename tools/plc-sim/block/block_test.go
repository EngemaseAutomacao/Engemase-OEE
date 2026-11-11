package block

import (
	"testing"
)

func TestPutUint32WordOrders(t *testing.T) {
	// 0xA1B2C3D4: bytes A=A1, B=B2, C=C3, D=D4.
	const v uint32 = 0xA1B2C3D4
	cases := []struct {
		order WordOrder
		want  [2]uint16
	}{
		{ABCD, [2]uint16{0xA1B2, 0xC3D4}},
		{CDAB, [2]uint16{0xC3D4, 0xA1B2}},
		{BADC, [2]uint16{0xB2A1, 0xD4C3}},
		{DCBA, [2]uint16{0xD4C3, 0xB2A1}},
	}
	for _, c := range cases {
		t.Run(c.order.String(), func(t *testing.T) {
			var got [2]uint16
			PutUint32(got[:], v, c.order)
			if got != c.want {
				t.Fatalf("PutUint32(%#x, %s) = %#04x, esperado %#04x", v, c.order, got, c.want)
			}
			if back := Uint32(got[:], c.order); back != v {
				t.Fatalf("Uint32 ida e volta = %#x, esperado %#x", back, v)
			}
		})
	}
}

func TestKnownValue100000CDAB(t *testing.T) {
	// docs/11 §6: testar sempre com um valor conhecido (contador = 100.000 = 0x000186A0).
	var r [2]uint16
	PutUint32(r[:], 100000, CDAB)
	if r != [2]uint16{0x86A0, 0x0001} {
		t.Fatalf("100000 em CDAB = %#04x, esperado [0x86a0 0x0001]", r)
	}
}

func TestRegistersLayoutAndDecode(t *testing.T) {
	b := Block{
		Version:     Version,
		Heartbeat:   65535,
		State:       2,
		FaultCode:   205,
		Total:       4294967295,
		Reject:      0x00010002,
		Good:        123456,
		Product:     1002,
		Speed:       600,
		LastCycleMs: 6012,
		StatusBits:  StatusAutomatic | StatusDoorOpen,
	}
	regs := b.Registers(CDAB)
	want := map[int]uint16{
		0: 1, 1: 65535, 2: 2, 3: 205,
		4: 0xFFFF, 5: 0xFFFF,
		6: 0x0002, 7: 0x0001,
		8: uint16(123456 & 0xFFFF), 9: uint16(123456 >> 16),
		10: 1002, 11: 600, 12: 6012, 13: 0b11,
	}
	for off, w := range want {
		if regs[off] != w {
			t.Errorf("offset %d = %d, esperado %d", off, regs[off], w)
		}
	}
	for off := UsedSize; off < Size; off++ {
		if regs[off] != 0 {
			t.Errorf("offset reservado %d = %d, esperado 0", off, regs[off])
		}
	}
	for _, order := range []WordOrder{ABCD, CDAB, BADC, DCBA} {
		r := b.Registers(order)
		got, err := Decode(r[:], order)
		if err != nil {
			t.Fatal(err)
		}
		if got != b {
			t.Fatalf("Decode(%s) = %+v, esperado %+v", order, got, b)
		}
	}
}

func TestDecodeTooShort(t *testing.T) {
	if _, err := Decode(make([]uint16, UsedSize-1), CDAB); err == nil {
		t.Fatal("esperava erro para bloco incompleto")
	}
}

func TestZeroValueIsCDAB(t *testing.T) {
	var o WordOrder
	if o != CDAB || DefaultWordOrder != CDAB {
		t.Fatalf("valor zero = %s, esperado CDAB (padrão do bloco)", o)
	}
}

func TestParseWordOrder(t *testing.T) {
	for _, s := range []string{"abcd", "CDAB", " badc ", "DCBA"} {
		o, err := ParseWordOrder(s)
		if err != nil {
			t.Fatalf("ParseWordOrder(%q): %v", s, err)
		}
		if o.String() == "" {
			t.Fatal("String vazio")
		}
	}
	if _, err := ParseWordOrder("ACBD"); err == nil {
		t.Fatal("esperava erro para ordem inválida")
	}
}

func TestHoldingRegisterConvention(t *testing.T) {
	cases := map[uint16]string{0: "40001", 1000: "41001", 9998: "49999"}
	for addr, want := range cases {
		if got := HoldingRegisterConvention(addr); got != want {
			t.Errorf("HoldingRegisterConvention(%d) = %s, esperado %s", addr, got, want)
		}
	}
}

func TestKnownStatusBits(t *testing.T) {
	if !KnownStatusBits(StatusAutomatic | StatusMaintenance) {
		t.Fatal("bits documentados deveriam ser aceitos")
	}
	if KnownStatusBits(1 << 7) {
		t.Fatal("bit 7 não é documentado")
	}
}
