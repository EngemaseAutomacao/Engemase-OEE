package buffer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
)

// SchemaVersion é a versão do esquema do buffer deste agente (PRAGMA user_version).
// Vai no manifesto do pacote (buffer_schema, ver internal/update): o atualizador
// recusa o rollback automático para um pacote de esquema anterior ao do buffer.db,
// que o agente revertido não abriria (lacuna L25, docs/17).
const SchemaVersion = schemaVersion

// FileSchemaVersion lê o user_version de um buffer.db sem alterá-lo (somente
// leitura, sem migrar). Arquivo ausente: 0, sem erro (nada a proteger).
func FileSchemaVersion(path string) (int, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	q := url.Values{}
	q.Set("mode", "ro")
	q.Add("_pragma", "query_only(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var v int
	if err := db.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&v); err != nil {
		return 0, fmt.Errorf("buffer: lendo a versão do esquema de %s: %w", path, err)
	}
	return v, nil
}
