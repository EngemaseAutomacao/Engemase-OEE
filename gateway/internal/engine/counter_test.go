package engine

import (
	"testing"
	"time"
)

func TestCounterTracker(t *testing.T) {
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	sec := func(s float64) time.Time { return t0.Add(time.Duration(s * float64(time.Second))) }

	type step struct {
		raw       uint32
		at        float64
		wantDelta int64
		wantKind  CounterKind
	}
	cases := []struct {
		name     string
		bits     int
		maxRate  float64
		restored *CounterState
		steps    []step
	}{
		{
			name: "normal e primeira leitura", bits: 32, maxRate: 10,
			steps: []step{{100, 0, 0, CounterFirst}, {103, 1, 3, CounterNormal}, {103, 2, 0, CounterNormal}, {110, 3, 7, CounterNormal}},
		},
		{
			name: "overflow uint16", bits: 16, maxRate: 10,
			steps: []step{{65530, 0, 0, CounterFirst}, {65535, 1, 5, CounterNormal}, {3, 2, 4, CounterOverflow}},
		},
		{
			name: "overflow uint32", bits: 32, maxRate: 10,
			steps: []step{{4294967290, 0, 0, CounterFirst}, {1, 1, 7, CounterOverflow}},
		},
		{
			name: "reset pelo operador", bits: 32, maxRate: 10,
			steps: []step{{50213, 0, 0, CounterFirst}, {50215, 1, 2, CounterNormal}, {3, 2, 3, CounterReset}, {5, 3, 2, CounterNormal}},
		},
		{
			name: "reset para valor alto não é contado", bits: 32, maxRate: 1,
			steps: []step{{50213, 0, 0, CounterFirst}, {40000, 1, 0, CounterReset}, {40001, 2, 1, CounterNormal}},
		},
		{
			name: "uint16 que cai longe do máximo é reset, não overflow", bits: 16, maxRate: 10,
			steps: []step{{30000, 0, 0, CounterFirst}, {5, 1, 5, CounterReset}},
		},
		{
			name: "salto absurdo descartado e nova base", bits: 32, maxRate: 2,
			steps: []step{{1000, 0, 0, CounterFirst}, {1_001_000, 1, 0, CounterJump}, {1_001_002, 2, 2, CounterNormal}},
		},
		{
			name: "limite cresce com o tempo (volta de NO_COMM longo)", bits: 32, maxRate: 2,
			steps: []step{{1000, 0, 0, CounterFirst}, {1500, 300, 500, CounterNormal}},
		},
		{
			name: "restaurado do SQLite continua o delta", bits: 32, maxRate: 10,
			restored: &CounterState{AddrKey: "k", Bits: 32, LastRaw: 500, LastAt: t0.Add(-time.Minute)},
			steps:    []step{{520, 0, 20, CounterNormal}},
		},
		{
			name: "endereço mudou: nova base sem delta", bits: 32, maxRate: 10,
			restored: &CounterState{AddrKey: "outro", Bits: 32, LastRaw: 500, LastAt: t0},
			steps:    []step{{9000, 1, 0, CounterRebaseline}, {9004, 2, 4, CounterNormal}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tr := &counterTracker{state: CounterState{Bits: c.bits, AddrKey: "k"}, maxRate: c.maxRate, restored: c.restored}
			for i, s := range c.steps {
				res := tr.update(s.raw, sec(s.at))
				if res.Delta != s.wantDelta || res.Kind != s.wantKind {
					t.Fatalf("passo %d (raw %d): delta=%d kind=%d; quer delta=%d kind=%d", i, s.raw, res.Delta, res.Kind, s.wantDelta, s.wantKind)
				}
				if tr.state.LastRaw != s.raw {
					t.Fatalf("passo %d: base = %d, quer %d", i, tr.state.LastRaw, s.raw)
				}
			}
		})
	}
}

func TestMinuteSecondsAlwaysSum60(t *testing.T) {
	cases := [][numSecs]int64{
		{29500, 15000, 15000, 0, 500},
		{0, 0, 0, 0, 0},
		{60000, 0, 0, 0, 0},
		{19999, 20001, 0, 0, 0},
		{333, 333, 333, 333, 333},
		{59999, 0, 0, 0, 0},
		{40000, 30000, 0, 0, 0}, // excesso (não deveria ocorrer) é cortado
	}
	for _, ms := range cases {
		a := &minuteAcc{ms: ms}
		s := a.seconds()
		sum := 0
		for _, v := range s {
			if v < 0 || v > 60 {
				t.Fatalf("%v → %v: valor fora de 0–60", ms, s)
			}
			sum += v
		}
		if sum != 60 {
			t.Fatalf("%v → %v soma %d", ms, s, sum)
		}
	}
	a := &minuteAcc{ms: [numSecs]int64{29500, 15000, 15000, 0, 500}}
	if s := a.seconds(); s != [numSecs]int{30, 15, 15, 0, 0} {
		t.Fatalf("maior resto: %v", s)
	}
	a = &minuteAcc{ms: [numSecs]int64{30000, 0, 0, 0, 0}}
	if s := a.seconds(); s[secRun] != 30 || s[secNoComm] != 30 {
		t.Fatalf("tempo não observado deveria ir para no_comm: %v", s)
	}
}
