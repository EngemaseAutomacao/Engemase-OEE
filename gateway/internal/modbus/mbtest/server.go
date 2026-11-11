// Package mbtest tem um servidor Modbus mínimo, em memória, para testes: responde
// FC01–FC04 em Modbus TCP (MBAP) ou em quadros RTU sobre TCP. Não é o simulador de
// máquinas (tools/plc-sim); serve para testar o cliente e a CLI sem rede externa.
package mbtest

import (
	"encoding/binary"
	"io"
	"net"
	"sync"
	"time"
)

// Framing escolhe o formato dos quadros no socket.
type Framing int

const (
	// MBAP é o Modbus TCP padrão.
	MBAP Framing = iota
	// RTU são quadros RTU (com CRC) num socket TCP, como num conversor serial↔Ethernet.
	RTU
)

// Server é um escravo Modbus em memória. Endereços acima do tamanho das tabelas
// respondem exceção 02. Unit ids fora de Units não respondem (simula escravo ausente).
type Server struct {
	mu       sync.Mutex
	ln       net.Listener
	framing  Framing
	Holding  []uint16
	Input    []uint16
	Coils    []bool
	Discrete []bool
	// Units que respondem; vazio = todas.
	Units map[uint8]bool
	// Delay antes de cada resposta (para testar timeout).
	Delay time.Duration
	// Requests conta as requisições recebidas.
	Requests int
	conns    map[net.Conn]struct{}
	wg       sync.WaitGroup
}

// Start sobe o servidor em 127.0.0.1 numa porta livre.
func Start(framing Framing) (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &Server{
		ln: ln, framing: framing,
		Holding: make([]uint16, 2048), Input: make([]uint16, 2048),
		Coils: make([]bool, 2048), Discrete: make([]bool, 2048),
		conns: map[net.Conn]struct{}{},
	}
	s.wg.Add(1)
	go s.accept()
	return s, nil
}

// Addr devolve "127.0.0.1:porta".
func (s *Server) Addr() string { return s.ln.Addr().String() }

// Close para o servidor, derruba as conexões abertas e espera as goroutines.
func (s *Server) Close() error {
	err := s.ln.Close()
	s.mu.Lock()
	for c := range s.conns {
		_ = c.Close()
	}
	s.mu.Unlock()
	s.wg.Wait()
	return err
}

// SetHolding grava registradores a partir de offset (thread-safe).
func (s *Server) SetHolding(offset int, regs ...uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy(s.Holding[offset:], regs)
}

// SetDelay muda o atraso das respostas (thread-safe).
func (s *Server) SetDelay(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Delay = d
}

// RequestCount devolve quantas requisições chegaram (thread-safe).
func (s *Server) RequestCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Requests
}

func (s *Server) accept() {
	defer s.wg.Done()
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.conns[c] = struct{}{}
		s.mu.Unlock()
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			defer func() {
				s.mu.Lock()
				delete(s.conns, c)
				s.mu.Unlock()
				_ = c.Close()
			}()
			s.serve(c)
		}()
	}
}

func (s *Server) serve(c net.Conn) {
	for {
		var unit, fc byte
		var addr, qty uint16
		var txID uint16
		switch s.framing {
		case MBAP:
			hdr := make([]byte, 7)
			if _, err := io.ReadFull(c, hdr); err != nil {
				return
			}
			txID = binary.BigEndian.Uint16(hdr[0:])
			length := binary.BigEndian.Uint16(hdr[4:])
			unit = hdr[6]
			pdu := make([]byte, int(length)-1)
			if _, err := io.ReadFull(c, pdu); err != nil {
				return
			}
			if len(pdu) < 5 {
				return
			}
			fc, addr, qty = pdu[0], binary.BigEndian.Uint16(pdu[1:]), binary.BigEndian.Uint16(pdu[3:])
		case RTU:
			frame := make([]byte, 8)
			if _, err := io.ReadFull(c, frame); err != nil {
				return
			}
			if CRC16(frame[:6]) != binary.LittleEndian.Uint16(frame[6:]) {
				continue // CRC ruim: escravo real ficaria em silêncio
			}
			unit, fc = frame[0], frame[1]
			addr, qty = binary.BigEndian.Uint16(frame[2:]), binary.BigEndian.Uint16(frame[4:])
		}

		s.mu.Lock()
		s.Requests++
		delay := s.Delay
		respond := len(s.Units) == 0 || s.Units[unit]
		pdu := s.handle(fc, addr, qty)
		s.mu.Unlock()

		if !respond {
			continue
		}
		if delay > 0 {
			time.Sleep(delay)
		}
		var out []byte
		switch s.framing {
		case MBAP:
			out = make([]byte, 7, 7+len(pdu))
			binary.BigEndian.PutUint16(out[0:], txID)
			binary.BigEndian.PutUint16(out[4:], uint16(len(pdu)+1))
			out[6] = unit
			out = append(out, pdu...)
		case RTU:
			out = append([]byte{unit}, pdu...)
			out = binary.LittleEndian.AppendUint16(out, CRC16(out))
		}
		if _, err := c.Write(out); err != nil {
			return
		}
	}
}

// handle monta a PDU de resposta (ou de exceção). Chamado com s.mu travado.
func (s *Server) handle(fc byte, addr, qty uint16) []byte {
	exc := func(code byte) []byte { return []byte{fc | 0x80, code} }
	end := int(addr) + int(qty)
	switch fc {
	case 0x01, 0x02:
		bits := s.Coils
		if fc == 0x02 {
			bits = s.Discrete
		}
		if qty < 1 || qty > 2000 {
			return exc(3)
		}
		if end > len(bits) {
			return exc(2)
		}
		n := (int(qty) + 7) / 8
		out := make([]byte, 2+n)
		out[0], out[1] = fc, byte(n)
		for i := 0; i < int(qty); i++ {
			if bits[int(addr)+i] {
				out[2+i/8] |= 1 << (uint(i) % 8)
			}
		}
		return out
	case 0x03, 0x04:
		regs := s.Holding
		if fc == 0x04 {
			regs = s.Input
		}
		if qty < 1 || qty > 125 {
			return exc(3)
		}
		if end > len(regs) {
			return exc(2)
		}
		out := make([]byte, 2, 2+2*int(qty))
		out[0], out[1] = fc, byte(2*qty)
		for i := 0; i < int(qty); i++ {
			out = binary.BigEndian.AppendUint16(out, regs[int(addr)+i])
		}
		return out
	}
	return exc(1)
}

// CRC16 é o CRC Modbus (polinômio 0xA001, valor inicial 0xFFFF).
func CRC16(b []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, x := range b {
		crc ^= uint16(x)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
