// Package remoteaccess é a lógica do acesso remoto de manutenção (VPN sob demanda, docs/12) do lado do
// gateway, sem depender do Tailscale: conferência da aprovação assinada, política local, sessão com prazo e
// inatividade, encaminhamento só para o SSH local e o protocolo entre o agente e o oee-remote-access.
//
// A rede em si (tsnet) fica no programa separado oee-remote-access (módulo próprio), atrás da interface
// Network: assim a coleta de OEE não carrega a biblioteca da VPN e uma falha nela não derruba a coleta.
package remoteaccess

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultKeysDir guarda as chaves públicas Ed25519 da aprovação (uma por arquivo vpn-approval-*.pub, 32
// bytes em base64). Pasta PRÓPRIA: nunca a das chaves do OTA (deploy/gateway/vpn-keys/README.md).
const DefaultKeysDir = "/usr/share/oee-remote-access/keys"

// ApprovalType é o `typ` das claims da aprovação de VPN (contrato VpnApprovalClaimsSchema).
const ApprovalType = "engemase.vpn_approval.v1"

// clockSkew tolera relógios um pouco diferentes entre a nuvem e o gateway.
const clockSkew = 5 * time.Minute

// ErrApproval é a falha da conferência (código approval_invalid no resultado do comando).
var ErrApproval = errors.New("aprovação inválida")

// Claims da aprovação (contrato VpnApprovalClaimsSchema).
type Claims struct {
	Typ            string `json:"typ"`
	GatewayID      string `json:"gateway_id"`
	SessionID      string `json:"session_id"`
	RequestedBy    string `json:"requested_by"`
	ApprovedBy     string `json:"approved_by"`
	ApprovedAt     string `json:"approved_at"`
	NotAfter       string `json:"not_after"`
	AllowOtForward bool   `json:"allow_ot_forward"`
}

// KeyID é o kid de uma chave: os 16 primeiros hex do SHA-256 dos 32 bytes públicos.
func KeyID(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:])[:16]
}

// LoadKeys lê as chaves confiáveis (vpn-approval-*.pub). Sem nenhuma, nada é aceito (falha fechada).
func LoadKeys(dir string) (map[string]ed25519.PublicKey, error) {
	files, err := filepath.Glob(filepath.Join(dir, "vpn-approval-*.pub"))
	if err != nil {
		return nil, err
	}
	keys := map[string]ed25519.PublicKey{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return nil, err
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			b, err := base64.StdEncoding.DecodeString(line)
			if err != nil || len(b) != ed25519.PublicKeySize {
				return nil, fmt.Errorf("%s: chave pública Ed25519 inválida", filepath.Base(f))
			}
			pub := ed25519.PublicKey(b)
			keys[KeyID(pub)] = pub
		}
	}
	return keys, nil
}

// VerifyApproval confere o JWS (EdDSA, kid conhecido) e as claims contra a sessão pedida: gateway, sessão,
// prazo da aprovação cobrindo o da sessão e ainda no futuro. Devolve as claims conferidas.
func VerifyApproval(jws string, keys map[string]ed25519.PublicKey, gatewayID, sessionID string, sessionExpiresAt, now time.Time) (*Claims, error) {
	fail := func(format string, args ...any) (*Claims, error) {
		return nil, fmt.Errorf("%w: %s", ErrApproval, fmt.Sprintf(format, args...))
	}
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return fail("não é um JWS compacto")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(hb, &header) != nil {
		return fail("cabeçalho ilegível")
	}
	if header.Alg != "EdDSA" {
		return fail("algoritmo %q não aceito", header.Alg)
	}
	pub, ok := keys[header.Kid]
	if !ok {
		return fail("chave %q desconhecida", header.Kid)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !ed25519.Verify(pub, []byte(parts[0]+"."+parts[1]), sig) {
		return fail("assinatura não confere")
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fail("conteúdo ilegível")
	}
	var c Claims
	if err := json.Unmarshal(pb, &c); err != nil {
		return fail("conteúdo ilegível")
	}
	if c.Typ != ApprovalType {
		return fail("tipo %q não é aprovação de VPN", c.Typ)
	}
	if c.GatewayID != gatewayID {
		return fail("aprovação de outro gateway")
	}
	if c.SessionID != sessionID {
		return fail("aprovação de outra sessão")
	}
	notAfter, err := time.Parse(time.RFC3339Nano, c.NotAfter)
	if err != nil {
		return fail("not_after inválido")
	}
	approvedAt, err := time.Parse(time.RFC3339Nano, c.ApprovedAt)
	if err != nil {
		return fail("approved_at inválido")
	}
	if approvedAt.After(now.Add(clockSkew)) {
		return fail("aprovação no futuro")
	}
	if !notAfter.After(now) {
		return fail("aprovação vencida")
	}
	if notAfter.Before(sessionExpiresAt) {
		return fail("a sessão passa do prazo aprovado")
	}
	return &c, nil
}
