package modbus

import (
	"reflect"
	"testing"
)

func TestPlan(t *testing.T) {
	hr := func(start, count uint16) Span { return Span{Area: HoldingRegister, Start: start, Count: count} }
	ir := func(start, count uint16) Span { return Span{Area: InputRegister, Start: start, Count: count} }
	co := func(start, count uint16) Span { return Span{Area: Coil, Start: start, Count: count} }

	cases := []struct {
		name   string
		in     []Span
		maxGap int
		want   []Span
	}{
		{"vazio", nil, 0, nil},
		{"encostadas viram uma", []Span{hr(100, 2), hr(102, 1), hr(103, 2)}, 0, []Span{hr(100, 5)}},
		{"sobrepostas", []Span{hr(10, 2), hr(11, 2)}, 0, []Span{hr(10, 3)}},
		{"buraco sem max_gap separa", []Span{hr(100, 1), hr(105, 1)}, 0, []Span{hr(100, 1), hr(105, 1)}},
		{"buraco dentro do max_gap junta", []Span{hr(100, 1), hr(105, 1)}, 8, []Span{hr(100, 6)}},
		{"áreas diferentes nunca juntam", []Span{hr(0, 1), ir(1, 1)}, 8, []Span{ir(1, 1), hr(0, 1)}},
		{"limite de 125 registradores", []Span{hr(0, 2), hr(100, 2), hr(124, 2)}, 200, []Span{hr(0, 102), hr(124, 2)}},
		{"bits até 2000", []Span{co(0, 1), co(1999, 1), co(2000, 1)}, 3000, []Span{co(0, 2000), co(2000, 1)}},
		{"ordem de entrada não importa", []Span{hr(3, 1), hr(1, 1), hr(2, 1)}, 0, []Span{hr(1, 3)}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Plan(c.in, c.maxGap)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("Plan = %v, quer %v", got, c.want)
			}
			for _, s := range got {
				if err := s.Validate(); err != nil {
					t.Fatalf("bloco inválido %v: %v", s, err)
				}
			}
		})
	}
}

func TestSpanValidate(t *testing.T) {
	if err := (Span{Area: HoldingRegister, Start: 0, Count: 126}).Validate(); err == nil {
		t.Fatal("126 registradores deveria falhar")
	}
	if err := (Span{Area: HoldingRegister, Start: 65535, Count: 2}).Validate(); err == nil {
		t.Fatal("faixa além de 65535 deveria falhar")
	}
	if err := (Span{Area: Coil, Start: 0, Count: 2000}).Validate(); err != nil {
		t.Fatalf("2000 bits deveria passar: %v", err)
	}
}
