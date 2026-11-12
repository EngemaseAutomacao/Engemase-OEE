package poller

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

const (
	devID   = "01a1599e-7f90-7b47-976d-2b40a6cb24c1"
	mID     = "01a159a1-4a68-72de-9057-14e72d836a47"
	tState  = "01a159ab-0000-7000-8000-000000000001"
	tTotal  = "01a159ab-0000-7000-8000-000000000002"
	tLooseA = "01a159ab-0000-7000-8000-000000000003"
	tLooseB = "01a159ab-0000-7000-8000-000000000004"
)

func tcpConfig(t *testing.T, addr string) *config.GatewayConfig {
	t.Helper()
	host, port, _ := strings.Cut(addr, ":")
	p, _ := strconv.Atoi(port)
	body := fmt.Sprintf(`{"config_version":1,"serial_buses":[],
	"devices":[{"id":"%s","protocol":"modbus-tcp","params":{"host":"%s","port":%d,"unit_id":1,"timeout_ms":100},
		"blocks":[{"area":"holding_register","start":1000,"count":14,"poll_ms":100}],
		"tags":[
		 {"id":"%s","address":{"area":"holding_register","offset":1002},"type":"uint16","role":"state.code","machine_id":"%s"},
		 {"id":"%s","address":{"area":"holding_register","offset":1004},"type":"uint32","word_order":"CDAB","role":"count.total","machine_id":"%s"},
		 {"id":"%s","address":{"area":"input_register","offset":20},"type":"int16","poll_ms":200,"role":"custom"},
		 {"id":"%s","address":{"area":"input_register","offset":21},"type":"int16","poll_ms":200,"role":"custom"}]}],
	"machines":[{"id":"%s","state_rules":{"mode":"state_code","map":{"1":"RUNNING"}}}],
	"uplink":{"sync_interval_s":10,"max_batch_items":2000}}`, devID, host, p, tState, mID, tTotal, mID, tLooseA, tLooseB, mID)
	cfg, err := config.ParseRemote([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestBuildGroupsBlocksAndLooseTags(t *testing.T) {
	cfg := tcpConfig(t, "127.0.0.1:1502")
	ps, err := Build(cfg, config.DefaultLocal())
	if err != nil || len(ps) != 1 {
		t.Fatalf("pollers: %d (%v)", len(ps), err)
	}
	p := ps[0]
	if len(p.groups) != 2 {
		t.Fatalf("grupos: %d", len(p.groups))
	}
	blk, loose := p.groups[0], p.groups[1]
	if blk.span != (modbus.Span{Area: modbus.HoldingRegister, Start: 1000, Count: 14}) || len(blk.tags) != 2 || blk.every != 100*time.Millisecond {
		t.Fatalf("bloco: %+v", blk)
	}
	// As duas tags soltas (IR 20 e 21, mesmo poll) viram uma leitura só.
	if loose.span != (modbus.Span{Area: modbus.InputRegister, Start: 20, Count: 2}) || len(loose.tags) != 2 || loose.every != 200*time.Millisecond {
		t.Fatalf("tags soltas: %+v", loose)
	}
	if p.target.Timeout != 100*time.Millisecond || p.target.Address != "127.0.0.1:1502" {
		t.Fatalf("alvo: %+v", p.target)
	}
}

func TestBuildRTUBusSharesOnePoller(t *testing.T) {
	cfg, err := config.ParseRemote(testutil.ReadFixture(t, "gateway-config.valid.tcp-and-rtu-bus.json"))
	if err != nil {
		t.Fatal(err)
	}
	ps, err := Build(cfg, config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	// 1 TCP + 1 barramento com 2 escravos.
	if len(ps) != 2 {
		t.Fatalf("pollers: %d", len(ps))
	}
	bus := ps[1]
	if bus.target.Transport != modbus.TransportRTU || bus.target.Address != "/dev/ttyAMA2" || bus.target.Baud != 19200 || bus.target.Parity != "E" || len(bus.devices) != 2 {
		t.Fatalf("barramento: %+v (%d dispositivos)", bus.target, len(bus.devices))
	}
	local := config.DefaultLocal()
	local.Hardware.Profile = "generic"
	if _, err := Build(cfg, local); err == nil {
		t.Fatal("porta lógica sem mapeamento no perfil generic deveria falhar")
	}
}

func TestRunReadsDecodesAndBacksOff(t *testing.T) {
	srv, err := mbtest.Start(mbtest.MBAP)
	if err != nil {
		t.Fatal(err)
	}
	cnt, _ := modbus.Split32(70000, modbus.CDAB)
	srv.SetHolding(1000, 1, 5, 1, 0, cnt[0], cnt[1])
	srv.Input[20] = uint16(0xFFFF) // -1

	ps, err := Build(tcpConfig(t, srv.Addr()), config.DefaultLocal())
	if err != nil {
		t.Fatal(err)
	}
	p := ps[0]
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := make(chan Reading, 100)
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()

	got := map[string]int64{}
	deadline := time.After(3 * time.Second)
	for len(got) < 4 {
		select {
		case r := <-out:
			if r.Err != nil {
				t.Fatalf("leitura: %v", r.Err)
			}
			for _, s := range r.Samples {
				got[s.TagID] = s.Value.Int64()
			}
		case <-deadline:
			t.Fatalf("timeout; lido: %v", got)
		}
	}
	if got[tState] != 1 || got[tTotal] != 70000 || got[tLooseA] != -1 || got[tLooseB] != 0 {
		t.Fatalf("valores: %v", got)
	}
	h := p.Health(time.Now())
	if len(h) != 1 || h[0].Status != contracts.DeviceConnected || h[0].Errors1m != 0 || h[0].LastOKAt == "" {
		t.Fatalf("saúde: %+v", h)
	}

	// CLP some: falhas, backoff e status desconectado.
	_ = srv.Close()
	failures := 0
	for failures < 4 {
		select {
		case r := <-out:
			if r.Err != nil {
				failures++
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("esperava falhas; vieram %d", failures)
		}
	}
	h = p.Health(time.Now())
	if h[0].Status != contracts.DeviceDisconnected || h[0].Errors1m < 3 || h[0].LastError == "" {
		t.Fatalf("saúde depois da queda: %+v", h[0])
	}
	cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("Run: %v", err)
	}
}
