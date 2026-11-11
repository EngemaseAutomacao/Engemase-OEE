package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// Valores padrão aplicados pelo agente quando o campo está ausente
// (packages/contracts/src/limits.ts, DEFAULTS).
const (
	DefaultSyncIntervalS   = 10
	DefaultMaxBatchItems   = 2000
	DefaultMaxBatchBytes   = 1_048_576
	DefaultTCPTimeoutMS    = 500
	DefaultRTUTimeoutMS    = 300
	DefaultRTUTurnaroundMS = 5
	DefaultCommLossAfterS  = 10
	DefaultDebounceS       = 1.0
	DefaultIdleAfterCycles = 3.0
	DefaultMaxRatePerS     = 1000.0
)

// Limites de config por gateway (contrato).
const (
	MaxSerialBuses = 8
	MaxDevices     = 64
	MaxMachines    = 256
	MaxTags        = 2000
	MinPollMSTCP   = 100
	MinPollMSRTU   = 200
	MaxPollMS      = 3_600_000
)

// Protocolos.
const (
	ProtocolTCP        = "modbus-tcp"
	ProtocolRTU        = "modbus-rtu"
	ProtocolRTUOverTCP = "modbus-rtu-over-tcp"
)

// Modos de estado da máquina.
const (
	ModeSignals      = "signals"
	ModeStateCode    = "state_code"
	ModeCountDerived = "count_derived"
)

// Papéis de tag.
const (
	RoleStateRunning = "state.running"
	RoleStateFault   = "state.fault"
	RoleStateCode    = "state.code"
	RoleFaultCode    = "fault.code"
	RoleCountTotal   = "count.total"
	RoleCountGood    = "count.good"
	RoleCountReject  = "count.reject"
	RoleProductCode  = "product.code"
	RoleSpeedActual  = "speed.actual"
	RoleHeartbeat    = "plc.heartbeat"
	RoleCustom       = "custom"
)

// GatewayConfig é a config completa gerada pela nuvem (GET /config).
type GatewayConfig struct {
	ConfigVersion int         `json:"config_version"`
	GatewayID     string      `json:"gateway_id,omitempty"`
	GeneratedAt   string      `json:"generated_at,omitempty"`
	SerialBuses   []SerialBus `json:"serial_buses"`
	Devices       []Device    `json:"devices"`
	Machines      []Machine   `json:"machines"`
	Uplink        Uplink      `json:"uplink"`
}

// SerialBus é um barramento RS-485 (um mestre: o gateway).
type SerialBus struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Port     string `json:"port"` // lógica ("rs485-1") ou /dev/...
	Baud     int    `json:"baud"`
	Parity   string `json:"parity"`
	DataBits int    `json:"data_bits"`
	StopBits int    `json:"stop_bits"`
}

// DeviceParams junta os parâmetros dos três protocolos; a validação confere quais
// campos cada protocolo exige.
type DeviceParams struct {
	Host         string `json:"host,omitempty"`
	Port         int    `json:"port,omitempty"`
	UnitID       *int   `json:"unit_id,omitempty"`
	TimeoutMS    int    `json:"timeout_ms,omitempty"`
	Bus          string `json:"bus,omitempty"`
	TurnaroundMS *int   `json:"turnaround_ms,omitempty"`
}

// Device é um CLP, módulo de I/O ou escravo RTU.
type Device struct {
	ID       string       `json:"id"`
	Name     string       `json:"name,omitempty"`
	Protocol string       `json:"protocol"`
	Enabled  *bool        `json:"enabled,omitempty"`
	Params   DeviceParams `json:"params"`
	Blocks   []Block      `json:"blocks,omitempty"`
	Tags     []Tag        `json:"tags"`
}

// Block é uma leitura em bloco (registradores/bits contíguos numa transação).
type Block struct {
	Area   string `json:"area"`
	Start  *int   `json:"start"`
	Count  int    `json:"count"`
	PollMS int    `json:"poll_ms"`
}

// Address é o endereço estruturado: área + offset base 0 (+ bit para bool em registrador).
type Address struct {
	Area   string `json:"area"`
	Offset *int   `json:"offset"`
	Bit    *int   `json:"bit,omitempty"`
}

// Scale é a escala linear: valor × mul + add.
type Scale struct {
	Mul *float64 `json:"mul,omitempty"`
	Add *float64 `json:"add,omitempty"`
}

// Sampling configura o histórico de tags custom/speed.actual (F2 no agente).
type Sampling struct {
	Deadband     *float64 `json:"deadband,omitempty"`
	MinIntervalS *int     `json:"min_interval_s,omitempty"`
	MaxIntervalS *int     `json:"max_interval_s,omitempty"`
}

// Tag é um sinal do CLP com papel para o motor de OEE.
type Tag struct {
	ID        string    `json:"id"`
	Name      string    `json:"name,omitempty"`
	Address   Address   `json:"address"`
	Type      string    `json:"type"`
	WordOrder string    `json:"word_order,omitempty"`
	Scale     *Scale    `json:"scale,omitempty"`
	PollMS    int       `json:"poll_ms,omitempty"`
	Role      string    `json:"role"`
	MachineID string    `json:"machine_id,omitempty"`
	Sampling  *Sampling `json:"sampling,omitempty"`
}

// StateRules define como o estado da máquina é determinado.
type StateRules struct {
	Mode              string            `json:"mode"`
	Map               map[string]string `json:"map,omitempty"`
	DefaultState      string            `json:"default_state,omitempty"`
	CommLossAfterS    *int              `json:"comm_loss_after_s,omitempty"`
	DebounceS         *float64          `json:"debounce_s,omitempty"`
	HeartbeatTimeoutS *int              `json:"heartbeat_timeout_s,omitempty"`
	IdealCycleS       *float64          `json:"ideal_cycle_s,omitempty"`
	IdleAfterCycles   *float64          `json:"idle_after_cycles,omitempty"`
}

// Machine é uma máquina monitorada.
type Machine struct {
	ID          string     `json:"id"`
	Name        string     `json:"name,omitempty"`
	StateRules  StateRules `json:"state_rules"`
	MaxRatePerS *float64   `json:"max_rate_per_s,omitempty"`
}

// Uplink são os parâmetros do /sync.
type Uplink struct {
	SyncIntervalS int `json:"sync_interval_s"`
	MaxBatchItems int `json:"max_batch_items"`
	MaxBatchBytes int `json:"max_batch_bytes,omitempty"`
}

// ParseRemote decodifica e valida a config da nuvem. Campos desconhecidos são
// aceitos (compatibilidade com versões novas do contrato), como no schema tolerante.
func ParseRemote(body []byte) (*GatewayConfig, error) {
	return parseRemote(body, false)
}

// ParseRemoteStrict é como ParseRemote, mas recusa campos desconhecidos (testes).
func ParseRemoteStrict(body []byte) (*GatewayConfig, error) {
	return parseRemote(body, true)
}

func parseRemote(body []byte, strict bool) (*GatewayConfig, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if strict {
		dec.DisallowUnknownFields()
	}
	var cfg GatewayConfig
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("config remota: JSON inválido: %w", err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("config remota: conteúdo extra depois do JSON")
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// ---------------------------------------------------------------------------
// Acesso com valores padrão (só depois de Validate)
// ---------------------------------------------------------------------------

// IsEnabled indica se o dispositivo deve ser lido (padrão: true).
func (d *Device) IsEnabled() bool { return d.Enabled == nil || *d.Enabled }

// Timeout por leitura com padrão por protocolo (ms).
func (d *Device) Timeout() int {
	if d.Params.TimeoutMS > 0 {
		return d.Params.TimeoutMS
	}
	if d.Protocol == ProtocolRTU {
		return DefaultRTUTimeoutMS
	}
	return DefaultTCPTimeoutMS
}

// UnitID devolve o unit id (validado como presente).
func (d *Device) UnitID() uint8 {
	if d.Params.UnitID == nil {
		return 0
	}
	return uint8(*d.Params.UnitID)
}

// Span devolve a faixa do bloco.
func (b *Block) Span() modbus.Span {
	a, _ := modbus.ParseArea(b.Area)
	return modbus.Span{Area: a, Start: uint16(intOr(b.Start, 0)), Count: uint16(b.Count)}
}

// Spec converte a tag para a descrição de decodificação.
func (t *Tag) Spec() modbus.TagSpec {
	a, _ := modbus.ParseArea(t.Address.Area)
	typ, _ := modbus.ParseDataType(t.Type)
	order, _ := modbus.ParseWordOrder(t.WordOrder)
	return modbus.TagSpec{Area: a, Offset: uint16(intOr(t.Address.Offset, 0)), Bit: intOr(t.Address.Bit, -1), Type: typ, WordOrder: order}
}

// ScaleFactors devolve (mul, add) com padrão (1, 0).
func (t *Tag) ScaleFactors() (float64, float64) {
	mul, add := 1.0, 0.0
	if t.Scale != nil {
		if t.Scale.Mul != nil {
			mul = *t.Scale.Mul
		}
		if t.Scale.Add != nil {
			add = *t.Scale.Add
		}
	}
	return mul, add
}

// AddrKey identifica endereço, tipo e ordem da tag. Se mudar entre configs, o
// contador ganha nova base (counter_rebaseline) em vez de calcular delta.
func (t *Tag) AddrKey() string {
	s := t.Spec()
	return fmt.Sprintf("%s:%d:%d:%s:%s", s.Area, s.Offset, s.Bit, s.Type, s.WordOrder)
}

// ContainingBlock devolve o bloco que contém a tag inteira (mesma área), se houver.
func (d *Device) ContainingBlock(t *Tag) *Block {
	sp := t.Spec().Span()
	for i := range d.Blocks {
		if d.Blocks[i].Span().Contains(sp.Area, sp.Start, int(sp.Count)) {
			return &d.Blocks[i]
		}
	}
	return nil
}

// EffectivePollMS é o intervalo de leitura da tag: o do bloco que a contém ou o próprio.
func (d *Device) EffectivePollMS(t *Tag) int {
	if b := d.ContainingBlock(t); b != nil {
		return b.PollMS
	}
	return t.PollMS
}

// CommLossAfterS com padrão.
func (r *StateRules) CommLossAfter() int { return intOr(r.CommLossAfterS, DefaultCommLossAfterS) }

// Debounce com padrão (s).
func (r *StateRules) Debounce() float64 { return floatOr(r.DebounceS, DefaultDebounceS) }

// IdleAfter com padrão (ciclos).
func (r *StateRules) IdleAfter() float64 { return floatOr(r.IdleAfterCycles, DefaultIdleAfterCycles) }

// MaxRate é a taxa máxima plausível de peças por segundo (sanidade dos contadores).
// Padrão: 20 / ciclo ideal, ou 1000/s sem ciclo ideal.
func (m *Machine) MaxRate() float64 {
	if m.MaxRatePerS != nil {
		return *m.MaxRatePerS
	}
	if m.StateRules.IdealCycleS != nil && *m.StateRules.IdealCycleS > 0 {
		return 20 / *m.StateRules.IdealCycleS
	}
	return DefaultMaxRatePerS
}

// SyncInterval com padrão (s).
func (u *Uplink) SyncInterval() int {
	if u.SyncIntervalS > 0 {
		return u.SyncIntervalS
	}
	return DefaultSyncIntervalS
}

// BatchItems com padrão.
func (u *Uplink) BatchItems() int {
	if u.MaxBatchItems > 0 {
		return u.MaxBatchItems
	}
	return DefaultMaxBatchItems
}

// BatchBytes com padrão (JSON descompactado).
func (u *Uplink) BatchBytes() int {
	if u.MaxBatchBytes > 0 {
		return u.MaxBatchBytes
	}
	return DefaultMaxBatchBytes
}

func intOr(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

func floatOr(p *float64, def float64) float64 {
	if p == nil {
		return def
	}
	return *p
}
