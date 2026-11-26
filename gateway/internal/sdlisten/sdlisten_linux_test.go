package sdlisten

import (
	"net"
	"path/filepath"
	"syscall"
	"testing"
)

func TestFromEnv(t *testing.T) {
	// Fora da ativação por socket, ou para outro PID: nada.
	if ls, err := fromEnv(func(string) string { return "" }, 1, firstFD); err != nil || len(ls) != 0 {
		t.Fatalf("sem ambiente: %v %v", ls, err)
	}
	env := map[string]string{"LISTEN_PID": "99", "LISTEN_FDS": "1"}
	if ls, err := fromEnv(func(k string) string { return env[k] }, 1, firstFD); err != nil || len(ls) != 0 {
		t.Fatalf("outro PID: %v %v", ls, err)
	}
	env = map[string]string{"LISTEN_PID": "1", "LISTEN_FDS": "x"}
	if _, err := fromEnv(func(k string) string { return env[k] }, 1, firstFD); err == nil {
		t.Fatal("LISTEN_FDS inválido")
	}

	// Dois sockets Unix reais, em descritores consecutivos, com nome.
	dir := t.TempDir()
	var fds []int
	for _, name := range []string{"a.sock", "b.sock"} {
		l, err := net.Listen("unix", filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		defer l.Close()
		f, err := l.(*net.UnixListener).File()
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		fds = append(fds, int(f.Fd()))
	}
	// Coloca os dois em descritores consecutivos altos (como o systemd faz a partir do 3).
	base := 200
	for i, fd := range fds {
		if err := syscall.Dup3(fd, base+i, 0); err != nil {
			t.Skipf("dup3: %v", err)
		}
	}
	env = map[string]string{"LISTEN_PID": "7", "LISTEN_FDS": "2", "LISTEN_FDNAMES": "ui:"}
	ls, err := fromEnv(func(k string) string { return env[k] }, 7, base)
	if err != nil {
		t.Fatal(err)
	}
	ui, err := One(ls, "ui")
	if err != nil || len(ls["unknown"]) != 1 {
		t.Fatalf("sockets: %v %v", ls, err)
	}
	defer ui.Close()
	defer ls["unknown"][0].Close()
	c, err := net.Dial("unix", filepath.Join(dir, "a.sock"))
	if err != nil {
		t.Fatal(err)
	}
	_ = c.Close()
	if _, err := One(ls, "https"); err == nil {
		t.Fatal("socket ausente deveria dar erro")
	}
}
