package localapi

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/peercred"
)

func serve(t *testing.T, s *Server) string {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "ui.sock")
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

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func status(context.Context) Status {
	return Status{Agent: Agent{Version: "1.2.3"}, Queue: Queue{Pending: 7}}
}

// SO_PEERCRED de verdade: o próprio usuário está na lista.
func TestStatusOverSocket(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("só Linux")
	}
	sock := serve(t, &Server{Status: status, AllowUIDs: []uint32{uint32(os.Getuid())}, Log: quiet})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := NewClient(sock).Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.Agent.Version != "1.2.3" || st.Queue.Pending != 7 {
		t.Fatalf("status: %+v", st)
	}
}

func TestCallerAndRoutes(t *testing.T) {
	var who atomic.Value
	who.Store(peercred.Peer{UID: 1000, GID: 1000})
	s := &Server{Status: status, AllowGIDs: []uint32{995}, Log: quiet,
		peer: func(net.Conn) (peercred.Peer, error) { return who.Load().(peercred.Peer), nil }}
	sock := serve(t, s)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := NewClient(sock).Status(ctx); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("usuário fora da lista: %v", err)
	}
	who.Store(peercred.Peer{UID: 996, GID: 995}) // oee-ui
	c := NewClient(sock)
	if _, err := c.Status(ctx); err != nil {
		t.Fatalf("grupo da página: %v", err)
	}
	for _, tc := range []struct{ method, path string }{{http.MethodPost, "/v1/status"}, {http.MethodGet, "/v1/config"}} {
		req, _ := http.NewRequestWithContext(ctx, tc.method, "http://agente"+tc.path, nil)
		res, err := c.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusOK {
			t.Errorf("%s %s deveria ser recusado", tc.method, tc.path)
		}
	}
}
