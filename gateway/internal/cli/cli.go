// Package cli tem os comandos de linha de comando do oee-gateway (cobra). Fica fora
// do main para ser testável.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/app"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
)

// ExitError carrega o código de saída (ex.: diag devolve 1 para avisos e 2 para falhas).
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string {
	if e.Err == nil {
		return fmt.Sprintf("código de saída %d", e.Code)
	}
	return e.Err.Error()
}

func (e *ExitError) Unwrap() error { return e.Err }

// Execute roda a CLI e devolve o código de saída do processo.
func Execute(args []string, stdout, stderr io.Writer) int {
	root := NewRoot(stdout, stderr)
	root.SetArgs(args)
	err := root.Execute()
	if err == nil {
		return 0
	}
	var ee *ExitError
	if errors.As(err, &ee) {
		if ee.Err != nil {
			fmt.Fprintln(stderr, "erro:", ee.Err)
		}
		return ee.Code
	}
	fmt.Fprintln(stderr, "erro:", err)
	return 1
}

// NewRoot monta a árvore de comandos.
func NewRoot(stdout, stderr io.Writer) *cobra.Command {
	root := &cobra.Command{
		Use:           "oee-gateway",
		Short:         "Agente de borda da plataforma Engemase OEE (Modbus TCP/RTU → nuvem)",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetOut(stdout)
	root.SetErr(stderr)
	root.PersistentFlags().String("config", config.DefaultLocalPath, "config local (gateway.yaml)")
	root.AddCommand(newRunCmd(), newVersionCmd(), newEnrollCmd(), newDiagCmd(), newModbusCmd(), newConfigCmd())
	return root
}

// runAgent roda o agente (trocado nos testes).
var runAgent = app.Run

func loadLocal(cmd *cobra.Command) (*config.Local, error) {
	path, _ := cmd.Flags().GetString("config")
	return config.LoadLocal(path)
}

func newRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "run",
		Short: "Roda o agente (processo do serviço systemd)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			local, err := loadLocal(cmd)
			if err != nil {
				return err
			}
			// O logger do agente (JSON no stderr, nível da config local) é também o
			// padrão do processo: o que não recebe um logger explícito (ex.: as falhas
			// do /sync com Syncer.Log nil) sai no mesmo journal e no mesmo nível.
			log := app.NewLogger(local.Log.Level)
			slog.SetDefault(log)
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return runAgent(ctx, app.Options{Local: local, Logger: log})
		},
	}
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Mostra versão, commit e data do build",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), buildinfo.String())
			return nil
		},
	}
}
