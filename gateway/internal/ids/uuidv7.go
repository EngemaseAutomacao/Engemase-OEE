// Package ids gera UUIDv7 (RFC 9562) a partir de um instante dado, para que os
// testes sejam determinísticos (relógio e fonte aleatória injetáveis).
package ids

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"sync"
	"time"
)

// Generator gera UUIDv7 monotônicos: dentro do mesmo milissegundo, os 12 bits de
// rand_a viram contador (método 1 da RFC 9562 §6.2), então ids gerados em sequência
// ficam em ordem.
type Generator struct {
	mu     sync.Mutex
	rand   io.Reader
	lastMS int64
	seq    uint16
}

// NewGenerator cria um gerador. rand = nil usa crypto/rand.
func NewGenerator(r io.Reader) *Generator {
	if r == nil {
		r = rand.Reader
	}
	return &Generator{rand: r}
}

// New gera um UUIDv7 com o timestamp t.
func (g *Generator) New(t time.Time) string {
	g.mu.Lock()
	defer g.mu.Unlock()

	ms := t.UnixMilli()
	if ms < 0 {
		ms = 0
	}
	var b [16]byte
	if _, err := io.ReadFull(g.rand, b[6:]); err != nil {
		panic("ids: fonte aleatória falhou: " + err.Error())
	}
	if ms <= g.lastMS {
		// Mesmo milissegundo (ou relógio voltou): mantém o tempo e incrementa o contador.
		ms = g.lastMS
		g.seq++
		if g.seq > 0x0FFF { // contador estourou: avança 1 ms artificialmente
			ms++
			g.seq = 0
		}
	} else {
		g.seq = uint16(b[6]&0x07)<<8 | uint16(b[7]) // começa baixo para sobrar espaço
	}
	g.lastMS = ms

	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	b[6] = 0x70 | byte(g.seq>>8)&0x0F // versão 7 + 4 bits altos do contador
	b[7] = byte(g.seq)
	b[8] = b[8]&0x3F | 0x80 // variante 10xx

	return format(b)
}

func format(b [16]byte) string {
	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out[:])
}

var defaultGen = NewGenerator(nil)

// NewV7 gera um UUIDv7 com o gerador padrão (crypto/rand).
func NewV7(t time.Time) string { return defaultGen.New(t) }
