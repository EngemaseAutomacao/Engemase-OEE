// Package buffer é o armazenamento local do agente: um único arquivo SQLite (driver
// Go puro modernc.org/sqlite, sem cgo) em modo WAL com synchronous=FULL, contendo a
// outbox de eventos e minutos (seq monotônico), o estado dos contadores (gravado na
// MESMA transação dos minutos), a config remota atual/anterior e metadados.
//
// Por que tudo num arquivo só: em WAL, uma transação com bancos anexados não é
// atômica entre arquivos, e o invariante "minuto + contador juntos" exige atomicidade.
package buffer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // driver "sqlite"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/engine"
)

// schemaVersion é a versão do esquema deste agente (PRAGMA user_version): uma por
// migração (ver migrations; as colunas de additions não contam).
const schemaVersion = len(migrations)

// Kinds da outbox principal.
const (
	KindEvent  = engine.KindEvent
	KindMinute = engine.KindMinute
)

// migrations levam o esquema da versão i à i+1 (índice i), cada uma numa transação
// junto com o user_version: um buffer.db gravado por um agente anterior (gateways já
// instalados) passa, ao abrir, só pelas que faltam, e as linhas existentes ficam.
// Migração que já saiu nunca muda.
//
// Um agente anterior recusa abrir um buffer de user_version mais novo (init), e o
// rollback do OTA reinstala justamente ele (sem /sync em 5 min, o oee-updater volta
// ao .deb anterior: deploy/gateway/systemd/oee-gateway-updater.service): depois de
// uma migração nova, o agente revertido não abre o buffer, o systemd o reinicia sem
// fim e o gateway fica sem coleta e sem OTA. Por isso mudança que um agente anterior
// consegue ignorar entra em additions, sem subir o user_version. Migração nova só
// para o que ele não consegue ignorar, e só depois de o atualizador recusar o
// rollback para um pacote de esquema mais velho.
var migrations = [...]string{
	// v1
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

	CREATE TABLE IF NOT EXISTS outbox_core (
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
	CREATE INDEX IF NOT EXISTS outbox_core_pending ON outbox_core(quarantine, seq);

	CREATE TABLE IF NOT EXISTS uplink_state (
		id               INTEGER PRIMARY KEY CHECK (id = 1),
		acked_core_seq   INTEGER NOT NULL DEFAULT 0,
		last_sync_ok_ms  INTEGER,
		server_offset_ms INTEGER,
		updated_ms       INTEGER NOT NULL
	) STRICT;

	CREATE TABLE IF NOT EXISTS counter_state (
		tag_id      TEXT PRIMARY KEY,
		machine_id  TEXT    NOT NULL,
		role        TEXT    NOT NULL,
		bits        INTEGER NOT NULL,
		addr_key    TEXT    NOT NULL,
		last_raw    INTEGER NOT NULL,
		last_raw_ms INTEGER NOT NULL,
		updated_ms  INTEGER NOT NULL
	) STRICT;

	CREATE TABLE IF NOT EXISTS config (
		slot        TEXT PRIMARY KEY CHECK (slot IN ('current','previous')),
		version     INTEGER NOT NULL,
		body        BLOB    NOT NULL,
		received_ms INTEGER NOT NULL
	) STRICT;`,
}

// additions são colunas acrescentadas sem subir o user_version, a cada abertura em
// que faltam (numa transação): um agente anterior do mesmo user_version continua
// abrindo o buffer (rollback do OTA), porque as ignora (lista as colunas que lê e
// grava, e o DEFAULT preenche as linhas que ele insere). Ele também não as atualiza:
// uma coluna cujo valor velho, sob uma linha regravada por ele, contaria errado
// precisa de um carimbo que mostre isso (carry_ms). Coluna que já saiu nunca muda.
var additions = [...]struct{ table, column, decl string }{
	// Carry do checkpoint de contador (engine.CounterState: peças já contadas num
	// minuto ainda aberto antes de um reset, salto ou nova base, que a base gravada
	// não cobre). Sem ele, um reinício depois de um reset no minuto aberto perdia
	// essas peças. As linhas existentes ficam com 0: base ao fim de um minuto fechado.
	{"counter_state", "carry", "INTEGER NOT NULL DEFAULT 0"},
	// carry_ms é o updated_ms da gravação que escreveu carry. Um agente anterior
	// regrava a linha (base nova, updated_ms novo) sem tocar no carry: com carry_ms
	// diferente do updated_ms, o carry é de uma base que já não vale e conta 0
	// (somá-lo de novo contaria as mesmas peças duas vezes depois de voltar à versão
	// nova).
	{"counter_state", "carry_ms", "INTEGER NOT NULL DEFAULT 0"},
}

// Item é uma linha da outbox principal.
type Item struct {
	Seq       int64
	Kind      string // event | minute
	ItemID    string // UUIDv7 do evento | "machine_id|bucket_ms"
	MachineID string
	At        time.Time
	Payload   json.RawMessage // JSON no formato do contrato, SEM seq
}

// JSON devolve o payload com o seq injetado, pronto para o /sync.
func (it Item) JSON() json.RawMessage { return contracts.WithSeq(it.Payload, it.Seq) }

// Store é o banco local.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Options configura Open.
type Options struct {
	// Now é o relógio (nil = time.Now), injetável em testes.
	Now func() time.Time
}

// Open abre (ou cria) o banco, aplica as migrações e confere a integridade.
func Open(path string, opts Options) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("criando diretório do buffer: %w", err)
	}
	q := url.Values{}
	for _, p := range []string{
		"journal_mode(WAL)",
		"synchronous(FULL)", // NORMAL em WAL arrisca desfazer o último commit numa queda de energia → dupla contagem
		"busy_timeout(5000)",
		"foreign_keys(ON)",
		"temp_store(MEMORY)",
		"journal_size_limit(67108864)",
	} {
		q.Add("_pragma", p)
	}
	q.Set("_txlock", "immediate")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	// Uma conexão só: um gravador, sem disputa de lock. (Leitores em paralelo: futuro.)
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: opts.Now}
	if s.now == nil {
		s.now = time.Now
	}
	if err := s.init(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) init(ctx context.Context) error {
	var check string
	if err := s.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); err != nil {
		return fmt.Errorf("buffer: verificação de integridade falhou: %w", err)
	}
	if check != "ok" {
		return fmt.Errorf("buffer: banco corrompido (%s)", check)
	}
	var mode string
	if err := s.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		return fmt.Errorf("buffer: journal_mode = %q (esperado wal): %v", mode, err)
	}
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > schemaVersion {
		return fmt.Errorf("buffer: esquema v%d é mais novo que este agente (v%d)", version, schemaVersion)
	}
	for v := version; v < schemaVersion; v++ {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[v]); err != nil {
			tx.Rollback()
			return fmt.Errorf("buffer: migração v%d: %w", v+1, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	if err := s.addColumns(ctx); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO uplink_state (id, acked_core_seq, updated_ms) VALUES (1, 0, ?) ON CONFLICT(id) DO NOTHING`, s.nowMS())
	return err
}

// addColumns acrescenta as colunas de additions que faltam, numa transação.
func (s *Store) addColumns(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, a := range additions {
		var n int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, a.table, a.column).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, "ALTER TABLE "+a.table+" ADD COLUMN "+a.column+" "+a.decl); err != nil {
			return fmt.Errorf("buffer: acrescentando %s.%s: %w", a.table, a.column, err)
		}
	}
	return tx.Commit()
}

// Close fecha o banco (com checkpoint do WAL).
func (s *Store) Close() error {
	_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return s.db.Close()
}

func (s *Store) nowMS() int64 { return s.now().UnixMilli() }

// Write é tudo o que vai numa transação.
type Write struct {
	Items    []Item
	Counters []engine.CounterState
	Meta     map[string]string
}

// Commit grava itens, contadores e metadados numa única transação. Itens repetidos
// (mesmo kind + item_id) são ignorados: um minuto nunca é enfileirado duas vezes.
// Devolve os seqs atribuídos (0 para item ignorado).
func (s *Store) Commit(ctx context.Context, w Write) ([]int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := s.nowMS()
	seqs := make([]int64, len(w.Items))
	for i, it := range w.Items {
		if it.Kind != KindEvent && it.Kind != KindMinute {
			return nil, fmt.Errorf("buffer: kind inválido %q", it.Kind)
		}
		if !json.Valid(it.Payload) {
			return nil, fmt.Errorf("buffer: payload de %s %s não é JSON válido", it.Kind, it.ItemID)
		}
		res, err := tx.ExecContext(ctx,
			`INSERT INTO outbox_core (kind, item_id, machine_id, at_ms, payload, bytes, created_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (kind, item_id) DO NOTHING`,
			it.Kind, it.ItemID, nullable(it.MachineID), it.At.UnixMilli(), []byte(it.Payload), len(it.Payload), now)
		if err != nil {
			return nil, fmt.Errorf("buffer: gravando %s: %w", it.Kind, err)
		}
		if n, _ := res.RowsAffected(); n == 1 {
			seqs[i], _ = res.LastInsertId()
		}
	}
	for _, c := range w.Counters {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO counter_state (tag_id, machine_id, role, bits, addr_key, last_raw, last_raw_ms, carry, carry_ms, updated_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
			 ON CONFLICT (tag_id) DO UPDATE SET machine_id=excluded.machine_id, role=excluded.role, bits=excluded.bits,
			   addr_key=excluded.addr_key, last_raw=excluded.last_raw, last_raw_ms=excluded.last_raw_ms, carry=excluded.carry,
			   carry_ms=excluded.carry_ms, updated_ms=excluded.updated_ms`,
			c.TagID, c.MachineID, c.Role, c.Bits, c.AddrKey, int64(c.LastRaw), c.LastAt.UnixMilli(), c.Carry, now); err != nil {
			return nil, fmt.Errorf("buffer: gravando contador: %w", err)
		}
	}
	for k, v := range w.Meta {
		if _, err := tx.ExecContext(ctx, `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return seqs, nil
}

// Enqueue grava itens (atalho para Commit só com itens).
func (s *Store) Enqueue(ctx context.Context, items ...Item) ([]int64, error) {
	return s.Commit(ctx, Write{Items: items})
}

// Peek devolve o próximo lote: itens pendentes (não confirmados, fora da quarentena)
// em ordem de seq, até maxItems e até maxBytes de payload (sempre ao menos 1 item).
func (s *Store) Peek(ctx context.Context, maxItems, maxBytes int) ([]Item, error) {
	if maxItems < 1 {
		maxItems = 1
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT seq, kind, item_id, COALESCE(machine_id, ''), at_ms, payload FROM outbox_core
		 WHERE quarantine = 0 AND seq > (SELECT acked_core_seq FROM uplink_state WHERE id = 1)
		 ORDER BY seq LIMIT ?`, maxItems)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	total := 0
	for rows.Next() {
		var it Item
		var atMS int64
		var payload []byte
		if err := rows.Scan(&it.Seq, &it.Kind, &it.ItemID, &it.MachineID, &atMS, &payload); err != nil {
			return nil, err
		}
		if maxBytes > 0 && len(out) > 0 && total+len(payload)+16 > maxBytes {
			break
		}
		total += len(payload) + 16 // + "seq" e vírgula
		it.At = time.UnixMilli(atMS).UTC()
		it.Payload = payload
		out = append(out, it)
	}
	return out, rows.Err()
}

// Ack confirma tudo até seq (inclusive): grava o ack e apaga os itens confirmados.
// Um ack menor que o atual é ignorado (respostas atrasadas).
func (s *Store) Ack(ctx context.Context, seq int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := s.nowMS()
	if _, err := tx.ExecContext(ctx,
		`UPDATE uplink_state SET acked_core_seq = MAX(acked_core_seq, ?), last_sync_ok_ms = ?, updated_ms = ? WHERE id = 1`,
		seq, now, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbox_core WHERE quarantine = 0 AND seq <= ?`, seq); err != nil {
		return err
	}
	return tx.Commit()
}

// Quarantine tira um item da fila principal (recusado com 400 depois da bisseção).
// Ele fica registrado para diagnóstico e não trava a fila.
func (s *Store) Quarantine(ctx context.Context, seq int64, reason string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE outbox_core SET quarantine = 1, error = ? WHERE seq = ?`, reason, seq)
	return err
}

// Stats resume a fila.
type Stats struct {
	Pending     int64
	Quarantined int64
	AckedSeq    int64
	LastSeq     int64
	Oldest      time.Time // criação do item pendente mais antigo (zero se vazio)
}

// Stats devolve o estado da fila.
func (s *Store) Stats(ctx context.Context) (Stats, error) {
	var st Stats
	var oldest sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM outbox_core WHERE quarantine = 0 AND seq > u.acked_core_seq),
		  (SELECT COUNT(*) FROM outbox_core WHERE quarantine = 1),
		  u.acked_core_seq,
		  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'outbox_core'), 0),
		  (SELECT MIN(created_ms) FROM outbox_core WHERE quarantine = 0 AND seq > u.acked_core_seq)
		FROM uplink_state u WHERE u.id = 1`).Scan(&st.Pending, &st.Quarantined, &st.AckedSeq, &st.LastSeq, &oldest)
	if err != nil {
		return st, err
	}
	if oldest.Valid {
		st.Oldest = time.UnixMilli(oldest.Int64).UTC()
	}
	return st, nil
}

// LoadCounters devolve os contadores persistidos, com o Carry de um checkpoint (0 se
// a linha foi regravada depois por um agente anterior: ver carry_ms em additions).
func (s *Store) LoadCounters(ctx context.Context) ([]engine.CounterState, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT tag_id, machine_id, role, bits, addr_key, last_raw, last_raw_ms,
		   CASE WHEN carry_ms = updated_ms THEN carry ELSE 0 END
		 FROM counter_state ORDER BY tag_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []engine.CounterState
	for rows.Next() {
		var c engine.CounterState
		var raw, ms int64
		if err := rows.Scan(&c.TagID, &c.MachineID, &c.Role, &c.Bits, &c.AddrKey, &raw, &ms, &c.Carry); err != nil {
			return nil, err
		}
		c.LastRaw, c.LastAt = uint32(raw), time.UnixMilli(ms).UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}

// SaveConfig grava a config aplicada como "current" e move a anterior para "previous".
func (s *Store) SaveConfig(ctx context.Context, version int, body []byte) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM config WHERE slot = 'previous'`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE config SET slot = 'previous' WHERE slot = 'current' AND version <> ?`, version); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO config (slot, version, body, received_ms) VALUES ('current', ?, ?, ?)
		 ON CONFLICT(slot) DO UPDATE SET version=excluded.version, body=excluded.body, received_ms=excluded.received_ms`,
		version, body, s.nowMS()); err != nil {
		return err
	}
	return tx.Commit()
}

// ErrNoConfig indica que ainda não há config salva.
var ErrNoConfig = errors.New("buffer: nenhuma config salva")

// LoadConfig devolve a config do slot ("current" ou "previous").
func (s *Store) LoadConfig(ctx context.Context, slot string) (int, []byte, error) {
	var version int
	var body []byte
	err := s.db.QueryRowContext(ctx, `SELECT version, body FROM config WHERE slot = ?`, slot).Scan(&version, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil, ErrNoConfig
	}
	return version, body, err
}

// SetServerOffset guarda a diferença de relógio para o servidor (ms).
func (s *Store) SetServerOffset(ctx context.Context, offsetMS int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE uplink_state SET server_offset_ms = ?, updated_ms = ? WHERE id = 1`, offsetMS, s.nowMS())
	return err
}

// Meta lê um metadado ("" se ausente).
func (s *Store) Meta(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// FromEngine converte a saída do motor numa Write (minutos e contadores juntos).
func FromEngine(out engine.Output) (Write, error) {
	w := Write{Counters: out.Counters}
	for _, r := range out.Records {
		b, err := json.Marshal(r.Payload)
		if err != nil {
			return Write{}, fmt.Errorf("buffer: serializando %s: %w", r.Kind, err)
		}
		w.Items = append(w.Items, Item{Kind: r.Kind, ItemID: r.ItemID, MachineID: r.MachineID, At: r.At, Payload: b})
	}
	return w, nil
}

// Pragmas devolve os pragmas que garantem a durabilidade (para diagnóstico).
func (s *Store) Pragmas(ctx context.Context) (journalMode string, synchronous int, err error) {
	if err = s.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		return
	}
	err = s.db.QueryRowContext(ctx, "PRAGMA synchronous").Scan(&synchronous)
	return
}
