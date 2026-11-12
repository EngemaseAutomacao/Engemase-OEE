// Comando plc-sim: simulador de CLP Modbus TCP com o bloco OEE padrão Engemase
// (docs/11, seção 3), para desenvolvimento, testes do gateway e demonstrações.
//
// Exemplo:
//
//	plc-sim --machines 3 --base 1000 --port 1502 --cycle 6s --seed 42 --scenario normal
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/plcserver"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/sim"
)

// tickInterval é o intervalo (relógio de parede) entre avanços da simulação.
const tickInterval = 100 * time.Millisecond

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, "plc-sim:", err)
		os.Exit(1)
	}
}

// appConfig é a configuração completa vinda da linha de comando.
type appConfig struct {
	machines    int
	seed        int64
	sim         sim.Config
	server      plcserver.Options
	speed       float64
	statusEvery time.Duration
	duration    time.Duration
	verbose     bool
}

func parseArgs(args []string, stderr io.Writer) (appConfig, error) {
	cfg := appConfig{sim: sim.DefaultConfig()}
	fs := flag.NewFlagSet("plc-sim", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprint(stderr, `plc-sim: simulador de CLP Modbus TCP com o bloco OEE padrão Engemase.

Uso:
  plc-sim [opções]

Exemplos:
  plc-sim --machines 3 --base 1000 --port 1502 --cycle 6s --seed 42 --scenario normal
  plc-sim --mode port --port 1502 --machines 2 --scenario offline
  plc-sim --scenario counter-reset,overflow --speed 10

Opções:
`)
		printFlags(stderr, fs)
	}

	fs.IntVar(&cfg.machines, "machines", 3, "número de máquinas simuladas")
	mode := fs.String("mode", string(plcserver.ModeUnit), "endereçamento: unit (uma porta, um unit id por máquina) ou port (uma porta por máquina)")
	fs.StringVar(&cfg.server.Host, "host", "127.0.0.1", "endereço de escuta (0.0.0.0 para aceitar conexões da rede)")
	fs.IntVar(&cfg.server.Port, "port", 1502, "porta Modbus TCP (no modo port é a da M1; a Mi usa port+i-1)")
	unitStart := fs.Int("unit-start", 1, "unit id da M1 no modo unit (as demais seguem em sequência)")
	base := fs.Uint("base", uint(block.DefaultBase), "endereço base 0 do bloco OEE em holding registers (1000 = 41001)")
	wordOrder := fs.String("word-order", block.DefaultWordOrder.String(), "ordem das words dos contadores de 32 bits: CDAB, ABCD, BADC ou DCBA")
	fs.DurationVar(&cfg.sim.Cycle, "cycle", cfg.sim.Cycle, "tempo de ciclo nominal (uma peça por ciclo)")
	fs.Int64Var(&cfg.seed, "seed", 1, "semente do gerador aleatório (mesma semente = mesmo comportamento)")
	scenario := fs.String("scenario", sim.ScenarioNormal, "cenário: "+strings.Join(sim.ScenarioNames(), ", ")+" (combine com vírgula)")
	fs.Float64Var(&cfg.speed, "speed", 1, "multiplicador do relógio simulado (10 = dez vezes mais rápido)")
	fs.Float64Var(&cfg.sim.ScrapRate, "scrap", cfg.sim.ScrapRate, "probabilidade de refugo por peça (0–1)")
	fs.Float64Var(&cfg.sim.MeanRunCycles, "mean-run", cfg.sim.MeanRunCycles, "média de ciclos produzidos entre paradas/falhas")
	fs.BoolVar(&cfg.sim.GoodCounter, "good-counter", cfg.sim.GoodCounter, "preencher contador_bons, só informativo: o template padrão do gateway não o lê (boas = total − refugo); false deixa em 0")
	startTotal := fs.Uint64("start-total", 0, "valor inicial de contador_total e contador_bons (ex.: 100000 para conferir a ordem das words)")
	fs.DurationVar(&cfg.sim.ResetEvery, "reset-every", cfg.sim.ResetEvery, "counter-reset: intervalo médio entre resets dos contadores")
	overflowMargin := fs.Uint64("overflow-margin", uint64(cfg.sim.OverflowMargin), "overflow: peças até contador_total passar de 4294967295 para 0")
	fs.DurationVar(&cfg.sim.OfflineEvery, "offline-every", cfg.sim.OfflineEvery, "offline: tempo médio online entre duas quedas")
	fs.DurationVar(&cfg.sim.OfflineFor, "offline-for", cfg.sim.OfflineFor, "offline: duração média de cada queda")
	offlineMode := fs.String("offline-mode", string(plcserver.OfflineAuto), "offline: auto, close (fecha a porta; só no modo port) ou exception (exceção 0x0B)")
	fs.DurationVar(&cfg.sim.FreezeEvery, "freeze-every", cfg.sim.FreezeEvery, "frozen: tempo médio entre dois congelamentos")
	fs.DurationVar(&cfg.sim.FreezeFor, "freeze-for", cfg.sim.FreezeFor, "frozen: duração média de cada congelamento")
	maxClients := fs.Uint("max-clients", 10, "conexões simultâneas por porta")
	fs.DurationVar(&cfg.statusEvery, "status-every", 30*time.Second, "intervalo do resumo de status no log (0 desliga)")
	fs.DurationVar(&cfg.duration, "duration", 0, "encerrar depois deste tempo (0 = até Ctrl+C)")
	fs.BoolVar(&cfg.verbose, "verbose", false, "logar cada ciclo e as mensagens da biblioteca Modbus")

	if err := fs.Parse(args); err != nil {
		return cfg, err
	}
	if fs.NArg() > 0 {
		return cfg, fmt.Errorf("argumento inesperado %q (as opções começam com --)", fs.Arg(0))
	}

	var errs []error
	if cfg.machines < 1 {
		errs = append(errs, fmt.Errorf("--machines deve ser >= 1 (recebido %d)", cfg.machines))
	}
	if *unitStart < 1 || *unitStart > 247 {
		errs = append(errs, fmt.Errorf("--unit-start deve estar entre 1 e 247 (recebido %d)", *unitStart))
	}
	if *base > math.MaxUint16-block.Size+1 {
		errs = append(errs, fmt.Errorf("--base deve ser <= %d para o bloco de %d registradores caber (recebido %d)", math.MaxUint16-block.Size+1, block.Size, *base))
	}
	if *startTotal > math.MaxUint32 {
		errs = append(errs, fmt.Errorf("--start-total deve ser <= 4294967295 (recebido %d)", *startTotal))
	}
	if *overflowMargin > math.MaxUint32 {
		errs = append(errs, fmt.Errorf("--overflow-margin deve ser <= 4294967295 (recebido %d)", *overflowMargin))
	}
	if !(cfg.speed > 0) || math.IsInf(cfg.speed, 0) {
		errs = append(errs, fmt.Errorf("--speed deve ser > 0 (recebido %g)", cfg.speed))
	}
	if cfg.statusEvery < 0 || cfg.duration < 0 {
		errs = append(errs, errors.New("--status-every e --duration não podem ser negativos"))
	}
	order, err := block.ParseWordOrder(*wordOrder)
	if err != nil {
		errs = append(errs, err)
	}
	sc, err := sim.ParseScenarios(*scenario)
	if err != nil {
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		return cfg, errors.Join(errs...)
	}

	cfg.sim.Scenarios = sc
	cfg.sim.StartTotal = uint32(*startTotal)
	cfg.sim.OverflowMargin = uint32(*overflowMargin)
	if err := cfg.sim.Validate(); err != nil {
		return cfg, err
	}
	cfg.server.Mode = plcserver.Mode(*mode)
	cfg.server.UnitStart = uint8(*unitStart)
	cfg.server.Base = uint16(*base)
	cfg.server.WordOrder = order
	cfg.server.OfflineMode = plcserver.OfflineMode(*offlineMode)
	cfg.server.MaxClients = *maxClients
	return cfg, nil
}

// argNames traduz os nomes de tipo que o pacote flag mostra.
var argNames = map[string]string{
	"duration": "duração",
	"string":   "texto",
	"int":      "n",
	"uint":     "n",
	"float":    "x",
}

// printFlags lista as opções no formato "--nome tipo", com o padrão em português.
func printFlags(w io.Writer, fs *flag.FlagSet) {
	fs.VisitAll(func(f *flag.Flag) {
		name, usage := flag.UnquoteUsage(f)
		line := "  --" + f.Name
		if pt, ok := argNames[name]; ok {
			name = pt
		}
		if name != "" {
			line += " " + name
		}
		def := ""
		if f.DefValue != "" && f.DefValue != "0" && f.DefValue != "false" && f.DefValue != "0s" {
			def = fmt.Sprintf(" (padrão: %s)", f.DefValue)
		}
		fmt.Fprintf(w, "%s\n      %s%s\n", line, usage, def)
	})
}

// syncWriter serializa escritas de várias goroutines no mesmo destino.
type syncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

// logger escreve linhas "hh:mm:ss.mmm [t=hh:mm:ss] mensagem".
type logger struct {
	w io.Writer
}

func (l *logger) at(simT time.Duration, format string, args ...any) {
	fmt.Fprintf(l.w, "%s [t=%s] %s\n", time.Now().Format("15:04:05.000"), formatSimTime(simT), fmt.Sprintf(format, args...))
}

func formatSimTime(d time.Duration) string {
	s := int64(d / time.Second)
	return fmt.Sprintf("%02d:%02d:%02d", s/3600, s/60%60, s%60)
}

func machineLabel(i int) string { return fmt.Sprintf("M%d", i+1) }

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	cfg, err := parseArgs(args, stderr)
	if err != nil {
		return err
	}

	out := &syncWriter{w: stdout}
	lg := &logger{w: out}
	if cfg.verbose {
		cfg.server.LibLogger = log.New(out, "", log.Ltime|log.Lmicroseconds)
	}

	machines := make([]*sim.Machine, cfg.machines)
	for i := range machines {
		m, err := sim.NewMachine(i, cfg.seed, cfg.sim)
		if err != nil {
			return err
		}
		machines[i] = m
	}
	srv, err := plcserver.New(machines, cfg.server)
	if err != nil {
		return err
	}
	if err := srv.Start(); err != nil {
		return err
	}
	defer srv.Stop()

	printBanner(out, cfg, srv)

	if cfg.duration > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, cfg.duration)
		defer cancel()
	}

	start := time.Now()
	lastStatus := start
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	var simT time.Duration
	for {
		select {
		case <-ctx.Done():
			printStatus(lg, srv, simT)
			lg.at(simT, "encerrando")
			return nil
		case now := <-ticker.C:
			simT = time.Duration(float64(now.Sub(start)) * cfg.speed)
			evs, err := srv.Advance(simT)
			for _, e := range evs {
				if e.Kind == sim.EventCycle && !cfg.verbose {
					continue
				}
				lg.at(e.At, "%s %s", machineLabel(e.Machine), e.Describe())
			}
			if err != nil {
				lg.at(simT, "ERRO ao abrir/fechar portas: %v (nova tentativa no próximo passo)", err)
			}
			if cfg.statusEvery > 0 && now.Sub(lastStatus) >= cfg.statusEvery {
				lastStatus = now
				printStatus(lg, srv, simT)
			}
		}
	}
}

func printBanner(w io.Writer, cfg appConfig, srv *plcserver.Server) {
	opts := srv.Options()
	last := opts.Base + block.Size - 1
	fmt.Fprintf(w, "plc-sim · simulador de CLP Modbus TCP · bloco OEE padrão Engemase v%d\n", block.Version)
	fmt.Fprintf(w, "  máquinas: %d · modo: %s · ciclo: %s · semente: %d · cenário: %s · velocidade: %g×\n",
		cfg.machines, opts.Mode, cfg.sim.Cycle, cfg.seed, cfg.sim.Scenarios, cfg.speed)
	fmt.Fprintf(w, "  bloco: HR %d–%d (%s–%s) · 32 bits em %s · coils 0 (rodando) e 1 (falha) · somente leitura\n",
		opts.Base, last, block.HoldingRegisterConvention(opts.Base), block.HoldingRegisterConvention(last), opts.WordOrder)
	if cfg.sim.Scenarios.Offline {
		fmt.Fprintf(w, "  offline: %s\n", describeOfflineMode(opts.OfflineMode))
	}
	for _, ep := range srv.Endpoints() {
		unit := "qualquer unit id"
		if ep.UnitID != 0 {
			unit = fmt.Sprintf("unit id %d", ep.UnitID)
		}
		fmt.Fprintf(w, "  %s → %s · %s\n", machineLabel(ep.Machine), ep.Addr, unit)
	}
	fmt.Fprintln(w, "Ctrl+C para encerrar.")
}

func describeOfflineMode(m plcserver.OfflineMode) string {
	if m == plcserver.OfflineClose {
		return "a porta da máquina é fechada (conexão recusada)"
	}
	return "a máquina responde com a exceção 0x0B (escravo sem resposta)"
}

func printStatus(lg *logger, srv *plcserver.Server, simT time.Duration) {
	for i := range srv.MachineCount() {
		// Mostra o que o gateway lê (o bloco exposto, que pode estar congelado).
		b, _ := srv.Snapshot(i)
		_, frozen, online := srv.MachineStatus(i)
		state := sim.State(b.State)
		flags := ""
		if !online {
			flags += " · OFFLINE"
		}
		if frozen {
			flags += " · CONGELADO"
		}
		fault := ""
		if state == sim.StateFault {
			fault = fmt.Sprintf(" %d", b.FaultCode)
		}
		lg.at(simT, "status %s %-10s total=%d refugo=%d bons=%d hb=%d produto=%d vel=%d/h ciclo=%dms%s",
			machineLabel(i), state.String()+fault, b.Total, b.Reject, b.Good, b.Heartbeat, b.Product, b.Speed, b.LastCycleMs, flags)
	}
}
