package modbus_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
)

func startServer(t *testing.T, f mbtest.Framing) *mbtest.Server {
	t.Helper()
	srv, err := mbtest.Start(f)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func TestTCPReadBlockAndDecode(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	cnt, _ := modbus.Split32(100000, modbus.CDAB)
	srv.SetHolding(1000, 1, 42, 1, 0, cnt[0], cnt[1])
	srv.Coils[3] = true

	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: srv.Addr()})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()

	raw, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.HoldingRegister, Start: 1000, Count: 14})
	if err != nil {
		t.Fatal(err)
	}
	v, err := raw.Decode(modbus.TagSpec{Area: modbus.HoldingRegister, Offset: 1004, Bit: -1, Type: modbus.Uint32, WordOrder: modbus.CDAB})
	if err != nil || v.Int64() != 100000 {
		t.Fatalf("contador = %v (%v)", v, err)
	}

	bits, err := r.ReadBlock(ctx, 1, modbus.Span{Area: modbus.Coil, Start: 0, Count: 10})
	if err != nil || len(bits.Bits) != 10 || !bits.Bits[3] || bits.Bits[2] {
		t.Fatalf("coils = %v (%v)", bits.Bits, err)
	}

	// A conexão é persistente: duas leituras, uma conexão (o servidor só conta requisições).
	if srv.RequestCount() != 2 {
		t.Fatalf("requisições = %d", srv.RequestCount())
	}
}

func TestExceptionIsClassified(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	r, _ := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: srv.Addr()})
	defer r.Close()

	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 2040, Count: 20})
	var exc *modbus.ExceptionError
	if !errors.As(err, &exc) || exc.Code != 2 {
		t.Fatalf("esperava exceção 02, veio %v", err)
	}
	// Exceção não é repetida.
	if srv.RequestCount() != 1 {
		t.Fatalf("requisições = %d (exceção não deve ser repetida)", srv.RequestCount())
	}
}

func TestTimeoutIsShortAndRetriedOnce(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	srv.SetDelay(400 * time.Millisecond)
	r, _ := modbus.Open(modbus.Target{
		Transport: modbus.TransportTCP, Address: srv.Addr(),
		Timeout: 100 * time.Millisecond, Retries: 1,
	})
	defer r.Close()

	start := time.Now()
	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 1})
	if !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("esperava ErrTimeout, veio %v", err)
	}
	if el := time.Since(start); el > 1500*time.Millisecond {
		t.Fatalf("timeout demorou %v", el)
	}
}

func TestConnectionRefused(t *testing.T) {
	srv := startServer(t, mbtest.MBAP)
	addr := srv.Addr()
	_ = srv.Close()
	r, _ := modbus.Open(modbus.Target{Transport: modbus.TransportTCP, Address: addr, Retries: 0})
	defer r.Close()
	_, err := r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: 1})
	if !errors.Is(err, modbus.ErrConnRefused) {
		t.Fatalf("esperava ErrConnRefused, veio %v", err)
	}
}

func TestRTUOverTCPWithSeveralUnits(t *testing.T) {
	srv := startServer(t, mbtest.RTU)
	srv.Units = map[uint8]bool{1: true, 2: true}
	srv.Input[16] = 7

	r, err := modbus.Open(modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: srv.Addr(), Timeout: 150 * time.Millisecond, Retries: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	for _, unit := range []uint8{1, 2} {
		raw, err := r.ReadBlock(ctx, unit, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 2})
		if err != nil || raw.Regs[0] != 7 {
			t.Fatalf("unit %d: %v (%v)", unit, raw.Regs, err)
		}
	}
	// Escravo ausente: timeout curto, sem travar os outros.
	if _, err := r.ReadBlock(ctx, 3, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 1}); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("unit 3 ausente: esperava timeout, veio %v", err)
	}
	if _, err := r.ReadBlock(ctx, 0, modbus.Span{Area: modbus.InputRegister, Start: 16, Count: 1}); err == nil {
		t.Fatal("unit id 0 (broadcast) nunca deve ser lido em RTU")
	}
}

func TestParseTarget(t *testing.T) {
	cases := []struct {
		in      string
		want    modbus.Target
		wantErr bool
	}{
		{in: "tcp://192.168.10.23", want: modbus.Target{Transport: modbus.TransportTCP, Address: "192.168.10.23:502", Retries: 1}},
		{in: "tcp://plc.local:1502?timeout_ms=800", want: modbus.Target{Transport: modbus.TransportTCP, Address: "plc.local:1502", Retries: 1, Timeout: 800 * time.Millisecond}},
		{in: "rtu+tcp://10.0.0.5:4001", want: modbus.Target{Transport: modbus.TransportRTUOverTCP, Address: "10.0.0.5:4001", Retries: 1}},
		{in: "rtu:///dev/ttyUSB0?baud=9600&parity=N&stop_bits=2", want: modbus.Target{Transport: modbus.TransportRTU, Address: "/dev/ttyUSB0", Baud: 9600, Parity: "N", DataBits: 8, StopBits: 2, Retries: 1}},
		{in: "rtu:///dev/ttyAMA2", want: modbus.Target{Transport: modbus.TransportRTU, Address: "/dev/ttyAMA2", Baud: 19200, Parity: "E", DataBits: 8, StopBits: 1, Retries: 1}},
		{in: "rtu:///dev/ttyUSB0?data_bits=7", wantErr: true},
		{in: "rtu:///dev/ttyUSB0?parity=X", wantErr: true},
		{in: "udp://1.2.3.4", wantErr: true},
		{in: "tcp://", wantErr: true},
		{in: "tcp://1.2.3.4?timeout_ms=5", wantErr: true},
	}
	for _, c := range cases {
		got, err := modbus.ParseTarget(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("%s: esperava erro", c.in)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s: got %+v (%v), quer %+v", c.in, got, err, c.want)
		}
	}
}
