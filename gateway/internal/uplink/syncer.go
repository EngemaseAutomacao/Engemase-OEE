package uplink

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// ErrBlocked indica que o envio está parado por 401 (token inválido ou revogado).
// A coleta continua e o buffer é mantido até um token novo (Unblock) ou até a sonda
// periódica ver o mesmo token aceito de novo.
var ErrBlocked = errors.New("uplink: envio bloqueado (401); aguardando novo registro")

// DefaultProbeEvery é o intervalo da sonda enquanto o envio está parado por 401: um
// /sync só de saúde (sem itens) com o MESMO token. Um 401 passageiro do servidor
// (deploy, falha no banco de tokens) não pode parar a frota inteira até um novo
// enroll no local; e 15 min é raro o bastante para não insistir num token de fato
// revogado.
const DefaultProbeEvery = 15 * time.Minute

// DefaultFailureLogEvery é o intervalo mínimo entre duas linhas de log da mesma
// classe de falha do /sync enquanto ela persiste (a primeira sai na hora).
const DefaultFailureLogEvery = 10 * time.Minute

// Queue é a parte da outbox usada pelo sincronizador (buffer.Store implementa).
type Queue interface {
	Peek(ctx context.Context, maxItems, maxBytes int) ([]buffer.Item, error)
	Ack(ctx context.Context, seq int64) error
	Quarantine(ctx context.Context, seq int64, reason string) error
}

// Sender envia um /sync (*Client implementa).
type Sender interface {
	Sync(ctx context.Context, req *contracts.SyncRequest) (*contracts.SyncResponse, error)
}

// Snapshot é o que vai em todo /sync além dos itens da fila.
type Snapshot struct {
	Agent          contracts.AgentHealth
	Devices        []contracts.DeviceHealth
	Live           []contracts.Live
	CommandResults []json.RawMessage
}

// Result resume um ciclo de sincronização.
type Result struct {
	Acked       int // itens confirmados
	Quarantined int // itens isolados por 400/413
	Response    *contracts.SyncResponse
	More        bool // a fila ainda tem pelo menos um lote cheio
}

// Syncer envia a outbox em lotes, trata os erros conforme o docs/04 e controla o
// ritmo (next_sync_s do servidor, backoff, recuperação de fila e envio imediato).
type Syncer struct {
	Sender   Sender
	Queue    Queue
	Snapshot func(now time.Time) Snapshot
	MaxItems int // itens por lote (padrão 2000)
	MaxBytes int // bytes de payload por lote (padrão 900 KiB, folga para o 1 MiB)
	// Interval é o ritmo quando o servidor não informa next_sync_s (padrão 10 s).
	Interval time.Duration
	Now      func() time.Time
	Backoff  *Backoff
	// Sleep substitui a espera entre ciclos (testes).
	Sleep func(ctx context.Context, d time.Duration) error
	// OnResponse recebe cada resposta 200 (versão de config, comandos).
	OnResponse func(*contracts.SyncResponse)
	// OnConfigOutdated é chamado no 409.
	OnConfigOutdated func()
	// OnBlocked é chamado no 401 (alarme local), inclusive a cada sonda recusada.
	OnBlocked func(error)
	// ProbeEvery é o intervalo da sonda enquanto bloqueado por 401 (padrão DefaultProbeEvery).
	ProbeEvery time.Duration
	// MarkerPath é o marcador de credencial recusada (BlockedMarkerPath da
	// credencial; vazio = não grava). Gravado no 401 (envio e cada sonda recusada) e
	// removido quando a nuvem volta a aceitar o token (200 ou 409). Só com ele o
	// enroll sem --force troca uma credencial existente.
	MarkerPath string
	// Log recebe as falhas do /sync (nil = slog.Default()).
	Log *slog.Logger
	// FailureLogEvery limita a repetição do log de uma mesma classe de falha
	// (padrão DefaultFailureLogEvery).
	FailureLogEvery time.Duration

	kick chan struct{}

	mu        sync.Mutex
	blocked   bool
	blockedAt time.Time // último 401 (envio ou sonda): a próxima sonda conta daqui
	offsets   []int64   // últimas diferenças de relógio (ms)
	lastOK    time.Time
	lastErr   error
	lastStart time.Time
	// markerGone: o marcador com certeza não existe (removido ou conferido nesta
	// execução). Começa false para o primeiro sucesso apagar um marcador antigo.
	markerGone bool
	outage     outage
}

// outage acompanha a falha atual do /sync para o log com limite de repetição.
type outage struct {
	class    string    // "" = sem falha
	since    time.Time // primeira falha da sequência
	lastLog  time.Time // última linha registrada
	failures int       // tentativas que falharam desde since
	quiet    int       // falhas sem linha de log desde lastLog
	classes  []string  // classes já vistas nesta queda, na ordem
}

func (s *Syncer) init() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kick == nil {
		s.kick = make(chan struct{}, 1)
	}
	if s.Now == nil {
		s.Now = time.Now
	}
	if s.Backoff == nil {
		s.Backoff = NewBackoff()
	}
	if s.MaxItems <= 0 || s.MaxItems > contracts.MaxBatchItems {
		s.MaxItems = contracts.MaxBatchItems
	}
	if s.MaxBytes <= 0 {
		s.MaxBytes = 900 << 10
	}
	if s.Interval <= 0 {
		s.Interval = 10 * time.Second
	}
	if s.ProbeEvery <= 0 {
		s.ProbeEvery = DefaultProbeEvery
	}
	if s.FailureLogEvery <= 0 {
		s.FailureLogEvery = DefaultFailureLogEvery
	}
	if s.Log == nil {
		s.Log = slog.Default()
	}
}

// Kick pede um envio imediato (mudança de estado). Respeita o mínimo de 2 s entre
// envios e não fura o backoff.
func (s *Syncer) Kick() {
	s.init()
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// Unblock libera o envio depois de um 401 (token novo).
func (s *Syncer) Unblock() {
	s.mu.Lock()
	s.blocked = false
	s.mu.Unlock()
	s.Kick()
}

// Blocked indica se o envio está parado por 401.
func (s *Syncer) Blocked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.blocked
}

// ClockOffsetMS é a diferença filtrada (mediana das 5 últimas) server_time − local.
func (s *Syncer) ClockOffsetMS() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.offsets) == 0 {
		return 0
	}
	v := append([]int64(nil), s.offsets...)
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	return v[len(v)/2]
}

// Status devolve o último sucesso e o último erro (para status/diag).
func (s *Syncer) Status() (lastOK time.Time, lastErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastOK, s.lastErr
}

// SyncOnce envia um lote (com bisseção/divisão em caso de 400/413).
func (s *Syncer) SyncOnce(ctx context.Context) (Result, error) {
	s.init()
	if s.Blocked() {
		return Result{}, ErrBlocked
	}
	s.mu.Lock()
	s.lastStart = s.Now()
	s.mu.Unlock()

	items, err := s.Queue.Peek(ctx, s.MaxItems, s.MaxBytes)
	if err != nil {
		err = &queueError{op: "lendo a fila", err: err}
		s.noteResult(err)
		return Result{}, err
	}
	var res Result
	err = s.send(ctx, items, &res)
	res.More = err == nil && len(items) >= s.MaxItems

	s.mu.Lock()
	s.lastErr = err
	if err == nil {
		s.lastOK = s.Now()
	}
	s.mu.Unlock()
	s.noteResult(err)

	switch ActionFor(err) {
	case ActionStopSending:
		s.mu.Lock()
		s.blocked = true
		s.blockedAt = s.Now()
		s.mu.Unlock()
		s.markBlocked(err)
		if s.OnBlocked != nil {
			s.OnBlocked(err)
		}
	case ActionRefreshConfig:
		if s.OnConfigOutdated != nil {
			s.OnConfigOutdated()
		}
	}
	return res, err
}

func (s *Syncer) send(ctx context.Context, items []buffer.Item, res *Result) error {
	resp, err := s.post(ctx, items)
	if err == nil {
		if len(items) > 0 {
			// Nunca confirma além do que foi enviado neste lote.
			ack := min(resp.AckSeq, items[len(items)-1].Seq)
			if ack > 0 {
				if aerr := s.Queue.Ack(ctx, ack); aerr != nil {
					return &queueError{op: "gravando ack", err: aerr}
				}
			}
			for _, it := range items {
				if it.Seq <= ack {
					res.Acked++
				}
			}
		}
		res.Response = resp
		if s.OnResponse != nil {
			s.OnResponse(resp)
		}
		return nil
	}

	switch ActionFor(err) {
	case ActionSplitBatch:
		switch len(items) {
		case 0:
			return err
		case 1:
			return s.quarantine(ctx, items[0], err, res)
		}
		return s.split(ctx, items, res)
	case ActionIsolateItem:
		switch len(items) {
		case 0:
			return err // o problema está na saúde/live, não num item
		case 1:
			// Antes de isolar, confirma que o culpado é o item: um sync sem itens precisa passar.
			if _, perr := s.post(ctx, nil); perr != nil {
				return err
			}
			return s.quarantine(ctx, items[0], err, res)
		}
		return s.split(ctx, items, res)
	}
	return err
}

func (s *Syncer) split(ctx context.Context, items []buffer.Item, res *Result) error {
	mid := len(items) / 2
	if err := s.send(ctx, items[:mid], res); err != nil {
		return err
	}
	return s.send(ctx, items[mid:], res)
}

func (s *Syncer) quarantine(ctx context.Context, it buffer.Item, cause error, res *Result) error {
	reason := cause.Error()
	if len(reason) > 500 {
		reason = reason[:500]
	}
	if err := s.Queue.Quarantine(ctx, it.Seq, reason); err != nil {
		return &queueError{op: fmt.Sprintf("quarentena do seq %d", it.Seq), err: err}
	}
	res.Quarantined++
	return nil
}

func (s *Syncer) post(ctx context.Context, items []buffer.Item) (*contracts.SyncResponse, error) {
	start := s.Now()
	var snap Snapshot
	if s.Snapshot != nil {
		snap = s.Snapshot(start)
	}
	req := &contracts.SyncRequest{
		Batch:          contracts.Batch{SentAt: contracts.FormatTime(start)},
		Agent:          snap.Agent,
		Devices:        snap.Devices,
		Live:           snap.Live,
		CommandResults: snap.CommandResults,
	}
	if len(items) > 0 {
		from, to := items[0].Seq, items[len(items)-1].Seq
		req.Batch.SeqFrom, req.Batch.SeqTo = &from, &to
	}
	for _, it := range items {
		if it.Kind == buffer.KindMinute {
			req.Minutes = append(req.Minutes, it.JSON())
		} else {
			req.Events = append(req.Events, it.JSON())
		}
	}
	resp, err := s.Sender.Sync(ctx, req)
	if err != nil {
		return nil, err
	}
	end := s.Now()
	if st, perr := contracts.ParseTime(resp.ServerTime); perr == nil {
		mid := start.Add(end.Sub(start) / 2)
		s.mu.Lock()
		s.offsets = append(s.offsets, st.Sub(mid).Milliseconds())
		if len(s.offsets) > 5 {
			s.offsets = s.offsets[len(s.offsets)-5:]
		}
		s.mu.Unlock()
	}
	return resp, nil
}

// Run sincroniza até o contexto acabar.
func (s *Syncer) Run(ctx context.Context) error {
	s.init()
	for {
		wait, honorKick := s.cycle(ctx)
		if err := s.wait(ctx, wait, honorKick); err != nil {
			return err
		}
	}
}

// cycle faz um ciclo e devolve quanto esperar até o próximo.
func (s *Syncer) cycle(ctx context.Context) (time.Duration, bool) {
	if s.Blocked() {
		if wait := s.probeWait(); wait > 0 {
			return wait, true // Unblock (token novo) acorda pelo kick
		}
		if !s.probe(ctx) {
			return s.ProbeEvery, true
		}
		// O mesmo token voltou a ser aceito: segue com o envio normal.
	}
	res, err := s.SyncOnce(ctx)
	switch ActionFor(err) {
	case ActionOK:
		s.Backoff.Reset()
		if res.More {
			// Recuperação de fila: próximo lote logo, com jitter, sem atropelar a nuvem.
			return time.Second + time.Duration(rand.Int64N(int64(500*time.Millisecond))), true
		}
		if res.Response != nil && res.Response.NextSyncS >= 1 {
			return time.Duration(min(res.Response.NextSyncS, 300)) * time.Second, true
		}
		return s.Interval, true
	case ActionStopSending:
		return s.ProbeEvery, true // Unblock acorda pelo kick; senão, a sonda
	case ActionRetryAfter:
		var he *HTTPError
		if errors.As(err, &he) && he.RetryAfter > 0 {
			s.Backoff.Next() // conta a tentativa
			return min(he.RetryAfter, s.Backoff.Max), false
		}
	}
	return s.Backoff.Next(), false
}

// probeWait diz quanto falta para a próxima sonda (<= 0: já é hora).
func (s *Syncer) probeWait() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return min(s.blockedAt.Add(s.ProbeEvery).Sub(s.Now()), s.ProbeEvery)
}

// probe testa o token atual com um /sync só de saúde: sem itens, o buffer fica
// intacto. Devolve true (e desbloqueia) se o servidor voltou a aceitar o token: 200,
// ou 409 (config_outdated), que a nuvem só responde depois de autenticar; no 409 a
// config é pedida, senão a sonda seguinte levaria 409 de novo e o envio não voltaria.
// Um novo 401 mantém o bloqueio e repete o alarme local; outro erro (rede, 5xx)
// não testou o token e só adia a sonda.
func (s *Syncer) probe(ctx context.Context) bool {
	s.mu.Lock()
	s.lastStart = s.Now()
	s.mu.Unlock()

	var res Result
	err := s.send(ctx, nil, &res)
	outdated := ActionFor(err) == ActionRefreshConfig

	s.mu.Lock()
	s.lastErr = err
	if err == nil || outdated {
		if err == nil {
			s.lastOK = s.Now()
		}
		s.blocked = false
		s.mu.Unlock()
		s.noteResult(err)
		if outdated && s.OnConfigOutdated != nil {
			s.OnConfigOutdated()
		}
		return true
	}
	s.blockedAt = s.Now()
	s.mu.Unlock()
	s.noteResult(err)
	if ActionFor(err) == ActionStopSending {
		s.markBlocked(err)
		if s.OnBlocked != nil {
			s.OnBlocked(err)
		}
	}
	return false
}

func (s *Syncer) wait(ctx context.Context, d time.Duration, honorKick bool) error {
	if s.Sleep != nil {
		return s.Sleep(ctx, d)
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	for {
		var kick <-chan struct{}
		if honorKick {
			kick = s.kick
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return nil
		case <-kick:
			// No máximo um envio a cada 2 s.
			s.mu.Lock()
			next := s.lastStart.Add(2 * time.Second)
			s.mu.Unlock()
			if gap := next.Sub(s.Now()); gap > 0 {
				timer.Reset(gap)
				honorKick = false
				continue
			}
			return nil
		}
	}
}

// ---------------------------------------------------------------------------
// Log das falhas do /sync
// ---------------------------------------------------------------------------

// Classes de falha do /sync (campo "classe" do log).
const (
	ClassDNS          = "dns"            // nome da nuvem não resolve
	ClassTLS          = "tls"            // certificado, CA corporativa, inspeção SSL, handshake
	ClassProxy        = "proxy"          // proxy fora do ar ou recusou o CONNECT (ex.: 407)
	ClassTimeout      = "timeout"        // conexão ou resposta além do prazo
	ClassConnection   = "conexao"        // recusada, derrubada, rede inalcançável
	ClassUnauthorized = "nao_autorizado" // 401 (alarme próprio pelo OnBlocked)
	ClassHTTP4xx      = "http_4xx"       // outro 4xx da nuvem (inclui 429)
	ClassHTTP5xx      = "http_5xx"       // erro do servidor
	ClassBuffer       = "buffer"         // falha na fila local (SQLite), não na nuvem
	ClassOther        = "outro"
)

// queueError marca uma falha da fila local, para não ser confundida com a nuvem.
type queueError struct {
	op  string
	err error
}

func (e *queueError) Error() string { return "uplink: " + e.op + ": " + e.err.Error() }
func (e *queueError) Unwrap() error { return e.err }

// FailureClass classifica um erro do /sync para o log e o diagnóstico (nil = "").
func FailureClass(err error) string {
	if err == nil {
		return ""
	}
	var he *HTTPError
	if errors.As(err, &he) {
		switch {
		case he.Status == http.StatusUnauthorized:
			return ClassUnauthorized
		case he.Status >= 500:
			return ClassHTTP5xx
		case he.Status >= 400:
			return ClassHTTP4xx
		}
		return ClassOther
	}
	var qe *queueError
	if errors.As(err, &qe) {
		return ClassBuffer
	}
	if isProxyError(err) {
		return ClassProxy
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return ClassDNS
	}
	if isTLSError(err) {
		return ClassTLS
	}
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
		return ClassTimeout
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) || errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET) ||
		errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return ClassConnection
	}
	return ClassOther
}

// isProxyError reconhece a falha no proxy: a conexão com o próprio proxy (o
// transporte do Go a embrulha num net.OpError "proxyconnect") ou a recusa do
// CONNECT (isConnectRefusal).
func isProxyError(err error) bool {
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "proxyconnect" {
		return true
	}
	var ue *url.Error
	return errors.As(err, &ue) && isConnectRefusal(ue.Err)
}

// errorStringType é o tipo de errors.New.
var errorStringType = reflect.TypeOf(errors.New(""))

// isConnectRefusal reconhece a recusa do CONNECT pelo proxy. O transporte do Go
// devolve só a frase do status, sem o código (errors.New(frase), net/http
// transport.go): a padrão ("Proxy Authentication Required", "Forbidden"), uma
// própria do proxy ("Authentication Required", "Tunnel or SSL Forbidden"), vazia
// ("HTTP/1.1 407 ") ou "unknown status code" (linha sem frase). Comparar com
// http.StatusText perdia as frases fora do padrão. Os outros erros sem tipo que o
// cliente HTTP devolve embrulhados no url.Error são do próprio Go (prefixo
// "net/http:"/"http:"), o fim de conexão (io.EOF), o cancelamento e o limite de
// redirecionamentos, todos excluídos aqui.
func isConnectRefusal(err error) bool {
	if err == nil || reflect.TypeOf(err) != errorStringType ||
		errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, context.Canceled) {
		return false
	}
	msg := err.Error()
	for _, own := range []string{"net/http:", "http:", "http2:", "stopped after "} {
		if strings.HasPrefix(msg, own) {
			return false
		}
	}
	return true
}

func isTLSError(err error) bool {
	var cve *tls.CertificateVerificationError
	var rhe tls.RecordHeaderError
	var alert tls.AlertError
	var uae x509.UnknownAuthorityError
	var hne x509.HostnameError
	var cie x509.CertificateInvalidError
	if errors.As(err, &cve) || errors.As(err, &rhe) || errors.As(err, &alert) ||
		errors.As(err, &uae) || errors.As(err, &hne) || errors.As(err, &cie) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "tls: ") || strings.Contains(msg, "TLS handshake timeout") || strings.Contains(msg, "x509: ")
}

// noteResult registra o resultado de um /sync (envio ou sonda): log com limite de
// repetição e o marcador de credencial recusada.
func (s *Syncer) noteResult(err error) {
	switch {
	case errors.Is(err, context.Canceled):
		// Desligamento do agente: não é falha da nuvem.
	case err == nil:
		s.recovered()
		s.clearMarker()
	case ActionFor(err) == ActionRefreshConfig:
		// 409: a nuvem autenticou o token, só falta a config; a queda (se houver)
		// termina no próximo 200.
		s.clearMarker()
	default:
		s.failed(err)
	}
}

// failed registra a falha: a primeira de uma sequência e cada classe nova nesta
// queda saem na hora; uma classe já vista (a mesma, ou uma que volta: dns ↔ timeout
// quando o cache do resolvedor expira, proxy instável) sai no máximo uma vez a
// cada FailureLogEvery, senão uma queda que alterna entre duas classes registraria
// toda tentativa. O 401 só entra na conta da queda: o alarme dele é o OnBlocked.
func (s *Syncer) failed(err error) {
	const (
		quiet = iota
		first
		changed
		persists
	)
	class := FailureClass(err)
	now := s.Now()

	s.mu.Lock()
	o := &s.outage
	prev := o.class
	if prev == "" {
		*o = outage{since: now}
	}
	o.failures++
	o.class = class
	seen := slices.Contains(o.classes, class)
	if !seen {
		o.classes = append(o.classes, class)
	}
	kind := quiet
	switch {
	case class == ClassUnauthorized:
	case prev == "":
		kind = first
	case !seen:
		kind = changed
	case now.Sub(o.lastLog) >= s.FailureLogEvery:
		kind = persists
	}
	if kind == quiet {
		o.quiet++
		s.mu.Unlock()
		return
	}
	since, failures, omitted := o.since, o.failures, o.quiet
	var classes []string
	if len(o.classes) > 1 {
		classes = slices.Clone(o.classes)
	}
	o.lastLog, o.quiet = now, 0
	s.mu.Unlock()

	attrs := []any{"classe", class, "erro", err}
	if classes != nil {
		attrs = append(attrs, "classes", classes)
	}
	var he *HTTPError
	if errors.As(err, &he) {
		attrs = append(attrs, "status", he.Status)
		if he.Code != "" {
			attrs = append(attrs, "codigo", he.Code)
		}
	}
	switch kind {
	case first:
		s.Log.Warn("falha no sync com a nuvem: a coleta continua e os dados ficam no buffer", attrs...)
	case changed:
		s.Log.Warn("falha no sync com a nuvem mudou de causa",
			append(attrs, "classe_anterior", prev, "duracao", roundDuration(now.Sub(since)), "falhas", failures, "omitidas", omitted)...)
	case persists:
		s.Log.Warn("falha no sync com a nuvem persiste",
			append(attrs, "duracao", roundDuration(now.Sub(since)), "falhas", failures, "omitidas", omitted)...)
	}
}

// recovered fecha a queda (se havia uma) com a duração e o número de falhas.
func (s *Syncer) recovered() {
	now := s.Now()
	s.mu.Lock()
	o := s.outage
	s.outage = outage{}
	s.mu.Unlock()
	if o.class == "" {
		return
	}
	attrs := []any{"classe", o.class, "duracao", roundDuration(now.Sub(o.since)), "falhas", o.failures}
	if len(o.classes) > 1 {
		attrs = append(attrs, "classes", o.classes)
	}
	s.Log.Info("sync com a nuvem recuperado", attrs...)
}

// roundDuration deixa a duração legível no journal (o JSON do slog grava
// time.Duration em nanossegundos).
func roundDuration(d time.Duration) string { return d.Round(time.Second).String() }

// ---------------------------------------------------------------------------
// Marcador de credencial recusada (auth-blocked)
// ---------------------------------------------------------------------------

// BlockedMarkerFile é o nome do marcador, no mesmo diretório da credencial.
const BlockedMarkerFile = "auth-blocked"

// BlockedMarker é gravado pelo agente (usuário oee, 0600, escrita atômica)
// enquanto a nuvem recusa o token com 401, e apagado quando ela volta a aceitar.
// Com ele presente, o enroll sem --force pode trocar a credencial existente: o
// sudo do técnico recusa --force e a imagem não tem root (docs/16 §4).
type BlockedMarker struct {
	Since  string `json:"since"`          // primeiro 401 deste bloqueio (RFC 3339, UTC)
	Last   string `json:"last"`           // último 401 (envio ou sonda)
	Status int    `json:"status"`         // 401
	Code   string `json:"code,omitempty"` // error.code da nuvem (unauthorized, token_revoked)
}

// BlockedMarkerPath devolve o caminho do marcador ao lado da credencial.
func BlockedMarkerPath(credentialsPath string) string {
	return filepath.Join(filepath.Dir(credentialsPath), BlockedMarkerFile)
}

// ReadBlockedMarker lê o marcador. Ausente devolve (nil, nil). Conteúdo ilegível
// ainda conta como marcador (só o agente grava o arquivo), com os campos vazios.
func ReadBlockedMarker(path string) (*BlockedMarker, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lendo o marcador de credencial recusada: %w", err)
	}
	var m BlockedMarker
	if json.Unmarshal(b, &m) != nil {
		return &BlockedMarker{}, nil
	}
	return &m, nil
}

// WriteBlockedMarker grava o marcador de forma atômica, com permissão 0600.
func WriteBlockedMarker(path string, m *BlockedMarker) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-"+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(b, '\n')); err != nil {
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

// RemoveBlockedMarker apaga o marcador; removed diz se ele existia.
func RemoveBlockedMarker(path string) (removed bool, err error) {
	err = os.Remove(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// markBlocked grava (ou atualiza) o marcador no 401, mantendo o início do bloqueio.
func (s *Syncer) markBlocked(err error) {
	if s.MarkerPath == "" {
		return
	}
	now := s.Now().UTC().Format(time.RFC3339)
	m := &BlockedMarker{Since: now, Last: now, Status: http.StatusUnauthorized}
	var he *HTTPError
	if errors.As(err, &he) {
		m.Status, m.Code = he.Status, he.Code
	}
	if old, rerr := ReadBlockedMarker(s.MarkerPath); rerr == nil && old != nil && old.Since != "" {
		m.Since = old.Since
	}
	if werr := WriteBlockedMarker(s.MarkerPath, m); werr != nil {
		s.Log.Warn("não foi possível gravar o marcador de credencial recusada (o enroll sem --force não vai trocar a credencial)",
			"caminho", s.MarkerPath, "erro", werr)
		return
	}
	s.mu.Lock()
	s.markerGone = false
	s.mu.Unlock()
}

// clearMarker apaga o marcador quando a nuvem volta a aceitar o token (uma vez:
// depois disso só um novo 401 o recria).
func (s *Syncer) clearMarker() {
	if s.MarkerPath == "" {
		return
	}
	s.mu.Lock()
	gone := s.markerGone
	s.mu.Unlock()
	if gone {
		return
	}
	removed, err := RemoveBlockedMarker(s.MarkerPath)
	if err != nil {
		s.Log.Warn("não foi possível apagar o marcador de credencial recusada", "caminho", s.MarkerPath, "erro", err)
		return
	}
	s.mu.Lock()
	s.markerGone = true
	s.mu.Unlock()
	if removed {
		s.Log.Info("nuvem voltou a aceitar o token: marcador de credencial recusada apagado", "caminho", s.MarkerPath)
	}
}
