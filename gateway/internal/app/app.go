// Package app monta o agente (oee-gateway run): lê a config local, abre o buffer,
// aplica a última config remota salva, sobe os pollers e o motor, e sincroniza com
// a nuvem quando há credencial. A coleta nunca depende da nuvem: com uma config
// salva, o agente coleta e grava, online ou offline.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/commands"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/ids"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

// Options configura o agente.
type Options struct {
	// Local é a config local já carregada.
	Local *config.Local
	// Logger (nil = JSON em stderr no nível da config local).
	Logger *slog.Logger
	// TickEvery é o ritmo do motor (padrão 1 s).
	TickEvery time.Duration
	// CredentialsPollEvery é o intervalo para perceber credencial nova (padrão 10 s).
	CredentialsPollEvery time.Duration
}

type agent struct {
	local   *config.Local
	store   *buffer.Store
	log     *slog.Logger
	ids     *ids.Generator
	cmds    *commands.Executor
	started time.Time
	opts    Options
	health  *healthCollector

	reconfigure chan *config.GatewayConfig
	fetchConfig chan struct{}

	mu        sync.Mutex
	cfg       *config.GatewayConfig
	cfgStatus *contracts.ConfigStatus
	etag      string
	live      []contracts.Live
	devices   []contracts.DeviceHealth
	lastTick  time.Time
	client    *uplink.Client
	syncer    *uplink.Syncer
	credToken string
}

// Run executa o agente até o contexto acabar (SIGTERM).
func Run(ctx context.Context, o Options) error {
	if o.Local == nil {
		return errors.New("app: config local ausente")
	}
	if o.TickEvery <= 0 {
		o.TickEvery = time.Second
	}
	if o.CredentialsPollEvery <= 0 {
		o.CredentialsPollEvery = 10 * time.Second
	}
	log := o.Logger
	if log == nil {
		log = NewLogger(o.Local.Log.Level)
	}
	store, err := buffer.Open(o.Local.Paths.Buffer, buffer.Options{})
	if err != nil {
		return err
	}
	defer store.Close()

	a := &agent{
		local: o.Local, store: store, log: log, ids: ids.NewGenerator(nil), cmds: commands.New(),
		started: time.Now(), opts: o, health: newHealthCollector(o.Local.Paths.StateDir),
		reconfigure: make(chan *config.GatewayConfig, 1), fetchConfig: make(chan struct{}, 1),
	}
	if err := a.loadSavedConfig(ctx); err != nil {
		return err
	}
	if err := a.recordStart(ctx); err != nil {
		return err
	}
	log.Info("agente iniciado", "versao", buildinfo.Version, "commit", buildinfo.Commit,
		"config_version", a.configVersion(), "buffer", o.Local.Paths.Buffer)

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	start := func(name string, fn func(context.Context) error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(runCtx); err != nil && !errors.Is(err, context.Canceled) {
				log.Error("rotina terminou com erro", "rotina", name, "erro", err)
			}
		}()
	}
	start("coleta", a.collect)
	start("credencial", a.watchCredentials)
	start("config", a.configLoop)
	start("watchdog", a.watchdog)
	_ = sdNotify("READY=1\nSTATUS=" + a.statusLine())

	<-ctx.Done()
	_ = sdNotify("STOPPING=1")
	cancel()
	wg.Wait()
	a.recordStop()
	log.Info("agente parado")
	return nil
}

// NewLogger cria o logger JSON (journald guarda o stderr do serviço).
func NewLogger(level string) *slog.Logger {
	var lv slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lv = slog.LevelDebug
	case "warn":
		lv = slog.LevelWarn
	case "error":
		lv = slog.LevelError
	default:
		lv = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: lv}))
}

// ---------------------------------------------------------------------------
// Config remota
// ---------------------------------------------------------------------------

func (a *agent) loadSavedConfig(ctx context.Context) error {
	_, body, err := a.store.LoadConfig(ctx, "current")
	if errors.Is(err, buffer.ErrNoConfig) {
		a.log.Warn("sem config salva: aguardando a nuvem (nada é coletado até lá)")
		return nil
	}
	if err != nil {
		return err
	}
	cfg, err := config.ParseRemote(body)
	if err != nil {
		// Não deveria acontecer (só gravamos config validada); cai para a anterior.
		a.log.Error("config salva inválida; tentando a anterior", "erro", err)
		if _, prev, perr := a.store.LoadConfig(ctx, "previous"); perr == nil {
			cfg, err = config.ParseRemote(prev)
		}
		if err != nil {
			return nil
		}
	}
	a.setConfig(cfg, "applied", "")
	return nil
}

func (a *agent) setConfig(cfg *config.GatewayConfig, state, errMsg string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cfg != nil {
		a.cfg = cfg
	}
	v := 0
	if a.cfg != nil {
		v = a.cfg.ConfigVersion
	}
	a.cfgStatus = &contracts.ConfigStatus{Version: v, State: state, Error: errMsg, At: contracts.FormatTime(time.Now())}
}

func (a *agent) currentConfig() *config.GatewayConfig {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

func (a *agent) configVersion() int {
	if c := a.currentConfig(); c != nil {
		return c.ConfigVersion
	}
	return 0
}

// configLoop baixa e aplica a config quando a nuvem avisa versão nova (ou 409).
func (a *agent) configLoop(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-a.fetchConfig:
		}
		a.mu.Lock()
		client, etag := a.client, a.etag
		a.mu.Unlock()
		if client == nil {
			continue
		}
		fctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		body, newETag, err := client.FetchConfig(fctx, etag)
		cancel()
		if errors.Is(err, uplink.ErrNotModified) {
			continue
		}
		if err != nil {
			a.log.Warn("falha ao baixar a config; tenta no próximo sync", "erro", err)
			continue
		}
		a.applyConfig(ctx, body, newETag)
	}
}

func (a *agent) applyConfig(ctx context.Context, body []byte, etag string) {
	now := time.Now()
	prev := a.configVersion()
	cfg, err := config.ParseRemote(body)
	if err != nil {
		a.log.Error("config recusada; a coleta segue com a atual", "erro", err)
		if v := peekVersion(body); v >= 1 {
			ev := contracts.ConfigRejectedEvent{ID: a.ids.New(now), Type: contracts.EventConfigRejected, At: contracts.FormatTime(now),
				Version: v, Error: truncate(err.Error(), 2000)}
			if prev > 0 {
				ev.RevertedTo = &prev
			}
			a.enqueueEvent(ctx, ev, now)
		}
		a.setConfig(nil, "rejected", truncate(err.Error(), 2000))
		return
	}
	if cfg.ConfigVersion == prev {
		a.mu.Lock()
		a.etag = etag
		a.mu.Unlock()
		return
	}
	if err := a.store.SaveConfig(ctx, cfg.ConfigVersion, body); err != nil {
		a.log.Error("falha ao salvar a config", "erro", err)
		return
	}
	ev := contracts.ConfigAppliedEvent{ID: a.ids.New(now), Type: contracts.EventConfigApplied, At: contracts.FormatTime(now), Version: cfg.ConfigVersion}
	if prev > 0 {
		ev.PreviousVersion = &prev
	}
	a.enqueueEvent(ctx, ev, now)
	a.mu.Lock()
	a.etag = etag
	a.mu.Unlock()
	a.setConfig(cfg, "applied", "")
	a.log.Info("config aplicada", "versao", cfg.ConfigVersion, "anterior", prev)
	select {
	case a.reconfigure <- cfg:
	default: // já há uma troca pendente: a coleta lê a config atual de qualquer forma
	}
}

// ---------------------------------------------------------------------------
// Coleta: pollers + motor
// ---------------------------------------------------------------------------

func (a *agent) collect(ctx context.Context) error {
	for {
		cfg := a.currentConfig()
		if cfg == nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-a.reconfigure:
				continue
			}
		}
		if err := a.collectWith(ctx, cfg); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

// collectWith roda uma config até ela ser trocada (nil) ou o contexto acabar.
//
// Na troca, o motor novo parte dos contadores persistidos no fim do último minuto
// fechado; o minuto aberto do motor antigo nunca foi enviado, então nenhuma peça
// se perde nem é contada duas vezes (aplicação por diferença: pendência).
func (a *agent) collectWith(ctx context.Context, cfg *config.GatewayConfig) error {
	now := time.Now()
	eng, err := engine.New(cfg, now, engine.Options{IDs: a.ids})
	if err != nil {
		return err
	}
	counters, err := a.store.LoadCounters(ctx)
	if err != nil {
		return err
	}
	eng.RestoreCounters(counters)

	pollers, err := poller.Build(cfg, a.local)
	if err != nil {
		a.log.Error("config sem como montar os pollers", "erro", err)
		a.setConfig(nil, "rejected", truncate(err.Error(), 2000))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-a.reconfigure:
			return nil
		}
	}

	pctx, stopPollers := context.WithCancel(ctx)
	readings := make(chan poller.Reading, 1024)
	var wg sync.WaitGroup
	for _, p := range pollers {
		wg.Add(1)
		go func(p *poller.Poller) {
			defer wg.Done()
			for pctx.Err() == nil { // supervisor: reinicia o poller com espera
				if err := p.Run(pctx, readings); err != nil && !errors.Is(err, context.Canceled) {
					a.log.Error("poller parou; reiniciando em 5 s", "poller", p.Name, "erro", err)
					select {
					case <-pctx.Done():
					case <-time.After(5 * time.Second):
					}
				}
			}
		}(p)
	}
	stop := func() {
		stopPollers()
		wg.Wait()
		a.tick(ctx, eng, pollers) // grava o que já fechou
	}

	ticker := time.NewTicker(a.opts.TickEvery)
	defer ticker.Stop()
	for {
		select {
		case r := <-readings:
			if r.Err != nil {
				eng.OnFailure(r.DeviceID, r.At)
			} else {
				eng.OnRead(r.At, r.Samples)
			}
		case <-ticker.C:
			a.tick(ctx, eng, pollers)
		case <-a.reconfigure:
			stop()
			return nil
		case <-ctx.Done():
			stop()
			return ctx.Err()
		}
	}
}

func (a *agent) tick(ctx context.Context, eng *engine.Engine, pollers []*poller.Poller) {
	now := time.Now()
	out := eng.Tick(now)
	if !out.Empty() {
		w, err := buffer.FromEngine(out)
		if err == nil {
			_, err = a.store.Commit(context.WithoutCancel(ctx), w)
		}
		if err != nil {
			a.log.Error("falha ao gravar no buffer", "erro", err)
		}
		for _, r := range out.Records {
			if ev, ok := r.Payload.(contracts.StateEvent); ok {
				a.log.Debug("estado", "maquina", ev.MachineID, "estado", ev.State, "desde", ev.At)
				a.kick()
			}
		}
	}
	var devs []contracts.DeviceHealth
	for _, p := range pollers {
		devs = append(devs, p.Health(now)...)
	}
	a.mu.Lock()
	a.live, a.devices, a.lastTick = eng.Live(now), devs, now
	a.mu.Unlock()
}

func (a *agent) kick() {
	a.mu.Lock()
	s := a.syncer
	a.mu.Unlock()
	if s != nil {
		s.Kick()
	}
}

// ---------------------------------------------------------------------------
// Nuvem: credencial e sync
// ---------------------------------------------------------------------------

// watchCredentials sobe o sync quando há credencial e troca o token quando ela
// muda (novo enroll depois de um 401).
func (a *agent) watchCredentials(ctx context.Context) error {
	var syncCancel context.CancelFunc
	var syncDone chan struct{}
	defer func() {
		if syncCancel != nil {
			syncCancel()
			<-syncDone
		}
	}()
	t := time.NewTicker(a.opts.CredentialsPollEvery)
	defer t.Stop()
	for {
		creds, err := config.LoadCredentials(a.local.Paths.Credentials)
		switch {
		case err != nil:
			a.log.Error("credencial ilegível", "erro", err)
		case creds == nil:
			if a.syncer == nil {
				a.log.Debug("gateway não registrado: rode oee-gateway enroll --code ...")
			}
		case a.syncer == nil:
			if err := a.startSync(ctx, creds, &syncCancel, &syncDone); err != nil {
				a.log.Error("não foi possível iniciar o sync", "erro", err)
			}
		case creds.Token != a.credToken:
			a.client.SetToken(creds.Token)
			a.mu.Lock()
			a.credToken = creds.Token
			a.mu.Unlock()
			a.syncer.Unblock()
			a.log.Info("credencial nova carregada")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
}

func (a *agent) startSync(ctx context.Context, creds *config.Credentials, cancel *context.CancelFunc, done *chan struct{}) error {
	client, err := uplink.New(uplink.Options{
		BaseURL: a.local.Cloud.URL, Token: creds.Token, AgentVersion: buildinfo.Version,
		Timeout: time.Duration(a.local.Cloud.TimeoutS) * time.Second, ExtraCAFile: a.local.Cloud.ExtraCAFile,
	})
	if err != nil {
		return err
	}
	s := &uplink.Syncer{
		Sender:   client,
		Queue:    a.store,
		Snapshot: a.snapshot,
		OnResponse: func(resp *contracts.SyncResponse) {
			a.cmds.Confirm()
			a.cmds.Handle(resp.Commands, time.Now())
			if resp.Config.LatestVersion > a.configVersion() {
				a.requestConfig()
			}
		},
		OnConfigOutdated: a.requestConfig,
		OnBlocked: func(err error) {
			a.log.Error("nuvem recusou o token: envio parado, buffer mantido (refaça o enroll)", "erro", err)
		},
	}
	if c := a.currentConfig(); c != nil {
		s.Interval = time.Duration(c.Uplink.SyncInterval()) * time.Second
		s.MaxItems = c.Uplink.BatchItems()
	}
	a.mu.Lock()
	a.client, a.syncer, a.credToken = client, s, creds.Token
	a.mu.Unlock()

	sctx, c := context.WithCancel(ctx)
	ch := make(chan struct{})
	*cancel, *done = c, ch
	go func() {
		defer close(ch)
		_ = s.Run(sctx)
	}()
	a.log.Info("sincronização com a nuvem iniciada", "url", a.local.Cloud.URL, "gateway_id", creds.GatewayID)
	return nil
}

func (a *agent) requestConfig() {
	select {
	case a.fetchConfig <- struct{}{}:
	default:
	}
}

// snapshot monta saúde, live e resultados de comando para cada /sync.
func (a *agent) snapshot(now time.Time) uplink.Snapshot {
	a.mu.Lock()
	live := append([]contracts.Live(nil), a.live...)
	devs := append([]contracts.DeviceHealth(nil), a.devices...)
	status := a.cfgStatus
	syncer := a.syncer
	a.mu.Unlock()

	h := a.health.collect(now)
	agentH := contracts.AgentHealth{
		Version: buildinfo.Version, UptimeS: int64(now.Sub(a.started).Seconds()), ConfigVersion: a.configVersion(),
		CPUPct: h.cpuPct, MemMB: h.memMB, DiskFreeMB: h.diskFreeMB, ConfigStatus: status, BootID: h.bootID,
	}
	if st, err := a.store.Stats(context.Background()); err == nil {
		agentH.BufferPending = st.Pending
		q := st.Quarantined
		agentH.Quarantined = &q
		if !st.Oldest.IsZero() {
			s := int64(now.Sub(st.Oldest).Seconds())
			agentH.BufferOldestS = &s
		}
	}
	if syncer != nil {
		agentH.ClockOffsetMS = syncer.ClockOffsetMS()
	}
	return uplink.Snapshot{Agent: agentH, Devices: devs, Live: live, CommandResults: a.cmds.Results(contracts.MaxCommandResults)}
}

// ---------------------------------------------------------------------------
// Início, parada e watchdog
// ---------------------------------------------------------------------------

func (a *agent) recordStart(ctx context.Context) error {
	clean, err := a.store.Meta(ctx, "clean_shutdown")
	if err != nil {
		return err
	}
	now := time.Now()
	ev := contracts.AgentStartEvent{ID: a.ids.New(now), Type: contracts.EventAgentStart, At: contracts.FormatTime(now),
		Version: buildinfo.Version, BootID: readBootID(), CleanShutdown: clean == "1"}
	b, err := jsonMarshal(ev)
	if err != nil {
		return err
	}
	_, err = a.store.Commit(ctx, buffer.Write{
		Items: []buffer.Item{{Kind: buffer.KindEvent, ItemID: ev.ID, At: now, Payload: b}},
		Meta:  map[string]string{"clean_shutdown": "0"},
	})
	return err
}

func (a *agent) recordStop() {
	now := time.Now()
	ev := contracts.AgentStopEvent{ID: a.ids.New(now), Type: contracts.EventAgentStop, At: contracts.FormatTime(now), Reason: "shutdown"}
	b, err := jsonMarshal(ev)
	if err != nil {
		return
	}
	if _, err := a.store.Commit(context.Background(), buffer.Write{
		Items: []buffer.Item{{Kind: buffer.KindEvent, ItemID: ev.ID, At: now, Payload: b}},
		Meta:  map[string]string{"clean_shutdown": "1"},
	}); err != nil {
		a.log.Error("falha ao registrar a parada", "erro", err)
	}
}

func (a *agent) enqueueEvent(ctx context.Context, ev any, at time.Time) {
	b, err := jsonMarshal(ev)
	if err != nil {
		return
	}
	id := eventID(b)
	if _, err := a.store.Enqueue(context.WithoutCancel(ctx), buffer.Item{Kind: buffer.KindEvent, ItemID: id, At: at, Payload: b}); err != nil {
		a.log.Error("falha ao gravar evento", "erro", err)
	}
	a.kick()
}

// watchdog alimenta o watchdog do systemd só se o motor está vivo (tick recente).
func (a *agent) watchdog(ctx context.Context) error {
	every := watchdogInterval()
	if every <= 0 {
		<-ctx.Done()
		return ctx.Err()
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
		a.mu.Lock()
		last, hasCfg := a.lastTick, a.cfg != nil
		a.mu.Unlock()
		if hasCfg && time.Since(last) > 5*time.Second && time.Since(a.started) > 30*time.Second {
			a.log.Error("motor sem tick há mais de 5 s: watchdog não alimentado")
			continue
		}
		_ = sdNotify("WATCHDOG=1\nSTATUS=" + a.statusLine())
	}
}

func (a *agent) statusLine() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	cloud := "não registrado"
	if a.syncer != nil {
		cloud = "nuvem offline"
		if ok, err := a.syncer.Status(); err == nil && !ok.IsZero() {
			cloud = "nuvem online"
		}
		if a.syncer.Blocked() {
			cloud = "nuvem bloqueada (401)"
		}
	}
	connected := 0
	for _, d := range a.devices {
		if d.Status == contracts.DeviceConnected {
			connected++
		}
	}
	return fmt.Sprintf("coletando %d/%d dispositivos · %s", connected, len(a.devices), cloud)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
