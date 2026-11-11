// Package sim contém o motor determinístico que simula uma máquina com o bloco
// OEE padrão Engemase: ciclos, refugo, paradas, falhas, setup e os cenários
// especiais (reset de contador, overflow, offline intermitente e CLP congelado).
//
// O motor é orientado a eventos sobre um relógio simulado: o estado em um
// instante t depende só da semente, da configuração e de t, nunca de quantas
// vezes AdvanceTo foi chamado nem do relógio de parede.
package sim

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Nomes dos cenários aceitos em --scenario.
const (
	ScenarioNormal       = "normal"
	ScenarioCounterReset = "counter-reset"
	ScenarioOverflow     = "overflow"
	ScenarioOffline      = "offline"
	ScenarioFrozen       = "frozen"
)

// Scenarios indica quais cenários especiais estão ligados. O valor zero é o
// cenário "normal" (só produção, paradas e falhas aleatórias).
type Scenarios struct {
	CounterReset bool // contadores zerados periodicamente (operador zerou)
	Overflow     bool // contadores começam perto de 4294967295 e dão a volta
	Offline      bool // máquina some da rede de forma intermitente
	Frozen       bool // CLP congelado: responde, mas o bloco (e o heartbeat) para
}

// ParseScenarios interpreta uma lista separada por vírgulas, por exemplo
// "counter-reset,offline". "normal" (ou vazio) não liga nenhum cenário especial.
func ParseScenarios(s string) (Scenarios, error) {
	var sc Scenarios
	for _, raw := range strings.Split(s, ",") {
		name := strings.ToLower(strings.TrimSpace(raw))
		switch name {
		case "", ScenarioNormal:
		case ScenarioCounterReset:
			sc.CounterReset = true
		case ScenarioOverflow:
			sc.Overflow = true
		case ScenarioOffline:
			sc.Offline = true
		case ScenarioFrozen:
			sc.Frozen = true
		default:
			return Scenarios{}, fmt.Errorf("cenário desconhecido %q (use %s)", raw, strings.Join(ScenarioNames(), ", "))
		}
	}
	return sc, nil
}

// ScenarioNames lista os nomes de cenário aceitos.
func ScenarioNames() []string {
	return []string{ScenarioNormal, ScenarioCounterReset, ScenarioOverflow, ScenarioOffline, ScenarioFrozen}
}

// String devolve os cenários ligados no formato aceito por ParseScenarios.
func (s Scenarios) String() string {
	var names []string
	if s.CounterReset {
		names = append(names, ScenarioCounterReset)
	}
	if s.Overflow {
		names = append(names, ScenarioOverflow)
	}
	if s.Offline {
		names = append(names, ScenarioOffline)
	}
	if s.Frozen {
		names = append(names, ScenarioFrozen)
	}
	if len(names) == 0 {
		return ScenarioNormal
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

// Config parametriza o comportamento de cada máquina simulada.
type Config struct {
	// Cycle é o tempo de ciclo nominal (uma peça por ciclo).
	Cycle time.Duration
	// ScrapRate é a probabilidade de uma peça ser refugo (0–1). Padrão 0,02.
	ScrapRate float64
	// MeanRunCycles é a média de ciclos produzidos entre duas paradas/falhas.
	MeanRunCycles float64
	// GoodCounter liga o contador_bons. Desligado, ele fica em 0 e o gateway
	// deve calcular total − refugo (docs/11, seção 3).
	GoodCounter bool
	// StartTotal é o valor inicial de contador_total (e de contador_bons).
	// Útil para conferir a ordem das words com um valor conhecido (ex.: 100000).
	StartTotal uint32

	Scenarios Scenarios

	// ResetEvery é o intervalo médio entre resets de contador (counter-reset).
	ResetEvery time.Duration
	// OverflowMargin é quantas peças faltam para contador_total dar a volta (overflow).
	OverflowMargin uint32
	// OfflineEvery é o tempo médio online entre duas quedas (offline).
	OfflineEvery time.Duration
	// OfflineFor é a duração média de cada queda (offline).
	OfflineFor time.Duration
	// FreezeEvery é o tempo médio entre dois congelamentos (frozen).
	FreezeEvery time.Duration
	// FreezeFor é a duração média de cada congelamento (frozen).
	FreezeFor time.Duration
}

// DefaultConfig devolve a configuração padrão (ciclo de 6 s, refugo de 2%).
func DefaultConfig() Config {
	return Config{
		Cycle:          6 * time.Second,
		ScrapRate:      0.02,
		MeanRunCycles:  25,
		GoodCounter:    true,
		ResetEvery:     2 * time.Minute,
		OverflowMargin: 20,
		OfflineEvery:   60 * time.Second,
		OfflineFor:     15 * time.Second,
		FreezeEvery:    90 * time.Second,
		FreezeFor:      15 * time.Second,
	}
}

// MinCycle é o menor tempo de ciclo aceito.
const MinCycle = 10 * time.Millisecond

// Validate confere a configuração.
func (c Config) Validate() error {
	var errs []error
	if c.Cycle < MinCycle {
		errs = append(errs, fmt.Errorf("tempo de ciclo deve ser >= %s (recebido %s)", MinCycle, c.Cycle))
	}
	if c.ScrapRate < 0 || c.ScrapRate > 1 {
		errs = append(errs, fmt.Errorf("taxa de refugo deve estar entre 0 e 1 (recebido %g)", c.ScrapRate))
	}
	if c.MeanRunCycles < 1 {
		errs = append(errs, fmt.Errorf("média de ciclos entre paradas deve ser >= 1 (recebido %g)", c.MeanRunCycles))
	}
	if c.Scenarios.CounterReset && c.ResetEvery <= 0 {
		errs = append(errs, errors.New("cenário counter-reset exige intervalo de reset > 0"))
	}
	if c.Scenarios.Overflow {
		if c.OverflowMargin < 1 {
			errs = append(errs, errors.New("cenário overflow exige margem >= 1"))
		}
		if c.StartTotal != 0 {
			errs = append(errs, errors.New("contador inicial não combina com o cenário overflow (ele já define os contadores)"))
		}
	}
	if c.Scenarios.Offline && (c.OfflineEvery <= 0 || c.OfflineFor <= 0) {
		errs = append(errs, errors.New("cenário offline exige intervalos > 0"))
	}
	if c.Scenarios.Frozen && (c.FreezeEvery <= 0 || c.FreezeFor <= 0) {
		errs = append(errs, errors.New("cenário frozen exige intervalos > 0"))
	}
	return errors.Join(errs...)
}
