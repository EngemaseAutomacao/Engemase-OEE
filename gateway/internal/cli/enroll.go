package cli

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/config"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

var (
	activationCodeRe = regexp.MustCompile(`^[A-Z0-9]{4}-[A-Z0-9]{4}$`)
	hostnameRe       = regexp.MustCompile(`^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`)
)

// NormalizeActivationCode deixa o código como a web mostra (ABCD-1234): maiúsculas,
// sem espaços, hífen no meio. Erro se não tiver 8 caracteres A–Z/0–9.
func NormalizeActivationCode(in string) (string, error) {
	raw := strings.ToUpper(strings.NewReplacer(" ", "", "-", "", "\t", "").Replace(in))
	if len(raw) == 8 {
		raw = raw[:4] + "-" + raw[4:]
	}
	if !activationCodeRe.MatchString(raw) {
		return "", fmt.Errorf("código de ativação inválido %q (8 letras/números, ex.: ABCD-1234)", in)
	}
	return raw, nil
}

func newEnrollCmd() *cobra.Command {
	var code, url, hostname string
	var force bool
	cmd := &cobra.Command{
		Use:   "enroll --code ABCD-1234 [--url https://oee.engemase.com.br]",
		Short: "Registra o gateway na plataforma com o código de ativação",
		Long: "Troca o código de ativação (uso único, válido por 24 h) pela credencial do gateway e a grava em\n" +
			"/var/lib/oee-gateway/credentials.json (0600). Se o agente estiver rodando, ele percebe a credencial nova sozinho.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			norm, err := NormalizeActivationCode(code)
			if err != nil {
				return err
			}
			local, err := loadLocal(cmd)
			if err != nil {
				return err
			}
			if url != "" {
				if err := config.ValidateCloudURL(url); err != nil {
					return err
				}
				local.Cloud.URL = strings.TrimRight(url, "/")
			}
			if hostname == "" {
				hostname, _ = os.Hostname()
			}
			if len(hostname) > 253 || !hostnameRe.MatchString(hostname) {
				return fmt.Errorf("nome de host inválido %q (use --hostname)", hostname)
			}
			arch := runtime.GOARCH
			if arch != "arm64" && arch != "amd64" && arch != "arm" {
				return fmt.Errorf("arquitetura %s não suportada", arch)
			}
			existing, err := config.LoadCredentials(local.Paths.Credentials)
			if err != nil && !force {
				return err
			}
			if existing != nil && !force {
				return fmt.Errorf("gateway já registrado (id %s, organização %s); use --force para registrar de novo", existing.GatewayID, existing.Org)
			}

			client, err := uplink.New(uplink.Options{BaseURL: local.Cloud.URL, AgentVersion: buildinfo.Version,
				Timeout: time.Duration(local.Cloud.TimeoutS) * time.Second, ExtraCAFile: local.Cloud.ExtraCAFile})
			if err != nil {
				return err
			}
			req := &contracts.EnrollRequest{
				Code: norm, Hostname: hostname, AgentVersion: buildinfo.Version,
				HW: contracts.HardwareInfo{Arch: arch, Model: hardwareModel(), MemMB: memTotalMB()},
			}
			ctx, cancel := context.WithTimeout(cmd.Context(), 60*time.Second)
			defer cancel()
			res, err := client.Enroll(ctx, req)
			if err != nil {
				return fmt.Errorf("registro recusado: %w", err)
			}
			creds := &config.Credentials{GatewayID: res.GatewayID, Token: res.Token, Org: res.Org, CloudURL: local.Cloud.URL}
			if err := config.SaveCredentials(local.Paths.Credentials, creds); err != nil {
				return fmt.Errorf("gravando a credencial: %w", err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Gateway registrado na organização %s (id %s).\nCredencial gravada em %s.\n",
				res.Org, res.GatewayID, local.Paths.Credentials)
			return nil
		},
	}
	cmd.Flags().StringVar(&code, "code", "", "código de ativação mostrado na web (ex.: ABCD-1234)")
	cmd.Flags().StringVar(&url, "url", "", "URL da plataforma (padrão: cloud.url do gateway.yaml)")
	cmd.Flags().StringVar(&hostname, "hostname", "", "nome do gateway (padrão: hostname do sistema)")
	cmd.Flags().BoolVar(&force, "force", false, "registrar de novo mesmo se já houver credencial")
	_ = cmd.MarkFlagRequired("code")
	return cmd
}

// hardwareModel lê o modelo da placa (device tree) ou devolve "generic".
func hardwareModel() string {
	b, err := os.ReadFile("/proc/device-tree/model")
	if err != nil {
		return "generic"
	}
	m := strings.TrimSpace(string(bytes.TrimRight(b, "\x00")))
	if m == "" {
		return "generic"
	}
	if len(m) > 120 {
		m = m[:120]
	}
	return m
}

// memTotalMB lê a memória total de /proc/meminfo (mínimo 1).
func memTotalMB() int {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 1
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			if kb, err := strconv.Atoi(fields[1]); err == nil && kb >= 1024 {
				return kb / 1024
			}
		}
	}
	return 1
}
