// Package contracts tem os tipos Go do contrato gateway ↔ nuvem v1
// (/api/gateway/v1). A fonte da verdade é o pacote TS packages/contracts (Zod →
// JSON Schema); os testes deste módulo validam o que o agente produz contra o JSON
// Schema estrito e decodificam as fixtures de lá.
//
// Os tipos da config remota (GET /config) ficam no pacote config.
package contracts

import (
	"encoding/json"
	"time"
)

// Rotas da API v1 (relativas à URL base da plataforma).
const (
	APIBasePath = "/api/gateway/v1"
	RouteEnroll = APIBasePath + "/enroll"
	RouteSync   = APIBasePath + "/sync"
	RouteConfig = APIBasePath + "/config"
)

// Limites do contrato (packages/contracts/src/limits.ts).
const (
	MaxSyncBodyBytes  = 1_048_576 // JSON descompactado
	MaxBatchItems     = 2000
	MaxLiveItems      = 256
	MaxCommandResults = 50
	MaxCountPerMinute = 1_000_000
	SecondsPerMinute  = 60
	MaxCounterRaw     = 4_294_967_295
)

// Formatos de timestamp: sempre UTC com sufixo Z.
const (
	timeLayout   = "2006-01-02T15:04:05.000Z"
	minuteLayout = "2006-01-02T15:04:05Z"
)

// FormatTime formata um instante como ISO 8601 UTC com milissegundos (ex.: 2026-11-11T13:02:05.120Z).
func FormatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

// FormatMinute formata o início de um minuto (segundos zero, ex.: 2026-11-11T13:01:00Z).
func FormatMinute(t time.Time) string { return t.UTC().Truncate(time.Minute).Format(minuteLayout) }

// ParseTime lê um timestamp do contrato.
func ParseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

// Estados de máquina (docs/07). NO_COMM é gerado só pelo gateway.
const (
	StateRunning = "RUNNING"
	StateStopped = "STOPPED"
	StateFault   = "FAULT"
	StateSetup   = "SETUP"
	StateNoComm  = "NO_COMM"
)

// ---------------------------------------------------------------------------
// /enroll
// ---------------------------------------------------------------------------

// HardwareInfo descreve o equipamento no enroll.
type HardwareInfo struct {
	Arch          string   `json:"arch"`
	Model         string   `json:"model"`
	MemMB         int      `json:"mem_mb"`
	SerialNumber  string   `json:"serial_number,omitempty"`
	BoardRevision string   `json:"board_revision,omitempty"`
	ImageVersion  string   `json:"image_version,omitempty"`
	Profile       string   `json:"profile,omitempty"`
	SerialPorts   []string `json:"serial_ports,omitempty"`
}

// EnrollRequest é o corpo de POST /enroll.
type EnrollRequest struct {
	Code         string       `json:"code"`
	Hostname     string       `json:"hostname"`
	AgentVersion string       `json:"agent_version"`
	HW           HardwareInfo `json:"hw"`
}

// EnrollResponse é a resposta 201 do enroll.
type EnrollResponse struct {
	GatewayID  string `json:"gateway_id"`
	Token      string `json:"token"`
	Org        string `json:"org"`
	ServerTime string `json:"server_time,omitempty"`
}

// ---------------------------------------------------------------------------
// /sync — requisição
// ---------------------------------------------------------------------------

// Batch é o cabeçalho do lote. Sync só de saúde envia apenas SentAt.
type Batch struct {
	SeqFrom        *int64 `json:"seq_from,omitempty"`
	SeqTo          *int64 `json:"seq_to,omitempty"`
	SamplesSeqFrom *int64 `json:"samples_seq_from,omitempty"`
	SamplesSeqTo   *int64 `json:"samples_seq_to,omitempty"`
	SentAt         string `json:"sent_at"`
}

// ConfigStatus informa o estado da última config recebida.
type ConfigStatus struct {
	Version int    `json:"version"`
	State   string `json:"state"` // applying | observing | applied | rejected | reverted
	Error   string `json:"error,omitempty"`
	At      string `json:"at,omitempty"`
}

// AgentHealth é a saúde do agente em cada /sync.
type AgentHealth struct {
	Version         string        `json:"version"`
	UptimeS         int64         `json:"uptime_s"`
	ConfigVersion   int           `json:"config_version"`
	CPUPct          float64       `json:"cpu_pct"`
	MemMB           float64       `json:"mem_mb"`
	DiskFreeMB      float64       `json:"disk_free_mb"`
	BufferPending   int64         `json:"buffer_pending"`
	ClockOffsetMS   int64         `json:"clock_offset_ms"`
	ConfigStatus    *ConfigStatus `json:"config_status,omitempty"`
	BufferOldestS   *int64        `json:"buffer_oldest_s,omitempty"`
	SamplesPending  *int64        `json:"samples_pending,omitempty"`
	Quarantined     *int64        `json:"quarantined,omitempty"`
	TempC           *float64      `json:"temp_c,omitempty"`
	EMMCWearPct     *float64      `json:"emmc_wear_pct,omitempty"`
	NTPSynced       *bool         `json:"ntp_synced,omitempty"`
	BootID          string        `json:"boot_id,omitempty"`
	UncleanBoots24h *int64        `json:"unclean_boots_24h,omitempty"`
}

// DeviceHealth é o estado da conexão com um dispositivo.
type DeviceHealth struct {
	ID           string           `json:"id"`
	Status       string           `json:"status"` // connected | degraded | disconnected | disabled
	LatencyMS    *int64           `json:"latency_ms,omitempty"`
	Errors1m     int64            `json:"errors_1m"`
	Timeouts1m   *int64           `json:"timeouts_1m,omitempty"`
	Exceptions1m map[string]int64 `json:"exceptions_1m,omitempty"`
	LastOKAt     string           `json:"last_ok_at,omitempty"`
	LastError    string           `json:"last_error,omitempty"`
}

// Status de conexão de dispositivo.
const (
	DeviceConnected    = "connected"
	DeviceDegraded     = "degraded"
	DeviceDisconnected = "disconnected"
	DeviceDisabled     = "disabled"
)

// BusHealth é o estado de um barramento RS-485.
type BusHealth struct {
	ID                 string   `json:"id"`
	Status             string   `json:"status"` // ok | degraded | port_unavailable
	CycleMS            *int64   `json:"cycle_ms,omitempty"`
	BusyPct            *float64 `json:"busy_pct,omitempty"`
	Overruns1m         *int64   `json:"overruns_1m,omitempty"`
	UnsolicitedBytes1m *int64   `json:"unsolicited_bytes_1m,omitempty"`
}

// Live é a foto atual de uma máquina (não passa pela outbox).
type Live struct {
	MachineID    string   `json:"machine_id"`
	At           string   `json:"at"`
	State        string   `json:"state"`
	StateSince   string   `json:"state_since"`
	FaultCode    *int64   `json:"fault_code,omitempty"`
	CounterTotal *int64   `json:"counter_total,omitempty"`
	Product      string   `json:"product,omitempty"`
	Speed        *float64 `json:"speed,omitempty"`
}

// SyncRequest é o corpo de POST /sync. Eventos e minutos vêm da outbox já em JSON
// (com o seq injetado na hora do envio), por isso são json.RawMessage.
type SyncRequest struct {
	Batch          Batch             `json:"batch"`
	Agent          AgentHealth       `json:"agent"`
	Devices        []DeviceHealth    `json:"devices,omitempty"`
	Buses          []BusHealth       `json:"buses,omitempty"`
	Events         []json.RawMessage `json:"events,omitempty"`
	Minutes        []json.RawMessage `json:"minutes,omitempty"`
	Live           []Live            `json:"live,omitempty"`
	Samples        []json.RawMessage `json:"samples,omitempty"`
	CommandResults []json.RawMessage `json:"command_results,omitempty"`
}

// ---------------------------------------------------------------------------
// Eventos e minutos (payloads da outbox, SEM seq: o seq é injetado no envio)
// ---------------------------------------------------------------------------

// Tipos de evento emitidos pelo agente neste esqueleto.
const (
	EventState             = "state"
	EventProduct           = "product"
	EventCounterReset      = "counter_reset"
	EventCounterJump       = "counter_jump"
	EventCounterRebaseline = "counter_rebaseline"
	EventAgentStart        = "agent_start"
	EventAgentStop         = "agent_stop"
	EventConfigApplied     = "config_applied"
	EventConfigRejected    = "config_rejected"
)

// StateEvent é a mudança de estado de uma máquina. At é o início do candidato
// (não o instante da confirmação do debounce).
type StateEvent struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	At            string `json:"at"`
	MachineID     string `json:"machine_id"`
	State         string `json:"state"`
	FaultCode     *int64 `json:"fault_code,omitempty"`
	PreviousState string `json:"previous_state,omitempty"`
}

// ProductEvent registra a troca de produto/receita.
type ProductEvent struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	At              string `json:"at"`
	MachineID       string `json:"machine_id"`
	Product         string `json:"product"`
	PreviousProduct string `json:"previous_product,omitempty"`
}

// CounterEvent cobre counter_reset, counter_jump e counter_rebaseline.
type CounterEvent struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	At             string `json:"at"`
	MachineID      string `json:"machine_id"`
	TagID          string `json:"tag_id"`
	Role           string `json:"role"`
	PreviousRaw    *int64 `json:"previous_raw,omitempty"`
	Raw            int64  `json:"raw"`
	DiscardedDelta *int64 `json:"discarded_delta,omitempty"` // só counter_jump
}

// AgentStartEvent registra o início do agente.
type AgentStartEvent struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	At            string `json:"at"`
	Version       string `json:"version"`
	BootID        string `json:"boot_id,omitempty"`
	CleanShutdown bool   `json:"clean_shutdown"`
}

// AgentStopEvent registra a parada do agente.
type AgentStopEvent struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	At     string `json:"at"`
	Reason string `json:"reason"` // shutdown | restart | update | error
	Detail string `json:"detail,omitempty"`
}

// ConfigAppliedEvent registra a aplicação de uma config.
type ConfigAppliedEvent struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	At              string `json:"at"`
	Version         int    `json:"version"`
	PreviousVersion *int   `json:"previous_version,omitempty"`
}

// ConfigRejectedEvent registra uma config recusada.
type ConfigRejectedEvent struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	At         string `json:"at"`
	Version    int    `json:"version"`
	Error      string `json:"error"`
	RevertedTo *int   `json:"reverted_to,omitempty"`
}

// Minute é o agregado de um minuto FECHADO. Os segundos somam exatamente 60.
type Minute struct {
	MachineID string `json:"machine_id"`
	T         string `json:"t"`
	RunS      int    `json:"run_s"`
	StopS     int    `json:"stop_s"`
	FaultS    int    `json:"fault_s"`
	SetupS    int    `json:"setup_s"`
	NoCommS   int    `json:"no_comm_s"`
	Total     int64  `json:"total"`
	Reject    int64  `json:"reject"`
	Good      *int64 `json:"good,omitempty"`
	Product   string `json:"product,omitempty"`
}

// ---------------------------------------------------------------------------
// /sync — resposta
// ---------------------------------------------------------------------------

// Command é um comando da nuvem (envelope; o payload é validado por tipo).
type Command struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	IssuedAt  string          `json:"issued_at,omitempty"`
	ExpiresAt string          `json:"expires_at"`
	Payload   json.RawMessage `json:"payload"`
}

// SyncResponse é a resposta 200 do /sync.
type SyncResponse struct {
	AckSeq        int64  `json:"ack_seq"`
	AckSamplesSeq *int64 `json:"ack_samples_seq,omitempty"`
	ServerTime    string `json:"server_time"`
	Config        struct {
		LatestVersion int `json:"latest_version"`
	} `json:"config"`
	Commands        []Command `json:"commands"`
	NextSyncS       int       `json:"next_sync_s"`
	MinAgentVersion string    `json:"min_agent_version"`
}

// ErrorIssue é um problema apontado pela API (caminho com pontos e regra semântica).
type ErrorIssue struct {
	Path    []any  `json:"path"`
	Message string `json:"message"`
	Rule    string `json:"rule,omitempty"`
}

// ErrorResponse é o corpo padrão de erro (4xx/5xx).
type ErrorResponse struct {
	Error struct {
		Code        string       `json:"code"`
		Message     string       `json:"message"`
		RetryAfterS *int64       `json:"retry_after_s,omitempty"`
		Issues      []ErrorIssue `json:"issues,omitempty"`
		RequestID   string       `json:"request_id,omitempty"`
	} `json:"error"`
}
