package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/poller"
)

const (
	devTCP  = "01a1599e-7f90-7b47-976d-2b40a6cb24c1"
	devOff  = "01a1599e-7f90-7b47-976d-2b40a6cb24c2"
	devRTU  = "01a1599e-7f90-7b47-976d-2b40a6cb24c3"
	busID   = "01a1599d-9148-75c2-9673-d03229272dbb"
	machine = "01a159a1-4a68-72de-9057-14e72d836a47"
)

// testConfig: um CLP Modbus TCP lido pela coleta (bloco OEE) e outro desabilitado no
// mesmo endereço de teste, mais um escravo RTU num barramento de porta inexistente.
func testConfig(t *testing.T, addr string) *config.GatewayConfig {
	t.Helper()
	host, port, _ := net.SplitHostPort(addr)
	body := fmt.Sprintf(`{"config_version":3,
	"serial_buses":[{"id":"%[4]s","port":"/dev/ttyNAOEXISTE9","baud":19200,"parity":"E","data_bits":8,"stop_bits":1}],
	"devices":[
	 {"id":"%[1]s","protocol":"modbus-tcp","params":{"host":"%[2]s","port":%[3]s,"unit_id":1,"timeout_ms":300},
	  "blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":200}],
	  "tags":[{"id":"01a159a5-0388-7c92-8248-4dd1953e51e0","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"%[5]s"}]},
	 {"id":"%[6]s","protocol":"modbus-tcp","enabled":false,"params":{"host":"localhost","port":%[3]s,"unit_id":1,"timeout_ms":300},"tags":[]},
	 {"id":"%[7]s","protocol":"modbus-rtu","params":{"bus":"%[4]s","unit_id":2},"tags":[]}],
	"machines":[{"id":"%[5]s","state_rules":{"mode":"state_code","map":{"1":"RUNNING"}}}],
	"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, devTCP, host, port, busID, machine, devOff, devRTU)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// runPollers sobe os pollers da config (leituras descartadas) e os registra.
func runPollers(t *testing.T, cfg *config.GatewayConfig) *poller.Registry {
	t.Helper()
	ps, err := poller.Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan poller.Reading, 64)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-out:
			case <-done:
				return
			}
		}
	}()
	finished := make(chan struct{}, len(ps))
	for _, p := range ps {
		go func(p *poller.Poller) {
			defer func() { finished <- struct{}{} }()
			_ = p.Run(ctx, out)
		}(p)
	}
	reg := &poller.Registry{}
	reg.Set(ps)
	t.Cleanup(func() {
		cancel()
		for range ps {
			<-finished
		}
		close(done)
	})
	return reg
}

type harness struct {
	x   *Executor
	plc *mbtest.Server
	cfg *config.GatewayConfig
	n   int
}

func newHarness(t *testing.T, withPollers bool, deps Deps) *harness {
	t.Helper()
	plc, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = plc.Close() })
	plc.Coils[5] = true // antes do SetHolding, que publica a escrita pela trava do servidor
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	plc.SetHolding(1000, 1, 7, 1, 0, cnt[0], cnt[1])
	plc.SetHolding(1020, 0x4348, 0x0000) // 200.0 em float32 ABCD
	plc.SetHolding(1030, 0b1010)
	cfg := testConfig(t, plc.Addr())
	h := &harness{plc: plc, cfg: cfg, x: New(Options{Log: quiet})}
	deps.Config = func() *config.GatewayConfig { return cfg }
	deps.Local = config.DefaultLocal()
	deps.Log = quiet
	if deps.Modbus == nil {
		deps.Modbus = &Access{}
	}
	if withPollers {
		deps.Modbus.Pollers = runPollers(t, cfg)
	}
	RegisterMVP(h.x, deps)
	t.Cleanup(h.x.Close)
	return h
}

// run executa um comando e devolve o resultado (já conferido contra o contrato).
func (h *harness) run(t *testing.T, typ, payload string) map[string]any {
	t.Helper()
	h.n++
	id := fmt.Sprintf("01a1cab3-55e8-7cf0-a52e-%012d", h.n)
	h.x.Handle([]contracts.Command{{ID: id, Type: typ, ExpiresAt: contracts.FormatTime(time.Now().Add(time.Minute)), Payload: json.RawMessage(payload)}}, time.Now())
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		for _, r := range h.x.Results(50) {
			if strings.Contains(string(r), id) {
				got := byID(t, []json.RawMessage{r})[id]
				_ = h.x.Confirm()
				return got
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("%s sem resultado", typ)
	return nil
}

func result(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	r, ok := m["result"].(map[string]any)
	if !ok || m["status"] != "ok" {
		t.Fatalf("esperava ok: %v", m)
	}
	return r
}

func tagRead(dev, addr, typ, extra string) string {
	return fmt.Sprintf(`{"device_id":"%s","address":%s,"type":"%s"%s}`, dev, addr, typ, extra)
}

func TestTagRead(t *testing.T) {
	for _, withPollers := range []bool{true, false} {
		t.Run("pollers="+strconv.FormatBool(withPollers), func(t *testing.T) {
			h := newHarness(t, withPollers, Deps{})
			before := h.plc.RequestCount()
			r := result(t, h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1004}`, "uint32", `,"word_order":"CDAB"`)))
			if r["value"] != float64(100000) || r["quality"] != "good" || len(r["raw"].([]any)) != 2 {
				t.Fatalf("uint32: %v", r)
			}
			if h.plc.RequestCount() == before {
				t.Fatal("nenhuma leitura chegou ao CLP")
			}
			r = result(t, h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1020}`, "float32", `,"word_order":"ABCD","scale":{"mul":0.5,"add":1}`)))
			if r["value"] != float64(101) {
				t.Fatalf("float32 com escala: %v", r)
			}
			r = result(t, h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1020}`, "float32", `,"word_order":"ABCD"`)))
			if r["value"] != float64(200) {
				t.Fatalf("float32: %v", r)
			}
			r = result(t, h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1030,"bit":3}`, "bool", "")))
			if r["value"] != true || r["raw"].([]any)[0] != float64(10) {
				t.Fatalf("bit de registrador: %v", r)
			}
			r = result(t, h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"coil","offset":5}`, "bool", "")))
			if r["value"] != true {
				t.Fatalf("coil: %v", r)
			}
			// Dispositivo desabilitado (sem poller): conexão avulsa.
			r = result(t, h.run(t, TypeTagRead, tagRead(devOff, `{"area":"holding_register","offset":1001}`, "uint16", "")))
			if r["value"] != float64(7) {
				t.Fatalf("desabilitado: %v", r)
			}

			m := h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":4000}`, "uint16", ""))
			if m["status"] != "error" || errCode(m) != CodeModbusException || m["error"].(map[string]any)["modbus_exception"] != float64(2) {
				t.Fatalf("exceção: %v", m)
			}
			m = h.run(t, TypeTagRead, tagRead("01a1599e-0000-7b47-976d-2b40a6cb24c1", `{"area":"holding_register","offset":1}`, "uint16", ""))
			if m["status"] != "rejected" || errCode(m) != CodeDeviceNotFound {
				t.Fatalf("sem dispositivo: %v", m)
			}
			m = h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1004}`, "uint32", ""))
			if m["status"] != "rejected" || errCode(m) != CodeInvalidPayload {
				t.Fatalf("sem word_order: %v", m)
			}
			// Porta serial que não existe: o barramento não abre.
			m = h.run(t, TypeTagRead, tagRead(devRTU, `{"area":"holding_register","offset":1}`, "uint16", ""))
			if c := errCode(m); c != CodePortUnavailable && c != CodeTimeout {
				t.Fatalf("porta ausente: %v", m)
			}
		})
	}
}

func TestTagReadTimeout(t *testing.T) {
	h := newHarness(t, true, Deps{})
	h.plc.SetDelay(2 * time.Second) // acima do timeout do dispositivo (300 ms, 1 repetição)
	m := h.run(t, TypeTagRead, tagRead(devTCP, `{"area":"holding_register","offset":1001}`, "uint16", ""))
	if c := errCode(m); c != CodeReadTimeout && c != CodeTimeout {
		t.Fatalf("CLP lento: %v", m)
	}
}

func deviceTest(host string, port, unit int, extra string) string {
	return fmt.Sprintf(`{"connection":{"protocol":"modbus-tcp","params":{"host":"%s","port":%d,"unit_id":%d,"timeout_ms":300}}%s}`, host, port, unit, extra)
}

func TestDeviceTest(t *testing.T) {
	var allowed []string
	allow := func(ip net.IP) error {
		allowed = append(allowed, ip.String())
		if ip.String() == "127.0.0.2" {
			return errors.New("fora da OT")
		}
		return nil
	}
	h := newHarness(t, true, Deps{AllowTarget: allow})
	host, portS, _ := net.SplitHostPort(h.plc.Addr())
	port, _ := strconv.Atoi(portS)

	// Endpoint da config: pela conexão da coleta, sem a política de fora da config.
	r := result(t, h.run(t, TypeDeviceTest, deviceTest(host, port, 1, `,"device_id":"`+devTCP+`","probe":{"area":"holding_register","offset":1000,"count":3}`)))
	if p := r["probe"].(map[string]any); fmt.Sprint(p["raw"]) != "[1 7 1]" {
		t.Fatalf("probe: %v", r)
	}
	if len(allowed) != 0 {
		t.Fatalf("endpoint da config passou pela política: %v", allowed)
	}
	r = result(t, h.run(t, TypeDeviceTest, deviceTest(host, port, 1, `,"probe":{"area":"coil","offset":4,"count":3}`)))
	if p := r["probe"].(map[string]any); fmt.Sprint(p["raw"]) != "[0 1 0]" {
		t.Fatalf("probe de bits: %v", r)
	}
	// Sem probe, pela coleta: uma transação mínima.
	result(t, h.run(t, TypeDeviceTest, deviceTest(host, port, 1, "")))

	// Fora da config: mesmo CLP por outra porta (um proxy TCP local).
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				up, err := net.Dial("tcp", h.plc.Addr())
				if err != nil {
					_ = c.Close()
					return
				}
				go func() { _, _ = ioCopy(up, c); _ = up.Close() }()
				_, _ = ioCopy(c, up)
				_ = c.Close()
			}()
		}
	}()
	other := ln.Addr().(*net.TCPAddr).Port
	r = result(t, h.run(t, TypeDeviceTest, deviceTest("127.0.0.1", other, 1, "")))
	if _, ok := r["probe"]; ok || len(allowed) != 1 {
		t.Fatalf("só conectar: %v (%v)", r, allowed)
	}
	r = result(t, h.run(t, TypeDeviceTest, deviceTest("127.0.0.1", other, 1, `,"probe":{"area":"holding_register","offset":1004,"count":2}`)))
	if p := r["probe"].(map[string]any); len(p["raw"].([]any)) != 2 {
		t.Fatalf("probe avulso: %v", r)
	}
	m := h.run(t, TypeDeviceTest, deviceTest("127.0.0.2", other, 1, ""))
	if m["status"] != "rejected" || errCode(m) != CodeTargetNotAllowed {
		t.Fatalf("fora da OT: %v", m)
	}
	m = h.run(t, TypeDeviceTest, deviceTest("plc.local", other, 1, ""))
	if errCode(m) != CodeTargetNotAllowed {
		t.Fatalf("nome de host fora da config: %v", m)
	}
	// Limite de taxa: 10 testes fora da config na janela (2 já contaram).
	for i := 0; i < outsideTestsMax-2; i++ {
		result(t, h.run(t, TypeDeviceTest, deviceTest("127.0.0.1", other, 1, "")))
	}
	if m = h.run(t, TypeDeviceTest, deviceTest("127.0.0.1", other, 1, "")); errCode(m) != CodeTargetNotAllowed {
		t.Fatalf("limite de taxa: %v", m)
	}
	// Porta fechada: falha de conexão.
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	cp := closed.Addr().(*net.TCPAddr).Port
	_ = closed.Close()
	h2 := newHarness(t, false, Deps{AllowTarget: func(net.IP) error { return nil }})
	if m = h2.run(t, TypeDeviceTest, deviceTest("127.0.0.1", cp, 1, "")); m["status"] != "error" || errCode(m) != CodeConnectionFailed {
		t.Fatalf("porta fechada: %v", m)
	}
}

// RTU: barramento da config em uso com outros parâmetros seriais exige
// allow_bus_pause; com ele, a coleta pausa e a leitura usa os parâmetros do comando.
func TestDeviceTestBusPause(t *testing.T) {
	fake := &fakeReader{regs: []uint16{42, 43}}
	var opened []modbus.Target
	acc := &Access{Open: func(tg modbus.Target) (modbus.Reader, error) {
		opened = append(opened, tg)
		return fake, nil
	}}
	h := newHarness(t, true, Deps{Modbus: acc})
	bus := func(baud int, pause bool) string {
		return fmt.Sprintf(`{"device_id":"%s","connection":{"protocol":"modbus-rtu","params":{"bus":"%s","unit_id":2}},
		 "serial_bus":{"id":"%s","port":"/dev/ttyNAOEXISTE9","baud":%d,"parity":"E","data_bits":8,"stop_bits":1},
		 "allow_bus_pause":%t,"probe":{"area":"input_register","offset":16,"count":2}}`, devRTU, busID, busID, baud, pause)
	}
	m := h.run(t, TypeDeviceTest, bus(9600, false))
	if m["status"] != "rejected" || errCode(m) != CodeBusPauseRequired {
		t.Fatalf("sem allow_bus_pause: %v", m)
	}
	r := result(t, h.run(t, TypeDeviceTest, bus(9600, true)))
	if p := r["probe"].(map[string]any); fmt.Sprint(p["raw"]) != "[42 43]" {
		t.Fatalf("pausa: %v", r)
	}
	if len(opened) != 1 || opened[0].Baud != 9600 || opened[0].Address != "/dev/ttyNAOEXISTE9" {
		t.Fatalf("transporte avulso: %+v", opened)
	}
	// Barramento fora da config e sem serial_bus.
	m = h.run(t, TypeDeviceTest, `{"connection":{"protocol":"modbus-rtu","params":{"bus":"01a1599d-0000-75c2-9673-d03229272dbb","unit_id":2}}}`)
	if errCode(m) != CodeBusNotFound {
		t.Fatalf("sem barramento: %v", m)
	}
}

type fakeReader struct{ regs []uint16 }

func (f *fakeReader) ReadBlock(_ context.Context, _ uint8, s modbus.Span) (modbus.Raw, error) {
	return modbus.Raw{Span: s, Regs: append([]uint16(nil), f.regs[:s.Count]...)}, nil
}
func (f *fakeReader) Close() error { return nil }
func (f *fakeReader) Info() string { return "falso" }

func TestConfigReloadAndRestartHandlers(t *testing.T) {
	var restarted []string
	h := newHarness(t, false, Deps{
		ReloadConfig: func(context.Context) (ConfigReloadResult, error) {
			return ConfigReloadResult{}, Fail(CodeConfigFetchFailed, "rede fora")
		},
		ScheduleRestart: func(id string, delay time.Duration, reason string) error {
			restarted = append(restarted, fmt.Sprintf("%s %s %s", id, delay, reason))
			return nil
		},
	})
	if m := h.run(t, TypeConfigReload, `{}`); m["status"] != "error" || errCode(m) != CodeConfigFetchFailed {
		t.Fatalf("config.reload: %v", m)
	}
	r := result(t, h.run(t, TypeAgentRestart, `{"reason":"suporte","delay_s":5}`))
	at, err := contracts.ParseTime(r["restart_at"].(string))
	if err != nil || time.Until(at) < 3*time.Second || len(restarted) != 1 || !strings.HasSuffix(restarted[0], " 5s suporte") {
		t.Fatalf("agent.restart: %v %v", r, restarted)
	}
}

func ioCopy(dst net.Conn, src net.Conn) (int64, error) {
	buf := make([]byte, 4096)
	var n int64
	for {
		k, err := src.Read(buf)
		if k > 0 {
			if _, werr := dst.Write(buf[:k]); werr != nil {
				return n, werr
			}
			n += int64(k)
		}
		if err != nil {
			return n, err
		}
	}
}
