package commands

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// Operação remota mínima (D29, junto do OTA mínimo): log.level e logs.upload.
//
// ATENÇÃO: os dois tipos ainda NÃO estão no contrato v1 (packages/contracts). A
// nuvem recusa comando fora do v1 antes de enviar, então estes handlers só rodam
// depois de o contrato ganhar os tipos (proposta no docs/04 §Tipos de comando, linha
// M4b). Os formatos abaixo são a proposta para o contrato.

// Tipos da operação remota mínima (fora do contrato v1).
const (
	TypeLogLevel   = "log.level"
	TypeLogsUpload = "logs.upload"
)

// Prazos de execução propostos.
const (
	LogLevelTimeout   = 10 * time.Second
	LogsUploadTimeout = 30 * time.Second
)

// Limites propostos.
const (
	// LogLevelMax é o prazo máximo de um nível temporário (docs/rascunhos/gateway-software.md §6.1).
	LogLevelMax = time.Hour
	// LogLevelDefault é o prazo quando o comando não informa duration_s.
	LogLevelDefault = 15 * time.Minute
	// logsDefaultLines e logsMaxLines limitam as linhas devolvidas.
	logsDefaultLines = 500
	logsMaxLines     = 2000
	// logsMaxBytes limita o texto devolvido (o resultado vai no /sync, de até 1 MiB).
	logsMaxBytes = 256 << 10
	// logsMaxSince é o período máximo pedido (s).
	logsMaxSince = 7 * 24 * 3600
)

// LogLevelPayload é o payload proposto de log.level.
type LogLevelPayload struct {
	Level     string `json:"level"`                // debug | info | warn | error
	DurationS *int   `json:"duration_s,omitempty"` // 60–3600 (padrão 900)
}

// LogLevelResult é o resultado proposto de log.level.
type LogLevelResult struct {
	Level    string `json:"level"`
	Previous string `json:"previous"`
	Until    string `json:"until"` // depois disso volta ao nível do gateway.yaml
}

// LogsUploadPayload é o payload proposto de logs.upload.
type LogsUploadPayload struct {
	Lines  *int `json:"lines,omitempty"`   // 1–2000 (padrão 500): as últimas linhas
	SinceS *int `json:"since_s,omitempty"` // só as linhas dos últimos N segundos (até 7 dias)
}

// LogsUploadResult é o resultado proposto de logs.upload: as linhas, com tokens
// redigidos, das mais antigas para as mais novas.
type LogsUploadResult struct {
	Source    string   `json:"source"` // journald
	Lines     []string `json:"lines"`
	Truncated bool     `json:"truncated"`
}

// LevelControl troca o nível do log do agente por um prazo e volta sozinho ao
// nível base (o do gateway.yaml).
type LevelControl struct {
	Var  *slog.LevelVar
	Base slog.Level

	mu    sync.Mutex
	timer *time.Timer
}

// Set muda o nível por d (no máximo LogLevelMax) e devolve o anterior.
func (l *LevelControl) Set(level slog.Level, d time.Duration) slog.Level {
	l.mu.Lock()
	defer l.mu.Unlock()
	prev := l.Var.Level()
	l.Var.Set(level)
	if l.timer != nil {
		l.timer.Stop()
	}
	l.timer = time.AfterFunc(min(d, LogLevelMax), func() { l.Var.Set(l.Base) })
	return prev
}

// Stop cancela a volta agendada (parada do agente).
func (l *LevelControl) Stop() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.timer != nil {
		l.timer.Stop()
	}
}

// ParseLevel lê um nível de log (debug, info, warn, error).
func ParseLevel(s string) (slog.Level, bool) {
	switch s {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	}
	return 0, false
}

func levelName(l slog.Level) string {
	switch {
	case l <= slog.LevelDebug:
		return "debug"
	case l <= slog.LevelInfo:
		return "info"
	case l <= slog.LevelWarn:
		return "warn"
	}
	return "error"
}

// OpsDeps é o que os handlers da operação remota usam do agente.
type OpsDeps struct {
	// Level controla o nível do log (nil: log.level fica unsupported).
	Level *LevelControl
	// ReadLogs lê as últimas n linhas do log do agente (since > 0: só desse período).
	// nil: JournalLines.
	ReadLogs func(ctx context.Context, n int, since time.Duration) ([]string, error)
	// Now é o relógio corrigido pelo server_time (padrão time.Now).
	Now func() time.Time
}

// RegisterOps registra log.level e logs.upload.
func RegisterOps(x *Executor, d OpsDeps) {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.ReadLogs == nil {
		d.ReadLogs = JournalLines
	}
	if d.Level != nil {
		x.Register(TypeLogLevel, LogLevelTimeout, func(_ context.Context, c contracts.Command) (any, error) {
			var p LogLevelPayload
			if err := decode(c.Payload, &p); err != nil {
				return nil, err
			}
			var is issues
			level, ok := ParseLevel(p.Level)
			if !ok {
				is.add("level", "", "level deve ser debug, info, warn ou error")
			}
			dur := LogLevelDefault
			if p.DurationS != nil {
				if *p.DurationS < 60 || *p.DurationS > int(LogLevelMax/time.Second) {
					is.add("duration_s", "", "duration_s fora da faixa 60–3600")
				}
				dur = time.Duration(*p.DurationS) * time.Second
			}
			if err := is.err(); err != nil {
				return nil, err
			}
			prev := d.Level.Set(level, dur)
			return LogLevelResult{Level: p.Level, Previous: levelName(prev), Until: contracts.FormatTime(d.Now().Add(dur))}, nil
		})
	}
	x.Register(TypeLogsUpload, LogsUploadTimeout, func(ctx context.Context, c contracts.Command) (any, error) {
		var p LogsUploadPayload
		if err := decode(c.Payload, &p); err != nil {
			return nil, err
		}
		var is issues
		n := logsDefaultLines
		if p.Lines != nil {
			if *p.Lines < 1 || *p.Lines > logsMaxLines {
				is.add("lines", "", fmt.Sprintf("lines fora da faixa 1–%d", logsMaxLines))
			}
			n = *p.Lines
		}
		var since time.Duration
		if p.SinceS != nil {
			if *p.SinceS < 1 || *p.SinceS > logsMaxSince {
				is.add("since_s", "", fmt.Sprintf("since_s fora da faixa 1–%d", logsMaxSince))
			}
			since = time.Duration(*p.SinceS) * time.Second
		}
		if err := is.err(); err != nil {
			return nil, err
		}
		lines, err := d.ReadLogs(ctx, n, since)
		if err != nil {
			return nil, Fail(CodeInternalError, "Falha ao ler o log: %v", err)
		}
		return limitLines(lines, n), nil
	})
}

// limitLines redige segredos e corta pelas últimas n linhas e por logsMaxBytes,
// mantendo as mais novas.
func limitLines(lines []string, n int) LogsUploadResult {
	res := LogsUploadResult{Source: "journald", Lines: []string{}}
	if len(lines) > n {
		lines, res.Truncated = lines[len(lines)-n:], true
	}
	total := 0
	start := len(lines)
	for start > 0 {
		l := truncate(redact(lines[start-1]), maxMessage)
		if total+len(l)+1 > logsMaxBytes {
			res.Truncated = true
			break
		}
		total += len(l) + 1
		lines[start-1] = l
		start--
	}
	res.Lines = append(res.Lines, lines[start:]...)
	return res
}

var (
	bearerRe = regexp.MustCompile(`(?i)(bearer\s+)[^\s"']+`)
	tokenRe  = regexp.MustCompile(`\bgw_[A-Za-z0-9_\-]{8,}`)
	secretRe = regexp.MustCompile(`(?i)("?\b(?:token|auth_key|password|senha|code)"?\s*[:=]\s*"?)[^\s",}]+`)
)

// redact remove do texto o que parece credencial (o agente já não registra
// segredos; isto é a segunda barreira antes de o log sair do gateway).
func redact(s string) string {
	s = bearerRe.ReplaceAllString(s, "${1}[removido]")
	s = tokenRe.ReplaceAllString(s, "gw_[removido]")
	return secretRe.ReplaceAllString(s, "${1}[removido]")
}

// JournalLines lê as últimas n linhas do journal do serviço do agente (o usuário
// oee é do grupo systemd-journal; ler o journal pela biblioteca exigiria cgo).
func JournalLines(ctx context.Context, n int, since time.Duration) ([]string, error) {
	args := []string{"-u", "oee-gateway.service", "-o", "short-iso-precise", "--no-pager", "-q", "-n", strconv.Itoa(n)}
	if since > 0 {
		args = append(args, "--since", "-"+strconv.Itoa(int(since/time.Second))+"s")
	}
	var out, errb bytes.Buffer
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("journalctl: %v: %s", err, truncate(strings.TrimSpace(errb.String()), 500))
	}
	text := strings.TrimRight(out.String(), "\n")
	if text == "" {
		return nil, nil
	}
	return strings.Split(text, "\n"), nil
}
