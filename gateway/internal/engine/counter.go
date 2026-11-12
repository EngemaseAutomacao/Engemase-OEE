package engine

import (
	"time"
)

// CounterState é o estado persistido de um contador (tabela counter_state): a base
// do próximo delta depois de um crash ou de uma troca de config, para nenhuma peça se
// perder nem ser contada duas vezes. Normalmente LastRaw é o valor ao FIM do último
// minuto fechado (o minuto aberto se perde e é recontado pelo delta).
//
// Um evento (reset, salto, nova base) num minuto ainda aberto não se refaz pelo delta
// (com outro Δt a decisão seria outra, e as peças antes de um reset sumiriam): ele
// grava junto um checkpoint com a base depois do evento menos as peças que a tag já
// contou nos minutos abertos (sem dar a volta), o resto dessas peças em Carry, e
// LastAt no início delas. A primeira leitura depois de restaurar soma Carry ao delta.
type CounterState struct {
	TagID     string
	MachineID string
	Role      string
	Bits      int    // 16 ou 32
	AddrKey   string // área, offset, tipo e ordem: mudou → nova base
	LastRaw   uint32
	LastAt    time.Time
	Carry     int64 // peças já contadas que LastRaw não cobre (só em checkpoint)
}

// CounterResult é o efeito de uma leitura de contador.
type CounterResult struct {
	Delta int64
	Kind  CounterKind
	// Para eventos: valor anterior e delta descartado (salto).
	PreviousRaw    uint32
	HasPrevious    bool
	DiscardedDelta uint32
}

// CounterKind classifica a leitura.
type CounterKind int

// Classes de leitura de contador.
const (
	CounterNormal     CounterKind = iota // delta normal (inclusive 0)
	CounterFirst                         // primeira leitura sem histórico: só define a base
	CounterOverflow                      // passou do máximo do tipo e recomeçou
	CounterReset                         // zerado no CLP (evento counter_reset)
	CounterJump                          // salto absurdo descartado (evento counter_jump)
	CounterRebaseline                    // endereço/tipo mudou na config (evento counter_rebaseline)
)

// counterTracker calcula deltas de um contador acumulado do CLP.
type counterTracker struct {
	state    CounterState
	valid    bool
	restored *CounterState // estado lido do SQLite, usado na primeira leitura
	maxRate  float64       // peças/s plausíveis
	// cadence é o maior Δt de uma leitura normal da tag (2 × poll + 1 s, como o
	// silêncio de holdPoint). A janela de overflow não cresce além dela.
	cadence time.Duration
	// anchor é o LastAt da base persistida mais recente (fim do último minuto
	// fechado, restaurada ou primeira leitura): as peças contadas depois dela estão
	// em minutos abertos.
	anchor time.Time
	ck     *counterCheckpoint // evento num minuto ainda aberto (nil = nenhum)
}

// counterCheckpoint é a base depois de um evento num minuto ainda aberto.
type counterCheckpoint struct {
	raw    uint32    // valor depois do evento
	minute int64     // início (ms) do minuto em que o evento caiu
	carry  int64     // peças da tag nos minutos abertos até o evento (inclusive)
	from   time.Time // LastAt da base anterior a essas peças
}

// checkpoint devolve o estado a persistir para o checkpoint atual.
func (c *counterTracker) checkpoint() CounterState {
	s := c.state // identidade: tag, máquina, papel, bits, endereço
	v := max(min(c.ck.carry, int64(c.ck.raw)), 0)
	s.LastRaw, s.LastAt, s.Carry = c.ck.raw-uint32(v), c.ck.from, c.ck.carry-v
	return s
}

// closed devolve o estado a persistir quando fecha o minuto (início em ms) em que a
// tag contou pieces peças e terminou em end. Com um evento num minuto posterior ainda
// aberto, vale o checkpoint dele, sem as peças que agora estão no minuto fechado.
func (c *counterTracker) closed(minute, pieces int64, end CounterState) CounterState {
	c.anchor = end.LastAt
	if c.ck == nil || c.ck.minute <= minute {
		c.ck = nil
		return end
	}
	c.ck.carry -= pieces
	c.ck.from = end.LastAt
	return c.checkpoint()
}

func (c *counterTracker) maxValue() uint64 {
	if c.state.Bits == 16 {
		return 0xFFFF
	}
	return 0xFFFFFFFF
}

// update aplica uma leitura bruta (já na largura do tipo, sem sinal).
//
// Sendo Δt o tempo desde a última leitura (mínimo 1 s) e limite = taxa × Δt + 10:
//   - cur ≥ prev: delta = cur − prev; acima do limite é salto (descarta e redefine a base);
//   - cur < prev: dist = máx − prev + 1 (peças até dar a volta) e wrap = dist + cur.
//     É overflow (delta = wrap) só se o anterior estava perto do máximo (docs/03):
//     dist ≤ perto, com perto = taxa × min(Δt, cadência) + 10 limitado a ¼ da faixa
//     do tipo, wrap ≤ limite (a volta cabe no Δt real) e wrap menor que meia faixa.
//     Senão é reset (delta = cur, se plausível).
//
// Overflow e reset só divergem nas dist peças até o máximo (cur conta nos dois): um
// reset tomado por overflow inventa no máximo "perto" peças e um overflow tomado por
// reset perde dist, que é produção real da lacuna. Por isso "perto" mede a distância
// do anterior ao máximo, não a volta inteira: as peças feitas depois da volta numa
// lacuna maior que a cadência (leituras falhas, reinício) não viram reset.
//
// A janela "perto" não cresce com a lacuna: com taxa × Δt, 60 s sem leitura (CLP
// religado, gateway reiniciado) já cobririam quase toda a faixa de 16 bits e um CLP
// religado com contador não retentivo (12000 → 5) viraria +53541 peças inventadas.
// Pelo mesmo motivo ela para em ¼ da faixa: com taxa × cadência acima disso (taxa
// padrão e poll de 20 s, ou max_rate_per_s alto num uint16) overflow e reset não se
// distinguem e, na dúvida, é reset: o counter_reset deixa rastro. A meia faixa vale
// quando o limite passa da faixa: aí recuar é mais curto que dar a volta.
func (c *counterTracker) update(cur uint32, at time.Time) CounterResult {
	var carry int64
	if !c.valid {
		r := c.restored
		c.restored = nil
		if r == nil {
			c.setBase(cur, at)
			c.anchor = at
			return CounterResult{Kind: CounterFirst}
		}
		c.anchor, carry = r.LastAt, max(r.Carry, 0)
		if r.AddrKey != c.state.AddrKey || r.Bits != c.state.Bits {
			prev := r.LastRaw
			c.setBase(cur, at)
			return CounterResult{Kind: CounterRebaseline, PreviousRaw: prev, HasPrevious: true, Delta: carry}
		}
		c.state.LastRaw, c.state.LastAt, c.valid = r.LastRaw, r.LastAt, true
	}

	prev := c.state.LastRaw
	dt := at.Sub(c.state.LastAt).Seconds()
	if dt < 1 {
		dt = 1
	}
	limit := c.maxRate*dt + 10

	res := CounterResult{PreviousRaw: prev, HasPrevious: true}
	switch {
	case cur >= prev:
		d := uint64(cur - prev)
		if float64(d) > limit {
			res.Kind, res.DiscardedDelta = CounterJump, uint32(d)
		} else {
			res.Kind, res.Delta = CounterNormal, int64(d)
		}
	default:
		span := c.maxValue() + 1
		dist := span - uint64(prev)
		wrap := dist + uint64(cur)
		near := min(c.maxRate*min(dt, max(c.cadence.Seconds(), 1))+10, float64(span/4))
		if float64(dist) <= near && float64(wrap) <= limit && wrap < span/2 {
			res.Kind, res.Delta = CounterOverflow, int64(wrap)
		} else {
			res.Kind = CounterReset
			if float64(cur) <= limit {
				res.Delta = int64(cur)
			}
		}
	}
	c.state.LastRaw, c.state.LastAt = cur, at
	res.Delta += carry // peças de um checkpoint: já validadas antes do reinício
	return res
}

func (c *counterTracker) setBase(cur uint32, at time.Time) {
	c.state.LastRaw, c.state.LastAt, c.valid = cur, at, true
}
