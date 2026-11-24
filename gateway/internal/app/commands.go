package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/commands"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// Comandos da nuvem no agente: o executor (internal/commands) com os handlers do MVP
// ligados à config aplicada, aos pollers em execução, ao configLoop e à parada.

// metaRestartCommand guarda o agent.restart que vai reiniciar o agente (id e
// resultado): depois de religar, o resultado volta a ser enviado até a nuvem
// confirmar, e o comando, se a nuvem ainda o reenviar, não é executado de novo (sem
// isso, cada partida reiniciaria o agente até o comando vencer).
const metaRestartCommand = "restart_command"

// restartConfirmWait é quanto o reinício espera, depois do horário pedido, a nuvem
// confirmar o resultado. Sem confirmação (nuvem fora), reinicia assim mesmo: o
// resultado está gravado e vai no primeiro /sync depois de religar.
var restartConfirmWait = 30 * time.Second

type pendingRestart struct {
	id        string
	reason    string
	confirmed chan struct{}
	closed    bool
}

type savedRestart struct {
	ID         string `json:"id"`
	RestartAt  string `json:"restart_at"`
	FinishedAt string `json:"finished_at"`
}

func (a *agent) newExecutor() *commands.Executor {
	x := commands.New(commands.Options{Now: a.cloudNow, OnResult: a.kick, Log: a.log})
	commands.RegisterMVP(x, commands.Deps{
		Config:          a.currentConfig,
		Local:           a.local,
		Modbus:          &commands.Access{Pollers: &a.pollers},
		ReloadConfig:    func(ctx context.Context) (commands.ConfigReloadResult, error) { return a.syncConfig(ctx, true) },
		ScheduleRestart: a.scheduleRestart,
		Now:             a.cloudNow,
		Log:             a.log,
	})
	return x
}

// cloudNow é o relógio local corrigido pela diferença para o server_time: é com ele
// que o expires_at dos comandos é comparado (docs/04).
func (a *agent) cloudNow() time.Time {
	a.mu.Lock()
	s := a.syncer
	a.mu.Unlock()
	now := time.Now()
	if s != nil {
		now = now.Add(time.Duration(s.ClockOffsetMS()) * time.Millisecond)
	}
	return now
}

// scheduleRestart grava o agent.restart e agenda a parada: no horário pedido e
// depois de a nuvem confirmar o resultado (ou restartConfirmWait sem confirmação).
func (a *agent) scheduleRestart(id string, delay time.Duration, reason string) error {
	now := a.cloudNow()
	saved, _ := json.Marshal(savedRestart{ID: id, RestartAt: contracts.FormatTime(now.Add(delay)), FinishedAt: contracts.FormatTime(now)})
	a.writeMu.Lock()
	_, err := a.store.Commit(context.Background(), buffer.Write{Meta: map[string]string{metaRestartCommand: string(saved)}})
	a.writeMu.Unlock()
	if err != nil {
		return commands.Fail(commands.CodeInternalError, "Falha ao gravar o pedido de reinício: %v", err)
	}
	p := &pendingRestart{id: id, reason: reason, confirmed: make(chan struct{})}
	a.restartMu.Lock()
	a.restart = p
	a.restartMu.Unlock()
	a.log.Info("reinício pedido pela nuvem", "comando", id, "em_s", delay.Seconds(), "motivo", reason)
	ctx := a.runCtx
	if ctx == nil {
		ctx = context.Background()
	}
	go func() {
		t := time.NewTimer(delay)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		wait := time.NewTimer(restartConfirmWait)
		defer wait.Stop()
		select {
		case <-ctx.Done():
			return
		case <-p.confirmed:
		case <-wait.C:
			a.log.Warn("reinício sem confirmação da nuvem; o resultado vai depois de religar", "comando", id)
		}
		select {
		case a.restartCh <- id:
		default:
		}
	}()
	return nil
}

// onConfirmed reage aos resultados que a nuvem confirmou: o agent.restart pendente
// pode reiniciar, e o gravado (desta partida ou de uma anterior) sai do buffer.
func (a *agent) onConfirmed(done []commands.Confirmed) {
	for _, c := range done {
		if c.Type != commands.TypeAgentRestart {
			continue
		}
		a.restartMu.Lock()
		p := a.restart
		if p != nil && p.id == c.ID && !p.closed {
			p.closed = true
			close(p.confirmed)
		}
		a.restartMu.Unlock()
		// A nuvem já tem o resultado: ele não precisa mais ser reenviado depois de religar.
		a.writeMu.Lock()
		_, _ = a.store.Commit(context.Background(), buffer.Write{Meta: map[string]string{metaRestartCommand: ""}})
		a.writeMu.Unlock()
	}
}

// restoreRestart recoloca o resultado do agent.restart que reiniciou o agente.
func (a *agent) restoreRestart(ctx context.Context) error {
	v, err := a.store.Meta(ctx, metaRestartCommand)
	if err != nil || v == "" {
		return err
	}
	var s savedRestart
	if json.Unmarshal([]byte(v), &s) != nil || s.ID == "" {
		return nil
	}
	at, err := contracts.ParseTime(s.FinishedAt)
	if err != nil {
		at = time.Now()
	}
	a.cmds.Restore(s.ID, commands.TypeAgentRestart, commands.AgentRestartResult{RestartAt: s.RestartAt}, at)
	return nil
}

// restartDetail descreve o reinício no agent_stop.
func (a *agent) restartDetail(id string) string {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()
	d := "agent.restart " + id
	if a.restart != nil && a.restart.id == id && a.restart.reason != "" {
		d += ": " + a.restart.reason
	}
	return truncate(d, 2000)
}
