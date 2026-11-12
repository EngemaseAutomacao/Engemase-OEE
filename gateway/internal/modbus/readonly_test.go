package modbus

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// Somente leitura no CLP, por construção (ADR-008): nenhum arquivo do módulo chama
// os métodos de escrita da biblioteca Modbus. Faz o papel do forbidigo enquanto o
// golangci-lint não entra no CI.
func TestNoModbusWriteCalls(t *testing.T) {
	forbidden := map[string]bool{
		"WriteSingleCoil": true, "WriteMultipleCoils": true, "WriteSingleRegister": true,
		"WriteMultipleRegisters": true, "ReadWriteMultipleRegisters": true, "MaskWriteRegister": true, "WriteFileRecord": true,
	}
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	checked := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && path != root && (d.Name() == "testdata" || strings.HasPrefix(d.Name(), ".")) {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		checked++
		ast.Inspect(f, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok && forbidden[sel.Sel.Name] {
				t.Errorf("%s: chamada de escrita Modbus proibida: %s", fset.Position(sel.Pos()), sel.Sel.Name)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 20 {
		t.Fatalf("só %d arquivos verificados: caminho do módulo errado?", checked)
	}
}
