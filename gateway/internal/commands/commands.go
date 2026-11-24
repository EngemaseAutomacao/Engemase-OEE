// Package commands recebe os comandos que chegam na resposta do /sync, deduplica
// por id, descarta os vencidos, executa os tipos que o agente conhece (cada um com o
// seu prazo, em paralelo limitado) e devolve os resultados no /sync seguinte.
//
// Tipo sem handler (os F2 do contrato e os de versões futuras) volta como
// rejected/unsupported, sem travar o /sync. O executor não bloqueia quem o chama: o
// Handle só registra e dispara; cada resultado pronto chama Options.OnResult (o
// agente pede um /sync imediato).
package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// Status dos resultados (CommandResultSchema).
const (
	StatusOK       = "ok"
	StatusError    = "error"
	StatusExpired  = "expired"
	StatusRejected = "rejected"
)

// Códigos de erro de comando (COMMAND_ERROR_CODES do contrato).
const (
	CodeUnsupported       = "unsupported"
	CodeInvalidPayload    = "invalid_payload"
	CodeExpired           = "expired"
	CodeTimeout           = "timeout"
	CodeDeviceNotFound    = "device_not_found"
	CodeTargetNotAllowed  = "target_not_allowed"
	CodeBusNotFound       = "bus_not_found"
	CodeBusPauseRequired  = "bus_pause_required"
	CodePortUnavailable   = "port_unavailable"
	CodeConnectionFailed  = "connection_failed"
	CodeReadTimeout       = "read_timeout"
	CodeModbusException   = "modbus_exception"
	CodeDecodeError       = "decode_error"
	CodeConfigFetchFailed = "config_fetch_failed"
	CodeConfigInvalid     = "config_invalid"
	CodePolicyDenied      = "policy_denied"
	CodeInternalError     = "internal_error"
)

// rejectedCodes são recusas antes de executar (status rejected); os outros códigos
// são falhas na execução (status error).
var rejectedCodes = map[string]bool{
	CodeUnsupported: true, CodeInvalidPayload: true, CodeDeviceNotFound: true, CodeTargetNotAllowed: true,
	CodeBusNotFound: true, CodeBusPauseRequired: true, CodePolicyDenied: true,
}

// maxMessage é o limite do texto de erro no contrato (ShortTextSchema).
const maxMessage = 2000

// defaultWorkers é quantos comandos rodam ao mesmo tempo (docs/rascunhos/gateway-software.md §3.4).
const defaultWorkers = 4

// seenTTL é quanto um id fica na deduplicação: validade máxima de um comando (24 h) e folga.
const seenTTL = 25 * time.Hour

// Error é a falha tipada de um handler (vira error.code no resultado).
type Error struct {
	Code    string
	Message string
	// ModbusException é o código da exceção Modbus (só com CodeModbusException).
	ModbusException int
	Details         map[string]any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Fail cria uma falha tipada.
func Fail(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// Handler executa um comando já validado no envelope. Devolve o objeto result do
// sucesso (serializado em JSON) ou um erro; erro que não é *Error vira internal_error.
// O contexto acaba no prazo de execução do tipo (ou na parada do agente).
type Handler func(ctx context.Context, c contracts.Command) (any, error)

type handlerSpec struct {
	fn      Handler
	timeout time.Duration
}

// Options configura o executor.
type Options struct {
	// Now é o relógio corrigido pela diferença para o server_time (padrão time.Now):
	// finished_at dos resultados.
	Now func() time.Time
	// OnResult é chamado (fora de trava) quando um resultado novo fica pronto.
	OnResult func()
	// Log recebe a auditoria dos comandos (id, tipo, status, duração). nil = slog.Default().
	Log *slog.Logger
	// Workers limita os comandos em execução ao mesmo tempo (padrão 4).
	Workers int
}

// Confirmed é um resultado que a nuvem confirmou (sync 200 depois do envio).
type Confirmed struct {
	ID   string
	Type string
}

// Executor guarda o histórico (deduplicação), os comandos em execução e os
// resultados ainda não confirmados.
type Executor struct {
	opts     Options
	handlers map[string]handlerSpec
	sem      chan struct{}
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup

	mu       sync.Mutex
	seen     map[string]time.Time
	pending  map[string]pendingResult
	order    []string
	lastSent []string
}

type pendingResult struct {
	typ  string
	body json.RawMessage
}

// New cria o executor (sem handlers: todo tipo é unsupported até Register).
func New(o Options) *Executor {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	if o.Workers <= 0 {
		o.Workers = defaultWorkers
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Executor{
		opts: o, handlers: map[string]handlerSpec{}, sem: make(chan struct{}, o.Workers), ctx: ctx, cancel: cancel,
		seen: map[string]time.Time{}, pending: map[string]pendingResult{},
	}
}

// Register associa um tipo a um handler com o prazo de execução
// (COMMAND_EXEC_TIMEOUT_S do contrato). Chame antes do primeiro Handle.
func (x *Executor) Register(typ string, timeout time.Duration, h Handler) {
	x.handlers[typ] = handlerSpec{fn: h, timeout: timeout}
}

// Close cancela os comandos em execução e espera terminarem (parada do agente). Os
// resultados que ficarem prontos depois disso não são enviados.
func (x *Executor) Close() {
	x.cancel()
	x.wg.Wait()
}

var (
	typeNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$`)
	uuidRe     = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)
)

// Handle processa os comandos de uma resposta do /sync. now é o relógio já
// corrigido pelo server_time (comparado com expires_at). Não bloqueia: os comandos
// válidos rodam em goroutines próprias.
func (x *Executor) Handle(cmds []contracts.Command, now time.Time) {
	x.mu.Lock()
	defer x.mu.Unlock()
	for id, at := range x.seen {
		if now.Sub(at) > seenTTL {
			delete(x.seen, id)
		}
	}
	for _, c := range cmds {
		if !uuidRe.MatchString(c.ID) || len(c.Type) > 64 || !typeNameRe.MatchString(c.Type) {
			// Sem id ou tipo válidos não há resultado possível no contrato: a nuvem já
			// recusa esses comandos antes de enviar. Só registra.
			x.opts.Log.Warn("comando fora do envelope do contrato ignorado", "id", truncate(c.ID, 64), "tipo", truncate(c.Type, 64))
			continue
		}
		if _, dup := x.seen[c.ID]; dup {
			continue // repetido: não executa de novo (o resultado continua pendente até confirmar)
		}
		x.seen[c.ID] = now
		if exp, err := contracts.ParseTime(c.ExpiresAt); err == nil && !now.Before(exp) {
			x.finishLocked(c, now, 0, nil, Fail(CodeExpired, "O comando chegou depois de expires_at."))
			continue
		} else if err != nil {
			x.finishLocked(c, now, 0, nil, Fail(CodeInvalidPayload, "expires_at inválido: use ISO 8601 em UTC."))
			continue
		}
		if !isObject(c.Payload) {
			x.finishLocked(c, now, 0, nil, Fail(CodeInvalidPayload, "payload deve ser um objeto JSON."))
			continue
		}
		spec, ok := x.handlers[c.Type]
		if !ok {
			x.finishLocked(c, now, 0, nil, Fail(CodeUnsupported, "Comando %s não implementado nesta versão do agente.", c.Type))
			continue
		}
		x.wg.Add(1)
		go x.run(c, spec)
	}
}

// run executa um comando no prazo do tipo, esperando a vaga de um worker (a espera
// conta no prazo).
func (x *Executor) run(c contracts.Command, spec handlerSpec) {
	defer x.wg.Done()
	start := time.Now()
	ctx, cancel := context.WithTimeout(x.ctx, spec.timeout)
	defer cancel()
	var (
		res any
		err error
	)
	select {
	case x.sem <- struct{}{}:
		res, err = safeCall(ctx, spec.fn, c)
		<-x.sem
	case <-ctx.Done():
		err = ctx.Err()
	}
	if x.ctx.Err() != nil {
		return // agente parando: o comando volta da nuvem depois do reinício
	}
	if err != nil && ctx.Err() != nil && !isTyped(err) {
		err = Fail(CodeTimeout, "O comando passou do prazo de execução (%s).", spec.timeout)
	}
	x.mu.Lock()
	x.finishLocked(c, x.opts.Now(), time.Since(start), res, err)
	x.mu.Unlock()
	if x.opts.OnResult != nil {
		x.opts.OnResult()
	}
}

// safeCall protege o agente de um pânico no handler (vira internal_error).
func safeCall(ctx context.Context, fn Handler, c contracts.Command) (res any, err error) {
	defer func() {
		if r := recover(); r != nil {
			res, err = nil, Fail(CodeInternalError, "Erro interno do agente: %v", r)
		}
	}()
	return fn(ctx, c)
}

func isTyped(err error) bool {
	var e *Error
	return errors.As(err, &e)
}

// resultBody é o resultado do contrato (CommandSuccessSchema ou CommandFailureSchema).
type resultBody struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	FinishedAt string     `json:"finished_at,omitempty"`
	DurationMS *int64     `json:"duration_ms,omitempty"`
	Result     any        `json:"result,omitempty"`
	Error      *errorBody `json:"error,omitempty"`
}

type errorBody struct {
	Code            string         `json:"code"`
	Message         string         `json:"message"`
	ModbusException int            `json:"modbus_exception,omitempty"`
	Details         map[string]any `json:"details,omitempty"`
}

// finishLocked monta e guarda o resultado (com x.mu) e registra a auditoria.
func (x *Executor) finishLocked(c contracts.Command, at time.Time, took time.Duration, res any, err error) {
	body := resultBody{ID: c.ID, Type: c.Type, FinishedAt: contracts.FormatTime(at)}
	if took > 0 {
		ms := took.Milliseconds()
		body.DurationMS = &ms
	}
	if err == nil {
		body.Status, body.Result = StatusOK, res
		if res == nil {
			body.Result = struct{}{}
		}
	} else {
		var e *Error
		if !errors.As(err, &e) {
			e = Fail(CodeInternalError, "%s", err.Error())
		}
		body.Status = StatusError
		switch {
		case e.Code == CodeExpired:
			body.Status = StatusExpired
		case rejectedCodes[e.Code]:
			body.Status = StatusRejected
		}
		body.Error = &errorBody{Code: e.Code, Message: truncate(e.Message, maxMessage), ModbusException: e.ModbusException, Details: e.Details}
	}
	b, merr := json.Marshal(body)
	if merr != nil {
		// Resultado que não vira JSON (ex.: NaN): falha interna, nunca um /sync quebrado.
		body.Status, body.Result = StatusError, nil
		body.Error = &errorBody{Code: CodeInternalError, Message: truncate("resultado inválido: "+merr.Error(), maxMessage)}
		b, _ = json.Marshal(body)
	}
	x.storeLocked(c.ID, c.Type, b)
	attrs := []any{"id", c.ID, "tipo", c.Type, "status", body.Status, "duracao_ms", took.Milliseconds()}
	if body.Error != nil {
		attrs = append(attrs, "codigo", body.Error.Code, "mensagem", body.Error.Message)
	}
	x.opts.Log.Info("comando da nuvem", attrs...)
}

func (x *Executor) storeLocked(id, typ string, body json.RawMessage) {
	if _, ok := x.pending[id]; !ok {
		x.order = append(x.order, id)
	}
	x.pending[id] = pendingResult{typ: typ, body: body}
}

// Restore recoloca um resultado já executado antes de um reinício (ex.: o do
// agent.restart que reiniciou o agente): o id fica deduplicado e o resultado volta a
// ser enviado até a nuvem confirmar. finishedAt é o do resultado original.
func (x *Executor) Restore(id, typ string, result any, finishedAt time.Time) {
	b, err := json.Marshal(resultBody{ID: id, Type: typ, Status: StatusOK, FinishedAt: contracts.FormatTime(finishedAt), Result: result})
	if err != nil {
		return
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	x.seen[id] = x.opts.Now()
	x.storeLocked(id, typ, b)
}

// Results devolve os resultados a enviar no próximo /sync (até max).
func (x *Executor) Results(max int) []json.RawMessage {
	x.mu.Lock()
	defer x.mu.Unlock()
	x.lastSent = x.lastSent[:0]
	var out []json.RawMessage
	for _, id := range x.order {
		if r, ok := x.pending[id]; ok && len(out) < max {
			out = append(out, r.body)
			x.lastSent = append(x.lastSent, id)
		}
	}
	return out
}

// Confirm remove os resultados enviados no último /sync que teve resposta 200 e
// devolve quais foram (o agente reage a alguns, ex.: agent.restart).
func (x *Executor) Confirm() []Confirmed {
	x.mu.Lock()
	defer x.mu.Unlock()
	var done []Confirmed
	for _, id := range x.lastSent {
		if r, ok := x.pending[id]; ok {
			done = append(done, Confirmed{ID: id, Type: r.typ})
			delete(x.pending, id)
		}
	}
	kept := x.order[:0]
	for _, id := range x.order {
		if _, ok := x.pending[id]; ok {
			kept = append(kept, id)
		}
	}
	x.order, x.lastSent = kept, x.lastSent[:0]
	return done
}

func isObject(raw json.RawMessage) bool {
	t := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(t, "{") {
		return false
	}
	var m map[string]json.RawMessage
	return json.Unmarshal(raw, &m) == nil
}

// truncate corta s em até n bytes sem partir um caractere UTF-8.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
