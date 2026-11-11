package sim

import "fmt"

// State é o valor do campo `estado` do bloco OEE (docs/11, seção 3).
type State uint16

const (
	StateStopped   State = 0 // parada
	StateProducing State = 1 // produzindo
	StateFault     State = 2 // falha
	StateSetup     State = 3 // setup
	StateManual    State = 4 // manual
	StateEmergency State = 5 // emergência
)

func (s State) String() string {
	switch s {
	case StateStopped:
		return "parada"
	case StateProducing:
		return "produzindo"
	case StateFault:
		return "falha"
	case StateSetup:
		return "setup"
	case StateManual:
		return "manual"
	case StateEmergency:
		return "emergência"
	default:
		return fmt.Sprintf("estado(%d)", uint16(s))
	}
}

// Valid indica se o estado é um dos códigos documentados.
func (s State) Valid() bool { return s <= StateEmergency }

// Fault descreve um código de falha simulado.
type Fault struct {
	Code        uint16
	Description string
	DoorOpen    bool // a falha liga o bit "porta aberta" em bits_status
}

// Faults é a tabela de falhas que o simulador sorteia.
var Faults = []Fault{
	{Code: 101, Description: "sobrecarga do motor principal"},
	{Code: 102, Description: "falha no inversor de frequência"},
	{Code: 205, Description: "pressão de ar baixa"},
	{Code: 310, Description: "sensor de presença de peça"},
	{Code: 412, Description: "temperatura do molde alta"},
	{Code: 520, Description: "porta de segurança aberta", DoorOpen: true},
}

// FaultDescription devolve a descrição de um código de falha simulado.
func FaultDescription(code uint16) string {
	for _, f := range Faults {
		if f.Code == code {
			return f.Description
		}
	}
	return "desconhecida"
}
