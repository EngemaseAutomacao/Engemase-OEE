package uplink

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// ErrBlocked indica que o envio está parado por 401 (token inválido ou revogado).
// A coleta continua e o buffer é mantido até um token novo (Unblock).
var ErrBlocked = errors.New("uplink: envio bloqueado (401); aguardando novo registro")

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
	// OnBlocked é chamado no 401 (alarme local).
	OnBlocked func(error)

	kick chan struct{}

	mu        sync.Mutex
	blocked   bool
	offsets   []int64 // últimas diferenças de relógio (ms)
	lastOK    time.Time
	lastErr   error
	lastStart time.Time
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
		return Result{}, fmt.Errorf("uplink: lendo a fila: %w", err)
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

	switch ActionFor(err) {
	case ActionStopSending:
		s.mu.Lock()
		s.blocked = true
		s.mu.Unlock()
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
					return fmt.Errorf("uplink: gravando ack: %w", aerr)
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
		return fmt.Errorf("uplink: quarentena do seq %d: %w", it.Seq, err)
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
		return time.Minute, true // Unblock acorda pelo kick
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
		return time.Minute, true
	case ActionRetryAfter:
		var he *HTTPError
		if errors.As(err, &he) && he.RetryAfter > 0 {
			s.Backoff.Next() // conta a tentativa
			return min(he.RetryAfter, s.Backoff.Max), false
		}
	}
	return s.Backoff.Next(), false
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
