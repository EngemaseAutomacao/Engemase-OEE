package uplink

import (
	"math/rand/v2"
	"time"
)

// Backoff exponencial com jitter: a espera n fica entre Base e min(Max, Base·2ⁿ),
// sorteada uniformemente (o sorteio espalha os gateways que voltam juntos depois de
// uma queda da nuvem). Padrão do docs/04: 1 s → 5 min.
type Backoff struct {
	Base time.Duration
	Max  time.Duration
	// Rand devolve um inteiro em [0, n); nil = math/rand/v2.
	Rand    func(n int64) int64
	attempt int
}

// NewBackoff cria o backoff padrão (1 s → 5 min).
func NewBackoff() *Backoff { return &Backoff{Base: time.Second, Max: 5 * time.Minute} }

// Next devolve a próxima espera e avança a tentativa.
func (b *Backoff) Next() time.Duration {
	base, maxD := b.Base, b.Max
	if base <= 0 {
		base = time.Second
	}
	if maxD < base {
		maxD = base
	}
	ceil := maxD
	if b.attempt < 30 {
		if c := base << uint(b.attempt); c > 0 && c < maxD {
			ceil = c
		}
	}
	b.attempt++
	if ceil <= base {
		return base
	}
	rnd := b.Rand
	if rnd == nil {
		rnd = rand.Int64N
	}
	return base + time.Duration(rnd(int64(ceil-base)+1))
}

// Reset volta à primeira tentativa (depois de um sucesso).
func (b *Backoff) Reset() { b.attempt = 0 }

// Attempt devolve quantas esperas seguidas já foram pedidas.
func (b *Backoff) Attempt() int { return b.attempt }
