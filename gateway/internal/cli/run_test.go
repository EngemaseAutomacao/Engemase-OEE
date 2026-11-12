package cli

import (
	"context"
	stdlog "log"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/app"
)

// O run passa ao agente o logger JSON da config local e o deixa como padrão do
// processo: o que não recebe logger explícito (o Syncer com Log nil, as falhas do
// /sync) sai no mesmo JSON e no mesmo nível, não no texto do slog padrão.
func TestRunSetsAgentLoggerAsDefault(t *testing.T) {
	prevDefault, prevFlags, prevOut := slog.Default(), stdlog.Flags(), stdlog.Writer()
	prevRun := runAgent
	t.Cleanup(func() {
		runAgent = prevRun
		slog.SetDefault(prevDefault)
		stdlog.SetOutput(prevOut)
		stdlog.SetFlags(prevFlags)
	})

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "gateway.yaml")
	yml := "cloud:\n  url: https://oee.exemplo.com.br\npaths:\n  state_dir: " + dir + "\nlog:\n  level: warn\n"
	if err := os.WriteFile(cfgPath, []byte(yml), 0o644); err != nil {
		t.Fatal(err)
	}
	var got app.Options
	var def *slog.Logger
	runAgent = func(_ context.Context, o app.Options) error {
		got, def = o, slog.Default()
		return nil
	}
	if _, errOut, code := run(t, "run", "--config", cfgPath); code != 0 {
		t.Fatalf("run: código %d, stderr %q", code, errOut)
	}
	if got.Local == nil || got.Logger == nil {
		t.Fatalf("opções do agente: %+v", got)
	}
	if def != got.Logger {
		t.Fatal("o slog padrão do processo deveria ser o logger do agente")
	}
	if _, ok := got.Logger.Handler().(*slog.JSONHandler); !ok {
		t.Fatalf("handler %T; quer JSON", got.Logger.Handler())
	}
	ctx := context.Background()
	if got.Logger.Enabled(ctx, slog.LevelInfo) || !got.Logger.Enabled(ctx, slog.LevelWarn) {
		t.Fatal("o nível deveria ser o da config local (warn)")
	}
}
