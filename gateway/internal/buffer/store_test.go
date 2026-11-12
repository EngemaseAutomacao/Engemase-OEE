package buffer_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
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

// v1Schema é o esquema que o agente gravava antes das colunas carry e carry_ms (cópia
// congelada da migração v1): o buffer.db dos gateways já instalados.
const v1Schema = `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE outbox_core (
	seq        INTEGER PRIMARY KEY AUTOINCREMENT,
	kind       TEXT    NOT NULL CHECK (kind IN ('event','minute')),
	item_id    TEXT    NOT NULL,
	machine_id TEXT,
	at_ms      INTEGER NOT NULL,
	payload    BLOB    NOT NULL,
	bytes      INTEGER NOT NULL,
	created_ms INTEGER NOT NULL,
	quarantine INTEGER NOT NULL DEFAULT 0,
	error      TEXT,
	UNIQUE (kind, item_id)
) STRICT;
CREATE INDEX outbox_core_pending ON outbox_core(quarantine, seq);
CREATE TABLE uplink_state (
	id               INTEGER PRIMARY KEY CHECK (id = 1),
	acked_core_seq   INTEGER NOT NULL DEFAULT 0,
	last_sync_ok_ms  INTEGER,
	server_offset_ms INTEGER,
	updated_ms       INTEGER NOT NULL
) STRICT;
CREATE TABLE counter_state (
	tag_id      TEXT PRIMARY KEY,
	machine_id  TEXT    NOT NULL,
	role        TEXT    NOT NULL,
	bits        INTEGER NOT NULL,
	addr_key    TEXT    NOT NULL,
	last_raw    INTEGER NOT NULL,
	last_raw_ms INTEGER NOT NULL,
	updated_ms  INTEGER NOT NULL
) STRICT;
CREATE TABLE config (
	slot        TEXT PRIMARY KEY CHECK (slot IN ('current','previous')),
	version     INTEGER NOT NULL,
	body        BLOB    NOT NULL,
	received_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version = 1;`

// rawDB abre o arquivo sem o Store (para montar um buffer antigo ou inspecionar o esquema).
func rawDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	return db
}

// schemaOf devolve o user_version e as colunas de counter_state.
func schemaOf(t *testing.T, path string) (int, []string) {
	t.Helper()
	db := rawDB(t, path)
	defer db.Close()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT name FROM pragma_table_info('counter_state') ORDER BY cid`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	return version, cols
}

// Um buffer.db gravado pelo agente anterior (esquema v1, sem carry) ganha as colunas
// ao abrir, com 0, sem subir o user_version, e nada do que já estava lá se perde
// (outbox com os seqs, ack, contadores, config e metadados). Reabrir não as
// acrescenta de novo.
func TestOpenMigratesV1BufferKeepingRows(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "buffer.db")
	db := rawDB(t, path)
	ev := event(1)
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{v1Schema, nil},
		{`INSERT INTO meta (key, value) VALUES ('clean_shutdown', '1')`, nil},
		{`INSERT INTO outbox_core (seq, kind, item_id, machine_id, at_ms, payload, bytes, created_ms) VALUES (41, 'event', ?, 'm', ?, ?, ?, ?)`,
			[]any{ev.ItemID, t0.UnixMilli(), []byte(ev.Payload), len(ev.Payload), t0.UnixMilli()}},
		{`INSERT INTO uplink_state (id, acked_core_seq, updated_ms) VALUES (1, 40, ?)`, []any{t0.UnixMilli()}},
		{`INSERT INTO counter_state (tag_id, machine_id, role, bits, addr_key, last_raw, last_raw_ms, updated_ms)
		  VALUES ('tag1', 'm1', 'count.total', 32, 'k', 4294967295, ?, ?)`, []any{t0.UnixMilli(), t0.UnixMilli()}},
		{`INSERT INTO config (slot, version, body, received_ms) VALUES ('current', 7, ?, ?)`, []any{[]byte(`{"config_version":7}`), t0.UnixMilli()}},
	} {
		if _, err := db.Exec(q.sql, q.args...); err != nil {
			t.Fatalf("montando o buffer v1: %v", err)
		}
	}
	db.Close()
	if v, cols := schemaOf(t, path); v != 1 || slices.Contains(cols, "carry") {
		t.Fatalf("buffer v1 mal montado: v%d %v", v, cols)
	}

	s := open(t, path)
	want := engine.CounterState{TagID: "tag1", MachineID: "m1", Role: "count.total", Bits: 32, AddrKey: "k", LastRaw: 4294967295, LastAt: t0}
	if cs, err := s.LoadCounters(ctx); err != nil || len(cs) != 1 || cs[0] != want {
		t.Fatalf("contadores depois da migração: %+v (%v)", cs, err)
	}
	items, err := s.Peek(ctx, 10, 0)
	if err != nil || len(items) != 1 || items[0].Seq != 41 || items[0].ItemID != ev.ItemID || string(items[0].Payload) != string(ev.Payload) {
		t.Fatalf("outbox depois da migração: %+v (%v)", items, err)
	}
	if st, err := s.Stats(ctx); err != nil || st.AckedSeq != 40 || st.LastSeq != 41 || st.Pending != 1 {
		t.Fatalf("stats depois da migração: %+v (%v)", st, err)
	}
	if v, body, err := s.LoadConfig(ctx, "current"); err != nil || v != 7 || string(body) != `{"config_version":7}` {
		t.Fatalf("config depois da migração: %d %s (%v)", v, body, err)
	}
	if v, err := s.Meta(ctx, "clean_shutdown"); err != nil || v != "1" {
		t.Fatalf("meta depois da migração: %q (%v)", v, err)
	}
	// O seq continua de onde estava (AUTOINCREMENT preservado).
	if seqs, err := s.Enqueue(ctx, event(2)); err != nil || seqs[0] != 42 {
		t.Fatalf("seq depois da migração: %v (%v)", seqs, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if v, cols := schemaOf(t, path); v != 1 || !slices.Contains(cols, "carry") || !slices.Contains(cols, "carry_ms") {
		t.Fatalf("depois de abrir: esquema v%d, colunas %v", v, cols)
	}

	s = open(t, path) // as colunas já estão lá: abre sem acrescentá-las de novo
	defer s.Close()
	if cs, err := s.LoadCounters(ctx); err != nil || len(cs) != 1 || cs[0] != want {
		t.Fatalf("contadores ao reabrir: %+v (%v)", cs, err)
	}
}

// Um esquema mais novo que o deste agente (buffer gravado por uma versão posterior)
// não é aberto: gravar nele sem conhecer as colunas novas as deixaria velhas.
func TestOpenRefusesNewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "buffer.db")
	open(t, path).Close()
	db := rawDB(t, path)
	if _, err := db.Exec(`PRAGMA user_version = 99`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if s, err := buffer.Open(path, buffer.Options{}); err == nil {
		s.Close()
		t.Fatal("abriu um buffer de esquema mais novo")
	}
}

// O Carry de um checkpoint (reset no minuto aberto) vai e volta pelo buffer, inclusive
// depois de reabrir, e o estado seguinte (minuto fechado, Carry 0) o substitui: um
// Carry velho somaria as mesmas peças de novo na próxima partida.
func TestCounterCarryRoundTrips(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "buffer.db")
	s := open(t, path)
	ck := engine.CounterState{TagID: "tag1", MachineID: "m1", Role: "count.total", Bits: 32, AddrKey: "k", LastRaw: 0, LastAt: t0, Carry: 13}
	other := engine.CounterState{TagID: "tag2", MachineID: "m1", Role: "count.reject", Bits: 16, AddrKey: "k2", LastRaw: 9, LastAt: t0}
	if _, err := s.Commit(ctx, buffer.Write{Counters: []engine.CounterState{ck, other}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = open(t, path)
	defer s.Close()
	cs, err := s.LoadCounters(ctx)
	if err != nil || len(cs) != 2 || cs[0] != ck || cs[1] != other {
		t.Fatalf("contadores depois de reabrir: %+v (%v)", cs, err)
	}

	closed := ck
	closed.LastRaw, closed.LastAt, closed.Carry = 25, t0.Add(time.Minute), 0
	if _, err := s.Commit(ctx, buffer.Write{Counters: []engine.CounterState{closed}}); err != nil {
		t.Fatal(err)
	}
	if cs, err := s.LoadCounters(ctx); err != nil || len(cs) != 2 || cs[0] != closed {
		t.Fatalf("minuto fechado depois do checkpoint: %+v (%v)", cs, err)
	}
}

// SQL do agente anterior às colunas carry e carry_ms (cópias congeladas): o que ele
// faz com counter_state depois de um rollback do OTA.
const (
	v1MaxSchema     = 1 // ele recusa um user_version maior
	v1UpsertCounter = `INSERT INTO counter_state (tag_id, machine_id, role, bits, addr_key, last_raw, last_raw_ms, updated_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (tag_id) DO UPDATE SET machine_id=excluded.machine_id, role=excluded.role, bits=excluded.bits,
			   addr_key=excluded.addr_key, last_raw=excluded.last_raw, last_raw_ms=excluded.last_raw_ms, updated_ms=excluded.updated_ms`
	v1LoadCounters = `SELECT tag_id, machine_id, role, bits, addr_key, last_raw, last_raw_ms FROM counter_state ORDER BY tag_id`
)

// Rollback do OTA depois de este agente abrir o buffer: o oee-updater reinstala o
// agente anterior, que tem de continuar abrindo o buffer (user_version que ele aceita)
// e lendo e gravando os contadores. Ele regrava a base sem tocar no carry: de volta à
// versão nova, o carry dessa linha é velho (as peças dele já foram contadas ou
// perdidas pelo agente anterior) e conta 0; o de uma linha que ele não regravou vale.
func TestOlderAgentKeepsBufferAfterRollback(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "buffer.db")
	s := open(t, path)
	rewritten := engine.CounterState{TagID: "tag1", MachineID: "m1", Role: "count.total", Bits: 32, AddrKey: "k", LastRaw: 0, LastAt: t0, Carry: 13}
	untouched := engine.CounterState{TagID: "tag2", MachineID: "m1", Role: "count.reject", Bits: 16, AddrKey: "k2", LastRaw: 4, LastAt: t0, Carry: 7}
	if _, err := s.Commit(ctx, buffer.Write{Counters: []engine.CounterState{rewritten, untouched}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	// O agente anterior abre o buffer, lê os contadores e fecha um minuto de tag1
	// (base nova) e o primeiro de uma tag nova.
	if v, _ := schemaOf(t, path); v > v1MaxSchema {
		t.Fatalf("user_version %d: o agente anterior (até v%d) recusaria o buffer e o rollback deixaria o gateway sem agente", v, v1MaxSchema)
	}
	db := rawDB(t, path)
	rows, err := db.Query(v1LoadCounters)
	if err != nil {
		t.Fatalf("agente anterior lendo os contadores: %v", err)
	}
	n := 0
	for rows.Next() {
		n++
	}
	if err := rows.Close(); err != nil || n != 2 {
		t.Fatalf("agente anterior leu %d contadores (%v)", n, err)
	}
	later := t0.Add(5 * time.Minute)
	for _, c := range []engine.CounterState{
		{TagID: "tag1", MachineID: "m1", Role: "count.total", Bits: 32, AddrKey: "k", LastRaw: 40, LastAt: later},
		{TagID: "tag3", MachineID: "m1", Role: "count.good", Bits: 32, AddrKey: "k3", LastRaw: 9, LastAt: later},
	} {
		if _, err := db.Exec(v1UpsertCounter, c.TagID, c.MachineID, c.Role, c.Bits, c.AddrKey, int64(c.LastRaw), c.LastAt.UnixMilli(), later.UnixMilli()); err != nil {
			t.Fatalf("agente anterior gravando o contador %s: %v", c.TagID, err)
		}
	}
	db.Close()

	// De volta à versão nova.
	s = open(t, path)
	defer s.Close()
	cs, err := s.LoadCounters(ctx)
	if err != nil || len(cs) != 3 {
		t.Fatalf("contadores depois do rollback: %+v (%v)", cs, err)
	}
	if cs[0].TagID != "tag1" || cs[0].LastRaw != 40 || cs[0].Carry != 0 {
		t.Fatalf("tag1 regravada pelo agente anterior: %+v; quer base 40 e Carry 0 (o 13 já não vale)", cs[0])
	}
	if cs[1] != untouched {
		t.Fatalf("tag2 sem regravação: %+v; quer %+v", cs[1], untouched)
	}
	if cs[2].TagID != "tag3" || cs[2].LastRaw != 9 || cs[2].Carry != 0 {
		t.Fatalf("tag3 criada pelo agente anterior: %+v", cs[2])
	}
}
