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
	"slices"
	"strconv"
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

// maxUnsentItems limita a saída do motor guardada em memória enquanto o buffer não
// grava (disco cheio, erro de E/S): 10 000 itens são ~8 h de minutos de 20 máquinas
// (~7 MB). Acima disso saem os itens mais antigos e um evento data_loss registra a
// perda: ela nunca é silenciosa.
const maxUnsentItems = 10_000

// commitErrLogEvery espaça o log de falha de gravação.
const commitErrLogEvery = time.Minute

// Espera entre tentativas de regravar a saída pendente enquanto o buffer falha: dobra
// a cada falha, de commitRetryMin até commitRetryMax. Cada tentativa regrava tudo (até
// maxUnsentItems itens) na rotina de coleta, que também lê os pollers e alimenta o
// watchdog; tentar a cada tick num disco lento ou com erro de E/S a travaria.
const (
	commitRetryMin = time.Second
	commitRetryMax = time.Minute
)

// Limites da verificação de saúde do watchdog (ver healthCheck).
const (
	// tickStaleMin: o motor sem tick por mais que isso (ou que 3 ritmos do tick, se
	// maior) é a rotina de coleta travada.
	tickStaleMin = 5 * time.Second
	// flushStuckAfter: uma tentativa de gravação no buffer em curso há mais que isso é
	// escritor travado; nenhuma tentativa há mais que isso além da prevista é o caminho
	// de gravação parado. Buffer que falha (disco cheio, erro de E/S) não trava nada: a
	// tentativa termina com erro e a próxima vem depois da espera (commitRetryMax).
	flushStuckAfter = 30 * time.Second
)

// clockJumpMin é a menor diferença, entre dois ticks, do avanço do relógio de parede
// para o do monotônico que conta como salto do relógio (passo do NTP ou do RTC).
// Abaixo disso é ruído (slew do NTP, atraso do tick).
const clockJumpMin = 2 * time.Second

// Meta (tabela meta do buffer) da última config recusada: depois de reiniciar, o
// agente não baixa nem recusa de novo a mesma versão. A recusa depende do binário
// (protocolos, papéis e limites que ele valida), então só vale para o mesmo build
// (metaRejectedAgent): depois de uma atualização, a versão é baixada e validada de novo.
const (
	metaRejectedVersion = "config_rejected_version"
	metaRejectedError   = "config_rejected_error"
	metaRejectedAgent   = "config_rejected_agent"
)

// agentBuild identifica o binário que recusou a config (versão e commit).
func agentBuild() string { return buildinfo.Version + " " + buildinfo.Commit }

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

	// Só a rotina de coleta (tick e collectWith) mexe nestes.
	unsent      buffer.Write                      // saída do motor que o buffer ainda não gravou (ver flush)
	lost        *unsentLoss                       // o que saiu de unsent pelo limite, ainda sem data_loss gravado
	commitLogAt time.Time                         // último log de falha de gravação (zero: gravando)
	retryAt     time.Duration                     // monotônico da próxima tentativa de gravar unsent
	retryWait   time.Duration                     // espera atual entre tentativas (0: gravando)
	clock       func() (time.Time, time.Duration) // parede e monotônico (nil = relógio do sistema)
	clockWall   time.Time                         // parede no tick anterior, sem leitura monotônica
	clockMono   time.Duration                     // monotônico no tick anterior

	// writeMu serializa as gravações do app na outbox (coleta e configLoop): o
	// data_loss lê o próprio seq (Stats) antes do Commit, e nada pode entrar no meio.
	writeMu sync.Mutex

	// beats são os batimentos que o watchdog confere (ver healthCheck).
	beats beats

	mu              sync.Mutex
	cfg             *config.GatewayConfig
	cfgStatus       *contracts.ConfigStatus
	etag            string
	rejectedVersion int    // última config_version recusada (0: nenhuma)
	rejectedETag    string // ETag do corpo recusado (If-None-Match evita baixá-lo de novo)
	live            []contracts.Live
	devices         []contracts.DeviceHealth
	lastTick        time.Time
	client          *uplink.Client
	syncer          *uplink.Syncer
	credToken       string
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
	if err := a.loadAppliedConfig(ctx); err != nil {
		return err
	}
	return a.loadRejected(ctx)
}

func (a *agent) loadAppliedConfig(ctx context.Context) error {
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

// loadRejected lê a última config_version recusada (gravada junto com o
// config_rejected). Se ela é mais nova que a aplicada e foi recusada por este mesmo
// build, a recusa continua valendo: a saúde segue informando, e a versão não é
// baixada de novo. Recusada por outro binário (atualização do agente), ela é
// ignorada: este binário baixa e valida a versão uma vez.
func (a *agent) loadRejected(ctx context.Context) error {
	v, err := a.store.Meta(ctx, metaRejectedVersion)
	if err != nil || v == "" {
		return err
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= a.configVersion() {
		return nil // meta estranha ou recusa superada: no pior caso, baixa e recusa uma vez de novo
	}
	by, err := a.store.Meta(ctx, metaRejectedAgent)
	if err != nil {
		return err
	}
	if by != agentBuild() {
		a.log.Info("config recusada por outro build do agente; será baixada e validada de novo",
			"versao", n, "recusada_por", by, "build", agentBuild())
		return nil
	}
	msg, err := a.store.Meta(ctx, metaRejectedError)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.rejectedVersion = n
	a.mu.Unlock()
	a.setConfig(nil, "rejected", msg)
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

// wantsConfig diz se vale baixar a config que a nuvem anuncia: só versão mais nova
// que a aplicada e diferente da que este agente já recusou. A nuvem repete a mesma
// latest_version em todo /sync; sem lembrar a recusa, cada sync baixaria a config,
// recusaria de novo e enfileiraria outro config_rejected.
func (a *agent) wantsConfig(latest int) bool {
	a.mu.Lock()
	rejected := a.rejectedVersion
	a.mu.Unlock()
	return latest > a.configVersion() && latest != rejected
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
		if a.rejectedETag != "" && a.rejectedETag != etag {
			// If-None-Match aceita lista: 304 também se a última ainda é a recusada (409).
			etag = strings.TrimPrefix(etag+", "+a.rejectedETag, ", ")
		}
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
		msg := truncate(err.Error(), 2000)
		v := peekVersion(body)
		a.mu.Lock()
		again := v >= 1 && v == a.rejectedVersion
		if v >= 1 {
			a.rejectedVersion = v
		}
		a.rejectedETag = etag
		a.mu.Unlock()
		a.setConfig(nil, "rejected", msg)
		if again {
			return // já recusada e registrada: um config_rejected por versão
		}
		a.log.Error("config recusada; a coleta segue com a atual", "versao", v, "erro", err)
		if v >= 1 {
			ev := contracts.ConfigRejectedEvent{ID: a.ids.New(now), Type: contracts.EventConfigRejected, At: contracts.FormatTime(now),
				Version: v, Error: msg}
			if prev > 0 {
				ev.RevertedTo = &prev
			}
			// Evento e versão recusada na mesma transação (vale depois de reiniciar, com este build).
			a.enqueueEventMeta(ctx, ev, now, map[string]string{
				metaRejectedVersion: strconv.Itoa(v), metaRejectedError: msg, metaRejectedAgent: agentBuild()})
		}
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
	// Daqui em diante o watchdog confere o motor. Se a coleta morrer antes do primeiro
	// tick (erro ao restaurar os contadores), o tick não vem e o systemd reinicia o agente.
	a.beatStart()
	now := time.Now()
	eng, err := engine.New(cfg, now, engine.Options{IDs: a.ids})
	if err != nil {
		return err
	}
	if err := a.restoreCounters(ctx, eng); err != nil {
		return err
	}

	pollers, err := poller.Build(cfg, a.local)
	if err != nil {
		a.log.Error("config sem como montar os pollers", "erro", err)
		a.setConfig(nil, "rejected", truncate(err.Error(), 2000))
		a.beatStop() // sem motor até outra config: nada a conferir (reiniciar não resolve)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-a.reconfigure:
			return nil
		}
	}

	for _, p := range pollers {
		p.Logger = a.log // mudanças do estado de conexão dos dispositivos
	}
	a.beatPollers(pollers)

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
		a.beatPollers(nil)        // laços parados de propósito: o watchdog não os confere na gravação final
		a.retryAt = 0             // na parada, tenta gravar mesmo durante a espera entre tentativas
		a.tick(ctx, eng, pollers) // grava o que já fechou
		a.beatStop()
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
			a.logUnsentAtExit()
			return ctx.Err()
		}
	}
}

func (a *agent) tick(ctx context.Context, eng *engine.Engine, pollers []*poller.Poller) {
	now, mono := a.readClock()
	a.checkClock(now, mono)
	out := eng.Tick(now)
	if !out.Empty() {
		w, err := buffer.FromEngine(out)
		if err != nil {
			a.log.Error("falha ao serializar a saída do motor", "erro", err)
		}
		a.addUnsent(w)
	}
	if mono >= a.retryAt {
		a.flushBegin(mono)
		if a.flush(ctx, now) {
			a.retryWait = 0
		} else {
			a.retryWait = min(max(2*a.retryWait, commitRetryMin), commitRetryMax)
			a.retryAt = mono + a.retryWait
		}
		a.flushEnd(a.retryAt)
	} else {
		a.trimUnsent(now) // entre tentativas, o limite de memória continua valendo
	}
	for _, r := range out.Records {
		if ev, ok := r.Payload.(contracts.StateEvent); ok {
			a.log.Debug("estado", "maquina", ev.MachineID, "estado", ev.State, "desde", ev.At)
			a.kick()
		}
	}
	var devs []contracts.DeviceHealth
	for _, p := range pollers {
		devs = append(devs, p.Health(now)...)
	}
	a.mu.Lock()
	a.live, a.devices, a.lastTick = eng.Live(now), devs, now
	a.mu.Unlock()
	a.tickDone()
}

// processStart é a referência do relógio monotônico do agente.
var processStart = time.Now()

// readClock devolve o relógio de parede (com a leitura monotônica, como time.Now) e o
// tempo monotônico desde o início do processo, imune a acertos de NTP/RTC.
func (a *agent) readClock() (time.Time, time.Duration) {
	if a.clock != nil {
		return a.clock()
	}
	now := time.Now()
	return now, now.Sub(processStart)
}

// checkClock compara, entre dois ticks, o avanço do relógio de parede com o do
// monotônico. Uma diferença de clockJumpMin ou mais é um passo do relógio (NTP/RTC
// acertando a hora) e vira um evento clock_jump. Os dados usam o relógio de parede:
// num passo para trás, o motor não conta tempo (estado e fechamento de minuto) até o
// relógio alcançar a hora em que estava (pendência: tratar no motor).
func (a *agent) checkClock(wall time.Time, mono time.Duration) {
	wall = wall.Round(0) // sem a leitura monotônica, Sub compara o tempo de parede
	prevWall, prevMono := a.clockWall, a.clockMono
	a.clockWall, a.clockMono = wall, mono
	if prevWall.IsZero() {
		return
	}
	jump := wall.Sub(prevWall) - (mono - prevMono)
	if jump.Abs() < clockJumpMin {
		return
	}
	if jump < 0 {
		a.log.Warn("relógio de parede voltou: a contagem de tempo das máquinas fica parada até ele alcançar a hora anterior",
			"salto_ms", jump.Milliseconds(), "antes", prevWall, "agora", wall)
	} else {
		a.log.Warn("relógio de parede saltou para frente", "salto_ms", jump.Milliseconds(), "antes", prevWall, "agora", wall)
	}
	ev := clockJumpEvent{ID: a.ids.New(wall), Type: eventClockJump, At: contracts.FormatTime(wall), JumpMS: jump.Milliseconds()}
	b, err := jsonMarshal(ev)
	if err != nil {
		return
	}
	a.addUnsent(buffer.Write{Items: []buffer.Item{{Kind: buffer.KindEvent, ItemID: ev.ID, At: wall, Payload: b}}})
}

// restoreCounters dá ao motor novo os contadores do fim do último minuto fechado.
// Os que o motor anterior já usou e o buffer ainda não gravou (falha de Commit) valem
// mais que os do disco: partir dos do disco contaria de novo as peças dos minutos
// que ainda estão em unsent.
func (a *agent) restoreCounters(ctx context.Context, eng *engine.Engine) error {
	counters, err := a.store.LoadCounters(ctx)
	if err != nil {
		return err
	}
	eng.RestoreCounters(mergeCounters(counters, a.unsent.Counters))
	return nil
}

// addUnsent junta uma saída nova ao que falta gravar. Contadores ficam um por tag
// (o mais recente): é o mesmo efeito dos upserts em ordem, e RestoreCounters usa o
// primeiro que encontra.
func (a *agent) addUnsent(w buffer.Write) {
	a.unsent.Items = append(a.unsent.Items, w.Items...)
	a.unsent.Counters = mergeCounters(a.unsent.Counters, w.Counters)
}

// mergeCounters sobrepõe newer a base (por tag) e devolve base.
func mergeCounters(base, newer []engine.CounterState) []engine.CounterState {
	for _, c := range newer {
		if i := slices.IndexFunc(base, func(x engine.CounterState) bool { return x.TagID == c.TagID }); i >= 0 {
			base[i] = c
		} else {
			base = append(base, c)
		}
	}
	return base
}

// flush grava unsent numa transação e diz se gravou. O motor não devolve o que já
// entregou (minutos fechados saem da memória dele, contadores avançam), então uma
// falha de Commit (disco cheio, erro de E/S) não pode descartar a saída: ela fica
// para a próxima tentativa (tick, com espera crescente). Regravar é idempotente:
// itens repetidos são ignorados por kind + item_id e os contadores são upserts.
func (a *agent) flush(ctx context.Context, now time.Time) bool {
	if len(a.unsent.Items) == 0 && len(a.unsent.Counters) == 0 {
		return true
	}
	ctx = context.WithoutCancel(ctx) // o tick da parada também grava
	a.trimUnsent(now)
	w := a.unsent
	if a.lost != nil {
		// Stats e Commit sem outra gravação do app no meio: o seq que o data_loss
		// informa é o que ele mesmo recebe.
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		item, err := a.dataLossItem(ctx)
		if err != nil {
			a.commitFailed(now, err)
			return false
		}
		w.Items = append([]buffer.Item{item}, a.unsent.Items...)
	}
	if _, err := a.store.Commit(ctx, w); err != nil {
		a.commitFailed(now, err)
		return false
	}
	if !a.commitLogAt.IsZero() {
		a.log.Info("buffer voltou a gravar; saída pendente gravada", "itens", len(w.Items))
	}
	a.unsent, a.lost, a.commitLogAt = buffer.Write{}, nil, time.Time{}
	return true
}

func (a *agent) commitFailed(now time.Time, err error) {
	if d := now.Sub(a.commitLogAt); a.commitLogAt.IsZero() || d >= commitErrLogEvery || d < 0 {
		a.log.Error("falha ao gravar no buffer; a saída do motor fica em memória e é regravada com espera crescente",
			"erro", err, "itens_pendentes", len(a.unsent.Items), "limite", maxUnsentItems)
		a.commitLogAt = now
	}
}

// logUnsentAtExit registra, sempre (sem o espaçamento de commitFailed), o que a parada
// perde: a saída do motor que o buffer não gravou só existe em memória, e o data_loss
// dela não tem onde ser gravado.
func (a *agent) logUnsentAtExit() {
	n := len(a.unsent.Items)
	if n == 0 && a.lost == nil {
		return
	}
	var from, to time.Time
	if l := a.lost; l != nil {
		n += l.items
		from, to = l.from, l.to
	}
	for _, it := range a.unsent.Items {
		if from.IsZero() || it.At.Before(from) {
			from = it.At
		}
		if it.At.After(to) {
			to = it.At
		}
	}
	a.log.Error("agente parando sem conseguir gravar no buffer: saída do motor perdida",
		"itens_perdidos", n, "de", from, "ate", to)
}

// unsentLoss acumula o que saiu de unsent pelo limite. Vira UM evento data_loss, com
// o mesmo id em todas as tentativas de gravação.
type unsentLoss struct {
	id       string
	at       time.Time
	items    int
	from, to time.Time
}

// trimUnsent aplica maxUnsentItems: descarta os itens mais antigos e acumula a perda.
// Os contadores ficam: o motor já contou a partir deles, e gravar os antigos faria a
// próxima partida contar peças duas vezes.
func (a *agent) trimUnsent(now time.Time) {
	n := len(a.unsent.Items) - maxUnsentItems
	if n <= 0 {
		return
	}
	if a.lost == nil {
		a.lost = &unsentLoss{id: a.ids.New(now), at: now}
	}
	l := a.lost
	for _, it := range a.unsent.Items[:n] {
		if l.items == 0 || it.At.Before(l.from) {
			l.from = it.At
		}
		if l.items == 0 || it.At.After(l.to) {
			l.to = it.At
		}
		l.items++
	}
	a.unsent.Items = append([]buffer.Item(nil), a.unsent.Items[n:]...)
	a.log.Error("buffer sem gravar há muito tempo: itens mais antigos descartados (data_loss)",
		"descartados", n, "total_perdido", l.items, "limite", maxUnsentItems)
}

// dataLossItem monta o data_loss do que saiu de unsent pelo limite (reason
// retention_limit, o limite de retenção em memória). Esses itens nunca chegaram à
// outbox e não têm seq; o contrato exige a faixa, então lost_seq_from/to marcam a
// posição da lacuna: o próximo seq, que este evento ocupa ao ser gravado à frente
// do restante (flush chama com writeMu, até o Commit).
func (a *agent) dataLossItem(ctx context.Context) (buffer.Item, error) {
	st, err := a.store.Stats(ctx)
	if err != nil {
		return buffer.Item{}, err
	}
	l := a.lost
	pos := st.LastSeq + 1
	ev := dataLossEvent{ID: l.id, Type: eventDataLoss, At: contracts.FormatTime(l.at), Reason: "retention_limit",
		LostSeqFrom: pos, LostSeqTo: pos, Items: l.items, PeriodFrom: contracts.FormatTime(l.from), PeriodTo: contracts.FormatTime(l.to)}
	b, err := jsonMarshal(ev)
	if err != nil {
		return buffer.Item{}, err
	}
	return buffer.Item{Kind: buffer.KindEvent, ItemID: ev.ID, At: l.at, Payload: b}, nil
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
			if a.wantsConfig(resp.Config.LatestVersion) {
				a.requestConfig()
			}
		},
		OnConfigOutdated: a.requestConfig,
		OnBlocked: func(err error) {
			a.log.Error("nuvem recusou o token: envio parado, buffer mantido; o mesmo token é testado de novo a cada "+
				uplink.DefaultProbeEvery.String()+" (se persistir, refaça o enroll)", "erro", err)
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
	a.enqueueEventMeta(ctx, ev, at, nil)
}

// enqueueEventMeta grava o evento e os metadados na mesma transação.
func (a *agent) enqueueEventMeta(ctx context.Context, ev any, at time.Time, meta map[string]string) {
	b, err := jsonMarshal(ev)
	if err != nil {
		return
	}
	id := eventID(b)
	a.writeMu.Lock()
	_, err = a.store.Commit(context.WithoutCancel(ctx), buffer.Write{
		Items: []buffer.Item{{Kind: buffer.KindEvent, ItemID: id, At: at, Payload: b}}, Meta: meta,
	})
	a.writeMu.Unlock()
	if err != nil {
		a.log.Error("falha ao gravar evento", "erro", err)
	}
	a.kick()
}

// watchdog alimenta o watchdog do systemd (WatchdogSec/3) só depois de uma
// verificação real de saúde (feedWatchdog).
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
		a.feedWatchdog()
	}
}

// feedWatchdog alimenta o watchdog do systemd (WATCHDOG=1) se a verificação de saúde
// passa; senão registra em warn qual verificação falhou e não alimenta (sem batimento
// por WatchdogSec, o systemd reinicia o agente). Diz se alimentou.
func (a *agent) feedWatchdog() bool {
	now, mono := a.readClock()
	if f := a.healthCheck(now, mono); f != nil {
		a.log.Warn("watchdog não alimentado: "+f.msg, append([]any{"verificacao", f.check}, f.attrs...)...)
		return false
	}
	_ = sdNotify("WATCHDOG=1\nSTATUS=" + a.statusLine())
	return true
}

// beats são os batimentos que o watchdog confere antes de alimentar o systemd (doc 16
// §3: ciclo do motor, leitores e gravação no SQLite). Tempos monotônicos desde
// processStart (readClock). O mu daqui só protege estes campos e nunca fica travado
// durante E/S: o watchdog não espera por uma rotina presa.
type beats struct {
	mu        sync.Mutex
	running   bool             // coleta rodando (config aplicada); falso: nada a conferir
	tick      time.Duration    // fim do último tick do motor (ou início da coleta)
	pollers   []*poller.Poller // leitores da config em uso
	flushing  bool             // tentativa de gravação no buffer em curso
	flushAt   time.Duration    // início da tentativa em curso, ou fim da última
	flushNext time.Duration    // próxima tentativa prevista: já (gravou) ou depois da espera (falhou)
}

// beatStart marca o início da coleta de uma config: o motor e a gravação passam a ser
// conferidos, a partir de agora. A próxima tentativa de gravação continua a prevista
// pela coleta anterior: se a gravação da parada falhou (buffer falhando numa troca de
// config), ela só vem depois da espera (retryAt, até commitRetryMax), e esperar não é
// caminho de gravação parado. Na rotina de coleta (dona de retryAt).
func (a *agent) beatStart() {
	_, mono := a.readClock()
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.running, b.tick, b.pollers = true, mono, nil
	b.flushing, b.flushAt, b.flushNext = false, mono, max(mono, a.retryAt)
}

// beatStop marca o fim da coleta (troca de config, config sem pollers montáveis).
func (a *agent) beatStop() {
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.running, b.pollers = false, nil
}

// beatPollers registra os leitores da config em uso (o watchdog confere o laço de cada um).
func (a *agent) beatPollers(ps []*poller.Poller) {
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pollers = ps
}

// tickDone marca o fim de um tick do motor.
func (a *agent) tickDone() {
	_, mono := a.readClock()
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tick = mono
}

// flushBegin marca o início de uma tentativa de gravação no buffer.
func (a *agent) flushBegin(mono time.Duration) {
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.flushing, b.flushAt = true, mono
}

// flushEnd marca o fim de uma tentativa de gravação (com sucesso ou falha); a próxima
// está prevista para retryAt (espera crescente, se falhou) ou para já (próximo tick).
func (a *agent) flushEnd(retryAt time.Duration) {
	_, end := a.readClock()
	b := &a.beats
	b.mu.Lock()
	defer b.mu.Unlock()
	b.flushing, b.flushAt, b.flushNext = false, end, max(end, retryAt)
}

// healthFailure é a verificação de saúde que falhou: o watchdog não é alimentado.
type healthFailure struct {
	check string // gravacao | motor | leitor
	msg   string
	attrs []any
}

// tickStaleAfter é o limite sem tick do motor: tickStaleMin ou 3 ritmos do tick.
func (a *agent) tickStaleAfter() time.Duration { return max(tickStaleMin, 3*a.opts.TickEvery) }

// healthCheck é a verificação real de saúde antes de alimentar o watchdog (nil:
// saudável). Confere, na ordem:
//
//   - gravação em curso: uma tentativa de gravar no buffer (SQLite) há mais que
//     flushStuckAfter é escritor travado. Buffer que falha não conta: a tentativa
//     termina, com erro, e a coleta segue (o agente não reinicia em laço por disco
//     cheio ou erro de E/S);
//   - motor: um tick nos últimos tickStaleAfter. Durante uma tentativa de gravação
//     (que roda dentro do tick) quem limita é a verificação acima: disco lento não é
//     motor travado. Depois dela, o limite conta do fim da gravação até o tick
//     terminar (o resto do tick, depois de uma gravação lenta, não é motor travado);
//   - gravação parada: nenhuma tentativa há mais que flushStuckAfter além da prevista
//     (já, ou depois da espera entre tentativas enquanto o buffer falha);
//   - leitores: o laço de cada poller completou uma volta (leitura com sucesso ou
//     falha: o CLP pode não responder) dentro do prazo dele (poller.Liveness). Um
//     laço à espera de o motor consumir as leituras (contrapressão) não conta: a
//     espera é da rotina de coleta, conferida acima. Na parada da coleta, os pollers
//     saem daqui antes da gravação final.
//
// Sem coleta rodando (sem config, ou config sem pollers montáveis à espera de outra)
// não há o que conferir.
func (a *agent) healthCheck(now time.Time, mono time.Duration) *healthFailure {
	b := &a.beats
	b.mu.Lock()
	running, tick, pollers := b.running, b.tick, b.pollers
	flushing, flushAt, flushNext := b.flushing, b.flushAt, b.flushNext
	b.mu.Unlock()
	if !running {
		return nil
	}
	if d := mono - flushAt; flushing && d > flushStuckAfter {
		return &healthFailure{check: "gravacao", msg: "gravação no buffer em curso além do limite (escritor travado)",
			attrs: []any{"em_curso_ha_ms", d.Milliseconds(), "limite_ms", flushStuckAfter.Milliseconds()}}
	}
	// Sem gravação em curso, flushAt é o fim da última. Depois do último tick, ela é do
	// tick em curso: o limite conta do fim dela.
	if d, limit := mono-max(tick, flushAt), a.tickStaleAfter(); !flushing && d > limit {
		attrs := []any{"ultimo_tick_ha_ms", (mono - tick).Milliseconds(), "limite_ms", limit.Milliseconds()}
		if flushAt > tick {
			attrs = append(attrs, "fim_gravacao_ha_ms", d.Milliseconds())
		}
		return &healthFailure{check: "motor", msg: "motor sem tick além do limite (coleta travada)", attrs: attrs}
	}
	if d := mono - flushNext; !flushing && d > flushStuckAfter {
		return &healthFailure{check: "gravacao", msg: "nenhuma tentativa de gravação no buffer além do limite (caminho de gravação parado)",
			attrs: []any{"ultima_tentativa_ha_ms", (mono - flushAt).Milliseconds(), "atraso_ms", d.Milliseconds(),
				"limite_ms", flushStuckAfter.Milliseconds()}}
	}
	for _, p := range pollers {
		if l := p.Liveness(); l.Stalled(now) {
			return &healthFailure{check: "leitor", msg: "laço de leitura sem completar uma volta no prazo (leitor travado)",
				attrs: []any{"poller", p.Name, "ultima_volta_ha_ms", now.Sub(l.Beat).Milliseconds(),
					"prazo_ms", l.Deadline.Sub(l.Beat).Milliseconds()}}
		}
	}
	return nil
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

// Eventos do contrato (packages/contracts/src/sync.ts) que só o app emite; espelham
// DataLossEventSchema e ClockJumpEventSchema (sem seq: injetado no envio).
const (
	eventDataLoss  = "data_loss"
	eventClockJump = "clock_jump"
)

type dataLossEvent struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	At          string `json:"at"`
	Reason      string `json:"reason"` // retention_limit | buffer_corrupted | quarantine_expired
	LostSeqFrom int64  `json:"lost_seq_from"`
	LostSeqTo   int64  `json:"lost_seq_to"`
	Items       int    `json:"items"`
	PeriodFrom  string `json:"period_from"`
	PeriodTo    string `json:"period_to"`
}

type clockJumpEvent struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	At     string `json:"at"`
	JumpMS int64  `json:"jump_ms"` // positivo = para frente
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
