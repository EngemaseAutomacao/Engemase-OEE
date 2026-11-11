package ids

import (
	"bytes"
	"regexp"
	"testing"
	"time"
)

// Mesmo padrão do contrato (z.uuidv7 do Zod).
var v7 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestFormatAndTimestamp(t *testing.T) {
	g := NewGenerator(bytes.NewReader(bytes.Repeat([]byte{0xAB}, 1000)))
	at := time.Date(2026, 11, 11, 13, 2, 5, 120_000_000, time.UTC)
	id := g.New(at)
	if !v7.MatchString(id) {
		t.Fatalf("id %q não é UUIDv7", id)
	}
	// Os 48 bits iniciais são o Unix ms.
	want := at.UnixMilli()
	var got int64
	for _, c := range id[0:8] + id[9:13] {
		got = got<<4 | int64(hexVal(byte(c)))
	}
	if got != want {
		t.Fatalf("timestamp = %d, quer %d", got, want)
	}
}

func TestMonotonicWithinSameMillisecond(t *testing.T) {
	g := NewGenerator(nil)
	at := time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	prev := ""
	for i := 0; i < 5000; i++ { // passa do contador de 12 bits
		id := g.New(at)
		if !v7.MatchString(id) {
			t.Fatalf("id %q inválido", id)
		}
		if id <= prev {
			t.Fatalf("ids fora de ordem: %s depois de %s", id, prev)
		}
		prev = id
	}
	// Relógio voltando não gera id menor.
	if id := g.New(at.Add(-time.Hour)); id <= prev {
		t.Fatalf("relógio voltou e o id regrediu: %s <= %s", id, prev)
	}
}

func hexVal(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	default:
		return c - 'a' + 10
	}
}
