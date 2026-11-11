// Package testutil reúne ajudas de teste: localizar o pacote packages/contracts
// (fixtures e JSON Schema) e validar JSON contra o schema estrito.
package testutil

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// ContractsDir procura packages/contracts subindo a partir do diretório do teste.
// Se não achar (módulo copiado sozinho), o teste é pulado.
func ContractsDir(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		cand := filepath.Join(dir, "packages", "contracts", "fixtures", "manifest.json")
		if _, err := os.Stat(cand); err == nil {
			return filepath.Join(dir, "packages", "contracts")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("packages/contracts não encontrado (rode os testes dentro do monorepo)")
		}
		dir = parent
	}
}

// Fixture é uma entrada do fixtures/manifest.json.
type Fixture struct {
	File        string `json:"file"`
	Schema      string `json:"schema"`
	Valid       bool   `json:"valid"`
	Layer       string `json:"layer"`
	Description string `json:"description"`
	Expect      struct {
		Path string `json:"path"`
		Rule string `json:"rule"`
	} `json:"expect"`
}

// Fixtures lê o manifest e devolve as fixtures de um schema (ex.: "gateway-config").
func Fixtures(t testing.TB, schema string) []Fixture {
	t.Helper()
	dir := ContractsDir(t)
	b, err := os.ReadFile(filepath.Join(dir, "fixtures", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Fixtures []Fixture `json:"fixtures"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	var out []Fixture
	for _, f := range m.Fixtures {
		if f.Schema == schema {
			out = append(out, f)
		}
	}
	if len(out) == 0 {
		t.Fatalf("nenhuma fixture para %q no manifest", schema)
	}
	return out
}

// ReadFixture lê o conteúdo de uma fixture.
func ReadFixture(t testing.TB, file string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(ContractsDir(t), "fixtures", file))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// StrictSchema compila o JSON Schema estrito (schema/strict/<name>.json), com
// validação de formatos, como o README do pacote de contratos recomenda.
func StrictSchema(t testing.TB, name string) *jsonschema.Schema {
	t.Helper()
	dir := ContractsDir(t)
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	path := filepath.Join(dir, "schema", "strict", name+".json")
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	doc, err := jsonschema.UnmarshalJSON(f)
	if err != nil {
		t.Fatal(err)
	}
	url := "file://" + filepath.ToSlash(path)
	if err := c.AddResource(url, doc); err != nil {
		t.Fatal(err)
	}
	s, err := c.Compile(url)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// ValidateJSON valida um documento JSON contra o schema; devolve a lista de erros
// formatada (vazia se válido).
func ValidateJSON(t testing.TB, s *jsonschema.Schema, doc []byte) string {
	t.Helper()
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(doc))
	if err != nil {
		t.Fatalf("JSON inválido: %v", err)
	}
	if err := s.Validate(inst); err != nil {
		return strings.TrimSpace(err.Error())
	}
	return ""
}
