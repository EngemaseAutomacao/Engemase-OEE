package config

import "strings"

// Validação de pedaços da config que também aparecem nos payloads de comando
// (tag.read, device.test): as mesmas regras do dispositivo, do barramento e da tag,
// com os caminhos relativos ao payload.

// nilID é o id de entidade usado só para validar um pedaço sem id próprio.
const nilID = "00000000-0000-0000-0000-000000000000"

// ValidateConnection confere protocolo e parâmetros de uma conexão (o
// DeviceConnectionSchema do contrato). Caminhos relativos a "connection".
func ValidateConnection(protocol string, params DeviceParams) []Issue {
	d := Device{ID: nilID, Protocol: protocol, Params: params}
	v := &validator{}
	d.validateStructure(v, 0)
	return rebase(v.issues, "devices.0.", "connection.")
}

// ValidateSerialBus confere um barramento RS-485. Caminhos relativos a "serial_bus".
func ValidateSerialBus(b SerialBus) []Issue {
	v := &validator{}
	b.validateStructure(v, 0)
	return rebase(v.issues, "serial_buses.0.", "serial_bus.")
}

// ValidateTypedAddress confere um endereço tipado (o de uma tag, sem papel nem
// máquina): estrutura de address, type, word_order e scale e as regras address.*.
// Caminhos relativos ao objeto que tem address e type (ex.: o payload do tag.read).
func ValidateTypedAddress(address Address, typ, wordOrder string, scale *Scale) []Issue {
	tag := Tag{ID: nilID, Address: address, Type: typ, WordOrder: wordOrder, Scale: scale, Role: RoleCustom}
	d := Device{ID: nilID, Protocol: ProtocolTCP, Params: DeviceParams{Host: "127.0.0.1", Port: 502, UnitID: new(int)}, Tags: []Tag{tag}}
	v := &validator{}
	d.validateStructure(v, 0)
	if len(v.issues) == 0 && tag.structurallyUsable() {
		checkTypedAddress(v, &d.Tags[0], []any{"devices", 0, "tags", 0})
	}
	return rebase(v.issues, "devices.0.tags.0.", "")
}

// rebase mantém só os problemas sob from e troca esse prefixo por to.
func rebase(issues []Issue, from, to string) []Issue {
	var out []Issue
	for _, is := range issues {
		if strings.HasPrefix(is.Path, from) {
			is.Path = to + strings.TrimPrefix(is.Path, from)
			out = append(out, is)
		}
	}
	return out
}
