package engine

import (
	"sort"
	"time"
)

// Índices dos segundos por estado no minuto.
const (
	secRun = iota
	secStop
	secFault
	secSetup
	secNoComm
	numSecs
)

// minuteAcc acumula um minuto aberto de uma máquina.
type minuteAcc struct {
	start   time.Time
	ms      [numSecs]int64 // milissegundos observados por estado
	total   int64
	reject  int64
	good    int64
	product string
	// Valor de cada contador no fim do minuto (para persistir junto com o minuto).
	counterEnd map[string]CounterState
}

func newMinuteAcc(start time.Time) *minuteAcc {
	return &minuteAcc{start: start, counterEnd: map[string]CounterState{}}
}

// seconds converte os milissegundos em segundos inteiros que somam exatamente 60,
// pelo método do maior resto. O tempo não observado entra em no_comm.
func (a *minuteAcc) seconds() [numSecs]int {
	ms := a.ms
	var observed int64
	for _, v := range ms {
		observed += v
	}
	if observed < 60_000 {
		ms[secNoComm] += 60_000 - observed
	}
	// Por segurança (não deveria acontecer): corta excesso do maior bucket.
	if observed > 60_000 {
		excess := observed - 60_000
		for excess > 0 {
			i := argmax(ms[:])
			cut := min(excess, ms[i])
			ms[i] -= cut
			excess -= cut
		}
	}

	var out [numSecs]int
	sum := 0
	type rem struct {
		idx  int
		frac int64
	}
	rems := make([]rem, 0, numSecs)
	for i, v := range ms {
		out[i] = int(v / 1000)
		sum += out[i]
		rems = append(rems, rem{i, v % 1000})
	}
	sort.SliceStable(rems, func(i, j int) bool { return rems[i].frac > rems[j].frac })
	for k := 0; sum < 60; k++ {
		out[rems[k%numSecs].idx]++
		sum++
	}
	return out
}

func argmax(v []int64) int {
	best := 0
	for i := range v {
		if v[i] > v[best] {
			best = i
		}
	}
	return best
}
