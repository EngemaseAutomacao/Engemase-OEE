package app

import (
	"context"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

// UIGroup é o grupo da página local (oee-localui.service, User=oee-ui).
const UIGroup = "oee-ui"

// serveLocalAPI atende a API local da página no ui.sock (ativação pelo systemd).
// Falha aqui não para a coleta: só fica no log.
func (a *agent) serveLocalAPI(ctx context.Context) {
	srv := &localapi.Server{Status: a.localStatus, AllowUIDs: []uint32{uint32(os.Getuid())}, Log: a.log}
	if g, err := user.LookupGroup(UIGroup); err == nil {
		if n, err := strconv.ParseUint(g.Gid, 10, 32); err == nil {
			srv.AllowGIDs = append(srv.AllowGIDs, uint32(n))
		}
	} else {
		a.log.Warn("API local: grupo da página local não encontrado; só root e o agente conectam", "grupo", UIGroup)
	}
	a.log.Info("API local da página iniciada", "socket", a.opts.UIListener.Addr().String())
	if err := srv.Serve(ctx, a.opts.UIListener); err != nil {
		a.log.Error("API local da página parou", "erro", err)
	}
}

// localStatus é o retrato do agente para a página local.
func (a *agent) localStatus(ctx context.Context) localapi.Status {
	now := time.Now()
	a.mu.Lock()
	live := append(a.live[:0:0], a.live...)
	devs := append(a.devices[:0:0], a.devices...)
	cs := a.cfgStatus
	cfg := a.cfg
	syncer := a.syncer
	a.mu.Unlock()

	st := localapi.Status{GeneratedAt: now.UTC()}
	st.Agent = localapi.Agent{Version: buildinfo.Version, Commit: buildinfo.Commit, StartedAt: a.started.UTC(), ConfigVersion: a.configVersion()}
	if cs != nil {
		st.Agent.ConfigState, st.Agent.ConfigError = cs.State, cs.Error
	}
	st.Cloud = localapi.Cloud{URL: a.local.Cloud.URL, Registered: syncer != nil}
	if syncer != nil {
		lastOK, lastErr := syncer.Status()
		if !lastOK.IsZero() {
			t := lastOK.UTC()
			st.Cloud.LastOKAt = &t
		}
		if lastErr != nil {
			st.Cloud.LastError = truncate(lastErr.Error(), 300)
			st.Cloud.LastErrorKind = uplink.FailureClass(lastErr)
		}
		st.Cloud.Blocked = syncer.Blocked()
		st.Cloud.ClockOffsetMS = syncer.ClockOffsetMS()
	}
	if qs, err := a.store.Stats(ctx); err == nil {
		st.Queue = localapi.Queue{Pending: qs.Pending, Quarantined: qs.Quarantined}
		if !qs.Oldest.IsZero() {
			s := int64(now.Sub(qs.Oldest).Seconds())
			st.Queue.OldestS = &s
		}
	} else {
		st.Queue.Error = truncate(err.Error(), 200)
	}

	devName, devProto, machName := map[string]string{}, map[string]string{}, map[string]string{}
	if cfg != nil {
		for _, d := range cfg.Devices {
			devName[d.ID], devProto[d.ID] = d.Name, d.Protocol
		}
		for _, m := range cfg.Machines {
			machName[m.ID] = m.Name
		}
	}
	for _, d := range devs {
		st.Devices = append(st.Devices, localapi.Device{ID: d.ID, Name: devName[d.ID], Protocol: devProto[d.ID], Status: d.Status,
			LatencyMS: d.LatencyMS, Errors1m: d.Errors1m, LastOKAt: d.LastOKAt, LastError: truncate(d.LastError, 200)})
	}
	seen := map[string]bool{}
	for _, l := range live {
		seen[l.MachineID] = true
		st.Machines = append(st.Machines, localapi.Machine{ID: l.MachineID, Name: machName[l.MachineID], At: l.At, State: l.State,
			StateSince: l.StateSince, FaultCode: l.FaultCode, CounterTotal: l.CounterTotal, Product: l.Product})
	}
	if cfg != nil { // máquina configurada ainda sem leitura também aparece
		for _, m := range cfg.Machines {
			if !seen[m.ID] {
				st.Machines = append(st.Machines, localapi.Machine{ID: m.ID, Name: m.Name})
			}
		}
	}
	return st
}

// markUpdateHealthy grava o update/health.json depois do primeiro /sync aceito
// deste processo, se houver uma atualização pedida: é o sinal que o oee-updater
// espera para não voltar o pacote (OTA mínimo, M4b).
func (a *agent) markUpdateHealthy() {
	if !a.updateHealthOnce.CompareAndSwap(false, true) {
		return
	}
	dir := filepath.Join(a.local.Paths.StateDir, "update")
	if ok, err := update.WriteHealth(dir, buildinfo.Version, time.Now()); err != nil {
		a.log.Error("OTA: health.json não gravado", "erro", err)
	} else if ok {
		a.log.Info("OTA: agente novo saudável (primeiro /sync aceito)", "versao", buildinfo.Version)
	}
}
