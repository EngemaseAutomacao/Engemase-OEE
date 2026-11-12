// Package config trata a config LOCAL mínima (/etc/oee-gateway/gateway.yaml), a
// credencial do gateway e a config REMOTA gerada pela nuvem (GET /config), com a
// validação estrutural e semântica do contrato v1.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// DefaultCloudURL é o endereço padrão da plataforma: só a URL base (o caminho
// /api/gateway/v1 é fixo no agente). É o ÚNICO lugar do código Go com o host; a
// CLI e os testes usam esta constante. Pela decisão D28 (12/11/2026), por
// enquanto vale só o domínio da Vercel; o domínio próprio fica para depois. Se o
// projeto na Vercel tiver outro nome, troque aqui e nos quatro YAML conferidos
// pelo TestDefaultCloudURLMatchesShippedYAML: o cloud.url de
// examples/gateway.yaml e de deploy/gateway/etc/gateway.yaml e o homepage de
// deploy/gateway/nfpm.yaml e nfpm-updater.yaml (só metadado do .deb).
//
// Trocar o domínio aqui NÃO muda os gateways já instalados: eles usam o
// cloud.url gravado no /etc/oee-gateway/gateway.yaml. Cada gateway instalado
// precisa ter o cloud.url atualizado (pelo pacote OTA, com um passo de
// migração, ou pelo técnico com root, na bancada), e só depois de o TI do
// cliente liberar o host novo. O "enroll --url" não troca o host do agente: vale
// só para a ativação. Caminho e cuidados: docs/16 §4.
const DefaultCloudURL = "https://engemase-oee.vercel.app"

// Caminhos canônicos (docs/16 §4).
const (
	DefaultLocalPath  = "/etc/oee-gateway/gateway.yaml"
	DefaultStateDir   = "/var/lib/oee-gateway"
	DefaultIdentity   = "/data/identity/hw.json"
	credentialsFile   = "credentials.json"
	bufferFile        = "buffer.db"
	localSchemaV1     = 1
	defaultCloudTimeS = 30
)

// Local é a config local mínima, editada no campo (o resto vem da nuvem).
type Local struct {
	Schema int `yaml:"schema"`
	Cloud  struct {
		// URL base da plataforma; o caminho /api/gateway/v1 é fixo no agente.
		URL string `yaml:"url"`
		// TimeoutS é o limite de cada requisição à nuvem.
		TimeoutS int `yaml:"timeout_s"`
		// ExtraCAFile é um PEM com CAs corporativas somadas às do sistema (gerado a
		// partir do network.json pelo ajudante privilegiado). Vazio = só as do sistema.
		ExtraCAFile string `yaml:"extra_ca_file"`
	} `yaml:"cloud"`
	Paths struct {
		StateDir    string `yaml:"state_dir"`
		Credentials string `yaml:"credentials"`
		Buffer      string `yaml:"buffer"`
		Identity    string `yaml:"identity"`
	} `yaml:"paths"`
	Hardware struct {
		// Profile: auto | recomputer-r1000 | generic.
		Profile string `yaml:"profile"`
		// SerialPorts mapeia porta lógica → dispositivo (ex.: rs485-1: /dev/ttyAMA2).
		SerialPorts map[string]string `yaml:"serial_ports"`
	} `yaml:"hardware"`
	Log struct {
		Level string `yaml:"level"` // debug | info | warn | error
	} `yaml:"log"`
}

// R1000SerialPorts é o mapa de portas do reComputer R1000 (ordem dos bornes a confirmar na bancada).
var R1000SerialPorts = map[string]string{
	"rs485-1": "/dev/ttyAMA2",
	"rs485-2": "/dev/ttyAMA3",
	"rs485-3": "/dev/ttyAMA5",
}

// DefaultLocal devolve a config local com todos os padrões.
func DefaultLocal() *Local {
	l := &Local{Schema: localSchemaV1}
	l.applyDefaults()
	return l
}

func (l *Local) applyDefaults() {
	if l.Schema == 0 {
		l.Schema = localSchemaV1
	}
	if l.Cloud.URL == "" {
		l.Cloud.URL = DefaultCloudURL
	}
	l.Cloud.URL = strings.TrimRight(l.Cloud.URL, "/")
	if l.Cloud.TimeoutS == 0 {
		l.Cloud.TimeoutS = defaultCloudTimeS
	}
	if l.Paths.StateDir == "" {
		l.Paths.StateDir = DefaultStateDir
	}
	if l.Paths.Credentials == "" {
		l.Paths.Credentials = filepath.Join(l.Paths.StateDir, credentialsFile)
	}
	if l.Paths.Buffer == "" {
		l.Paths.Buffer = filepath.Join(l.Paths.StateDir, bufferFile)
	}
	if l.Paths.Identity == "" {
		l.Paths.Identity = DefaultIdentity
	}
	if l.Hardware.Profile == "" {
		l.Hardware.Profile = "auto"
	}
	if l.Log.Level == "" {
		l.Log.Level = "info"
	}
}

// LoadLocal lê e valida o gateway.yaml. Arquivo ausente devolve os padrões (o
// agente sobe mesmo sem config local, em modo "não registrado").
func LoadLocal(path string) (*Local, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return DefaultLocal(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("lendo %s: %w", path, err)
	}
	return ParseLocal(b)
}

// ParseLocal decodifica (recusando campos desconhecidos, para pegar erro de
// digitação no campo) e valida o YAML local.
func ParseLocal(b []byte) (*Local, error) {
	l := &Local{}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(l); err != nil && !errors.Is(err, io.EOF) { // arquivo vazio = padrões
		return nil, fmt.Errorf("gateway.yaml inválido: %w", err)
	}
	l.applyDefaults()
	if err := l.Validate(); err != nil {
		return nil, err
	}
	return l, nil
}

// Validate confere a config local.
func (l *Local) Validate() error {
	var problems []string
	if l.Schema != localSchemaV1 {
		problems = append(problems, fmt.Sprintf("schema %d não suportado (use 1)", l.Schema))
	}
	if err := ValidateCloudURL(l.Cloud.URL); err != nil {
		problems = append(problems, err.Error())
	}
	if l.Cloud.TimeoutS < 1 || l.Cloud.TimeoutS > 300 {
		problems = append(problems, "cloud.timeout_s fora da faixa 1–300")
	}
	for name, p := range map[string]string{"paths.state_dir": l.Paths.StateDir, "paths.credentials": l.Paths.Credentials, "paths.buffer": l.Paths.Buffer} {
		if !filepath.IsAbs(p) {
			problems = append(problems, name+" precisa ser um caminho absoluto")
		}
	}
	switch l.Hardware.Profile {
	case "auto", "recomputer-r1000", "generic":
	default:
		problems = append(problems, fmt.Sprintf("hardware.profile %q inválido (auto, recomputer-r1000 ou generic)", l.Hardware.Profile))
	}
	for name, dev := range l.Hardware.SerialPorts {
		if !serialRe.MatchString(name) || strings.HasPrefix(name, "/") {
			problems = append(problems, fmt.Sprintf("porta lógica %q inválida (ex.: rs485-1)", name))
		}
		if !strings.HasPrefix(dev, "/dev/") {
			problems = append(problems, fmt.Sprintf("porta %s → %q precisa ser /dev/...", name, dev))
		}
	}
	switch l.Log.Level {
	case "debug", "info", "warn", "error":
	default:
		problems = append(problems, fmt.Sprintf("log.level %q inválido (debug, info, warn ou error)", l.Log.Level))
	}
	if len(problems) > 0 {
		return fmt.Errorf("gateway.yaml inválido: %s", strings.Join(problems, "; "))
	}
	return nil
}

// ValidateCloudURL exige HTTPS (HTTP só para localhost, em testes e bancada).
func ValidateCloudURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("cloud.url inválida %q", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return fmt.Errorf("cloud.url deve ser só a URL base (sem caminho): %q", raw)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		h := u.Hostname()
		if h == "localhost" || h == "127.0.0.1" || h == "::1" {
			return nil
		}
		return fmt.Errorf("cloud.url precisa ser HTTPS (HTTP só em localhost): %q", raw)
	}
	return fmt.Errorf("cloud.url com esquema %q não suportado", u.Scheme)
}

// ResolveSerialPort converte a porta da config remota ("rs485-1" ou "/dev/...")
// no caminho do dispositivo, pelo perfil de hardware.
func (l *Local) ResolveSerialPort(port string) (string, error) {
	if strings.HasPrefix(port, "/dev/") {
		return port, nil
	}
	if dev, ok := l.Hardware.SerialPorts[port]; ok {
		return dev, nil
	}
	if l.Hardware.Profile == "auto" || l.Hardware.Profile == "recomputer-r1000" {
		if dev, ok := R1000SerialPorts[port]; ok {
			return dev, nil
		}
	}
	return "", fmt.Errorf("porta lógica %q não existe no perfil de hardware %q", port, l.Hardware.Profile)
}

// Credentials é o que o enroll grava em /var/lib/oee-gateway/credentials.json (0600).
type Credentials struct {
	GatewayID  string `json:"gateway_id"`
	Token      string `json:"token"`
	Org        string `json:"org"`
	CloudURL   string `json:"cloud_url"`
	EnrolledAt string `json:"enrolled_at"`
}

// LoadCredentials lê a credencial. Ausente devolve (nil, nil): gateway não registrado.
func LoadCredentials(path string) (*Credentials, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lendo credencial: %w", err)
	}
	var c Credentials
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("credencial corrompida em %s: %w", path, err)
	}
	if c.Token == "" || c.GatewayID == "" {
		return nil, fmt.Errorf("credencial incompleta em %s", path)
	}
	return &c, nil
}

// SaveCredentials grava a credencial de forma atômica, com permissão 0600.
func SaveCredentials(path string, c *Credentials) error {
	if c.EnrolledAt == "" {
		c.EnrolledAt = time.Now().UTC().Format(time.RFC3339)
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(b, '\n'), 0o600)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-"+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
