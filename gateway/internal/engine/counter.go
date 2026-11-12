package engine

import (
	"time"
)

// CounterState é o estado persistido de um contador (tabela counter_state). LastRaw
// é sempre o valor ao FIM do último minuto fechado: assim, depois de um crash, o
// próximo delta parte dele e nenhuma peça se perde nem é contada duas vezes.
type CounterState struct {
	TagID     string
	MachineID string
	Role      string
	Bits      int    // 16 ou 32
	AddrKey   string // área, offset, tipo e ordem: mudou → nova base
	LastRaw   uint32
	LastAt    time.Time
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
//   - cur < prev: wrap = (máx − prev) + cur + 1; se wrap ≤ limite é overflow (delta = wrap);
//     senão é reset (delta = cur, se plausível).
func (c *counterTracker) update(cur uint32, at time.Time) CounterResult {
	if !c.valid {
		r := c.restored
		c.restored = nil
		if r == nil {
			c.setBase(cur, at)
			return CounterResult{Kind: CounterFirst}
		}
		if r.AddrKey != c.state.AddrKey || r.Bits != c.state.Bits {
			prev := r.LastRaw
			c.setBase(cur, at)
			return CounterResult{Kind: CounterRebaseline, PreviousRaw: prev, HasPrevious: true}
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
		wrap := (c.maxValue() - uint64(prev)) + uint64(cur) + 1
		if float64(wrap) <= limit {
			res.Kind, res.Delta = CounterOverflow, int64(wrap)
		} else {
			res.Kind = CounterReset
			if float64(cur) <= limit {
				res.Delta = int64(cur)
			}
		}
	}
	c.state.LastRaw, c.state.LastAt = cur, at
	return res
}

func (c *counterTracker) setBase(cur uint32, at time.Time) {
	c.state.LastRaw, c.state.LastAt, c.valid = cur, at, true
}
