package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simonvetter/modbus"

	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/block"
	"github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim/plcserver"
)

func TestParseArgsExample(t *testing.T) {
	cfg, err := parseArgs(strings.Fields("--machines 3 --base 1000 --port 1502 --cycle 6s --seed 42 --scenario normal"), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.machines != 3 || cfg.server.Base != 1000 || cfg.server.Port != 1502 || cfg.sim.Cycle != 6*time.Second || cfg.seed != 42 {
		t.Fatalf("config = %+v", cfg)
	}
	if cfg.sim.Scenarios.String() != "normal" || cfg.server.Mode != plcserver.ModeUnit || cfg.server.WordOrder != block.CDAB {
		t.Fatalf("padrões inesperados: %+v", cfg)
	}
}

func TestParseArgsScenariosAndOptions(t *testing.T) {
	args := "--scenario counter-reset,overflow,offline,frozen --mode port --word-order dcba --overflow-margin 3 --good-counter=false --speed 10"
	cfg, err := parseArgs(strings.Fields(args), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	sc := cfg.sim.Scenarios
	if !sc.CounterReset || !sc.Overflow || !sc.Offline || !sc.Frozen {
		t.Fatalf("cenários = %+v", sc)
	}
	if cfg.server.Mode != plcserver.ModePort || cfg.server.WordOrder != block.DCBA || cfg.sim.OverflowMargin != 3 || cfg.sim.GoodCounter || cfg.speed != 10 {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestParseArgsErrors(t *testing.T) {
	bad := []string{
		"--machines 0",
		"--unit-start 0",
		"--unit-start 300",
		"--base 65530",
		"--word-order XYZW",
		"--scenario explode",
		"--speed 0",
		"--cycle 1ms",
		"--scrap 2",
		"--start-total 4294967296",
		"--scenario overflow --start-total 10",
		"--status-every -1s",
		"posicional",
		"--nao-existe",
	}
	for _, args := range bad {
		if _, err := parseArgs(strings.Fields(args), io.Discard); err == nil {
			t.Errorf("%q: esperava erro", args)
		}
	}
	if _, err := parseArgs([]string{"--help"}, io.Discard); !errors.Is(err, flag.ErrHelp) {
		t.Errorf("--help: erro %v, esperado flag.ErrHelp", err)
	}
}

// O contador_bons é só informativo (docs/11, seção 3): o template padrão do gateway não o
// lê e as boas saem de total − refugo. A ajuda não pode prometer que o gateway "calcula"
// as boas quando o campo fica em 0.
func TestHelpGoodCounterInformativo(t *testing.T) {
	var out bytes.Buffer
	if _, err := parseArgs([]string{"--help"}, &out); !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("--help: erro %v, esperado flag.ErrHelp", err)
	}
	_, after, ok := strings.Cut(out.String(), "  --good-counter\n")
	if !ok {
		t.Fatalf("--good-counter ausente da ajuda:\n%s", out.String())
	}
	usage, _, _ := strings.Cut(after, "\n")
	for _, want := range []string{"informativo", "não o lê", "total − refugo"} {
		if !strings.Contains(usage, want) {
			t.Errorf("ajuda de --good-counter sem %q: %q", want, usage)
		}
	}
	if strings.Contains(usage, "gateway calcula") {
		t.Errorf("ajuda de --good-counter ainda diz que o gateway calcula as boas: %q", usage)
	}
}

func TestFormatSimTime(t *testing.T) {
	if got := formatSimTime(26*time.Hour + 3*time.Minute + 4*time.Second + 999*time.Millisecond); got != "26:03:04" {
		t.Fatalf("formatSimTime = %q", got)
	}
}

// lockedBuffer permite ler a saída enquanto run ainda escreve nela.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestRunServesAndLogs(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()

	// 1 s de relógio a 60× = 60 s simulados: ~60 ciclos de 1 s; overflow após 3 peças.
	args := []string{
		"--machines", "2", "--port", strconv.Itoa(port), "--cycle", "1s", "--seed", "42",
		"--scenario", "overflow", "--overflow-margin", "2", "--speed", "60",
		"--duration", "1s", "--status-every", "300ms", "--mean-run", "1000000",
	}
	var out lockedBuffer
	done := make(chan error, 1)
	go func() { done <- run(context.Background(), args, &out, io.Discard) }()

	// Lê o bloco da M2 pela rede enquanto o simulador roda.
	var c *modbus.ModbusClient
	deadline := time.Now().Add(2 * time.Second)
	for {
		c, err = modbus.NewClient(&modbus.ClientConfiguration{URL: "tcp://127.0.0.1:" + strconv.Itoa(port), Timeout: time.Second})
		if err != nil {
			t.Fatal(err)
		}
		if err = c.Open(); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("o simulador não abriu a porta: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	defer c.Close()
	if err := c.SetUnitId(2); err != nil {
		t.Fatal(err)
	}
	regs, err := c.ReadRegisters(block.DefaultBase, block.Size, modbus.HOLDING_REGISTER)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := block.Decode(regs, block.CDAB); b.Version != block.Version {
		t.Fatalf("versao_bloco = %d", b.Version)
	}

	if err := <-done; err != nil {
		t.Fatalf("run: %v", err)
	}
	log := out.String()
	for _, want := range []string{
		"bloco OEE padrão Engemase",
		"HR 1000–1031 (41001–41032)",
		"M2 → 127.0.0.1:" + strconv.Itoa(port) + " · unit id 2",
		"OVERFLOW do contador_total",
		"status M1",
		"encerrando",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("log sem %q:\n%s", want, log)
		}
	}
}

func TestRunFailsOnBusyPort(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	args := []string{"--port", strconv.Itoa(l.Addr().(*net.TCPAddr).Port), "--duration", "100ms"}
	if err := run(context.Background(), args, io.Discard, io.Discard); err == nil {
		t.Fatal("esperava erro com a porta ocupada")
	}
}
