// Package sdlisten recebe os sockets abertos pelo systemd (ativação por socket:
// LISTEN_PID, LISTEN_FDS e LISTEN_FDNAMES, a partir do fd 3), sem libsystemd. É
// assim que o oee-localui recebe a porta 443 sem privilégio e que o oee-helper e a
// API local do agente recebem os sockets Unix (deploy/gateway/systemd/fase1).
package sdlisten

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// firstFD é o primeiro descritor passado pelo systemd (SD_LISTEN_FDS_START).
const firstFD = 3

// Listeners devolve os sockets passados ao processo, pelo FileDescriptorName= da
// unit (sem nome: "unknown", como no systemd). Fora da ativação por socket, devolve
// um mapa vazio. As variáveis são removidas do ambiente (não passam a filhos).
func Listeners() (map[string][]net.Listener, error) {
	defer func() {
		_ = os.Unsetenv("LISTEN_PID")
		_ = os.Unsetenv("LISTEN_FDS")
		_ = os.Unsetenv("LISTEN_FDNAMES")
	}()
	return fromEnv(os.Getenv, os.Getpid(), firstFD)
}

func fromEnv(env func(string) string, pid, first int) (map[string][]net.Listener, error) {
	out := map[string][]net.Listener{}
	if env("LISTEN_PID") == "" {
		return out, nil
	}
	if p, err := strconv.Atoi(env("LISTEN_PID")); err != nil || p != pid {
		return out, nil // sockets de outro processo (ex.: herdados por engano)
	}
	n, err := strconv.Atoi(env("LISTEN_FDS"))
	if err != nil || n < 0 {
		return nil, fmt.Errorf("sdlisten: LISTEN_FDS inválido %q", env("LISTEN_FDS"))
	}
	var names []string
	if v := env("LISTEN_FDNAMES"); v != "" {
		names = strings.Split(v, ":")
	}
	for i := 0; i < n; i++ {
		fd := first + i
		name := "unknown"
		if i < len(names) && names[i] != "" {
			name = names[i]
		}
		syscall.CloseOnExec(fd)
		f := os.NewFile(uintptr(fd), "sd-"+name)
		l, err := net.FileListener(f)
		_ = f.Close() // FileListener duplica o descritor
		if err != nil {
			return nil, fmt.Errorf("sdlisten: fd %d (%s): %w", fd, name, err)
		}
		out[name] = append(out[name], l)
	}
	return out, nil
}

// One devolve o único socket com o nome dado (erro se faltar ou houver mais de um).
func One(ls map[string][]net.Listener, name string) (net.Listener, error) {
	switch len(ls[name]) {
	case 1:
		return ls[name][0], nil
	case 0:
		return nil, fmt.Errorf("sdlisten: socket %q não recebido do systemd (rode pela unit com o .socket)", name)
	}
	return nil, fmt.Errorf("sdlisten: mais de um socket %q", name)
}
