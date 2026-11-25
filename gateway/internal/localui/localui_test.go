package localui

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCertIsStable(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tls")
	a, err := LoadOrCreateCert(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadOrCreateCert(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a.Certificate[0], b.Certificate[0]) {
		t.Fatal("o certificado mudou entre dois starts")
	}
	st, err := os.Stat(filepath.Join(dir, "key.pem"))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("chave: %v %v", st.Mode(), err)
	}
	// Chave estragada não é trocada em silêncio (o técnico perderia a confiança no certificado).
	if err := os.WriteFile(filepath.Join(dir, "key.pem"), []byte("lixo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateCert(dir); err == nil {
		t.Fatal("chave ilegível deveria dar erro")
	}
}

func TestServeAndGuard(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	s := &Server{StateDir: state, TLSDir: filepath.Join(state, "tls"), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, l) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("Serve: %v", err)
		}
	}()
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // autoassinado (o técnico aceita no navegador)
	}}
	url := "https://" + l.Addr().String()
	get := func(path, host, method string) (*http.Response, string) {
		t.Helper()
		req, _ := http.NewRequest(method, url+path, nil)
		if host != "" {
			req.Host = host
		}
		var resp *http.Response
		for i := 0; i < 50; i++ {
			if resp, err = client.Do(req); err == nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp, string(b)
	}
	// Sem sessão, "/" leva ao login (o cliente segue o 303).
	resp, body := get("/", "", http.MethodGet)
	if resp.StatusCode != 200 || !strings.Contains(body, "Gateway OEE") || resp.Request.URL.Path != "/entrar" || resp.Header.Get("Content-Security-Policy") == "" ||
		resp.Header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("página: %d %v", resp.StatusCode, resp.Header)
	}
	if resp, _ = get("/healthz", "localhost:443", http.MethodGet); resp.StatusCode != 200 {
		t.Fatalf("healthz: %d", resp.StatusCode)
	}
	if resp, _ = get("/", "gateway.exemplo.com", http.MethodGet); resp.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("Host por nome (DNS rebinding): %d", resp.StatusCode)
	}
	if resp, _ = get("/", "", http.MethodPost); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST sem Origin: %d", resp.StatusCode)
	}
	if resp, _ = get("/", "", http.MethodPut); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("PUT: %d", resp.StatusCode)
	}
}

func TestAllowedLocal(t *testing.T) {
	for addr, want := range map[string]bool{
		"127.0.0.1:443": true, "169.254.10.20:443": true, "192.168.10.5:443": true, "10.1.2.3:443": true,
		"8.8.8.8:443": false, "200.150.1.1:443": false,
	} {
		a, _ := net.ResolveTCPAddr("tcp", addr)
		if got := allowedLocal(a); got != want {
			t.Errorf("%s: %v", addr, got)
		}
	}
	for host, want := range map[string]bool{"192.168.10.5": true, "192.168.10.5:443": true, "[::1]:443": true, "localhost": true, "evil.com": false, "": false} {
		if got := allowedHost(host); got != want {
			t.Errorf("Host %q: %v", host, got)
		}
	}
}
