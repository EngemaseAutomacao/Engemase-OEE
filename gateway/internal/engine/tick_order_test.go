package engine_test

import (
	"fmt"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
)

// runSchedule roda as leituras (a cada readMS, a partir de readMS) e os Ticks (a cada
// tickMS, com fase phaseMS) em ordem de tempo até untilMS. No mesmo instante,
// tickFirst põe o Tick antes da leitura (no agente, o select escolhe ao acaso quando
// os dois canais estão prontos).
func runSchedule(e *engine.Engine, untilMS, readMS, tickMS, phaseMS int, tickFirst bool, read func(now float64) []engine.Sample) []engine.Record {
	var recs []engine.Record
	tick := func(ms int) { recs = append(recs, e.Tick(at(float64(ms)/1000)).Records...) }
	for ms := 1; ms <= untilMS; ms++ {
		isTick := (ms-phaseMS)%tickMS == 0
		if isTick && tickFirst {
			tick(ms)
		}
		if ms%readMS == 0 {
			e.OnRead(at(float64(ms)/1000), read(float64(ms)/1000))
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
