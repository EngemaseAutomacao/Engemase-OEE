package engine_test

import (
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
)

// runSchedule roda as leituras (a cada readMS, a partir de readMS) e os Ticks (a cada
// tickMS, com fase phaseMS) em ordem de tempo até untilMS. No mesmo instante,
// tickFirst põe o Tick antes da leitura (no agente, o select escolhe ao acaso quando
// os dois canais estão prontos). read devolve nil para leitura falha. Os instantes
// são milissegundos exatos (at, com float, erra por 1 ns).
func runSchedule(e *engine.Engine, untilMS, readMS, tickMS, phaseMS int, tickFirst bool, read func(now float64) []engine.Sample) []engine.Record {
	var recs []engine.Record
	atMS := func(ms int) time.Time { return t0.Add(time.Duration(ms) * time.Millisecond) }
	tick := func(ms int) { recs = append(recs, e.Tick(atMS(ms)).Records...) }
	for ms := 1; ms <= untilMS; ms++ {
		isTick := (ms-phaseMS)%tickMS == 0
		if isTick && tickFirst {
			tick(ms)
		}
		if ms%readMS == 0 {
			if samples := read(float64(ms) / 1000); samples != nil {
				e.OnRead(atMS(ms), samples)
			} else {
				e.OnFailure(deviceID, atMS(ms))
			}
		}
		if isTick && !tickFirst {
			tick(ms)
		}
	}
	return recs
}

// A decisão sobre um candidato não pode depender de o Tick vir antes ou depois da
// leitura que o desmente, nem da fase do Tick em relação às leituras: as mesmas
// leituras dão os mesmos eventos e os mesmos minutos. A leitura que desmente o
// candidato exatamente no fim do prazo (debounce, heartbeat_timeout_s, janela
// ociosa) não o confirma; depois do fim do prazo confirma, como um Tick no meio
// confirmaria.
func TestCandidateDecisionIndependentOfTickOrder(t *testing.T) {
	cases := []struct {
		name   string
		rules  string
		tags   []string
		readMS int
		read   func(now float64) []engine.Sample
		want   []wantEv
		secs   *[5]int // run, stop, fault, setup, no_comm do primeiro minuto (nil = não confere)
	}{
		{
			name: "parada vista em 20,0 e 20,5 e desfeita em 21,0 (no prazo)", rules: `{"mode":"signals"}`,
			tags: []string{tRunning}, readMS: 500,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tRunning, Value: boolV(!(now >= 20 && now < 21))}}
			},
			want: []wantEv{{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1}},
		},
		{
			name: "parada vista em 20,3 e 21,0 e desfeita em 21,7 (depois do prazo)", rules: `{"mode":"signals"}`,
			tags: []string{tRunning}, readMS: 700,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tRunning, Value: boolV(!(now >= 20 && now < 21.5))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.700Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:20.300Z", "STOPPED", "RUNNING", -1},
				{"2026-11-11T13:00:21.700Z", "RUNNING", "STOPPED", -1},
			},
		},
		{
			name: "heartbeat repete uma amostra", rules: `{"mode":"state_code","map":{"1":"RUNNING"},"heartbeat_timeout_s":2}`,
			tags: []string{tCode, tHB}, readMS: 1000,
			read: func(now float64) []engine.Sample {
				hb := uint16(now)
				if now == 21 {
					hb = 20
				}
				return []engine.Sample{{TagID: tCode, Value: u16(1)}, {TagID: tHB, Value: u16(hb)}}
			},
			want: []wantEv{{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1}},
		},
		{
			name: "heartbeat parado além do prazo", rules: `{"mode":"state_code","map":{"1":"RUNNING"},"heartbeat_timeout_s":2}`,
			tags: []string{tCode, tHB}, readMS: 1500,
			read: func(now float64) []engine.Sample {
				hb := uint16(now * 2)
				if now == 21 {
					hb = 39 // repete a leitura de 19,5; muda em 22,5
				}
				return []engine.Sample{{TagID: tCode, Value: u16(1)}, {TagID: tHB, Value: u16(hb)}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.500Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:19.500Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:22.500Z", "RUNNING", "NO_COMM", -1},
			},
		},
		{
			name: "count_derived com peça logo depois da janela ociosa", rules: `{"mode":"count_derived","ideal_cycle_s":2,"idle_after_cycles":3}`,
			tags: []string{tTotal}, readMS: 1000,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tTotal, Value: u32(uint32(now / 7))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.000Z", "STOPPED", "", -1},
				{"2026-11-11T13:00:07.000Z", "RUNNING", "STOPPED", -1},
			},
		},
		{
			// A falha em 25,0 ainda não chega a comm_loss (19,5 + 6); a leitura de volta
			// em 25,5 decide o NO_COMM antes do Tick. A parada (última peça em 2 + 6 s)
			// não pode recuar para dentro da lacuna e apagar o NO_COMM.
			name:  "count_derived: NO_COMM decidido pela leitura de volta continua no_comm",
			rules: `{"mode":"count_derived","ideal_cycle_s":2,"comm_loss_after_s":6}`, tags: []string{tTotal}, readMS: 500,
			read: func(now float64) []engine.Sample {
				if now >= 20 && now < 25.5 {
					return nil
				}
				return []engine.Sample{{TagID: tTotal, Value: u32(map[bool]uint32{true: 1}[now >= 2])}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.500Z", "STOPPED", "", -1},
				{"2026-11-11T13:00:02.000Z", "RUNNING", "STOPPED", -1},
				{"2026-11-11T13:00:08.000Z", "STOPPED", "RUNNING", -1},
				{"2026-11-11T13:00:20.000Z", "NO_COMM", "STOPPED", -1},
				{"2026-11-11T13:00:25.500Z", "STOPPED", "NO_COMM", -1},
			},
			secs: &[5]int{6, 48, 0, 0, 6},
		},
		{
			// 1 peça/s; o contador alcança na volta. Leitura falha não é falta de peça.
			name:  "count_derived: falhas curtas não inventam parada",
			rules: `{"mode":"count_derived","ideal_cycle_s":1,"comm_loss_after_s":10}`, tags: []string{tTotal}, readMS: 500,
			read: func(now float64) []engine.Sample {
				if now >= 20.5 && now <= 25.5 {
					return nil
				}
				return []engine.Sample{{TagID: tTotal, Value: u32(uint32(now))}}
			},
			want: []wantEv{{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1}},
			secs: &[5]int{59, 0, 0, 0, 1},
		},
		{
			name:  "count_derived: NO_COMM desde a primeira falha, sem parada antes",
			rules: `{"mode":"count_derived","ideal_cycle_s":1,"comm_loss_after_s":10}`, tags: []string{tTotal}, readMS: 500,
			read: func(now float64) []engine.Sample {
				if now >= 20.5 && now <= 39.5 {
					return nil
				}
				return []engine.Sample{{TagID: tTotal, Value: u32(uint32(now))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:20.500Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:40.000Z", "RUNNING", "NO_COMM", -1},
			},
			secs: &[5]int{40, 0, 0, 0, 20},
		},
		{
			// Falha vista em 20,0 e 20,5; leituras falham de 21,0 a 29,5 (debounce 3 s,
			// comm_loss 3 s). Não se extrapola o candidato através das falhas.
			name:  "candidato não é confirmado através de falhas de leitura",
			rules: `{"mode":"signals","debounce_s":3,"comm_loss_after_s":3}`, tags: []string{tRunning, tFault}, readMS: 500,
			read: func(now float64) []engine.Sample {
				if now >= 21 && now < 30 {
					return nil
				}
				return []engine.Sample{{TagID: tRunning, Value: boolV(true)}, {TagID: tFault, Value: boolV(now >= 20 && now < 21)}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.500Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:21.000Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:30.000Z", "RUNNING", "NO_COMM", -1},
			},
			secs: &[5]int{51, 0, 0, 0, 9},
		},
		{
			// Heartbeat (prazo 2 s) a 1 s e leituras falhando a partir de 20: o prazo
			// do heartbeat não corre durante as falhas; o NO_COMM é o da comunicação.
			name:  "heartbeat não extrapolado através de falhas de leitura",
			rules: `{"mode":"state_code","map":{"1":"RUNNING"},"comm_loss_after_s":3,"heartbeat_timeout_s":2}`, tags: []string{tCode, tHB}, readMS: 1000,
			read: func(now float64) []engine.Sample {
				if now >= 20 && now < 30 {
					return nil
				}
				return []engine.Sample{{TagID: tCode, Value: u16(1)}, {TagID: tHB, Value: u16(uint16(now))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.000Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:20.000Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:30.000Z", "RUNNING", "NO_COMM", -1},
			},
			secs: &[5]int{49, 0, 0, 0, 11},
		},
		{
			// Heartbeat congelado depois de 19,6 e máquina parada desde 20,3 (debounce
			// 1 s, prazo 2 s): a parada está inteira na dúvida do heartbeat e não pode
			// ser confirmada por um Tick antes de o NO_COMM (desde 19,6) ser decidido.
			name:  "candidato depois da última mudança do heartbeat",
			rules: `{"mode":"signals","heartbeat_timeout_s":2}`, tags: []string{tRunning, tHB}, readMS: 700,
			read: func(now float64) []engine.Sample {
				hb := uint16(math.Round(now * 10))
				if now > 19.6 && now < 40 {
					hb = 196
				}
				return []engine.Sample{{TagID: tRunning, Value: boolV(now < 20.3)}, {TagID: tHB, Value: u16(hb)}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.700Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:19.600Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:40.600Z", "STOPPED", "NO_COMM", -1},
			},
			secs: &[5]int{19, 19, 0, 0, 22},
		},
		{
			// Leitura a cada 1,5 s, debounce 1 s, heartbeat mudando a cada leitura: a
			// parada vista só em 21,0 e desfeita em 22,5 durou mais que o debounce. A
			// leitura que a desmente traz heartbeat novo (o CLP estava vivo): confirma,
			// como numa máquina sem heartbeat.
			name:  "heartbeat novo na leitura que desmente o candidato",
			rules: `{"mode":"signals","heartbeat_timeout_s":3}`, tags: []string{tRunning, tHB}, readMS: 1500,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tRunning, Value: boolV(now != 21)}, {TagID: tHB, Value: u16(uint16(now * 2))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.500Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:21.000Z", "STOPPED", "RUNNING", -1},
				{"2026-11-11T13:00:22.500Z", "RUNNING", "STOPPED", -1},
			},
			secs: &[5]int{57, 2, 0, 0, 1},
		},
		{
			// count_derived com heartbeat mudando a cada leitura de 1,5 s: peça em 21,0,
			// janela ociosa de 1,2 s (debounce 1 s). Um Tick entre 22,2 e 22,5 não pode
			// descartar a produção pela janela extrapolada: a leitura de 22,5, com
			// heartbeat novo, mostra que ela durou 1,2 s e a confirma.
			name:  "count_derived: janela ociosa não extrapolada na dúvida do heartbeat",
			rules: `{"mode":"count_derived","ideal_cycle_s":1.2,"idle_after_cycles":1,"heartbeat_timeout_s":4}`, tags: []string{tTotal, tHB}, readMS: 1500,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tTotal, Value: u32(map[bool]uint32{true: 1}[now >= 20.9])}, {TagID: tHB, Value: u16(uint16(now * 2))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.500Z", "STOPPED", "", -1},
				{"2026-11-11T13:00:21.000Z", "RUNNING", "STOPPED", -1},
				{"2026-11-11T13:00:22.200Z", "STOPPED", "RUNNING", -1},
			},
			secs: &[5]int{1, 57, 0, 0, 2},
		},
		{
			// Peça em 27,0 (janela de 0,9 s) e falhas de 28,5 a 33,0: o heartbeat novo na
			// leitura de volta (34,5, depois de mais que heartbeat_timeout_s) não diz que
			// o CLP esteve vivo na lacuna. NO_COMM desde a primeira falha, sem produção.
			name:  "heartbeat da leitura de volta depois do prazo não resolve a dúvida",
			rules: `{"mode":"count_derived","ideal_cycle_s":0.9,"idle_after_cycles":1,"debounce_s":0.5,"comm_loss_after_s":7,"heartbeat_timeout_s":3}`,
			tags:  []string{tTotal, tHB}, readMS: 1500,
			read: func(now float64) []engine.Sample {
				if now >= 28.5 && now < 34.5 {
					return nil
				}
				return []engine.Sample{{TagID: tTotal, Value: u32(map[bool]uint32{true: 1}[now >= 26.9])}, {TagID: tHB, Value: u16(uint16(now * 2))}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:01.500Z", "STOPPED", "", -1},
				{"2026-11-11T13:00:28.500Z", "NO_COMM", "STOPPED", -1},
				{"2026-11-11T13:00:34.500Z", "STOPPED", "NO_COMM", -1},
			},
			secs: &[5]int{0, 53, 0, 0, 7},
		},
		{
			// O candidato começa na leitura em que o heartbeat mudou pela última vez.
			name:  "candidato na última mudança do heartbeat",
			rules: `{"mode":"state_code","map":{"1":"RUNNING","2":"FAULT"},"debounce_s":1.5,"heartbeat_timeout_s":2}`, tags: []string{tCode, tHB}, readMS: 700,
			read: func(now float64) []engine.Sample {
				hb := uint16(math.Round(now * 10))
				if now > 25.9 && now < 40 {
					hb = 259
				}
				return []engine.Sample{{TagID: tCode, Value: u16(map[bool]uint16{true: 1, false: 2}[now < 25.85])}, {TagID: tHB, Value: u16(hb)}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.700Z", "RUNNING", "", -1},
				{"2026-11-11T13:00:25.900Z", "NO_COMM", "RUNNING", -1},
				{"2026-11-11T13:00:40.600Z", "FAULT", "NO_COMM", -1},
			},
			secs: &[5]int{25, 0, 20, 0, 15},
		},
		{
			// Uma peça em 20,3 (janela ociosa de 1,25 s, debounce 1 s, leitura a cada
			// 0,7 s): produzindo de 20,3 a 21,55, mais que o debounce, sem leitura que o
			// mostre pelo debounce inteiro. A janela acaba entre leituras.
			name:  "count_derived: produção que acaba no fim da janela ociosa",
			rules: `{"mode":"count_derived","ideal_cycle_s":1.25,"idle_after_cycles":1}`, tags: []string{tTotal}, readMS: 700,
			read: func(now float64) []engine.Sample {
				return []engine.Sample{{TagID: tTotal, Value: u32(map[bool]uint32{true: 1}[now >= 20.25])}}
			},
			want: []wantEv{
				{"2026-11-11T13:00:00.700Z", "STOPPED", "", -1},
				{"2026-11-11T13:00:20.300Z", "RUNNING", "STOPPED", -1},
				{"2026-11-11T13:00:21.550Z", "STOPPED", "RUNNING", -1},
			},
			secs: &[5]int{1, 58, 0, 0, 1},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var ref *contracts.Minute
			for _, tickFirst := range []bool{false, true} {
				for _, phase := range []int{0, 250, 500, 750} {
					name := fmt.Sprintf("tickFirst=%v fase=%d ms", tickFirst, phase)
					e := newEngine(t, buildConfig(t, c.rules, c.tags...), t0)
					s := &sim{e: e, records: runSchedule(e, 62_000, c.readMS, 1000, phase, tickFirst, c.read)}
					t.Run(name, func(t *testing.T) { checkStates(t, s.stateEvents(), c.want) })
					mins := s.minutes()
					if len(mins) == 0 {
						t.Fatalf("%s: nenhum minuto fechado", name)
					}
					if ref == nil {
						ref = &mins[0]
						if sum := ref.RunS + ref.StopS + ref.FaultS + ref.SetupS + ref.NoCommS; sum != 60 {
							t.Fatalf("%s: minuto soma %d", name, sum)
						}
						if c.secs != nil {
							checkMinute(t, *ref, c.secs[0], c.secs[1], c.secs[2], c.secs[3], c.secs[4], ref.Total, 0)
						}
						continue
					}
					if mins[0] != *ref {
						t.Fatalf("%s: minuto %+v, quer %+v", name, mins[0], *ref)
					}
				}
			}
		})
	}
}

// Propriedade: para leituras quaisquer (sinais, código, contador, heartbeat, janelas de
// falha e heartbeat congelado), a ordem e a fase dos Ticks não mudam os eventos nem os
// minutos. Cenários pseudoaleatórios com semente fixa (o teste é determinístico).
func TestTickOrderIndependenceRandomized(t *testing.T) {
	seeds := 150
	if testing.Short() {
		seeds = 20
	}
	for seed := range seeds {
		sc := randomScenario(uint64(seed))
		var ref string
		for _, tickFirst := range []bool{false, true} {
			for _, phase := range []int{0, 250, 500, 750} {
				e := newEngine(t, buildConfig(t, sc.rules, sc.tags...), t0)
				got := scenarioDigest(runSchedule(e, 125_000, sc.readMS, 1000, phase, tickFirst, sc.read))
				if ref == "" {
					ref = got
					continue
				}
				if got != ref {
					t.Fatalf("semente %d (%s, leitura a cada %d ms), tickFirst=%v fase %d ms:\n%s\nquer:\n%s",
						seed, sc.rules, sc.readMS, tickFirst, phase, got, ref)
				}
			}
		}
	}
}

type scenario struct {
	rules  string
	tags   []string
	readMS int
	read   func(now float64) []engine.Sample
}

// scenarioDigest resume os eventos de estado até 13:02 e os minutos 13:00 e 13:01 (o
// que vem depois pode estar decidido numa fase e ainda não na outra quando a
// simulação acaba). Eventos e minutos à parte: a ordem entre eles na saída depende de
// quando o Tick fecha o minuto.
func scenarioDigest(recs []engine.Record) string {
	var evs, mins strings.Builder
	for _, r := range recs {
		switch p := r.Payload.(type) {
		case contracts.Minute:
			if r.At.Before(at(120)) {
				fmt.Fprintf(&mins, "%+v\n", p)
			}
		case contracts.StateEvent:
			if p.At < "2026-11-11T13:02" {
				fmt.Fprintf(&evs, "%s %s %s\n", p.At, p.State, p.PreviousState)
			}
		}
	}
	return evs.String() + mins.String()
}

// randomScenario monta um cenário a partir da semente (gerador congruencial: o
// resultado não depende da versão do Go).
func randomScenario(seed uint64) scenario {
	state := seed*6364136223846793005 + 1442695040888963407
	next := func() uint64 {
		state = state*6364136223846793005 + 1442695040888963407
		return state >> 11
	}
	intn := func(n int) int { return int(next() % uint64(n)) }
	float := func() float64 { return float64(next()%1_000_000) / 1_000_000 }

	mode := intn(3)
	debounce := []float64{0.5, 1, 1.5, 2, 3}[intn(5)]
	commLoss := 3 + intn(8)
	readMS := []int{300, 500, 700, 1000, 1500}[intn(5)]
	withHB := intn(2) == 0
	hbTimeout := 2 + intn(3)
	type seg struct {
		from, to float64
		v        int
	}
	var segs []seg
	for t := 0.0; t < 62; {
		d := 0.3 + float()*6
		segs = append(segs, seg{t, t + d, intn(4)})
		t += d
	}
	window := func(n int, maxLen float64) [][2]float64 {
		var w [][2]float64
		for range intn(n) {
			a := float() * 55
			w = append(w, [2]float64{a, a + float()*maxLen})
		}
		return w
	}
	fails, frozen := window(3, 15), window(3, 6)
	inside := func(now float64, w [][2]float64) (bool, float64) {
		for _, x := range w {
			if now >= x[0] && now < x[1] {
				return true, x[0]
			}
		}
		return false, 0
	}
	hbStep := 1 + intn(3) // o heartbeat muda a cada hbStep leituras, abaixo do prazo
	for hbStep > 1 && (hbStep+1)*readMS >= hbTimeout*1000 {
		hbStep--
	}
	rate := float() * 2

	sc := scenario{readMS: readMS}
	switch mode {
	case 0:
		sc.rules = fmt.Sprintf(`{"mode":"signals","debounce_s":%v,"comm_loss_after_s":%d`, debounce, commLoss)
		sc.tags = []string{tRunning, tFault}
	case 1:
		sc.rules = fmt.Sprintf(`{"mode":"state_code","map":{"0":"STOPPED","1":"RUNNING","2":"FAULT","3":"SETUP"},"debounce_s":%v,"comm_loss_after_s":%d`, debounce, commLoss)
		sc.tags = []string{tCode}
	default:
		sc.rules = fmt.Sprintf(`{"mode":"count_derived","ideal_cycle_s":%v,"idle_after_cycles":%d,"debounce_s":%v,"comm_loss_after_s":%d`,
			0.5+float()*2, 1+intn(3), debounce, commLoss)
		sc.tags = []string{tTotal}
	}
	if withHB {
		sc.rules += fmt.Sprintf(`,"heartbeat_timeout_s":%d`, hbTimeout)
		sc.tags = append(sc.tags, tHB)
	}
	sc.rules += "}"
	sc.read = func(now float64) []engine.Sample {
		if f, _ := inside(now, fails); f {
			return nil
		}
		v := 0
		for _, s := range segs {
			if now >= s.from && now < s.to {
				v = s.v
			}
		}
		var out []engine.Sample
		switch mode {
		case 0:
			out = []engine.Sample{{TagID: tRunning, Value: boolV(v&1 == 1)}, {TagID: tFault, Value: boolV(v == 2)}}
		case 1:
			out = []engine.Sample{{TagID: tCode, Value: u16(uint16(v))}}
		default: // peças à taxa rate nos trechos com v > 0
			total := 0.0
			for _, s := range segs {
				if s.from < now && s.v > 0 {
					total += (min(now, s.to) - s.from) * rate
				}
			}
			out = []engine.Sample{{TagID: tTotal, Value: u32(uint32(total))}}
		}
		if withHB {
			ms := int(math.Round(now * 1000))
			if f, start := inside(now, frozen); f {
				ms = int(start * 1000)
			}
			out = append(out, engine.Sample{TagID: tHB, Value: u16(uint16(ms / (readMS * hbStep)))})
		}
		return out
	}
	return sc
}
