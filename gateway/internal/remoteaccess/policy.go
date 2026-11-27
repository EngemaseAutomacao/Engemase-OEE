package remoteaccess

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
)

// DefaultPolicyPath é a política local do acesso remoto (docs/12): prevalece sobre a nuvem.
const DefaultPolicyPath = "/etc/oee-gateway/remote-access.json"

// LocalPolicy é o que o técnico/cliente decide no próprio gateway.
//
//	{"allowed": true, "allow_ot_forward": false, "locked": false}
//
// `locked` é o kill switch (`sudo oee-gateway remote-access off --lock`): com ele, nada abre.
type LocalPolicy struct {
	Allowed        bool `json:"allowed"`
	AllowOtForward bool `json:"allow_ot_forward"`
	Locked         bool `json:"locked"`
}

// Permits diz se a VPN pode ligar.
func (p LocalPolicy) Permits() bool { return p.Allowed && !p.Locked }

// LoadPolicy lê a política local. Sem arquivo: permitido (a aprovação do cliente continua obrigatória),
// sem encaminhamento para CLP. Arquivo ilegível: NADA é permitido (falha fechada).
func LoadPolicy(path string) LocalPolicy {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return LocalPolicy{Allowed: true}
	}
	if err != nil {
		return LocalPolicy{Allowed: false, Locked: true}
	}
	var p LocalPolicy
	if json.Unmarshal(raw, &p) != nil {
		return LocalPolicy{Allowed: false, Locked: true}
	}
	return p
}
