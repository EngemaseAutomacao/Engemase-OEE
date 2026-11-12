package poller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// fakeReader é um transporte falso: cada ReadBlock chama read.
type fakeReader struct {
	read func(ctx context.Context, s modbus.Span) (modbus.Raw, error)
}

func (f *fakeReader) ReadBlock(ctx context.Context, _ uint8, s modbus.Span) (modbus.Raw, error) {
	return f.read(ctx, s)
}
func (f *fakeReader) Close() error { return nil }
func (f *fakeReader) Info() string { return "falso" }

func okRaw(s modbus.Span) modbus.Raw { return modbus.Raw{Span: s, Regs: make([]uint16, s.Count)} }

// singleConfig é um dispositivo TCP com um bloco só (uma leitura por volta do laço).
func singleConfig(t *testing.T, timeoutMS, pollMS int) *config.GatewayConfig {
	t.Helper()
	body := fmt.Sprintf(`{"config_version":1,"serial_buses":[],
	"devices":[{"id":"%s","name":"Prensa 3","protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":1502,"unit_id":1,"timeout_ms":%d},
		"blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":%d}],
		"tags":[{"id":"%s","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"%s"}]}],
	"machines":[{"id":"%s","state_rules":{"mode":"state_code","map":{"1":"RUNNING"},"comm_loss_after_s":60}}],
	"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, devID, timeoutMS, pollMS, tState, mID, mID)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func onePoller(t *testing.T, cfg *config.GatewayConfig) *Poller {
	t.Helper()
	ps, err := Build(cfg, config.DefaultLocal())
	if err != nil || len(ps) != 1 {
		t.Fatalf("pollers: %d (%v)", len(ps), err)
	}
	return ps[0]
}

// runPoller roda o poller até o fim do teste, descartando as leituras.
func runPoller(t *testing.T, p *Poller) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan Reading, 1024)
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()
	go func() {
		for {
			select {
			case <-out:
			case <-ctx.Done():
				return
			}
		}
	}()
	t.Cleanup(func() {
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Errorf("Run: %v", err)
		}
	})
}

// waitLiveness espera o batimento satisfazer cond.
func waitLiveness(t *testing.T, p *Poller, cond func(Liveness) bool) Liveness {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if l := p.Liveness(); cond(l) {
			return l
		}
		if time.Now().After(deadline) {
			t.Fatalf("batimento não chegou ao esperado: %+v", p.Liveness())
		}
	}
}

// O prazo do laço vem do poll e dos timeouts: 3 × (maior poll + pior leitura), no
// mínimo 30 s. Pior leitura = (retries + 1) × (conexão + 4 timeouts + pausa).
func TestLivenessBoundFromPollAndTimeouts(t *testing.T) {
	if b := onePoller(t, tcpConfig(t, "127.0.0.1:1502")).LivenessBound(); b != livenessMin {
		t.Fatalf("poll 100/200 ms, timeout 100 ms: prazo %v, quer o mínimo %v", b, livenessMin)
	}
	// Poll 10 s, timeout 5 s, 1 repetição: 3 × (10 s + 2 × (2 s + 20 s)) = 162 s.
	if b := onePoller(t, singleConfig(t, 5000, 10_000)).LivenessBound(); b != 162*time.Second {
		t.Fatalf("poll 10 s, timeout 5 s: prazo %v, quer 162s", b)
	}
}

// Leituras que falham (CLP sem responder) mantêm o laço vivo: cada volta terminada,
// com sucesso ou falha, renova o batimento.
func TestLivenessAdvancesOnFailedReads(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	var reads atomic.Int64
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(context.Context, modbus.Span) (modbus.Raw, error) {
			reads.Add(1)
			return modbus.Raw{}, fmt.Errorf("%w: sem resposta", modbus.ErrTimeout)
		}}, nil
	}
	runPoller(t, p)
	first := waitLiveness(t, p, func(l Liveness) bool { return reads.Load() >= 1 && !l.Beat.IsZero() })
	l := waitLiveness(t, p, func(l Liveness) bool { return l.Beat.After(first.Beat) })
	if l.Stalled(time.Now()) || l.Deadline.Sub(l.Beat) < p.LivenessBound() {
		t.Fatalf("laço vivo com leituras falhando foi dado como parado: %+v", l)
	}
}

// Leitura presa (transporte que não devolve): o batimento para e, passado o prazo, o
// laço é dado como parado.
func TestLivenessStalledWhenReadHangs(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	hung := make(chan struct{})
	var once sync.Once
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(ctx context.Context, _ modbus.Span) (modbus.Raw, error) {
			once.Do(func() { close(hung) })
			<-ctx.Done() // presa até o fim do teste
			return modbus.Raw{}, ctx.Err()
		}}, nil
	}
	runPoller(t, p)
	<-hung
	l := p.Liveness()
	if l.Beat.IsZero() {
		t.Fatal("a tentativa de abrir o transporte deveria contar como volta")
	}
	// Um grupo só, com prazo já vencido na partida: nenhuma espera planejada estende o prazo.
	bound := p.LivenessBound()
	if l.Deadline.Sub(l.Beat) != bound {
		t.Fatalf("prazo %v depois da última volta, quer %v", l.Deadline.Sub(l.Beat), bound)
	}
	if l.Stalled(l.Beat.Add(bound - time.Millisecond)) {
		t.Fatalf("dentro do prazo (%v) não é parada", bound)
	}
	if !l.Stalled(l.Beat.Add(bound + time.Millisecond)) {
		t.Fatalf("leitura presa além do prazo (%v) deveria ser parada: %+v", bound, l)
	}
}

// Backoff de dispositivo sem resposta (até 30 s + jitter) é espera planejada: o prazo
// se estende até o fim dela, e o laço não é dado como parado no meio da espera.
func TestLivenessExtendedDuringBackoff(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(_ context.Context, s modbus.Span) (modbus.Raw, error) { return okRaw(s), nil }}, nil
	}
	until := time.Now().Add(35 * time.Second) // passo máximo do backoff (30 s) + jitter
	p.mu.Lock()
	d := p.devices[devID]
	d.failures, d.until, d.lastErr = 10, until, "modbus: timeout"
	p.mu.Unlock()
	bound := p.LivenessBound()
	runPoller(t, p)
	l := waitLiveness(t, p, func(l Liveness) bool { return !l.Deadline.Before(until.Add(bound)) })
	// Sem a extensão, Beat + prazo (30 s) venceria antes do fim do backoff (35 s).
	if l.Stalled(l.Beat.Add(bound+time.Second)) || l.Stalled(until.Add(bound-time.Second)) {
		t.Fatalf("laço em backoff dado como parado: %+v (backoff até %v)", l, until)
	}
	if !l.Stalled(until.Add(bound + time.Second)) {
		t.Fatalf("passado o backoff e o prazo, o laço deveria ser dado como parado: %+v", l)
	}
}

// syncBuffer é um io.Writer seguro entre goroutines (o log vem do laço do poller).
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) lines(t *testing.T) []map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, ln := range strings.Split(strings.TrimSpace(s.b.String()), "\n") {
		if ln == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(ln), &m); err != nil {
			t.Fatalf("log: %v (%s)", err, ln)
		}
		out = append(out, m)
	}
	return out
}

// scriptedRun roda o poller com um transporte que devolve os resultados do roteiro
// (nil = leitura boa), um por leitura, e devolve as linhas de log. O relógio do poller
// avança 1 min por consulta: nenhum prazo (ritmo ou backoff) faz o teste esperar.
func scriptedRun(t *testing.T, script []error) []map[string]any {
	t.Helper()
	p := onePoller(t, singleConfig(t, 100, 100))
	logs := &syncBuffer{}
	p.Logger = slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	var clock atomic.Int64
	t0 := time.Date(2026, 11, 12, 8, 0, 0, 0, time.UTC)
	p.now = func() time.Time { return t0.Add(time.Duration(clock.Add(1)) * time.Minute) }
	exhausted := make(chan struct{})
	var i atomic.Int64
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(ctx context.Context, s modbus.Span) (modbus.Raw, error) {
			n := int(i.Load())
			if n == len(script) {
				close(exhausted) // a leitura anterior já foi registrada e logada
				<-ctx.Done()
				return modbus.Raw{}, ctx.Err()
			}
			i.Add(1)
			err := script[n]
			if err != nil {
				return modbus.Raw{}, err
			}
			return okRaw(s), nil
		}}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan Reading, len(script)+1)
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()
	select {
	case <-exhausted:
	case <-time.After(5 * time.Second):
		t.Fatalf("roteiro não terminou: %d de %d leituras", i.Load(), len(script))
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Run: %v", err)
	}
	return logs.lines(t)
}

// transitions resume as linhas de log de mudança de estado: "nível estado<anterior".
func transitions(t *testing.T, lines []map[string]any) []string {
	t.Helper()
	var out []string
	for _, l := range lines {
		if !strings.HasPrefix(l["msg"].(string), "dispositivo ") {
			continue
		}
		if l["dispositivo"] != devID || l["nome"] != "Prensa 3" || l["protocolo"] != config.ProtocolTCP || l["poller"] == "" {
			t.Fatalf("log sem identificar o dispositivo: %v", l)
		}
		errMsg, _ := l["ultimo_erro"].(string)
		if l["estado"] != contracts.DeviceConnected && !strings.Contains(errMsg, "timeout") {
			t.Fatalf("log de %v sem o último erro: %v", l["estado"], l)
		}
		out = append(out, fmt.Sprintf("%s %s<%s", l["level"], l["estado"], l["anterior"]))
	}
	return out
}

// Cada mudança do estado de conexão vai para o log uma vez (conectado em info,
// degradado e desconectado em warn, com o último erro); leituras que não mudam o
// estado não logam nada.
func TestDeviceStateTransitionsLoggedOnce(t *testing.T) {
	to := fmt.Errorf("%w: sem resposta", modbus.ErrTimeout)
	got := transitions(t, scriptedRun(t, []error{nil, nil, to, nil, to, to, to, to, nil, nil}))
	want := []string{
		"INFO connected<",
		"WARN degraded<connected",
		"INFO connected<degraded",
		"WARN degraded<connected",
		"WARN disconnected<degraded",
		"INFO connected<disconnected",
	}
	if strings.Join(got, " | ") != strings.Join(want, " | ") {
		t.Fatalf("transições no log:\n got %v\nwant %v", got, want)
	}
}

// Dispositivo que nunca respondeu: o estado inicial (desconectado) só vai para o log
// quando se confirma (3 falhas seguidas, backoff), uma vez.
func TestNeverConnectedDeviceLoggedOnceWhenConfirmed(t *testing.T) {
	to := fmt.Errorf("%w: sem resposta", modbus.ErrTimeout)
	lines := scriptedRun(t, []error{to, to, to, to, to, nil})
	got := transitions(t, lines)
	want := []string{"WARN disconnected<", "INFO connected<disconnected"}
	if strings.Join(got, " | ") != strings.Join(want, " | ") {
		t.Fatalf("transições no log:\n got %v\nwant %v", got, want)
	}
	for _, l := range lines {
		if l["estado"] == contracts.DeviceDisconnected && l["falhas_seguidas"] != float64(3) {
			t.Fatalf("desconectado deveria ir para o log na 3ª falha: %v", l)
		}
	}
}

// Motor sem consumir as leituras (contrapressão: gravação lenta no agente): o laço
// espera para entregar a leitura, mas não está travado. O prazo fica suspenso nessa
// espera (o consumidor é conferido à parte pelo watchdog do agente) e recomeça na
// entrega: uma leitura presa depois dela volta a ser conferida.
func TestLivenessSuspendedWhileDeliveryBlocks(t *testing.T) {
	p := onePoller(t, singleConfig(t, 100, 100))
	var clock atomic.Int64
	t0 := time.Date(2026, 11, 12, 8, 0, 0, 0, time.UTC)
	p.now = func() time.Time { return t0.Add(time.Duration(clock.Load())) }
	var reads atomic.Int64
	p.open = func(modbus.Target) (modbus.Reader, error) {
		return &fakeReader{read: func(ctx context.Context, s modbus.Span) (modbus.Raw, error) {
			if reads.Add(1) == 1 {
				return okRaw(s), nil
			}
			<-ctx.Done() // a segunda leitura fica presa até o fim do teste
			return modbus.Raw{}, ctx.Err()
		}}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan Reading) // sem folga: nada é consumido até o teste ler
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()
	defer func() {
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Errorf("Run: %v", err)
		}
	}()

	bound := p.LivenessBound()
	l := waitLiveness(t, p, func(l Liveness) bool { return l.Delivering })
	if !l.Beat.Equal(t0) || l.Stalled(t0.Add(bound+time.Hour)) {
		t.Fatalf("esperando o motor consumir, o laço não está travado: %+v", l)
	}
	clock.Store(int64(time.Hour)) // o motor levou 1 h para consumir
	<-out
	l = waitLiveness(t, p, func(l Liveness) bool { return !l.Delivering && reads.Load() >= 2 })
	delivered := t0.Add(time.Hour)
	if l.Stalled(delivered.Add(bound - time.Millisecond)) {
		t.Fatalf("o prazo recomeça na entrega (%v): %+v", delivered, l)
	}
	if !l.Stalled(delivered.Add(bound + time.Millisecond)) {
		t.Fatalf("leitura presa depois da entrega, além do prazo, deveria ser parada: %+v", l)
	}
}
