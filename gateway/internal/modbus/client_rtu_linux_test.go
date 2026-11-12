//go:build linux

package modbus_test

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/modbus/mbtest"
)

// Constantes do poll(2) no Linux (iguais em todas as arquiteturas).
const (
	pollIn  = 0x1
	pollHup = 0x10
)

// escravoPTY é um escravo Modbus RTU do outro lado de um pseudo-terminal: o cliente
// abre /dev/pts/N como se fosse a porta serial. Só responde FC03 do unit 1.
//
// Diferença para uma UART real: num pty o lado do mestre mantém o tty vivo, então o
// que é escrito enquanto o cliente está com a porta fechada fica guardado para a
// próxima abertura. Numa UART o último close descarta o buffer de entrada e, com a
// porta fechada, o receptor fica desligado: o byte se perde. O escravo emula isso
// descartando a resposta quando o cliente fechou a porta (POLLHUP no mestre).
type escravoPTY struct {
	m           *os.File
	mu          sync.Mutex
	holding     []uint16
	delay       time.Duration
	descartadas int
}

func abrirPTY(t *testing.T) (*os.File, string) {
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
	return m, fmt.Sprintf("/dev/pts/%d", n)
}

// clienteFechou diz se nenhum descritor do lado escravo do pty está aberto.
func (e *escravoPTY) clienteFechou() bool {
	rc, err := e.m.SyscallConn()
	if err != nil {
		return true
	}
	fechado := false
	if err := rc.Control(func(fd uintptr) {
		pfd := struct {
			fd              int32
			events, revents int16
		}{fd: int32(fd), events: pollIn}
		var ts syscall.Timespec // timeout zero: só consulta
		n, _, en := syscall.Syscall6(syscall.SYS_PPOLL, uintptr(unsafe.Pointer(&pfd)), 1, uintptr(unsafe.Pointer(&ts)), 0, 0, 0)
		fechado = en == 0 && n == 1 && pfd.revents&pollHup != 0
	}); err != nil {
		return true
	}
	return fechado
}

func (e *escravoPTY) setDelay(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.delay = d
}

func (e *escravoPTY) respostasDescartadas() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.descartadas
}

func (e *escravoPTY) servir() {
	var buf []byte
	tmp := make([]byte, 256)
	for {
		n, err := e.m.Read(tmp)
		if err != nil {
			if errors.Is(err, syscall.EIO) { // o cliente está com a porta fechada
				buf = buf[:0]
				time.Sleep(2 * time.Millisecond)
				continue
			}
			return // mestre fechado: fim do teste
		}
		buf = append(buf, tmp[:n]...)
		for len(buf) >= 8 {
			req := append([]byte(nil), buf[:8]...)
			buf = buf[8:]
			if mbtest.CRC16(req[:6]) != binary.LittleEndian.Uint16(req[6:]) || req[0] != 1 || req[1] != 0x03 {
				continue
			}
			addr, qty := binary.BigEndian.Uint16(req[2:]), binary.BigEndian.Uint16(req[4:])
			e.mu.Lock()
			delay := e.delay
			out := []byte{1, 0x03, byte(2 * qty)}
			for i := 0; i < int(qty); i++ {
				out = binary.BigEndian.AppendUint16(out, e.holding[int(addr)+i])
			}
			e.mu.Unlock()
			out = binary.LittleEndian.AppendUint16(out, mbtest.CRC16(out))
			time.Sleep(delay)
			if e.clienteFechou() {
				e.mu.Lock()
				e.descartadas++
				e.mu.Unlock()
				continue
			}
			if _, err := e.m.Write(out); err != nil {
				return
			}
		}
	}
}

// RTU na porta serial tem a mesma exposição do RTU sobre TCP: a grid-x casa a resposta
// só por unit id e função, então a resposta atrasada de uma leitura que expirou era
// aceita como resposta da próxima (HR200 devolvia o valor do HR100). Depois de um
// timeout o cliente tem de fechar a porta (o que descarta a entrada numa UART) e
// reabri-la na leitura seguinte.
func TestRTUSerialDescartaRespostaAtrasadaAposTimeout(t *testing.T) {
	m, porta := abrirPTY(t)
	esc := &escravoPTY{m: m, holding: make([]uint16, 512)}
	esc.holding[100], esc.holding[200] = 111, 222
	done := make(chan struct{})
	go func() { defer close(done); esc.servir() }()
	t.Cleanup(func() { _ = m.Close(); <-done })

	r, err := modbus.Open(modbus.Target{
		Transport: modbus.TransportRTU, Address: porta,
		Baud: 19200, Parity: "E", DataBits: 8, StopBits: 1,
		Timeout: 100 * time.Millisecond, Retries: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if v, err := lerHR(r, 100); err != nil || v != 111 {
		t.Fatalf("leitura inicial: %d (%v)", v, err)
	}

	esc.setDelay(300 * time.Millisecond)
	if _, err := lerHR(r, 100); !errors.Is(err, modbus.ErrTimeout) {
		t.Fatalf("esperava ErrTimeout na leitura lenta, veio %v", err)
	}
	esc.setDelay(0)
	time.Sleep(350 * time.Millisecond) // a resposta atrasada do HR100 já saiu do escravo

	v, err := lerHR(r, 200)
	if err != nil {
		t.Fatalf("HR200 depois do timeout (a porta devia ser reaberta): %v", err)
	}
	if v != 222 {
		t.Fatalf("HR200 = %d, quer 222 (111 é a resposta atrasada do HR100)", v)
	}
	if n := esc.respostasDescartadas(); n != 1 {
		t.Fatalf("respostas emitidas com a porta fechada = %d, quer 1 (a porta devia fechar no timeout)", n)
	}
}
