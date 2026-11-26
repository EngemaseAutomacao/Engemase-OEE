package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// Payloads dos comandos do contrato v1 (packages/contracts/src/commands.ts). A
// validação espelha o Zod: o JSON Schema tolerante (campos novos são aceitos) e as
// regras semânticas (address.*, probe.range, device_test.bus).

// TagReadPayload é o payload de tag.read ("Ler agora").
type TagReadPayload struct {
	DeviceID  string         `json:"device_id"`
	Address   config.Address `json:"address"`
	Type      string         `json:"type"`
	WordOrder string         `json:"word_order,omitempty"`
	Scale     *config.Scale  `json:"scale,omitempty"`
}

// Connection é o DeviceConnectionSchema (protocolo + parâmetros).
type Connection struct {
	Protocol string              `json:"protocol"`
	Params   config.DeviceParams `json:"params"`
}

// RawRead é uma leitura bruta de N registradores/bits (probe do device.test).
type RawRead struct {
	Area   string `json:"area"`
	Offset *int   `json:"offset"`
	Count  int    `json:"count"`
}

// Span converte a leitura (só depois de validada).
func (r *RawRead) Span() modbus.Span {
	a, _ := modbus.ParseArea(r.Area)
	return modbus.Span{Area: a, Start: uint16(*r.Offset), Count: uint16(r.Count)}
}

// DeviceTestPayload é o payload de device.test.
type DeviceTestPayload struct {
	DeviceID      string            `json:"device_id,omitempty"`
	Connection    Connection        `json:"connection"`
	SerialBus     *config.SerialBus `json:"serial_bus,omitempty"`
	AllowBusPause bool              `json:"allow_bus_pause,omitempty"`
	Probe         *RawRead          `json:"probe,omitempty"`
}

// AgentRestartPayload é o payload de agent.restart.
type AgentRestartPayload struct {
	Reason string `json:"reason,omitempty"`
	DelayS *int   `json:"delay_s,omitempty"`
}

// Regras semânticas dos payloads (packages/contracts/src/rules.ts).
const (
	RuleProbeRange    = "probe.range"
	RuleDeviceTestBus = "device_test.bus"
)

// issues junta os problemas de um payload e vira invalid_payload.
type issues []config.Issue

func (is *issues) add(path, rule, msg string) {
	*is = append(*is, config.Issue{Path: path, Rule: rule, Message: msg})
}

func (is issues) err() error {
	if len(is) == 0 {
		return nil
	}
	parts := make([]string, 0, len(is))
	list := make([]map[string]any, 0, len(is))
	for _, i := range is {
		parts = append(parts, i.String())
		item := map[string]any{"path": i.Path, "message": i.Message}
		if i.Rule != "" {
			item["rule"] = i.Rule
		}
		list = append(list, item)
	}
	e := Fail(CodeInvalidPayload, "Payload inválido: %s", strings.Join(parts, "; "))
	e.Details = map[string]any{"issues": list}
	return e
}

// decode lê o payload no tipo (campos desconhecidos são aceitos: contrato tolerante).
func decode(raw json.RawMessage, into any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(into); err != nil {
		return Fail(CodeInvalidPayload, "Payload inválido: %v", err)
	}
	return nil
}

// ParseTagRead decodifica e valida o payload de tag.read.
func ParseTagRead(raw json.RawMessage) (*TagReadPayload, error) {
	var p TagReadPayload
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	var is issues
	if !uuidRe.MatchString(p.DeviceID) {
		is.add("device_id", "", "device_id deve ser um UUID")
	}
	is = append(is, config.ValidateTypedAddress(p.Address, p.Type, p.WordOrder, p.Scale)...)
	if err := is.err(); err != nil {
		return nil, err
	}
	return &p, nil
}

// ParseDeviceTest decodifica e valida o payload de device.test.
func ParseDeviceTest(raw json.RawMessage) (*DeviceTestPayload, error) {
	var p DeviceTestPayload
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	var is issues
	if p.DeviceID != "" && !uuidRe.MatchString(p.DeviceID) {
		is.add("device_id", "", "device_id deve ser um UUID")
	}
	is = append(is, config.ValidateConnection(p.Connection.Protocol, p.Connection.Params)...)
	if p.SerialBus != nil {
		is = append(is, config.ValidateSerialBus(*p.SerialBus)...)
		if p.Connection.Protocol != config.ProtocolRTU || p.Connection.Params.Bus != p.SerialBus.ID {
			is.add("serial_bus", RuleDeviceTestBus, "serial_bus só vale em modbus-rtu e com o id de connection.params.bus.")
		}
	}
	if r := p.Probe; r != nil {
		area, err := modbus.ParseArea(r.Area)
		switch {
		case err != nil || r.Area != area.String():
			is.add("probe.area", "", "área inválida")
		case r.Count < 1 || r.Count > area.MaxPerRead():
			is.add("probe.count", "", fmt.Sprintf("quantidade fora da faixa 1–%d", area.MaxPerRead()))
		}
		switch {
		case r.Offset == nil:
			is.add("probe.offset", "", "offset é obrigatório")
		case *r.Offset < 0 || *r.Offset > modbus.MaxOffset:
			is.add("probe.offset", "", fmt.Sprintf("offset fora da faixa 0–%d", modbus.MaxOffset))
		case len(is) == 0 && *r.Offset+r.Count-1 > modbus.MaxOffset:
			is.add("probe.count", RuleProbeRange, "O último endereço lido não pode passar de 65535.")
		}
	}
	if err := is.err(); err != nil {
		return nil, err
	}
	return &p, nil
}

// ParseAgentRestart decodifica e valida o payload de agent.restart.
func ParseAgentRestart(raw json.RawMessage) (*AgentRestartPayload, error) {
	var p AgentRestartPayload
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	var is issues
	if utf8.RuneCountInString(p.Reason) > 200 {
		is.add("reason", "", "reason com mais de 200 caracteres")
	}
	if p.DelayS != nil && (*p.DelayS < 0 || *p.DelayS > 300) {
		is.add("delay_s", "", "delay_s fora da faixa 0–300")
	}
	if err := is.err(); err != nil {
		return nil, err
	}
	return &p, nil
}
