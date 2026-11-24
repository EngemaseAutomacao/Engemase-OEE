// Package update tem as regras do OTA mínimo (M4b, D29) que não dependem de rede
// nem de root: o manifesto do pacote e a decisão de rollback. O oee-updater (root,
// pacote oee-gateway-updater) usa este pacote; o contrato dele está em
// deploy/gateway/systemd/oee-gateway-updater.service.
package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

// legacyBufferSchema é o esquema dos pacotes cujo manifesto não traz buffer_schema:
// todos os agentes até a regra da L25 usam o user_version 1.
const legacyBufferSchema = 1

// Manifest é o manifesto assinado (Ed25519, manifest.json.sig) de um pacote do agente.
type Manifest struct {
	Package         string `json:"package"` // oee-gateway
	Version         string `json:"version"`
	Arch            string `json:"arch"` // arm64 | armhf | amd64
	SHA256          string `json:"sha256"`
	Size            int64  `json:"size"`
	MinImageVersion string `json:"min_image_version,omitempty"`
	// BufferSchema é o user_version do buffer.db que este agente cria e o maior que
	// ele abre (buffer.SchemaVersion do build; oee-gateway version --buffer-schema).
	// Ausente nos manifestos antigos: vale 1.
	BufferSchema *int `json:"buffer_schema,omitempty"`
	// AllowedRollbackTo lista as versões mais antigas aceitas num rollback manual.
	AllowedRollbackTo []string `json:"allowed_rollback_to,omitempty"`
}

var sha256Re = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ParseManifest lê e confere um manifesto (a assinatura é conferida antes, sobre os bytes).
func ParseManifest(b []byte) (*Manifest, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("manifesto: JSON inválido: %w", err)
	}
	switch {
	case m.Package != "oee-gateway":
		return nil, fmt.Errorf("manifesto: pacote %q inesperado", m.Package)
	case m.Version == "":
		return nil, errors.New("manifesto: sem versão")
	case m.Arch == "":
		return nil, errors.New("manifesto: sem arquitetura")
	case !sha256Re.MatchString(m.SHA256):
		return nil, errors.New("manifesto: sha256 inválido")
	case m.Size <= 0:
		return nil, errors.New("manifesto: tamanho inválido")
	case m.BufferSchema != nil && *m.BufferSchema < 1:
		return nil, errors.New("manifesto: buffer_schema deve ser ≥ 1")
	}
	return &m, nil
}

// Schema é o esquema do buffer do pacote (1 nos manifestos sem o campo).
func (m *Manifest) Schema() int {
	if m.BufferSchema == nil {
		return legacyBufferSchema
	}
	return *m.BufferSchema
}

// ErrRollbackSchema: o pacote anterior não abriria o buffer atual.
var ErrRollbackSchema = errors.New("rollback recusado: o pacote anterior não abre o esquema atual do buffer")

// CheckAutoRollback decide se o rollback automático (agente novo sem saúde dentro do
// prazo) pode reinstalar o pacote anterior. bufferSchema é o user_version do
// buffer.db no disco (buffer.FileSchemaVersion). Se o agente novo já migrou o buffer
// para um esquema que o anterior não abre, reinstalá-lo deixaria o gateway sem
// coleta e sem OTA (o anterior recusa o buffer e o systemd o reinicia sem fim):
// nesse caso o rollback é recusado, o agente novo fica e o gateway entra na lista
// "atenção" da frota (lacuna L25, docs/17).
func CheckAutoRollback(previous *Manifest, bufferSchema int) error {
	if prev := previous.Schema(); bufferSchema > prev {
		return fmt.Errorf("%w (buffer v%d, pacote %s aceita até v%d)", ErrRollbackSchema, bufferSchema, previous.Version, prev)
	}
	return nil
}
