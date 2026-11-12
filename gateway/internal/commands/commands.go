// Package commands recebe os comandos que chegam na resposta do /sync, deduplica
// por id, descarta os vencidos e devolve os resultados no /sync seguinte.
//
// Neste esqueleto nenhum tipo é executado ainda: todo comando válido e no prazo é
// respondido com rejected/unsupported (a nuvem não fica esperando para sempre).
// Os handlers de tag.read, device.test, config.reload e agent.restart entram aqui.
package commands

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// Result é o corpo de um resultado de falha (CommandFailureSchema do contrato).
type Result struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"`
	Status     string    `json:"status"` // error | expired | rejected
	FinishedAt string    `json:"finished_at,omitempty"`
	Error      ErrorBody `json:"error"`
}

// ErrorBody é o erro do resultado.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Executor guarda o histórico (deduplicação) e os resultados ainda não confirmados.
type Executor struct {
	mu       sync.Mutex
	seen     map[string]time.Time
	pending  map[string]json.RawMessage
	order    []string
	lastSent []string
}

// New cria o executor.
func New() *Executor {
	return &Executor{seen: map[string]time.Time{}, pending: map[string]json.RawMessage{}}
}

// Handle processa os comandos de uma resposta do /sync.
func (x *Executor) Handle(cmds []contracts.Command, now time.Time) {
	x.mu.Lock()
	defer x.mu.Unlock()
	for id, at := range x.seen { // validade máxima de um comando: 24 h
		if now.Sub(at) > 25*time.Hour {
			delete(x.seen, id)
		}
	}
	for _, c := range cmds {
		if c.ID == "" {
			continue
		}
		if _, dup := x.seen[c.ID]; dup {
			continue // repetido: não executa de novo (o resultado continua pendente até confirmar)
		}
		x.seen[c.ID] = now
		res := Result{ID: c.ID, Type: c.Type, FinishedAt: contracts.FormatTime(now)}
		if exp, err := contracts.ParseTime(c.ExpiresAt); err == nil && !now.Before(exp) {
			res.Status, res.Error = "expired", ErrorBody{Code: "expired", Message: "O comando chegou depois de expires_at."}
		} else {
			res.Status, res.Error = "rejected", ErrorBody{Code: "unsupported", Message: "Comando ainda não implementado nesta versão do agente."}
		}
		b, _ := json.Marshal(res)
		x.pending[c.ID] = b
		x.order = append(x.order, c.ID)
	}
}

// Results devolve os resultados a enviar no próximo /sync (até max).
func (x *Executor) Results(max int) []json.RawMessage {
	x.mu.Lock()
	defer x.mu.Unlock()
	x.lastSent = x.lastSent[:0]
	var out []json.RawMessage
	for _, id := range x.order {
		if r, ok := x.pending[id]; ok && len(out) < max {
			out = append(out, r)
			x.lastSent = append(x.lastSent, id)
		}
	}
	return out
}

// Confirm remove os resultados enviados no último /sync que teve resposta 200.
func (x *Executor) Confirm() {
	x.mu.Lock()
	defer x.mu.Unlock()
	for _, id := range x.lastSent {
		delete(x.pending, id)
	}
	kept := x.order[:0]
	for _, id := range x.order {
		if _, ok := x.pending[id]; ok {
			kept = append(kept, id)
		}
	}
	x.order, x.lastSent = kept, x.lastSent[:0]
}
