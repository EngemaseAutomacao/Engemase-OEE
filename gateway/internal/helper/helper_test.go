package helper

import (
	"context"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func serve(t *testing.T, s *Server) string {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "helper.sock")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, l) }()
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("Serve: %v", err)
		}
	})
	return sock
}

func call(t *testing.T, sock, op string) *Response {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := Call(ctx, sock, Request{Op: op})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func code(r *Response) string {
	if r.Error == nil {
		return ""
	}
	return r.Error.Code
}

func TestOpsByCaller(t *testing.T) {
	var who atomic.Value
	s := &Server{AgentGID: 990, Log: quiet, peer: func(net.Conn) (Peer, error) { return who.Load().(Peer), nil }}
	sock := serve(t, s)

	who.Store(Peer{UID: 990, GID: 990}) // agente
	if r := call(t, sock, OpPing); !r.OK {
		t.Fatalf("ping do agente: %+v", r)
	}
	if r := call(t, sock, OpFactoryReset); code(r) != ErrForbidden {
		t.Fatalf("reset pelo agente: %+v", r)
	}
	if r := call(t, sock, OpNetworkApply); code(r) != ErrNotImplemented {
		t.Fatalf("rede (esqueleto): %+v", r)
	}
	if r := call(t, sock, "shell.exec"); code(r) != ErrUnknownOp {
		t.Fatalf("operação fora da lista: %+v", r)
	}
	who.Store(Peer{UID: 0, Root: true})
	if r := call(t, sock, OpFactoryReset); code(r) != ErrNotImplemented {
		t.Fatalf("reset pelo root (esqueleto): %+v", r)
	}
	who.Store(Peer{UID: 1000, GID: 1000}) // outro usuário
	if r := call(t, sock, OpPing); code(r) != ErrForbidden {
		t.Fatalf("usuário qualquer: %+v", r)
	}
}

func TestBadRequests(t *testing.T) {
	s := &Server{Log: quiet, peer: func(net.Conn) (Peer, error) { return Peer{Root: true}, nil }}
	sock := serve(t, s)
	send := func(payload string) string {
		c, err := net.Dial("unix", sock)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		_, _ = c.Write([]byte(payload))
		if uc, ok := c.(*net.UnixConn); ok {
			_ = uc.CloseWrite()
		}
		b, _ := io.ReadAll(c)
		return string(b)
	}
	if out := send("não é json\n"); !strings.Contains(out, ErrBadRequest) {
		t.Fatalf("JSON inválido: %s", out)
	}
	if out := send(strings.Repeat("x", maxRequestBytes+10)); !strings.Contains(out, "grande demais") {
		t.Fatalf("pedido grande: %s", out)
	}
}

// Sem conexões por IdleExit, Serve termina (o socket reativa o serviço).
func TestIdleExit(t *testing.T) {
	l, err := net.Listen("unix", filepath.Join(t.TempDir(), "h.sock"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Log: quiet, IdleExit: 50 * time.Millisecond}
	done := make(chan error, 1)
	go func() { done <- s.Serve(context.Background(), l) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("não saiu ocioso")
	}
}

// SO_PEERCRED de verdade: o chamador é este processo.
func TestPeerCred(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("só Linux")
	}
	s := &Server{AgentGID: uint32(os.Getgid()), Log: quiet}
	sock := serve(t, s)
	r := call(t, sock, OpPing)
	if !r.OK {
		t.Fatalf("ping: %+v", r)
	}
	if uid := r.Result.(map[string]any)["uid"]; uid != float64(os.Getuid()) {
		t.Fatalf("uid do chamador: %v", uid)
	}
}
