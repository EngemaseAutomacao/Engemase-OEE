package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
)

// SupportUser é o único usuário que entra pelo SSH do acesso remoto (docs/12).
const SupportUser = "suporte"

// SSHPrincipal é o principal que um certificado SSH precisa ter para entrar NESTE gateway: a
// plataforma emite o certificado da sessão com ele, e um certificado de outro gateway não serve.
func SSHPrincipal(gatewayID string) string { return "oee-gw-" + gatewayID }

// newSSHPrincipalsCmd é o AuthorizedPrincipalsCommand do sshd do acesso remoto
// (/usr/share/oee-remote-access/ssh/sshd_config, roda como o usuário oee): para o usuário
// suporte, imprime o principal deste gateway; para qualquer outro usuário, ou sem registro na
// plataforma, não imprime nada e o sshd recusa. Nunca falha com mensagem no stdout.
func newSSHPrincipalsCmd() *cobra.Command {
	return &cobra.Command{
		Use:    "ssh-principals USUÁRIO",
		Short:  "Principal aceito nos certificados SSH do acesso remoto (uso do sshd)",
		Hidden: true,
		Args:   cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if args[0] != SupportUser {
				return nil
			}
			local, err := loadLocal(cmd)
			if err != nil {
				return err
			}
			creds, err := config.LoadCredentials(local.Paths.Credentials)
			if err != nil {
				return err
			}
			if creds == nil || creds.GatewayID == "" {
				return nil
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), SSHPrincipal(creds.GatewayID))
			return err
		},
	}
}
