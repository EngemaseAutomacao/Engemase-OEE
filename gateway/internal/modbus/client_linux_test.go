//go:build linux

package modbus_test

import (
	"errors"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// A consulta à fila de envio (SIOCOUTQ) conta o que foi escrito e o outro lado ainda
// não reconheceu: zero depois do ACK, mais que zero com a janela do outro lado cheia.
func TestBytesNaoReconhecidosConsultaAFilaDeEnvio(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	aceita := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err != nil {
			close(aceita)
			return
		}
		aceita <- c
	}()
	c, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	srv, ok := <-aceita
	if !ok {
		t.Fatal("accept falhou")
	}
	defer srv.Close()

	esperar := func(cond func(n int) bool, quer string) {
		t.Helper()
		var (
			n  int
			ok bool
		)
		for limite := time.Now().Add(5 * time.Second); time.Now().Before(limite); time.Sleep(time.Millisecond) {
			if n, ok = modbus.BytesNaoReconhecidos(c); ok && cond(n) {
				return
			}
		}
		t.Fatalf("bytes não reconhecidos = %d (ok=%v), quer %s", n, ok, quer)
	}

	if _, err := c.Write([]byte{1, 3, 0, 100, 0, 1, 0xC5, 0xD5}); err != nil {
		t.Fatal(err)
	}
	esperar(func(n int) bool { return n == 0 }, "0 depois do ACK")

	// O servidor não lê: a janela dele enche e o resto fica na fila de envio.
	bloco := make([]byte, 64<<10)
	for {
		_ = c.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
		if _, err := c.Write(bloco); err != nil {
			if !errors.Is(err, os.ErrDeadlineExceeded) {
				t.Fatal(err)
			}
			break
		}
	}
	esperar(func(n int) bool { return n > 0 }, "> 0 com a fila cheia")

	go func() { _, _ = io.Copy(io.Discard, srv) }()
	esperar(func(n int) bool { return n == 0 }, "0 depois de o servidor ler tudo")

	_ = c.Close()
	if n, ok := modbus.BytesNaoReconhecidos(c); ok {
		t.Fatalf("socket fechado: esperava ok=false, veio %d", n)
	}
}
