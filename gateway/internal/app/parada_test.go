package app

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
)

// clpMudo é um CLP Modbus TCP que aceita a conexão e lê as requisições sem nunca
// responder: a leitura em curso só termina pelo prazo (a grid-x não olha o contexto).
// reqs recebe um aviso a cada conexão, quando chega a primeira requisição.
func clpMudo(t *testing.T) (string, <-chan struct{}) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	reqs := make(chan struct{}, 16)
	var (
		mu    sync.Mutex
		conns []net.Conn
		wg    sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
			wg.Add(1)
			go func() {
				defer wg.Done()
				buf := make([]byte, 256)
				for first := true; ; first = false {
					if _, err := c.Read(buf); err != nil {
						return
					}
					if first {
						select {
						case reqs <- struct{}{}:
						default:
						}
					}
				}
			}()
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		mu.Lock()
		for _, c := range conns {
			_ = c.Close()
		}
		mu.Unlock()
		wg.Wait()
	})
	return ln.Addr().String(), reqs
}

// pararComLeituraEmCurso roda a coleta com um CLP mudo (timeout_ms 1000), espera a
// primeira requisição sair e chama parar (troca de config ou SIGTERM) com a leitura em
// curso: o poller só volta quando ela expira. Devolve os batimentos com a parada dos
// leitores já marcada, o canal com o resultado de collectWith e quando parar foi chamado.
func pararComLeituraEmCurso(t *testing.T, a *agent, parar func(cfg *config.GatewayConfig)) (beatsView, <-chan error, time.Time) {
	t.Helper()
	addr, reqs := clpMudo(t)
	cfg, err := config.ParseRemote([]byte(strings.Replace(string(oeeConfig(addr, 1)), `"timeout_ms":200`, `"timeout_ms":1000`, 1)))
	if err != nil {
		t.Fatal(err)
	}
	a.local, a.opts.TickEvery = config.DefaultLocal(), 5*time.Millisecond
	a.reconfigure = make(chan *config.GatewayConfig, 1)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done := make(chan error, 1)
	go func() { done <- a.collectWith(ctx, cfg) }()
	select {
	case <-reqs:
	case <-time.After(5 * time.Second):
		t.Fatal("a leitura não começou")
	}
	stoppedAt := time.Now()
	if parar == nil {
		cancel()
	} else {
		parar(cfg)
	}
	b := waitBeats(t, a, func(b beatsView) bool { return b.stopping })
	if !b.running || len(b.pollers) != 1 {
		t.Fatalf("a parada dos leitores devia estar em curso, com o poller registrado: %+v", b)
	}
	if want := b.pollers[0].StopBound() + a.tickStaleAfter(); b.stopLimit != want || want != 6*time.Second {
		t.Fatalf("limite da parada %v, quer o StopBound do poller mais o limite do motor (%v)", b.stopLimit, want)
	}
	return b, done, stoppedAt
}

// emParada confere que a parada dos leitores seguia em curso: a verificação feita antes
// dela viu a parada, e não o tick da gravação final.
func emParada(t *testing.T, a *agent) {
	t.Helper()
	if !beatsOf(a).stopping {
		t.Fatal("a parada dos leitores terminou antes da verificação: o cenário não a exercitou (CLP respondeu?)")
	}
}

// attrMap lê os atributos (chave, valor) de uma falha do watchdog.
func attrMap(attrs []any) map[string]any {
	m := map[string]any{}
	for i := 0; i+1 < len(attrs); i += 2 {
		if k, ok := attrs[i].(string); ok {
			m[k] = attrs[i+1]
		}
	}
	return m
}

// Troca de config com a leitura em curso: o poller só volta quando ela expira (até o
// StopBound dele; num conversor RTU sobre TCP, até 60 s no máximo do contrato). Nesse
// meio a rotina de coleta espera, sem tick do motor: isso não é coleta travada. Antes,
// o watchdog acusava "motor sem tick" depois de 5 s e deixava de ser alimentado, e
// uma recarga longa fazia o systemd matar um agente saudável.
func TestWatchdogFedWhilePollersStopOnReconfigure(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	b, done, _ := pararComLeituraEmCurso(t, a, func(cfg *config.GatewayConfig) { a.reconfigure <- cfg })
	stale := b.tick + a.tickStaleAfter() + 500*time.Millisecond // além do limite do motor, dentro do da parada
	clk.set(stale)
	if f := a.healthCheck(time.Now(), stale); f != nil {
		t.Fatalf("parada dos leitores em curso, dentro do limite, não é motor travado: %+v\n%s", f, logs.String())
	}
	emParada(t, a)

	// Com os leitores de volta, o motor volta a ser conferido, contado do fim da parada,
	// já durante o último tick (a gravação final; aqui, preso em a.mu depois de gravar).
	a.mu.Lock()
	locked := true
	defer func() {
		if locked {
			a.mu.Unlock()
		}
	}()
	end := waitBeats(t, a, func(b beatsView) bool { return !b.stopping && !b.flushing && b.flushAt >= stale })
	if !end.running || len(end.pollers) != 0 || end.tick < stale {
		t.Fatalf("fim da parada: %+v", end)
	}
	if f := checkAt(a, stale); f != nil {
		t.Fatalf("logo depois da parada: %+v\n%s", f, logs.String())
	}
	if f := checkAt(a, stale+a.tickStaleAfter()+time.Second); f == nil || f.check != "motor" {
		t.Fatalf("último tick preso além do limite do motor, depois da parada: %+v", f)
	}
	a.mu.Unlock()
	locked = false

	if err := <-done; err != nil {
		t.Fatalf("collectWith: %v", err)
	}
	if b := beatsOf(a); b.running || b.stopping || len(b.pollers) != 0 {
		t.Fatalf("depois da troca: %+v", b)
	}
}

// Parada dos leitores que passa do limite (o maior StopBound mais o limite do motor):
// um leitor travou ao parar. O watchdog deixa de ser alimentado, com a verificação
// leitor, para o systemd reiniciar o agente.
func TestWatchdogFailsWhenPollerStopExceedsLimit(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	b, done, _ := pararComLeituraEmCurso(t, a, func(cfg *config.GatewayConfig) { a.reconfigure <- cfg })
	at := b.stopAt + b.stopLimit
	clk.set(at)
	if f := a.healthCheck(time.Now(), at); f != nil {
		t.Fatalf("parada no limite: %+v", f)
	}
	at += time.Second
	clk.set(at)
	f := a.healthCheck(time.Now(), at)
	emParada(t, a)
	if f == nil || f.check != "leitor" || !strings.Contains(f.msg, "parada dos leitores além do limite") {
		t.Fatalf("parada além do limite: %+v\n%s", f, logs.String())
	}
	if m := attrMap(f.attrs); m["parada_ha_ms"] != (b.stopLimit+time.Second).Milliseconds() ||
		m["limite_ms"] != b.stopLimit.Milliseconds() || m["leitores"] != 1 {
		t.Fatalf("atributos da falha: %v", f.attrs)
	}
	if err := <-done; err != nil {
		t.Fatalf("collectWith: %v", err)
	}
}

// SIGTERM com a leitura em curso: a parada é a mesma da troca de config (os leitores
// voltam antes da gravação final), e a coleta volta dentro do StopBound do poller, que
// o TimeoutStopSec da unit cobre (TestTimeoutStopSecCobreAParadaDosPollers, em
// internal/poller). Nada na parada do app soma espera além dele.
func TestShutdownStopsPollersWithinStopBound(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	b, done, sigterm := pararComLeituraEmCurso(t, a, nil)
	stale := b.tick + a.tickStaleAfter() + 500*time.Millisecond
	clk.set(stale)
	if f := a.healthCheck(time.Now(), stale); f != nil {
		t.Fatalf("parada dos leitores no SIGTERM, dentro do limite: %+v\n%s", f, logs.String())
	}
	emParada(t, a)
	var err error
	select {
	case err = <-done:
	case <-time.After(10 * b.stopLimit):
		t.Fatal("a coleta não voltou depois do SIGTERM")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("collectWith: %v", err)
	}
	// A leitura em curso (até 1 s) e a gravação final, com folga para o agendamento.
	if el, bound := time.Since(sigterm), b.pollers[0].StopBound(); el > bound+bound/2 {
		t.Fatalf("parada levou %v, além do StopBound %v do poller", el, bound)
	}
}

// Config com um dispositivo Modbus TCP (timeout_ms 1000) e um conversor RTU sobre TCP
// (timeout_ms 10000, o máximo do contrato). Os pollers não rodam: só os limites contam.
const stopBoundConfigJSON = `{"config_version":1,"serial_buses":[],
	"devices":[
	 {"id":"` + devID + `","protocol":"modbus-tcp","params":{"host":"10.0.0.1","port":502,"unit_id":1,"timeout_ms":1000},
	  "blocks":[{"area":"holding_register","start":0,"count":1,"poll_ms":1000}],
	  "tags":[{"id":"` + tHB + `","address":{"area":"holding_register","offset":0},"type":"uint16","role":"custom"}]},
	 {"id":"01a159a8-b2f0-7a10-8c3e-5f1d2e3a4b5c","protocol":"modbus-rtu-over-tcp","params":{"host":"10.0.0.2","port":4001,"unit_id":1,"timeout_ms":10000},
	  "blocks":[{"area":"holding_register","start":0,"count":1,"poll_ms":1000}],
	  "tags":[{"id":"` + tState + `","address":{"area":"holding_register","offset":0},"type":"uint16","role":"custom"}]}],
	"machines":[],"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`

// O limite da parada vem do maior StopBound dos leitores (6 × 10 s no conversor RTU
// sobre TCP), não de um valor fixo. Uma parada de 40 s, dentro dele, não para o
// watchdog, mesmo além do limite do motor e do caminho de gravação parado. Quando ela
// termina, o motor e a gravação voltam a ser conferidos a partir do fim dela: a
// gravação final vem logo em seguida, e uma parada longa não acusa nem motor travado
// nem gravação parada antes dela.
func TestWatchdogStopLimitFromPollersAndChecksResumeAfterStop(t *testing.T) {
	a, clk, logs, _ := watchdogAgent(t)
	cfg, err := config.ParseRemote([]byte(stopBoundConfigJSON))
	if err != nil {
		t.Fatal(err)
	}
	ps, err := poller.Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	var bound time.Duration
	for _, p := range ps {
		bound = max(bound, p.StopBound())
	}
	if len(ps) != 2 || bound != 60*time.Second {
		t.Fatalf("cenário: %d pollers, maior StopBound %v (quer 2 e 60 s)", len(ps), bound)
	}
	a.beatStart()
	a.beatPollers(ps)
	a.beatStopBegin(ps)
	if b := beatsOf(a); b.stopLimit != bound+a.tickStaleAfter() {
		t.Fatalf("limite da parada %v, quer o maior StopBound (%v) mais o limite do motor (%v)", b.stopLimit, bound, a.tickStaleAfter())
	}

	long := 40 * time.Second // além de tickStaleAfter e de flushStuckAfter
	if f := checkAt(a, long); f != nil {
		t.Fatalf("parada de %v, dentro do limite: %+v", long, f)
	}
	if f := checkAt(a, bound+a.tickStaleAfter()+time.Second); f == nil || f.check != "leitor" {
		t.Fatalf("parada além do limite: %+v", f)
	}

	clk.set(long)
	a.beatStopEnd()
	if b := beatsOf(a); b.stopping || len(b.pollers) != 0 || !b.running {
		t.Fatalf("fim da parada: %+v", b)
	}
	if f := checkAt(a, long); f != nil {
		t.Fatalf("logo depois de uma parada de %v, antes da gravação final: %+v\n%s", long, f, logs.String())
	}
	if f := checkAt(a, long+a.tickStaleAfter()+time.Second); f == nil || f.check != "motor" {
		t.Fatalf("sem tick depois da parada, além do limite do motor: %+v", f)
	}
}
