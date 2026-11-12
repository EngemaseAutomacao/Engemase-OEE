package buffer_test

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
)

var t0 = time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)

func open(t *testing.T, path string) *buffer.Store {
	t.Helper()
	s, err := buffer.Open(path, buffer.Options{Now: func() time.Time { return t0 }})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func event(i int) buffer.Item {
	id := fmt.Sprintf("01a1cab1-cc5a-7af4-9800-%012d", i)
	ev := contracts.StateEvent{ID: id, Type: "state", At: contracts.FormatTime(t0), MachineID: "m", State: "RUNNING"}
	b, _ := json.Marshal(ev)
	return buffer.Item{Kind: buffer.KindEvent, ItemID: id, MachineID: "m", At: t0, Payload: b}
}

func minute(machine string, start time.Time) buffer.Item {
	m := contracts.Minute{MachineID: machine, T: contracts.FormatMinute(start), RunS: 60}
	b, _ := json.Marshal(m)
	return buffer.Item{Kind: buffer.KindMinute, ItemID: fmt.Sprintf("%s|%d", machine, start.UnixMilli()), MachineID: machine, At: start, Payload: b}
}

func TestEnqueuePeekAck(t *testing.T) {
	ctx := context.Background()
	s := open(t, filepath.Join(t.TempDir(), "buffer.db"))
	defer s.Close()

	var items []buffer.Item
	for i := 1; i <= 5; i++ {
		items = append(items, event(i))
	}
	seqs, err := s.Enqueue(ctx, items...)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(seqs); i++ {
		if seqs[i] != seqs[i-1]+1 {
			t.Fatalf("seq não monotônico: %v", seqs)
		}
	}

	batch, err := s.Peek(ctx, 3, 0)
	if err != nil || len(batch) != 3 || batch[0].Seq != seqs[0] || batch[2].Seq != seqs[2] {
		t.Fatalf("peek: %+v (%v)", batch, err)
	}
	var withSeq map[string]any
	if err := json.Unmarshal(batch[0].JSON(), &withSeq); err != nil || int64(withSeq["seq"].(float64)) != seqs[0] || withSeq["type"] != "state" {
		t.Fatalf("payload com seq: %s (%v)", batch[0].JSON(), err)
	}

	if err := s.Ack(ctx, batch[2].Seq); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Stats(ctx)
	if st.Pending != 2 || st.AckedSeq != seqs[2] || st.LastSeq != seqs[4] {
		t.Fatalf("stats: %+v", st)
	}
	// Ack atrasado (menor) não volta atrás.
	if err := s.Ack(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if st, _ := s.Stats(ctx); st.AckedSeq != seqs[2] {
		t.Fatalf("ack regrediu: %+v", st)
	}
	rest, _ := s.Peek(ctx, 100, 0)
	if len(rest) != 2 || rest[0].Seq != seqs[3] {
		t.Fatalf("resto: %+v", rest)
	}

	// Seq continua crescendo mesmo depois de apagar (AUTOINCREMENT).
	if err := s.Ack(ctx, seqs[4]); err != nil {
		t.Fatal(err)
	}
	more, _ := s.Enqueue(ctx, event(6))
	if more[0] <= seqs[4] {
		t.Fatalf("seq reutilizado: %d <= %d", more[0], seqs[4])
	}
}

func TestMinuteIsNeverEnqueuedTwice(t *testing.T) {
	ctx := context.Background()
	s := open(t, filepath.Join(t.TempDir(), "buffer.db"))
	defer s.Close()
	seqs, _ := s.Enqueue(ctx, minute("m1", t0))
	again, err := s.Enqueue(ctx, minute("m1", t0), minute("m2", t0))
	if err != nil {
		t.Fatal(err)
	}
	if seqs[0] == 0 || again[0] != 0 || again[1] == 0 {
		t.Fatalf("seqs: %v %v", seqs, again)
	}
	if st, _ := s.Stats(ctx); st.Pending != 2 {
		t.Fatalf("pendentes: %d", st.Pending)
	}
}

func TestPeekRespectsBytes(t *testing.T) {
	ctx := context.Background()
	s := open(t, filepath.Join(t.TempDir(), "buffer.db"))
	defer s.Close()
	for i := 1; i <= 10; i++ {
		if _, err := s.Enqueue(ctx, event(i)); err != nil {
			t.Fatal(err)
		}
	}
	one := len(event(1).Payload) + 16
	batch, _ := s.Peek(ctx, 100, 3*one)
	if len(batch) != 3 {
		t.Fatalf("lote com limite de bytes: %d itens", len(batch))
	}
	batch, _ = s.Peek(ctx, 100, 1) // sempre ao menos 1
	if len(batch) != 1 {
		t.Fatalf("lote mínimo: %d", len(batch))
	}
}

func TestQuarantineDoesNotBlockQueue(t *testing.T) {
	ctx := context.Background()
	s := open(t, filepath.Join(t.TempDir(), "buffer.db"))
	defer s.Close()
	seqs, _ := s.Enqueue(ctx, event(1), event(2), event(3))
	if err := s.Quarantine(ctx, seqs[1], "400 invalid_payload"); err != nil {
		t.Fatal(err)
	}
	batch, _ := s.Peek(ctx, 10, 0)
	if len(batch) != 2 || batch[0].Seq != seqs[0] || batch[1].Seq != seqs[2] {
		t.Fatalf("lote sem o item em quarentena: %+v", batch)
	}
	_ = s.Ack(ctx, seqs[2])
	if st, _ := s.Stats(ctx); st.Pending != 0 || st.Quarantined != 1 {
		t.Fatalf("stats: %+v", st)
	}
}

// Minutos e contadores na mesma transação, e tudo sobrevive a reabrir o arquivo.
func TestCountersAndConfigPersistAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "buffer.db")
	s := open(t, path)
	out := engine.Output{
		Records: []engine.Record{{Kind: engine.KindMinute, ItemID: "m1|1", MachineID: "m1", At: t0,
			Payload: contracts.Minute{MachineID: "m1", T: contracts.FormatMinute(t0), RunS: 60, Total: 12}}},
		Counters: []engine.CounterState{{TagID: "tag1", MachineID: "m1", Role: "count.total", Bits: 32, AddrKey: "k", LastRaw: 4294967295, LastAt: t0}},
	}
	w, err := buffer.FromEngine(out)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Commit(ctx, w); err != nil {
		t.Fatal(err)
	}
	// Atualiza o mesmo contador.
	out.Counters[0].LastRaw = 7
	w, _ = buffer.FromEngine(engine.Output{Counters: out.Counters})
	if _, err := s.Commit(ctx, w); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveConfig(ctx, 42, []byte(`{"config_version":42}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveConfig(ctx, 43, []byte(`{"config_version":43}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s = open(t, path)
	defer s.Close()
	cs, err := s.LoadCounters(ctx)
	if err != nil || len(cs) != 1 || cs[0].LastRaw != 7 || !cs[0].LastAt.Equal(t0) || cs[0].Bits != 32 {
		t.Fatalf("contadores: %+v (%v)", cs, err)
	}
	v, body, err := s.LoadConfig(ctx, "current")
	if err != nil || v != 43 || string(body) != `{"config_version":43}` {
		t.Fatalf("config atual: %d %s (%v)", v, body, err)
	}
	if v, _, _ := s.LoadConfig(ctx, "previous"); v != 42 {
		t.Fatalf("config anterior: %d", v)
	}
	if st, _ := s.Stats(ctx); st.Pending != 1 {
		t.Fatalf("pendentes depois de reabrir: %d", st.Pending)
	}
}

func TestEmptyStoreHasNoConfig(t *testing.T) {
	s := open(t, filepath.Join(t.TempDir(), "x", "buffer.db"))
	defer s.Close()
	if _, _, err := s.LoadConfig(context.Background(), "current"); err != buffer.ErrNoConfig {
		t.Fatalf("esperava ErrNoConfig, veio %v", err)
	}
	if _, err := s.Enqueue(context.Background(), buffer.Item{Kind: "outro", ItemID: "x", Payload: []byte(`{}`)}); err == nil {
		t.Fatal("kind inválido deveria falhar")
	}
	if _, err := s.Enqueue(context.Background(), buffer.Item{Kind: buffer.KindEvent, ItemID: "x", Payload: []byte(`{`)}); err == nil {
		t.Fatal("payload inválido deveria falhar")
	}
}

func TestDurabilityPragmas(t *testing.T) {
	s := open(t, filepath.Join(t.TempDir(), "buffer.db"))
	defer s.Close()
	mode, sync, err := s.Pragmas(context.Background())
	if err != nil || mode != "wal" || sync != 2 { // 2 = FULL
		t.Fatalf("journal_mode=%s synchronous=%d (%v)", mode, sync, err)
	}
}
