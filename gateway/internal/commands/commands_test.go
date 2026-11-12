package commands

import (
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/testutil"
)

func TestExecutorDedupExpiryAndConfirm(t *testing.T) {
	schema := testutil.StrictSchema(t, "command-result")
	now := time.Date(2026, 11, 11, 13, 2, 5, 0, time.UTC)
	cmds := []contracts.Command{
		{ID: "01a1cab3-55e8-7cf0-a52e-692c5f1aac62", Type: "tag.read", ExpiresAt: contracts.FormatTime(now.Add(time.Minute))},
		{ID: "01a1cab3-55e8-7cf0-a52e-692c5f1aac63", Type: "agent.update", ExpiresAt: contracts.FormatTime(now.Add(-time.Second))},
	}
	x := New()
	x.Handle(cmds, now)
	x.Handle(cmds, now.Add(time.Second)) // repetido pela nuvem: ignorado
	res := x.Results(50)
	if len(res) != 2 {
		t.Fatalf("resultados: %d", len(res))
	}
	for _, r := range res {
		if errs := testutil.ValidateJSON(t, schema, r); errs != "" {
			t.Fatalf("resultado fora do contrato: %s\n%s", errs, r)
		}
	}
	if string(res[1]) == string(res[0]) {
		t.Fatal("resultados iguais")
	}
	x.Confirm()
	if len(x.Results(50)) != 0 {
		t.Fatal("confirmados deveriam sair da fila")
	}
	x.Handle(cmds, now.Add(2*time.Second))
	if len(x.Results(50)) != 0 {
		t.Fatal("comando já visto não gera resultado de novo")
	}
}
