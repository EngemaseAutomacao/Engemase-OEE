package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

// newUpdateCmd é o lado do agente do OTA mínimo: baixa e confere o pacote e grava o
// pedido para o oee-updater (root). Enquanto o contrato v1 não tem um comando de
// atualização vindo da nuvem, é a CLI (como o usuário oee) que dispara.
func newUpdateCmd() *cobra.Command {
	root := &cobra.Command{Use: "update", Short: "Atualização do agente (OTA mínimo)"}
	fetch := &cobra.Command{
		Use:   "fetch",
		Short: "Baixa o pacote pelo manifesto assinado e pede a instalação ao oee-updater (rode como oee)",
		Long: "Baixa o manifesto (https) e a assinatura (<manifesto>.sig), confere a assinatura Ed25519 com as\n" +
			"chaves de " + update.DefaultKeysDir + ", baixa o .deb conferindo tamanho e SHA-256 e grava\n" +
			"<state_dir>/update/request.json. O oee-gateway-updater.path dispara o oee-updater, que confere\n" +
			"tudo de novo, instala, espera o 1º /sync aceito do agente novo (5 min) e volta ao anterior se não vier.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			local, err := loadLocal(cmd)
			if err != nil {
				return err
			}
			manifestURL, _ := cmd.Flags().GetString("manifest-url")
			keysDir, _ := cmd.Flags().GetString("keys-dir")
			id, _ := cmd.Flags().GetString("id")
			keys, err := update.LoadKeys(keysDir)
			if err != nil {
				return err
			}
			cfgPath, _ := cmd.Flags().GetString("config")
			proxyEnv := filepath.Join(filepath.Dir(cfgPath), proxyEnvFile)
			if applied, err := loadProxyEnv(proxyEnv); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "aviso: proxy de %s não aplicado: %v\n", proxyEnv, err)
			} else if len(applied) > 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "Proxy de %s (%s).\n", proxyEnv, strings.Join(applied, ", "))
			}
			client, err := update.NewHTTPClient(local.Cloud.ExtraCAFile)
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			dir := filepath.Join(local.Paths.StateDir, "update")
			m, err := update.Fetch(ctx, update.FetchOptions{ManifestURL: manifestURL, Dir: dir, Keys: keys, Client: client, RequestID: id})
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Pacote %s (%s) conferido; instalação pedida ao oee-updater (resultado em %s).\n",
				m.Version, m.Arch, filepath.Join(dir, update.ResultFile))
			return nil
		},
	}
	fetch.Flags().String("manifest-url", "", "endereço https do manifesto assinado")
	fetch.Flags().String("keys-dir", update.DefaultKeysDir, "chaves públicas do OTA")
	fetch.Flags().String("id", "", "identificador do pedido (vai no result.json)")
	_ = fetch.MarkFlagRequired("manifest-url")
	root.AddCommand(fetch)
	return root
}
