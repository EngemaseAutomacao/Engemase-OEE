package commands

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/remoteaccess"
)

type fakeVpn struct {
	got    remoteaccess.EnableRequest
	err    error
	ended  string
	status remoteaccess.Status
}

func (f *fakeVpn) Enable(_ context.Context, r remoteaccess.EnableRequest) (remoteaccess.EnableResult, error) {
	f.got = r
	if f.err != nil {
		return remoteaccess.EnableResult{}, f.err
	}
	return remoteaccess.EnableResult{SessionID: r.SessionID, State: "active", NodeIP: "100.64.0.9", Connection: "relay", SessionExpiresAt: r.SessionExpiresAt}, nil
}
func (f *fakeVpn) Disable(_ context.Context, id, reason string) (remoteaccess.Summary, error) {
	f.ended = reason
	now := time.Date(2026, 11, 27, 16, 0, 0, 0, time.UTC)
	return remoteaccess.Summary{SessionID: id, StartedAt: now.Add(-time.Hour), EndedAt: now, EndReason: reason, BytesIn: 10, SSHLogins: 1}, nil
}
func (f *fakeVpn) Status(context.Context) (remoteaccess.Status, error) { return f.status, nil }

func runVpn(t *testing.T, f *fakeVpn, typ, payload string) (any, error) {
	t.Helper()
	x := New(Options{})
	RegisterVpn(x, VpnDeps{Service: f, GatewayID: func() string { return "01a1cab3-2bea-7244-bb03-702b326efb32" }})
	spec, ok := x.handlers[typ]
	if !ok {
		t.Fatalf("%s não registrado", typ)
	}
	return spec.fn(context.Background(), contracts.Command{ID: "01a1cab3-2bea-7244-bb03-702b326efc00", Type: typ, Payload: json.RawMessage(payload)})
}

func TestVpnEnablePassesThroughAndFormatsResult(t *testing.T) {
	f := &fakeVpn{}
	res, err := runVpn(t, f, TypeVpnEnable, `{"session_id":"01a1cab3-2bea-7244-bb03-702b326efb99","auth_key":"tskey-auth-xxxxxxxxxxxxxxxx","node_name":"oee-gw-a-b","session_expires_at":"2026-11-27T17:00:00.000Z","idle_timeout_s":900,"approval":"a.b.c"}`)
	if err != nil {
		t.Fatal(err)
	}
	if f.got.GatewayID != "01a1cab3-2bea-7244-bb03-702b326efb32" || f.got.AuthKey == "" || f.got.IdleTimeout != 15*time.Minute {
		t.Fatalf("pedido ao serviço: %+v", f.got)
	}
	r := res.(VpnEnableResult)
	if r.State != "active" || r.SessionExpiresAt != "2026-11-27T17:00:00.000Z" || r.Connection != "relay" {
		t.Fatalf("resultado: %+v", r)
	}
	b, _ := json.Marshal(r)
	if string(b) == "" || json.Valid(b) == false {
		t.Fatal("resultado não serializa")
	}
}

func TestVpnErrorsKeepContractCode(t *testing.T) {
	f := &fakeVpn{err: &remoteaccess.Error{Code: remoteaccess.CodeApprovalInvalid, Message: "assinatura não confere"}}
	_, err := runVpn(t, f, TypeVpnEnable, `{"session_id":"01a1cab3-2bea-7244-bb03-702b326efb99","auth_key":"tskey-auth-xxxxxxxxxxxxxxxx","node_name":"oee-gw-a-b","session_expires_at":"2026-11-27T17:00:00.000Z","approval":"a.b.c"}`)
	var e *Error
	if err == nil || !asError(err, &e) || e.Code != "approval_invalid" {
		t.Fatalf("código: %v", err)
	}
	if _, err := runVpn(t, f, TypeVpnEnable, `{"session_expires_at":"ontem"}`); err == nil {
		t.Fatal("data inválida deveria falhar")
	}
}

func TestVpnDisableAndStatus(t *testing.T) {
	f := &fakeVpn{}
	res, err := runVpn(t, f, TypeVpnDisable, `{"session_id":"01a1cab3-2bea-7244-bb03-702b326efb99"}`)
	if err != nil || f.ended != "requested" {
		t.Fatalf("disable: %v %q", err, f.ended)
	}
	if s := res.(VpnSessionSummary); s.EndedAt != "2026-11-27T16:00:00.000Z" || s.SSHLogins != 1 {
		t.Fatalf("resumo: %+v", s)
	}
	if _, err := runVpn(t, f, TypeVpnDisable, `{}`); err == nil {
		t.Fatal("sem session_id deveria falhar")
	}
	f.status = remoteaccess.Status{State: "off", Policy: remoteaccess.LocalPolicy{Allowed: true}}
	st, err := runVpn(t, f, TypeVpnStatus, `{}`)
	if err != nil || st.(VpnStatusResult).State != "off" || st.(VpnStatusResult).Forwards == nil {
		t.Fatalf("status: %+v %v", st, err)
	}
}

func asError(err error, out **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*out = e
	}
	return ok
}
