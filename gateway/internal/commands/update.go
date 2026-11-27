package commands

import (
	"context"
	"errors"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

// agent.update (OTA pela nuvem, docs/16 §3). O agente baixa e confere o pacote da sua arquitetura
// (assinatura, tamanho, SHA-256) e responde "downloaded". A instalação NÃO é pedida aqui: o
// oee-updater reinicia o agente logo depois, e o resultado se perderia. Quem pede é o agente, quando a
// nuvem confirma o resultado (UpdateDeps.Downloaded guarda o que pedir).
const (
	TypeAgentUpdate = "agent.update"
	// AgentUpdateTimeout cobre o download do .deb por links lentos e com proxy (contrato: 900 s).
	AgentUpdateTimeout = 15 * time.Minute
)

// UpdateDeps liga o comando ao OTA.
type UpdateDeps struct {
	// Current é a versão em execução (buildinfo.Version).
	Current string
	// Arch é a arquitetura do manifesto deste binário (update.GoArch()).
	Arch string
	// Fetch baixa e confere o pacote pelo manifesto, sem gravar o pedido de instalação.
	Fetch func(ctx context.Context, manifestURL, version string) (*update.Manifest, error)
	// Downloaded é avisado do pacote pronto (id do comando e versão): instalar depois da confirmação.
	Downloaded func(commandID, version string)
}

// AgentUpdatePayload (contrato AgentUpdatePayloadSchema).
type AgentUpdatePayload struct {
	Version   string            `json:"version"`
	Manifests map[string]string `json:"manifests"`
}

// AgentUpdateResult (contrato AgentUpdateResultSchema).
type AgentUpdateResult struct {
	Version  string `json:"version"`
	Previous string `json:"previous"`
	State    string `json:"state"` // downloaded | current
}

// RegisterUpdate registra o agent.update (sem Fetch: fica unsupported).
func RegisterUpdate(x *Executor, d UpdateDeps) {
	if d.Fetch == nil || d.Downloaded == nil {
		return
	}
	x.Register(TypeAgentUpdate, AgentUpdateTimeout, func(ctx context.Context, c contracts.Command) (any, error) {
		var p AgentUpdatePayload
		if err := decode(c.Payload, &p); err != nil {
			return nil, err
		}
		if !update.ValidVersion(p.Version) {
			return nil, Fail(CodeInvalidPayload, "versão inválida: %q", p.Version)
		}
		if p.Version == d.Current {
			return AgentUpdateResult{Version: p.Version, Previous: d.Current, State: "current"}, nil
		}
		url := p.Manifests[d.Arch]
		if url == "" {
			return nil, Fail(CodeInvalidPayload, "sem manifesto para a arquitetura %s", d.Arch)
		}
		m, err := d.Fetch(ctx, url, p.Version)
		switch {
		case errors.Is(err, update.ErrBusy):
			return nil, Fail(CodeUpdateBusy, "%v", err)
		case err != nil:
			return nil, Fail(CodeUpdateFailed, "%v", err)
		}
		d.Downloaded(c.ID, m.Version)
		return AgentUpdateResult{Version: m.Version, Previous: d.Current, State: "downloaded"}, nil
	})
}
