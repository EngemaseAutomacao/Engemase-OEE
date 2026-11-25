package helper

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"time"
)

// OSSystem é o System real: NetworkManager pelo D-Bus (busctl, para os
// checkpoints, e nmcli), systemctl e timedatectl. Cada comando tem caminho
// absoluto, argumentos fixos ou já validados e prazo.
type OSSystem struct {
	// SetTime acerta o relógio (padrão: settimeofday, ver clock_linux.go).
	SetTime func(time.Time) error
}

const cmdTimeout = 30 * time.Second

const (
	nmBus   = "org.freedesktop.NetworkManager"
	nmPath  = "/org/freedesktop/NetworkManager"
	nmIface = "org.freedesktop.NetworkManager"
	// Flags do CheckpointCreate: DESTROY_ALL (1) apaga checkpoints antigos;
	// DELETE_NEW_CONNECTIONS (2) e DISCONNECT_NEW_DEVICES (4) desfazem o que surgir.
	nmCheckpointFlags = "7"
)

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, cmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return "", fmt.Errorf("%s: %w: %s", name, err, msg)
	}
	return out.String(), nil
}

// CheckpointCreate chama org.freedesktop.NetworkManager.CheckpointCreate (todos os
// dispositivos, rollback em segundos) e devolve o caminho do checkpoint.
func (OSSystem) CheckpointCreate(ctx context.Context, rollback time.Duration) (string, error) {
	out, err := run(ctx, "/usr/bin/busctl", "call", nmBus, nmPath, nmIface, "CheckpointCreate", "aouu",
		"0", strconv.Itoa(int(rollback/time.Second)), nmCheckpointFlags)
	if err != nil {
		return "", err
	}
	// Saída: o "/org/freedesktop/NetworkManager/Checkpoint/N"
	f := strings.Fields(out)
	if len(f) != 2 || f[0] != "o" {
		return "", fmt.Errorf("resposta inesperada do CheckpointCreate: %q", strings.TrimSpace(out))
	}
	path := strings.Trim(f[1], `"`)
	if !checkpointRe.MatchString(path) {
		return "", fmt.Errorf("checkpoint inválido: %q", path)
	}
	return path, nil
}

func checkpointCall(ctx context.Context, method, path string) error {
	if !checkpointRe.MatchString(path) {
		return fmt.Errorf("checkpoint inválido: %q", path)
	}
	_, err := run(ctx, "/usr/bin/busctl", "call", nmBus, nmPath, nmIface, method, "o", path)
	return err
}

// CheckpointDestroy confirma (a rede nova fica).
func (OSSystem) CheckpointDestroy(ctx context.Context, path string) error {
	return checkpointCall(ctx, "CheckpointDestroy", path)
}

// CheckpointRollback volta à rede do checkpoint.
func (OSSystem) CheckpointRollback(ctx context.Context, path string) error {
	return checkpointCall(ctx, "CheckpointRollback", path)
}

// ReloadConnections relê os keyfiles.
func (OSSystem) ReloadConnections(ctx context.Context) error {
	_, err := run(ctx, "/usr/bin/nmcli", "connection", "reload")
	return err
}

// ActivateConnection sobe um perfil (oee-it, oee-ot).
func (OSSystem) ActivateConnection(ctx context.Context, id string) error {
	if id != "oee-it" && id != "oee-ot" {
		return fmt.Errorf("perfil fora da lista: %q", id)
	}
	_, err := run(ctx, "/usr/bin/nmcli", "--wait", "20", "connection", "up", "id", id)
	return err
}

var allowedUnits = map[string]bool{"oee-gateway.service": true, "oee-localui.service": true}

func systemctl(ctx context.Context, verb, unit string) error {
	if !allowedUnits[unit] {
		return fmt.Errorf("unit fora da lista: %q", unit)
	}
	_, err := run(ctx, "/usr/bin/systemctl", "--no-block", verb, unit)
	return err
}

// RestartUnit reinicia uma unit da lista (sem esperar).
func (OSSystem) RestartUnit(ctx context.Context, unit string) error {
	return systemctl(ctx, "restart", unit)
}

// StopUnit para uma unit da lista. Espera parar: o reset apaga o buffer depois.
func (OSSystem) StopUnit(ctx context.Context, unit string) error {
	if !allowedUnits[unit] {
		return fmt.Errorf("unit fora da lista: %q", unit)
	}
	_, err := run(ctx, "/usr/bin/systemctl", "stop", unit)
	return err
}

// StartUnit inicia uma unit da lista (sem esperar).
func (OSSystem) StartUnit(ctx context.Context, unit string) error {
	return systemctl(ctx, "start", unit)
}

// NTPSynchronized pergunta ao timedated se o relógio está sincronizado.
func (OSSystem) NTPSynchronized(ctx context.Context) (bool, error) {
	out, err := run(ctx, "/usr/bin/timedatectl", "show", "--property=NTPSynchronized", "--value")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) == "yes", nil
}

// SetClock acerta o relógio do sistema.
func (s OSSystem) SetClock(t time.Time) error {
	if s.SetTime != nil {
		return s.SetTime(t)
	}
	return setSystemClock(t)
}

// Chown passa o arquivo para root:<group>.
func (OSSystem) Chown(path, group string) error {
	g, err := user.LookupGroup(group)
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(g.Gid)
	if err != nil {
		return err
	}
	return os.Lchown(path, 0, gid)
}

// Hostname devolve o nome da unidade.
func (OSSystem) Hostname() (string, error) {
	h, err := os.Hostname()
	if err != nil {
		return "", err
	}
	if h == "" {
		return "", errors.New("hostname vazio")
	}
	return h, nil
}
