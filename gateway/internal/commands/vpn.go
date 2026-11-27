package commands

import (
	"context"
	"errors"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/remoteaccess"
)

// Comandos do acesso remoto (docs/12). O agente só repassa ao oee-remote-access, que confere a aprovação
// assinada e liga a VPN. A chave de entrada (auth_key) é segredo de uso único: atravessa a memória e o
// socket local e nunca é gravada nem registrada em log.
const (
	TypeVpnEnable  = "vpn.enable"
	TypeVpnDisable = "vpn.disable"
	TypeVpnStatus  = "vpn.status"

	VpnEnableTimeout  = 2 * time.Minute
	VpnDisableTimeout = 30 * time.Second
	VpnStatusTimeout  = 10 * time.Second
)

// VpnService é o oee-remote-access (cliente do socket em produção).
type VpnService interface {
	Enable(ctx context.Context, r remoteaccess.EnableRequest) (remoteaccess.EnableResult, error)
	Disable(ctx context.Context, sessionID, reason string) (remoteaccess.Summary, error)
	Status(ctx context.Context) (remoteaccess.Status, error)
}

// VpnDeps liga os comandos ao serviço e à identidade do gateway.
type VpnDeps struct {
	Service   VpnService
	GatewayID func() string
}

// VpnEnablePayload (contrato VpnEnablePayloadSchema).
type VpnEnablePayload struct {
	SessionID        string `json:"session_id"`
	AuthKey          string `json:"auth_key"`
	ControlURL       string `json:"control_url,omitempty"`
	NodeName         string `json:"node_name"`
	SessionExpiresAt string `json:"session_expires_at"`
	IdleTimeoutS     *int   `json:"idle_timeout_s,omitempty"`
	Approval         string `json:"approval"`
}

// VpnDisablePayload (contrato VpnDisablePayloadSchema).
type VpnDisablePayload struct {
	SessionID string `json:"session_id"`
	Reason    string `json:"reason,omitempty"`
}

// VpnEnableResult (contrato VpnEnableResultSchema).
type VpnEnableResult struct {
	SessionID        string `json:"session_id"`
	State            string `json:"state"`
	NodeIP           string `json:"node_ip,omitempty"`
	Connection       string `json:"connection,omitempty"`
	SessionExpiresAt string `json:"session_expires_at"`
}

// VpnSessionSummary (contrato VpnSessionSummarySchema): resultado do vpn.disable.
type VpnSessionSummary struct {
	SessionID string `json:"session_id"`
	StartedAt string `json:"started_at,omitempty"`
	EndedAt   string `json:"ended_at"`
	EndReason string `json:"end_reason"`
	BytesIn   int64  `json:"bytes_in"`
	BytesOut  int64  `json:"bytes_out"`
	SSHLogins int    `json:"ssh_logins"`
}

// VpnStatusResult (contrato VpnStatusResultSchema).
type VpnStatusResult struct {
	State             string         `json:"state"`
	SessionID         string         `json:"session_id,omitempty"`
	NodeIP            string         `json:"node_ip,omitempty"`
	Connection        string         `json:"connection,omitempty"`
	SessionExpiresAt  string         `json:"session_expires_at,omitempty"`
	IdleS             *int           `json:"idle_s,omitempty"`
	ActiveConnections *int           `json:"active_connections,omitempty"`
	Forwards          []any          `json:"forwards"`
	LocalPolicy       VpnLocalPolicy `json:"local_policy"`
}

// VpnLocalPolicy é a política local no status.
type VpnLocalPolicy struct {
	Allowed        bool `json:"allowed"`
	AllowOtForward bool `json:"allow_ot_forward"`
	Locked         bool `json:"locked"`
}

// vpnError traduz o erro do serviço para o resultado do comando (mesmo código do contrato).
func vpnError(err error) error {
	var e *remoteaccess.Error
	if errors.As(err, &e) {
		return Fail(e.Code, "%s", e.Message)
	}
	return Fail(remoteaccess.CodeVpnFailed, "%v", err)
}

// RegisterVpn registra vpn.enable, vpn.disable e vpn.status (sem serviço: ficam unsupported).
func RegisterVpn(x *Executor, d VpnDeps) {
	if d.Service == nil || d.GatewayID == nil {
		return
	}
	x.Register(TypeVpnEnable, VpnEnableTimeout, func(ctx context.Context, c contracts.Command) (any, error) {
		var p VpnEnablePayload
		if err := decode(c.Payload, &p); err != nil {
			return nil, err
		}
		exp, err := time.Parse(time.RFC3339Nano, p.SessionExpiresAt)
		if err != nil {
			return nil, Fail(CodeInvalidPayload, "session_expires_at inválido")
		}
		idle := time.Duration(0)
		if p.IdleTimeoutS != nil {
			idle = time.Duration(*p.IdleTimeoutS) * time.Second
		}
		res, err := d.Service.Enable(ctx, remoteaccess.EnableRequest{
			GatewayID: d.GatewayID(), SessionID: p.SessionID, AuthKey: p.AuthKey, ControlURL: p.ControlURL,
			NodeName: p.NodeName, SessionExpiresAt: exp, IdleTimeout: idle, Approval: p.Approval,
		})
		p.AuthKey = "" // não segura o segredo além do necessário
		if err != nil {
			return nil, vpnError(err)
		}
		return VpnEnableResult{SessionID: res.SessionID, State: "active", NodeIP: res.NodeIP, Connection: res.Connection, SessionExpiresAt: contracts.FormatTime(res.SessionExpiresAt)}, nil
	})
	x.Register(TypeVpnDisable, VpnDisableTimeout, func(ctx context.Context, c contracts.Command) (any, error) {
		var p VpnDisablePayload
		if err := decode(c.Payload, &p); err != nil {
			return nil, err
		}
		if p.SessionID == "" {
			return nil, Fail(CodeInvalidPayload, "session_id é obrigatório")
		}
		reason := p.Reason
		if reason == "" {
			reason = remoteaccess.EndRequested
		}
		sum, err := d.Service.Disable(ctx, p.SessionID, reason)
		if err != nil {
			return nil, vpnError(err)
		}
		out := VpnSessionSummary{SessionID: sum.SessionID, EndedAt: contracts.FormatTime(sum.EndedAt), EndReason: sum.EndReason, BytesIn: sum.BytesIn, BytesOut: sum.BytesOut, SSHLogins: sum.SSHLogins}
		if !sum.StartedAt.IsZero() {
			out.StartedAt = contracts.FormatTime(sum.StartedAt)
		}
		return out, nil
	})
	x.Register(TypeVpnStatus, VpnStatusTimeout, func(ctx context.Context, _ contracts.Command) (any, error) {
		st, err := d.Service.Status(ctx)
		if err != nil {
			return nil, vpnError(err)
		}
		out := VpnStatusResult{State: st.State, SessionID: st.SessionID, NodeIP: st.NodeIP, Connection: st.Connection, Forwards: []any{},
			LocalPolicy: VpnLocalPolicy{Allowed: st.Policy.Allowed, AllowOtForward: st.Policy.AllowOtForward, Locked: st.Policy.Locked}}
		if st.SessionExpiresAt != nil {
			out.SessionExpiresAt = contracts.FormatTime(*st.SessionExpiresAt)
			idle, active := st.IdleS, st.ActiveConnections
			out.IdleS, out.ActiveConnections = &idle, &active
		}
		return out, nil
	})
}
