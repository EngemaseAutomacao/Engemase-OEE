package cli

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
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

	// geteuid e credDirOwner são trocados nos testes (que costumam rodar como root
	// no contêiner).
	geteuid      = os.Geteuid
	credDirOwner = dirOwner
)

// refuseRootEnroll recusa o enroll como root quando a credencial ficaria ilegível
// para o agente: o diretório dela (ou o primeiro ancestral que já existe) é de
// outro usuário. No gateway, /var/lib/oee-gateway é oee:oee 0750 e a credencial é
// 0600: gravada por root, o agente (usuário oee) não a leria. Com o diretório de
// root (bancada ou teste ponta a ponta com o agente também como root), quem grava
// e quem lê são o mesmo usuário: segue.
func refuseRootEnroll(credPath, code string) error {
	if geteuid() != 0 {
		return nil
	}
	uid, name, err := credDirOwner(credPath)
	if err != nil {
		return fmt.Errorf("conferindo o dono do diretório da credencial: %w", err)
	}
	if uid == 0 {
		return nil
	}
	if code == "" {
		code = "ABCD-1234"
	}
	if strings.HasPrefix(name, "#") {
		name = "'" + name + "'" // uid sem nome: o shell trataria o # como comentário
	}
	return fmt.Errorf("não rode o enroll como root: o diretório da credencial (%s) é do usuário %s, o do agente, e a "+
		"credencial (0600) ficaria com dono root, ilegível para ele. Rode como o usuário do agente: sudo -u %s oee-gateway enroll --code %s",
		filepath.Dir(credPath), name, name, code)
}

// dirOwner devolve o dono (uid e nome; "#uid" sem nome) do diretório do arquivo,
// ou do primeiro ancestral que já existe (o enroll cria o que faltar).
func dirOwner(path string) (int, string, error) {
	dir := filepath.Dir(path)
	for {
		st, err := os.Stat(dir)
		if errors.Is(err, fs.ErrNotExist) && filepath.Dir(dir) != dir {
			dir = filepath.Dir(dir)
			continue
		}
		if err != nil {
			return 0, "", err
		}
		sys, ok := st.Sys().(*syscall.Stat_t)
		if !ok {
			return 0, "", fmt.Errorf("%s: dono desconhecido", dir)
		}
		id := strconv.FormatUint(uint64(sys.Uid), 10)
		name := "#" + id
		if u, err := user.LookupId(id); err == nil {
			name = u.Username
		}
		return int(sys.Uid), name, nil
	}
}

// proxyEnvFile fica ao lado do gateway.yaml: /etc/oee-gateway/proxy.env, o mesmo
// que a unit do agente carrega (EnvironmentFile=).
const proxyEnvFile = "proxy.env"

// proxyVars são as variáveis de proxy que o transporte do Go lê
// (http.ProxyFromEnvironment); as quatro primeiras definem um proxy.
var proxyVars = []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"}

// loadProxyEnv aplica ao processo o proxy do proxy.env quando o ambiente não tem
// nenhum. O agente recebe o arquivo pela unit, mas o enroll roda no console: o
// shell do técnico não o carrega e o sudo zera o ambiente (env_reset). Sem isto,
// num local com proxy obrigatório o agente sincroniza e o enroll vai direto e
// falha (dns/timeout). Devolve os nomes aplicados (nunca os valores: a URL do
// proxy pode ter senha). Arquivo ausente não é erro.
func loadProxyEnv(path string) ([]string, error) {
	for _, k := range proxyVars[:4] {
		if os.Getenv(k) != "" {
			return nil, nil // o ambiente manda
		}
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	vars := parseEnvFile(b)
	hasProxy := false
	for _, k := range proxyVars[:4] {
		hasProxy = hasProxy || vars[k] != ""
	}
	if !hasProxy {
		return nil, nil
	}
	var applied []string
	for _, k := range proxyVars {
		if vars[k] == "" || os.Getenv(k) != "" {
			continue
		}
		if err := os.Setenv(k, vars[k]); err != nil {
			return applied, err
		}
		applied = append(applied, k)
	}
	return applied, nil
}

// parseEnvFile lê o formato do EnvironmentFile= do systemd no que o proxy.env usa:
// CHAVE=valor por linha, comentários com # ou ;, valor entre aspas opcional.
func parseEnvFile(b []byte) map[string]string {
	vars := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		vars[strings.TrimSpace(k)] = v
	}
	return vars
}

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
		Use:   "enroll --code ABCD-1234 [--url URL]",
		Short: "Registra o gateway na plataforma com o código de ativação",
		Long: "Troca o código de ativação (uso único, válido por 24 h) pela credencial do gateway e a grava em\n" +
			"/var/lib/oee-gateway/credentials.json (0600). Se o agente estiver rodando, ele percebe a credencial nova sozinho.\n" +
			"Roda como o usuário do agente (sudo -u oee oee-gateway enroll --code ...); como root é recusado se o\n" +
			"diretório da credencial for de outro usuário. Sem proxy no ambiente, usa o do proxy.env ao lado do gateway.yaml.\n" +
			"O --url vale só para esta ativação: o agente sincroniza com o cloud.url do gateway.yaml, que precisa ter o\n" +
			"mesmo host (senão o agente manda o token a outro host, que pode recusá-lo). Na bancada, prefira editar o cloud.url.\n" +
			"Com credencial já gravada, só registra de novo sem --force se o agente marcou que a nuvem recusa o token\n" +
			"(401: token revogado ou inválido), pelo arquivo auth-blocked ao lado da credencial.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			norm, codeErr := NormalizeActivationCode(code)
			local, err := loadLocal(cmd)
			if err != nil {
				return err
			}
			if err := refuseRootEnroll(local.Paths.Credentials, norm); err != nil {
				return err
			}
			if codeErr != nil {
				return codeErr
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
			markerPath := uplink.BlockedMarkerPath(local.Paths.Credentials)
			var refused *uplink.BlockedMarker // credencial existente recusada pela nuvem (401)
			if existing != nil && !force {
				if refused, err = uplink.ReadBlockedMarker(markerPath); err != nil {
					return err
				}
				if refused == nil {
					return fmt.Errorf("gateway já registrado (id %s, organização %s) e o agente não marcou a credencial como "+
						"recusada pela nuvem (sem %s); confira com oee-gateway diag. Para registrar de novo assim mesmo, use --force",
						existing.GatewayID, existing.Org, markerPath)
				}
			}

			out := cmd.OutOrStdout()
			cfgPath, _ := cmd.Flags().GetString("config")
			proxyEnv := filepath.Join(filepath.Dir(cfgPath), proxyEnvFile)
			if applied, err := loadProxyEnv(proxyEnv); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "aviso: proxy de %s não aplicado (o enroll vai direto): %v\n", proxyEnv, err)
			} else if len(applied) > 0 {
				fmt.Fprintf(out, "Proxy de %s (%s).\n", proxyEnv, strings.Join(applied, ", "))
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
			fmt.Fprintf(out, "Gateway registrado na organização %s (id %s).\nCredencial gravada em %s.\n",
				res.Org, res.GatewayID, local.Paths.Credentials)
			switch {
			case existing != nil && refused != nil:
				fmt.Fprintf(out, "Credencial anterior (gateway %s, organização %s) substituída: a nuvem a recusava%s.\n",
					existing.GatewayID, existing.Org, describeRefusal(refused))
			case existing != nil:
				fmt.Fprintf(out, "Credencial anterior (gateway %s, organização %s) substituída (--force).\n", existing.GatewayID, existing.Org)
			}
			// A credencial nova ainda não foi recusada; se for, o agente grava o marcador de novo.
			if _, err := uplink.RemoveBlockedMarker(markerPath); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "aviso: não foi possível apagar %s (o agente apaga no próximo sync aceito): %v\n", markerPath, err)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&code, "code", "", "código de ativação mostrado na web (ex.: ABCD-1234)")
	cmd.Flags().StringVar(&url, "url", "", "URL da plataforma só para esta ativação (padrão: cloud.url do gateway.yaml, que é o que o agente usa)")
	cmd.Flags().StringVar(&hostname, "hostname", "", "nome do gateway (padrão: hostname do sistema)")
	cmd.Flags().BoolVar(&force, "force", false, "registrar de novo mesmo se já houver credencial")
	_ = cmd.MarkFlagRequired("code")
	return cmd
}

// describeRefusal resume o marcador para a saída do enroll (" desde ... (código)").
func describeRefusal(m *uplink.BlockedMarker) string {
	var b strings.Builder
	if m.Since != "" {
		b.WriteString(" desde " + m.Since)
	}
	if m.Code != "" {
		b.WriteString(" (" + m.Code + ")")
	}
	return b.String()
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
