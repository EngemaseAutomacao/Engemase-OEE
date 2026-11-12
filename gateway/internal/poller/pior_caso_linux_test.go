//go:build linux

package poller

import (
	"context"
	"errors"
	"fmt"
	"os"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
)

// abrirPTY abre um pseudo-terminal: o mestre fica com o teste e o caminho do escravo
// faz as vezes da porta serial. Requisições escritas pelo cliente vão para reqs (o
// instante em que cada uma chegou).
func abrirPTY(t *testing.T) (m *os.File, porta string, reqs <-chan time.Time) {
	t.Helper()
	m, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Skipf("sem pseudo-terminal: %v", err)
	}
	rc, err := m.SyscallConn()
	if err != nil {
		_ = m.Close()
		t.Fatal(err)
	}
	var (
		n     uint32
		ioErr error
	)
	err = rc.Control(func(fd uintptr) {
		var unlock int32
		if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock))); e != 0 {
			ioErr = e
			return
		}
		if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCGPTN, uintptr(unsafe.Pointer(&n))); e != 0 {
			ioErr = e
		}
	})
	if err == nil {
		err = ioErr
	}
	if err != nil {
		_ = m.Close()
		t.Skipf("pseudo-terminal indisponível: %v", err)
	}
	ch := make(chan time.Time, 64)
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf, tmp := 0, make([]byte, 256)
		for {
			k, err := m.Read(tmp)
			if errors.Is(err, syscall.EIO) { // o cliente está com a porta fechada
				time.Sleep(2 * time.Millisecond)
				continue
			}
			if err != nil {
				return // mestre fechado: fim do teste
			}
			for buf += k; buf >= 8; buf -= 8 { // requisição RTU de leitura: 8 bytes
				select {
				case ch <- time.Now():
				default:
				}
			}
		}
	}()
	t.Cleanup(func() { _ = m.Close(); <-done })
	return m, fmt.Sprintf("/dev/pts/%d", n), ch
}

// RTU serial com o escravo mudo: em cada tentativa, depois de escrever a requisição, a
// grid-x espera o tempo do quadro (calculado pelo baud e pelo tamanho da resposta)
// antes de contar o timeout. A 9600 bauds, numa leitura de 125 registradores, são
// ~414 ms por tentativa, mais que os timeouts; readWorst tem de contar com eles.
func TestReadWorstCobreEsperaDoQuadroSerial(t *testing.T) {
	_, porta, _ := abrirPTY(t)
	alvo := modbus.Target{Transport: modbus.TransportRTU, Address: porta, Baud: 9600, Parity: "E", DataBits: 8,
		StopBits: 1, Timeout: 100 * time.Millisecond, Retries: modbus.DefaultRetries, TurnaroundDelay: 10 * time.Millisecond}
	r, err := modbus.Open(alvo)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	start := time.Now()
	_, err = r.ReadBlock(context.Background(), 1, modbus.Span{Area: modbus.HoldingRegister, Start: 0, Count: modbus.MaxRegistersPerRead})
	el := time.Since(start)
	if !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("escravo mudo: esperava ErrTimeout, veio %v", err)
	}
	quadro := esperaQuadroRTU(alvo.Baud, quadroRTUMax)
	t.Logf("leitura em bloco: %v (quadro %v, pior calculada %v)", el, quadro, readWorst(alvo))
	if el < 2*quadro {
		t.Fatalf("leitura levou %v: menos que a espera do quadro nas duas tentativas (%v)", el, 2*quadro)
	}
	if w := readWorst(alvo); el > w {
		t.Fatalf("leitura levou %v, além da pior leitura calculada %v", el, w)
	}
}

// RTU serial com o contexto cancelado no meio da leitura e um byte de lixo chegando
// pouco antes do prazo dela: a grid-x só confere o prazo entre bytes, e o byte seguinte
// espera até mais um timeout no select da porta. A leitura vai a ~2T, e o Close ainda
// segura a linha quieta por T: Run volta em até 3T, o StopBound (2T não bastaria).
func TestStopBoundRTUSerialLeituraAlemDoPrazo(t *testing.T) {
	const timeout = 500 * time.Millisecond
	m, porta, reqs := abrirPTY(t)
	alvo := modbus.Target{Transport: modbus.TransportRTU, Address: porta, Baud: 115200, Parity: "E", DataBits: 8,
		StopBits: 1, Timeout: timeout, Retries: modbus.DefaultRetries}
	p := pollerDeAlvo(alvo)
	quadro := esperaQuadroRTU(alvo.Baud, 8+5+2*2) // HR 0–1: requisição de 8 bytes, resposta de 9
	pedido := make(chan time.Time, 1)
	go func() {
		var at time.Time
		select {
		case at = <-reqs:
		case <-t.Context().Done():
			return
		}
		pedido <- at
		// Lixo (não é o unit 1) a 3/4 do prazo da leitura, que começa depois do quadro.
		time.Sleep(time.Until(at.Add(quadro + 3*timeout/4)))
		_, _ = m.Write([]byte{0})
	}()
	// Cancela com a leitura já em curso (depois da espera do quadro, que olha o contexto).
	medirParada(t, p, pedido, 100*time.Millisecond, 2*timeout+timeout/4)
}
