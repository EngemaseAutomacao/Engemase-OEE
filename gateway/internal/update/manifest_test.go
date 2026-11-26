package update

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
)

const sum = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

func manifest(t *testing.T, extra string) *Manifest {
	t.Helper()
	m, err := ParseManifest([]byte(`{"package":"oee-gateway","version":"1.2.0","arch":"arm64","sha256":"` + sum + `","size":1234` + extra + `}`))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestParseManifest(t *testing.T) {
	if m := manifest(t, ""); m.Schema() != 1 {
		t.Fatalf("manifesto antigo vale esquema 1: %d", m.Schema())
	}
	if m := manifest(t, `,"buffer_schema":2,"allowed_rollback_to":["1.1.0"]`); m.Schema() != 2 || m.AllowedRollbackTo[0] != "1.1.0" {
		t.Fatalf("buffer_schema: %+v", m)
	}
	for _, bad := range []string{
		`{"package":"outro","version":"1","arch":"arm64","sha256":"` + sum + `","size":1}`,
		`{"package":"oee-gateway","version":"1","arch":"arm64","sha256":"abc","size":1}`,
		`{"package":"oee-gateway","version":"1","arch":"arm64","sha256":"` + sum + `","size":1,"buffer_schema":0}`,
	} {
		if _, err := ParseManifest([]byte(bad)); err == nil {
			t.Errorf("deveria recusar: %s", bad)
		}
	}
}

// L25: rollback automático só para um pacote que abre o buffer como está no disco.
func TestCheckAutoRollback(t *testing.T) {
	prevV1 := manifest(t, "")
	if err := CheckAutoRollback(prevV1, 1); err != nil {
		t.Fatalf("mesmo esquema: %v", err)
	}
	if err := CheckAutoRollback(prevV1, 0); err != nil {
		t.Fatalf("sem buffer: %v", err)
	}
	err := CheckAutoRollback(prevV1, 2)
	if !errors.Is(err, ErrRollbackSchema) || !strings.Contains(err.Error(), "v2") {
		t.Fatalf("buffer migrado: %v", err)
	}
	if err := CheckAutoRollback(manifest(t, `,"buffer_schema":2`), 2); err != nil {
		t.Fatalf("pacote anterior já de esquema 2: %v", err)
	}
}

// O esquema do agente atual é o que o buffer.db dele tem, lido sem alterar o arquivo.
func TestBufferSchemaOnDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "buffer.db")
	if v, err := buffer.FileSchemaVersion(path); err != nil || v != 0 {
		t.Fatalf("sem arquivo: %d %v", v, err)
	}
	s, err := buffer.Open(path, buffer.Options{})
	if err != nil {
		t.Fatal(err)
	}
	v, err := buffer.FileSchemaVersion(path) // com o agente rodando (WAL aberto)
	if err != nil || v != buffer.SchemaVersion {
		t.Fatalf("esquema no disco: %d %v (agente v%d)", v, err, buffer.SchemaVersion)
	}
	_ = s.Close()
	if err := CheckAutoRollback(manifest(t, ""), v); err != nil {
		t.Fatalf("hoje (v%d) o rollback para um pacote antigo é permitido: %v", v, err)
	}
}
