package cli

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "config", Short: "Config remota (gerada pela nuvem)"}
	cmd.AddCommand(&cobra.Command{
		Use:   "validate ARQUIVO.json",
		Short: "Valida uma config remota (estrutura e regras semânticas do contrato v1)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			cfg, err := config.ParseRemote(body)
			if err != nil {
				var verr *config.ValidationError
				if errors.As(err, &verr) {
					fmt.Fprintf(cmd.ErrOrStderr(), "config inválida: %d problema(s)\n", len(verr.Issues))
					for _, is := range verr.Issues {
						fmt.Fprintln(cmd.ErrOrStderr(), "  -", is.String())
					}
					return &ExitError{Code: 1}
				}
				return err
			}
			tags := 0
			for _, d := range cfg.Devices {
				tags += len(d.Tags)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "config válida: versão %d · %d barramento(s) · %d dispositivo(s) · %d tag(s) · %d máquina(s)\n",
				cfg.ConfigVersion, len(cfg.SerialBuses), len(cfg.Devices), tags, len(cfg.Machines))
			return nil
		},
	})
	return cmd
}
