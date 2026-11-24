//go:build integration

// Teste de integração com o simulador tools/plc-sim: compila e sobe o simulador,
// lê o bloco OEE padrão pelo cliente Modbus do agente e roda poller + motor contra
// ele, e os comandos da nuvem (tag.read, device.test) contra ele.
// Rode com: go test -tags integration ./test/integration/
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/commands"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

// startSim compila e sobe o plc-sim numa porta livre; devolve "127.0.0.1:porta".
func startSim(t *testing.T, args ...string) string {
	t.Helper()
	dir := filepath.Join(testutil.RepoRoot(t), "tools", "plc-sim")
	if _, err := os.Stat(filepath.Join(dir, "go.mod")); err != nil {
		t.Skip("tools/plc-sim não encontrado")
	}
	bin := filepath.Join(t.TempDir(), "plc-sim")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = dir
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("compilando o plc-sim: %v\n%s", err, out)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	var logs bytes.Buffer
	cmd := exec.Command(bin, append([]string{"--port", strconv.Itoa(port), "--status-every", "0"}, args...)...)
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("log do plc-sim:\n%s", logs.String())
		}
	})
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	deadline := time.Now().Add(15 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			_ = c.Close()
			return addr
		}
		if time.Now().After(deadline) {
			t.Fatalf("plc-sim não abriu %s: %v\n%s", addr, err, logs.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestReadOEEBlockFromSimulator(t *testing.T) {
	addr := startSim(t, "--machines", "2", "--start-total", "100000", "--seed", "7", "--speed", "10")
	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: addr, Timeout: time.Second, Retries: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	span := modbus.Span{Area: modbus.HoldingRegister, Start: 1000, Count: modbus.OEEBlockRegisters}

	read := func(unit uint8) modbus.OEEBlock {
		t.Helper()
		raw, err := r.ReadBlock(ctx, unit, span)
		if err != nil {
			t.Fatalf("unit %d: %v", unit, err)
		}
		b, err := modbus.DecodeOEEBlock(raw.Regs, modbus.CDAB)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	first := read(1)
	if first.Version != 1 || first.State > 5 || first.Total < 100000 {
		t.Fatalf("bloco OEE inesperado (contador em CDAB deveria partir de 100000): %+v", first)
	}
	if b2 := read(2); b2.Version != 1 || b2.Total < 100000 {
		t.Fatalf("máquina 2: %+v", b2)
	}
	time.Sleep(1500 * time.Millisecond)
	later := read(1)
	if later.Heartbeat == first.Heartbeat {
		t.Fatalf("heartbeat parado: %d", later.Heartbeat)
	}
	if later.Total < first.Total {
		t.Fatalf("contador regrediu no cenário normal: %d → %d", first.Total, later.Total)
	}
	coils, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.Coil, Start: 0, Count: 2})
	if err != nil || len(coils.Bits) != 2 {
		t.Fatalf("coils: %v (%v)", coils.Bits, err)
	}
}

// Poller + motor contra o simulador: estado, contador e live chegam ao motor.
func TestEngineAgainstSimulator(t *testing.T) {
	addr := startSim(t, "--machines", "1", "--start-total", "100000", "--seed", "3", "--speed", "20", "--cycle", "2s")
	host, port, _ := net.SplitHostPort(addr)
	body := fmt.Sprintf(`{"config_version":1,"serial_buses":[],
	"devices":[{"id":"01a1599e-7f90-7b47-976d-2b40a6cb24c1","protocol":"modbus-tcp","params":{"host":"%s","port":%s,"unit_id":1},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[
	   {"id":"01a159a4-1540-74dd-a3e5-239a6a4ca4df","address":{"area":"holding_register","offset":1001},"type":"uint16","role":"plc.heartbeat","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"},
	   {"id":"01a159a5-0388-7c92-8248-4dd1953e51e0","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"},
	   {"id":"01a159a5-f1d0-76fa-a2bb-a449aa22b3e3","address":{"area":"holding_register","offset":1003},"type":"uint16","role":"fault.code","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"},
	   {"id":"01a159a6-e018-779c-9647-cae69dd0eeb2","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"},
	   {"id":"01a159a7-ce60-7646-890e-0d4462a5fa79","address":{"area":"holding_register","offset":1006},"type":"uint32","word_order":"CDAB","role":"count.reject","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"},
	   {"id":"01a159a8-bca8-76bf-9ec7-ea2e7cc0597a","address":{"area":"holding_register","offset":1010},"type":"uint16","role":"product.code","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"}]}],
	"machines":[{"id":"01a159a1-4a68-72de-9057-14e72d836a47","state_rules":{"mode":"state_code",
	  "map":{"0":"STOPPED","1":"RUNNING","2":"FAULT","3":"SETUP","4":"STOPPED","5":"FAULT"},"heartbeat_timeout_s":10}}],
	"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, host, port)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	ps, err := poller.Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	eng, err := engine.New(cfg, time.Now(), engine.Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	readings := make(chan poller.Reading, 256)
	go func() { _ = ps[0].Run(ctx, readings) }()

	var states []contracts.StateEvent
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
loop:
	for {
		select {
		case r := <-readings:
			if r.Err != nil {
				t.Fatalf("leitura: %v", r.Err)
			}
			eng.OnRead(r.At, r.Samples)
		case <-tick.C:
			for _, rec := range eng.Tick(time.Now()).Records {
				if ev, ok := rec.Payload.(contracts.StateEvent); ok {
					states = append(states, ev)
				}
			}
		case <-ctx.Done():
			break loop
		}
	}
	if len(states) == 0 || states[0].State == contracts.StateNoComm {
		t.Fatalf("esperava um estado vindo do CLP simulado: %+v", states)
	}
	live := eng.Live(time.Now())
	if len(live) != 1 || live[0].CounterTotal == nil || *live[0].CounterTotal < 100000 || live[0].Product == "" {
		t.Fatalf("live: %+v", live)
	}
}

// Comandos da nuvem contra o simulador: tag.read pela fila do poller em execução e
// device.test pela conexão da coleta e por uma conexão avulsa (endereço fora da config).
func TestCommandsAgainstSimulator(t *testing.T) {
	addr := startSim(t, "--machines", "2", "--start-total", "100000", "--seed", "5", "--speed", "10")
	_, port, _ := net.SplitHostPort(addr)
	const dev = "01a1599e-7f90-7b47-976d-2b40a6cb24c1"
	body := fmt.Sprintf(`{"config_version":1,"serial_buses":[],
	"devices":[{"id":"%s","protocol":"modbus-tcp","params":{"host":"localhost","port":%s,"unit_id":1},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[{"id":"01a159a5-0388-7c92-8248-4dd1953e51e0","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"01a159a1-4a68-72de-9057-14e72d836a47"}]}],
	"machines":[{"id":"01a159a1-4a68-72de-9057-14e72d836a47","state_rules":{"mode":"state_code","map":{"1":"RUNNING"}}}],
	"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, dev, port)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	ps, err := poller.Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	readings := make(chan poller.Reading, 256)
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = ps[0].Run(ctx, readings)
	}()
	go func() {
		for {
			select {
			case <-readings:
			case <-stopped:
				return
			}
		}
	}()
	defer func() { cancel(); <-stopped }()
	reg := &poller.Registry{}
	reg.Set(ps)

	x := commands.New(commands.Options{})
	defer x.Close()
	commands.RegisterMVP(x, commands.Deps{
		Config: func() *config.GatewayConfig { return cfg }, Local: config.DefaultLocal(),
		Modbus: &commands.Access{Pollers: reg}, AllowTarget: func(net.IP) error { return nil },
	})
	schema := testutil.StrictSchema(t, "command-result")
	n := 0
	run := func(typ, payload string) map[string]any {
		t.Helper()
		n++
		id := fmt.Sprintf("01a1cab3-55e8-7cf0-a52e-%012d", n)
		x.Handle([]contracts.Command{{ID: id, Type: typ, ExpiresAt: contracts.FormatTime(time.Now().Add(time.Minute)),
			Payload: []byte(payload)}}, time.Now())
		for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
			for _, r := range x.Results(50) {
				if !bytes.Contains(r, []byte(id)) {
					continue
				}
				if errs := testutil.ValidateJSON(t, schema, r); errs != "" {
					t.Fatalf("resultado fora do contrato: %s\n%s", errs, r)
				}
				var m map[string]any
				_ = json.Unmarshal(r, &m)
				x.Confirm()
				if m["status"] != "ok" {
					t.Fatalf("%s: %s", typ, r)
				}
				return m["result"].(map[string]any)
			}
		}
		t.Fatalf("%s sem resultado", typ)
		return nil
	}

	r := run("tag.read", `{"device_id":"`+dev+`","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB"}`)
	if v, _ := r["value"].(float64); v < 100000 {
		t.Fatalf("contador lido: %v", r)
	}
	r = run("tag.read", `{"device_id":"`+dev+`","address":{"area":"holding_register","offset":1000},"type":"uint16"}`)
	if r["value"] != float64(1) {
		t.Fatalf("versão do bloco OEE: %v", r)
	}
	if r = run("tag.read", `{"device_id":"`+dev+`","address":{"area":"coil","offset":0},"type":"bool"}`); r["value"] == nil {
		t.Fatalf("coil: %v", r)
	}
	// Máquina 2 (unit 2) pela conexão da coleta.
	r = run("device.test", `{"connection":{"protocol":"modbus-tcp","params":{"host":"localhost","port":`+port+`,"unit_id":2}},
		"probe":{"area":"holding_register","offset":1000,"count":14}}`)
	if raw := r["probe"].(map[string]any)["raw"].([]any); len(raw) != 14 || raw[0] != float64(1) {
		t.Fatalf("probe da máquina 2: %v", r)
	}
	// Fora da config (127.0.0.1 em vez de localhost): conexão avulsa.
	run("device.test", `{"connection":{"protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":`+port+`,"unit_id":1}}}`)
	r = run("device.test", `{"connection":{"protocol":"modbus-tcp","params":{"host":"127.0.0.1","port":`+port+`,"unit_id":1}},
		"probe":{"area":"coil","offset":0,"count":2}}`)
	if raw := r["probe"].(map[string]any)["raw"].([]any); len(raw) != 2 {
		t.Fatalf("probe avulso: %v", r)
	}
}
