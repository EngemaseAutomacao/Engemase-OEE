package config_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
)

// endpointDev é um dispositivo de rede (modbus-tcp ou modbus-rtu-over-tcp) para os
// testes de endpoint.
type endpointDev struct {
	protocol string
	host     string
	port     int
	unit     int
}

// endpointConfig monta uma config com os dispositivos dados, cada um com uma tag
// custom (sem máquina).
func endpointConfig(devs ...endpointDev) []byte {
	parts := make([]string, len(devs))
	for i, d := range devs {
		parts[i] = fmt.Sprintf(`{"id":"01a1599e-7f90-7b47-976d-2b40a6cb24%02x","protocol":"%s",
			"params":{"host":"%s","port":%d,"unit_id":%d},
			"tags":[{"id":"01a159ab-0000-7000-8000-0000000000%02x","address":{"area":"holding_register","offset":0},
				"type":"uint16","poll_ms":1000,"role":"custom"}]}`, i, d.protocol, d.host, d.port, d.unit, i)
	}
	return []byte(`{"config_version":1,"serial_buses":[],"devices":[` + strings.Join(parts, ",") +
		`],"machines":[],"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`)
}

// rulesOf devolve "caminho [regra]" de cada problema semântico da config (nil se válida).
func rulesOf(t *testing.T, body []byte) []string {
	t.Helper()
	_, err := config.ParseRemote(body)
	if err == nil {
		return nil
	}
	var verr *config.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("erro inesperado: %v", err)
	}
	var out []string
	for _, is := range verr.Issues {
		if is.Rule == "" {
			t.Fatalf("problema de estrutura numa config de teste: %v", is)
		}
		out = append(out, is.Path+" ["+is.Rule+"]")
	}
	return out
}

// Vários escravos atrás do mesmo conversor RTU sobre TCP (unit ids diferentes) e
// vários dispositivos Modbus TCP no mesmo endpoint são válidos; o mesmo host:porta e
// unit_id duas vezes (host sem diferença de caixa) não é; nem o mesmo host:porta com
// Modbus TCP num dispositivo e RTU sobre TCP em outro: o endpoint fala um protocolo só.
func TestTCPEndpointRules(t *testing.T) {
	const tcp, rtuTCP = config.ProtocolTCP, config.ProtocolRTUOverTCP
	cases := []struct {
		name string
		devs []endpointDev
		want []string
	}{
		{"escravos atrás de um conversor", []endpointDev{
			{rtuTCP, "conv-a.planta", 4001, 1}, {rtuTCP, "CONV-A.planta", 4001, 2}, {rtuTCP, "conv-a.planta", 4001, 3}}, nil},
		{"Modbus TCP com vários unit ids", []endpointDev{
			{tcp, "10.0.0.5", 502, 1}, {tcp, "10.0.0.5", 502, 2}}, nil},
		{"protocolos diferentes em portas diferentes", []endpointDev{
			{tcp, "conv-a.planta", 502, 1}, {rtuTCP, "conv-a.planta", 4001, 1}}, nil},
		{"mesmo escravo duas vezes no conversor", []endpointDev{
			{rtuTCP, "conv-a.planta", 4001, 1}, {rtuTCP, "Conv-A.Planta", 4001, 1}},
			[]string{"devices.1.params [" + config.RuleTCPEndpointUnique + "]"}},
		{"Modbus TCP e RTU sobre TCP no mesmo endpoint", []endpointDev{
			{rtuTCP, "conv-a.planta", 4001, 1}, {rtuTCP, "conv-a.planta", 4001, 2}, {tcp, "CONV-A.planta", 4001, 3}},
			[]string{"devices.2.protocol [" + config.RuleTCPEndpointProtocol + "]"}},
		{"protocolo diferente e unit repetido", []endpointDev{
			{tcp, "10.0.0.5", 502, 1}, {rtuTCP, "10.0.0.5", 502, 1}},
			[]string{"devices.1.protocol [" + config.RuleTCPEndpointProtocol + "]", "devices.1.params [" + config.RuleTCPEndpointUnique + "]"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := rulesOf(t, endpointConfig(c.devs...))
			if strings.Join(got, " | ") != strings.Join(c.want, " | ") {
				t.Fatalf("problemas:\n got %v\nwant %v", got, c.want)
			}
		})
	}
}

// A mensagem da regra nova é em português e diz o que corrigir.
func TestTCPEndpointProtocolMessage(t *testing.T) {
	_, err := config.ParseRemote(endpointConfig(endpointDev{config.ProtocolTCP, "10.0.0.5", 502, 1}, endpointDev{config.ProtocolRTUOverTCP, "10.0.0.5", 502, 2}))
	if err == nil || !strings.Contains(err.Error(), "mesmo host e porta precisam usar o mesmo protocolo") {
		t.Fatalf("erro: %v", err)
	}
}
