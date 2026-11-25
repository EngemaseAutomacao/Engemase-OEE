package update

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// DebSystem é o System real: dpkg, dpkg-deb, dpkg-query e systemctl, com caminho
// absoluto, ambiente mínimo e prazo.
type DebSystem struct{}

func runCmd(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C", "DEBIAN_FRONTEND=noninteractive"}
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if len(msg) > 500 {
			msg = msg[len(msg)-500:]
		}
		return out.String(), fmt.Errorf("%s: %w: %s", name, err, msg)
	}
	return out.String(), nil
}

// DebFields lê Package, Version e Architecture do .deb.
func (DebSystem) DebFields(ctx context.Context, deb string) (string, string, string, error) {
	out, err := runCmd(ctx, time.Minute, "/usr/bin/dpkg-deb", "--showformat=${Package}\n${Version}\n${Architecture}\n", "--show", deb)
	if err != nil {
		return "", "", "", err
	}
	f := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(f) != 3 {
		return "", "", "", fmt.Errorf("dpkg-deb: saída inesperada %q", out)
	}
	return f[0], f[1], f[2], nil
}

// InstalledVersion é a versão instalada ("" se o pacote não está instalado).
func (DebSystem) InstalledVersion(ctx context.Context, pkg string) (string, error) {
	out, err := runCmd(ctx, time.Minute, "/usr/bin/dpkg-query", "--showformat=${db:Status-Status} ${Version}", "--show", pkg)
	if err != nil {
		if strings.Contains(err.Error(), "no packages found") {
			return "", nil
		}
		return "", err
	}
	status, ver, _ := strings.Cut(strings.TrimSpace(out), " ")
	if status != "installed" {
		return "", nil
	}
	return ver, nil
}

// Arch é a arquitetura do dpkg.
func (DebSystem) Arch(ctx context.Context) (string, error) {
	out, err := runCmd(ctx, time.Minute, "/usr/bin/dpkg", "--print-architecture")
	return strings.TrimSpace(out), err
}

// Install instala o .deb mantendo os conffiles editados no gateway.
func (DebSystem) Install(ctx context.Context, deb string) error {
	_, err := runCmd(ctx, 5*time.Minute, "/usr/bin/dpkg", "--force-confdef", "--force-confold", "-i", deb)
	return err
}

// ConfigurePending termina a configuração de pacotes interrompida.
func (DebSystem) ConfigurePending(ctx context.Context) error {
	_, err := runCmd(ctx, 5*time.Minute, "/usr/bin/dpkg", "--force-confdef", "--force-confold", "--configure", "-a")
	return err
}

// RestartAgent reinicia o agente sem esperar o READY (o updater espera a saúde).
func (DebSystem) RestartAgent(ctx context.Context) error {
	_, err := runCmd(ctx, time.Minute, "/usr/bin/systemctl", "--no-block", "restart", "oee-gateway.service")
	return err
}

// StartUpdater enfileira o apply (o boot-check vem antes do agente e não espera).
func (DebSystem) StartUpdater(ctx context.Context) error {
	_, err := runCmd(ctx, time.Minute, "/usr/bin/systemctl", "--no-block", "start", "oee-gateway-updater.service")
	return err
}
