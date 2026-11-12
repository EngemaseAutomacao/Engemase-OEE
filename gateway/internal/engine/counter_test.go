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
		cadence  time.Duration // 0 = mínimo de 1 s
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
			// CLP religado (contador não retentivo 12000 → 5) depois de 90 s sem gateway:
			// 1000 × 90 + 10 cobriria a faixa inteira de 16 bits. Reset, sem inventar 53541.
			name: "uint16: queda depois de lacuna longa é reset, não overflow", bits: 16, maxRate: 1000, cadence: 2 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 12000, LastAt: t0.Add(-90 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}, {8, 1, 3, CounterNormal}},
		},
		{
			// Lacuna típica de reinício (resto do minuto + boot): 1000 × 60 + 10 ainda não
			// cobre a faixa, mas 12000 não está perto do máximo. A janela não cresce com Δt.
			name: "uint16: queda depois de lacuna de 60 s é reset, não overflow", bits: 16, maxRate: 1000, cadence: 2 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 12000, LastAt: t0.Add(-60 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}},
		},
		{
			name: "uint16: queda depois de lacuna de 65 s é reset, não overflow", bits: 16, maxRate: 1000, cadence: 2 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 12000, LastAt: t0.Add(-65 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}},
		},
		{
			// CLP religado com o gateway rodando: 20 s de leituras falhas e o contador
			// volta a ~0. 50000 não está perto do máximo: reset, não +15541.
			name: "uint16: queda depois de 20 s de falhas é reset", bits: 16, maxRate: 1000, cadence: 2 * time.Second,
			steps: []step{{50000, 0, 0, CounterFirst}, {5, 20, 5, CounterReset}},
		},
		{
			// O contador estava de fato perto do máximo antes do reinício: overflow.
			name: "uint16: overflow perto do máximo depois de lacuna continua overflow", bits: 16, maxRate: 1000, cadence: 2 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 65500, LastAt: t0.Add(-69 * time.Second)},
			steps:    []step{{96, 0, 132, CounterOverflow}},
		},
		{
			// "Perto do máximo" é a distância do anterior até o máximo, não a volta inteira:
			// as peças feitas depois da volta numa lacuna maior que a cadência (leituras
			// falhas abaixo de comm_loss) não transformam o overflow em reset.
			name: "uint16: overflow perto do máximo depois de leituras falhas continua overflow", bits: 16, maxRate: 5, cadence: 3 * time.Second,
			steps: []step{{65516, 0, 0, CounterFirst}, {16, 9, 36, CounterOverflow}, {20, 10, 4, CounterNormal}},
		},
		{
			// Reinício: o LastAt restaurado é a última leitura do último minuto fechado, então
			// a lacuna sempre passa da cadência. 36 do máximo (taxa 20/s, cadência 2 s) é perto.
			name: "uint16: overflow perto do máximo depois de reinício continua overflow", bits: 16, maxRate: 20, cadence: 2 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 65500, LastAt: t0.Add(-70 * time.Second)},
			steps:    []step{{35, 1, 71, CounterOverflow}},
		},
		{
			// Fronteira: o anterior a exatamente taxa × cadência + 10 do máximo é overflow;
			// um a mais já é reset (delta = atual).
			name: "uint16: distância igual à janela é overflow", bits: 16, maxRate: 5, cadence: 3 * time.Second,
			steps: []step{{65511, 0, 0, CounterFirst}, {30, 20, 55, CounterOverflow}},
		},
		{
			name: "uint16: distância uma acima da janela é reset", bits: 16, maxRate: 5, cadence: 3 * time.Second,
			steps: []step{{65510, 0, 0, CounterFirst}, {30, 20, 30, CounterReset}},
		},
		{
			// Do máximo exato para zero: uma peça.
			name: "uint16: máximo → 0 é uma peça", bits: 16, maxRate: 1,
			steps: []step{{65535, 0, 0, CounterFirst}, {0, 1, 1, CounterOverflow}},
		},
		{
			// Perto do máximo, mas a volta não cabe na taxa × Δt real: reset.
			name: "uint16: perto do máximo com volta implausível é reset", bits: 16, maxRate: 5, cadence: 3 * time.Second,
			steps: []step{{65530, 0, 0, CounterFirst}, {100, 9, 0, CounterReset}},
		},
		{
			// taxa × cadência passa de meia faixa (padrão 1000/s, poll de 20 s): "perto do
			// máximo" fica limitado a ¼ da faixa. CLP religado com contador não retentivo
			// acima da meia faixa (40000 → 5) é reset, não +25541 peças inventadas.
			name: "uint16: janela limitada a ¼ da faixa com poll lento", bits: 16, maxRate: 1000, cadence: 41 * time.Second,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 40000, LastAt: t0.Add(-90 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}},
		},
		{
			name: "uint16: janela limitada a ¼ da faixa com taxa alta", bits: 16, maxRate: 10000, cadence: 3400 * time.Millisecond,
			restored: &CounterState{AddrKey: "k", Bits: 16, LastRaw: 40000, LastAt: t0.Add(-90 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}},
		},
		{
			// Com a janela limitada, a volta real dentro de ¼ da faixa continua overflow.
			name: "uint16: volta real com poll lento continua overflow", bits: 16, maxRate: 1000, cadence: 41 * time.Second,
			steps: []step{{60000, 0, 0, CounterFirst}, {12464, 20, 18000, CounterOverflow}},
		},
		{
			// Taxa mínima (1/s) e Δt < 1 s: Δt vale 1 s, janela de 11.
			name: "uint16: taxa 1/s e Δt curto", bits: 16, maxRate: 1, cadence: 3 * time.Second,
			steps: []step{{65530, 0, 0, CounterFirst}, {4, 0.2, 10, CounterOverflow}, {16, 0.4, 0, CounterJump}},
		},
		{
			// Taxa máxima da config (100000/s) num uint32: sem limite prático de ¼ da faixa.
			name: "uint32: taxa máxima da config, overflow normal", bits: 32, maxRate: 100_000, cadence: 2 * time.Second,
			steps: []step{{4294900000, 0, 0, CounterFirst}, {30000, 1, 97296, CounterOverflow}},
		},
		{
			// max_rate_per_s acima da faixa de 16 bits (a config aceita até 100000): a janela
			// cobre a faixa já com Δt = 1 s, mas a volta real perto do máximo é overflow...
			name: "uint16 com taxa acima da faixa: overflow perto do máximo continua overflow", bits: 16, maxRate: 70000,
			steps: []step{{65000, 0, 0, CounterFirst}, {100, 1, 636, CounterOverflow}, {101, 2, 1, CounterNormal}},
		},
		{
			// ... e a queda longe do máximo (mais de meia faixa) é reset.
			name: "uint16 com taxa acima da faixa: queda longe do máximo é reset", bits: 16, maxRate: 70000,
			steps: []step{{12000, 0, 0, CounterFirst}, {5, 1, 5, CounterReset}},
		},
		{
			name: "uint16: overflow com taxa alta e Δt curto continua overflow", bits: 16, maxRate: 1000,
			steps: []step{{65000, 0, 0, CounterFirst}, {100, 1, 636, CounterOverflow}},
		},
		{
			name: "uint32: overflow depois de lacuna longa continua overflow", bits: 32, maxRate: 1000,
			restored: &CounterState{AddrKey: "k", Bits: 32, LastRaw: 4294967000, LastAt: t0.Add(-90 * time.Second)},
			steps:    []step{{5, 0, 301, CounterOverflow}},
		},
		{
			name: "uint32: reset depois de lacuna longa continua reset", bits: 32, maxRate: 1000,
			restored: &CounterState{AddrKey: "k", Bits: 32, LastRaw: 12000, LastAt: t0.Add(-90 * time.Second)},
			steps:    []step{{5, 0, 5, CounterReset}},
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
		{
			// Checkpoint de um reset no minuto aberto (veja CounterState): as peças já
			// contadas antes do reinício entram uma vez, no primeiro delta.
			name: "Carry restaurado soma no primeiro delta", bits: 32, maxRate: 10,
			restored: &CounterState{AddrKey: "k", Bits: 32, LastRaw: 0, LastAt: t0.Add(-time.Minute), Carry: 13},
			steps:    []step{{8, 0, 8 + 13, CounterNormal}, {9, 1, 1, CounterNormal}},
		},
		{
			name: "Carry restaurado soma mesmo com reset ou salto na volta", bits: 32, maxRate: 1,
			restored: &CounterState{AddrKey: "k", Bits: 32, LastRaw: 500, LastAt: t0.Add(-time.Second), Carry: 7},
			steps:    []step{{3, 0, 3 + 7, CounterReset}, {1_000_000, 1, 0, CounterJump}},
		},
		{
			name: "Carry restaurado soma com nova base", bits: 32, maxRate: 10,
			restored: &CounterState{AddrKey: "outro", Bits: 32, LastRaw: 500, LastAt: t0, Carry: 4},
			steps:    []step{{9000, 1, 4, CounterRebaseline}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tr := &counterTracker{state: CounterState{Bits: c.bits, AddrKey: "k"}, maxRate: c.maxRate, cadence: c.cadence, restored: c.restored}
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

// O checkpoint de um evento no minuto aberto guarda a base que refaz as peças já
// contadas pelo delta (sem dar a volta) e o resto em Carry; quando um minuto anterior
// fecha, as peças dele saem do checkpoint.
func TestCounterCheckpoint(t *testing.T) {
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	tr := &counterTracker{state: CounterState{TagID: "tag", Bits: 32, AddrKey: "k"}, maxRate: 10}

	// Salto: a base depois do evento cobre as peças contadas.
	tr.ck = &counterCheckpoint{raw: 5170, minute: t0.Add(time.Minute).UnixMilli(), carry: 10, from: t0}
	if s := tr.checkpoint(); s.LastRaw != 5160 || s.Carry != 0 || !s.LastAt.Equal(t0) || s.TagID != "tag" || s.AddrKey != "k" {
		t.Fatalf("checkpoint do salto: %+v", s)
	}
	// Reset para 3 com 13 peças contadas: base 0 e o resto em Carry.
	tr.ck = &counterCheckpoint{raw: 3, minute: t0.Add(time.Minute).UnixMilli(), carry: 13, from: t0}
	if s := tr.checkpoint(); s.LastRaw != 0 || s.Carry != 10 {
		t.Fatalf("checkpoint do reset: %+v", s)
	}
	// Fecha o minuto 13:00 (anterior ao evento) com 4 peças da tag: vale o checkpoint,
	// sem elas, a partir da última leitura do 13:00.
	end := CounterState{TagID: "tag", Bits: 32, AddrKey: "k", LastRaw: 50069, LastAt: t0.Add(59 * time.Second)}
	if s := tr.closed(t0.UnixMilli(), 4, end); s.LastRaw != 0 || s.Carry != 6 || !s.LastAt.Equal(end.LastAt) {
		t.Fatalf("checkpoint depois do 13:00: %+v", s)
	}
	// Fecha o minuto do evento: vale o fim dele e o checkpoint acaba.
	end2 := CounterState{TagID: "tag", Bits: 32, AddrKey: "k", LastRaw: 50, LastAt: t0.Add(119 * time.Second)}
	if s := tr.closed(t0.Add(time.Minute).UnixMilli(), 40, end2); s != end2 || tr.ck != nil || !tr.anchor.Equal(end2.LastAt) {
		t.Fatalf("fim do minuto do evento: %+v (checkpoint %+v)", s, tr.ck)
	}
}

// O total de cada estado no minuto não depende de onde os Ticks cortam o tempo, mesmo
// com instantes fora do milissegundo (janela ociosa, relógio em ns): cada trecho conta
// pelas posições truncadas dentro do minuto.
func TestAccountIndependentOfSegmentation(t *testing.T) {
	t0 := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	cuts := [][]time.Duration{
		{2001 * time.Millisecond},
		{1000500 * time.Microsecond, 2001 * time.Millisecond},
		{300700 * time.Microsecond, 1000500 * time.Microsecond, 1999900 * time.Microsecond, 2001 * time.Millisecond},
	}
	for _, c := range cuts {
		m := &machine{e: &Engine{}, confirmed: stateKey{state: "RUNNING"}, accounted: t0, closedUntil: t0, minutes: map[int64]*minuteAcc{}}
		for _, d := range c {
			m.account(t0.Add(d))
		}
		if got := m.minutes[t0.UnixMilli()].ms[secRun]; got != 2001 {
			t.Fatalf("cortes %v: %d ms, quer 2001", c, got)
		}
	}
}
