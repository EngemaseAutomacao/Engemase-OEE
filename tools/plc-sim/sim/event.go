package sim

import (
	"fmt"
	"time"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
)

// EventKind identifica o tipo de acontecimento simulado.
type EventKind int

const (
	// EventStateChange: a máquina mudou de estado.
	EventStateChange EventKind = iota
	// EventCycle: um ciclo terminou (uma peça, boa ou refugo).
	EventCycle
	// EventCounterReset: contadores zerados (cenário counter-reset).
	EventCounterReset
	// EventCounterWrap: um contador de 32 bits deu a volta (4294967295 → 0).
	EventCounterWrap
	// EventOffline: a máquina parou de responder (cenário offline).
	EventOffline
	// EventOnline: a máquina voltou a responder (cenário offline).
	EventOnline
	// EventFreeze: o bloco congelou, inclusive o heartbeat (cenário frozen).
	EventFreeze
	// EventUnfreeze: o bloco voltou a ser atualizado (cenário frozen).
	EventUnfreeze
)

func (k EventKind) String() string {
	switch k {
	case EventStateChange:
		return "state"
	case EventCycle:
		return "cycle"
	case EventCounterReset:
		return "counter-reset"
	case EventCounterWrap:
		return "counter-wrap"
	case EventOffline:
		return "offline"
	case EventOnline:
		return "online"
	case EventFreeze:
		return "freeze"
	case EventUnfreeze:
		return "unfreeze"
	default:
		return fmt.Sprintf("EventKind(%d)", int(k))
	}
}

// Counter identifica um dos contadores de 32 bits do bloco.
type Counter string

const (
	CounterTotal  Counter = "contador_total"
	CounterReject Counter = "contador_refugo"
	CounterGood   Counter = "contador_bons"
)

// Event é um acontecimento da simulação, usado para log e testes.
type Event struct {
	At      time.Duration // instante simulado
	Machine int           // índice da máquina (0 = M1)
	Kind    EventKind

	// EventStateChange
	From, To   State
	FaultCode  uint16
	StatusBits uint16
	Product    uint16
	// Duration é a duração sorteada do novo estado, da queda ou do congelamento.
	Duration time.Duration

	// EventCycle
	CycleMs uint16
	Scrap   bool

	// EventCounterWrap
	Counter Counter

	// Contadores logo após o evento (no reset: valores antes de zerar).
	Total, Reject, Good uint32
}

// Describe devolve uma descrição legível, em português, do evento.
func (e Event) Describe() string {
	switch e.Kind {
	case EventStateChange:
		return e.describeState()
	case EventCycle:
		kind := "peça boa"
		if e.Scrap {
			kind = "REFUGO"
		}
		return fmt.Sprintf("ciclo de %.3fs · %s · total=%d refugo=%d bons=%d",
			float64(e.CycleMs)/1000, kind, e.Total, e.Reject, e.Good)
	case EventCounterReset:
		return fmt.Sprintf("contadores ZERADOS (cenário counter-reset) · antes: total=%d refugo=%d bons=%d",
			e.Total, e.Reject, e.Good)
	case EventCounterWrap:
		return fmt.Sprintf("OVERFLOW do %s: 4294967295 → 0 (cenário overflow)", e.Counter)
	case EventOffline:
		return fmt.Sprintf("OFFLINE por ~%s (cenário offline: sem resposta Modbus)", roundDur(e.Duration))
	case EventOnline:
		return fmt.Sprintf("ONLINE de novo · total=%d refugo=%d bons=%d", e.Total, e.Reject, e.Good)
	case EventFreeze:
		return fmt.Sprintf("CONGELADO por ~%s (cenário frozen: responde, mas bloco e heartbeat param)", roundDur(e.Duration))
	case EventUnfreeze:
		return fmt.Sprintf("descongelado · total=%d refugo=%d bons=%d", e.Total, e.Reject, e.Good)
	default:
		return e.Kind.String()
	}
}

func (e Event) describeState() string {
	d := roundDur(e.Duration)
	switch e.To {
	case StateProducing:
		return fmt.Sprintf("%s → PRODUZINDO (produto %d)", e.From, e.Product)
	case StateStopped:
		reason := ""
		switch {
		case e.From == StateEmergency:
			reason = " (rearme após emergência)"
		case e.StatusBits&block.StatusNoMaterial != 0:
			reason = " (falta de material)"
		}
		return fmt.Sprintf("%s → PARADA por ~%s%s", e.From, d, reason)
	case StateFault:
		extra := ""
		if e.StatusBits&block.StatusMaintenance != 0 {
			extra = ", manutenção acionada"
		}
		return fmt.Sprintf("%s → FALHA %d (%s) por ~%s%s", e.From, e.FaultCode, FaultDescription(e.FaultCode), d, extra)
	case StateSetup:
		return fmt.Sprintf("%s → SETUP (troca de produto) por ~%s", e.From, d)
	case StateManual:
		return fmt.Sprintf("%s → MANUAL por ~%s", e.From, d)
	case StateEmergency:
		return fmt.Sprintf("%s → EMERGÊNCIA por ~%s", e.From, d)
	default:
		return fmt.Sprintf("%s → %s por ~%s", e.From, e.To, d)
	}
}

func roundDur(d time.Duration) time.Duration {
	if d < time.Second {
		return d.Round(time.Millisecond)
	}
	return d.Round(time.Second)
}
