package uplink_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	stdlog "log"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/uplink"
)

// logSink guarda as linhas JSON do slog para o teste conferir.
type logSink struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logSink) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logSink) lines(t *testing.T) []map[string]any {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(l.buf.String()), "\n") {
		if raw == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("linha de log não é JSON: %q", raw)
		}
		out = append(out, m)
	}
	return out
}

func newLogSink() (*logSink, *slog.Logger) {
	sink := &logSink{}
	return sink, slog.New(slog.NewJSONHandler(sink, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// scriptSender devolve o erro configurado (nil = 200 sem itens).
type scriptSender struct {
	mu    sync.Mutex
	err   error
	calls int
}

func (s *scriptSender) set(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *scriptSender) Sync(_ context.Context, _ *contracts.SyncRequest) (*contracts.SyncResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return &contracts.SyncResponse{ServerTime: contracts.FormatTime(time.Now()), NextSyncS: 10}, nil
}

// emptyQueue é uma fila sem itens (ou que falha no Peek).
type emptyQueue struct{ peekErr error }

func (q emptyQueue) Peek(context.Context, int, int) ([]buffer.Item, error) { return nil, q.peekErr }
func (emptyQueue) Ack(context.Context, int64) error                        { return nil }
func (emptyQueue) Quarantine(context.Context, int64, string) error         { return nil }

func dnsErr() error {
	return &url.Error{Op: "Post", URL: "https://oee.exemplo.com.br/api/gateway/v1/sync",
		Err: &net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "no such host", Name: "oee.exemplo.com.br", IsNotFound: true}}}
}

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// A primeira falha sai na hora; a mesma classe só repete a cada FailureLogEvery
// (com quantas foram omitidas); troca de classe sai na hora; a volta registra a
// duração da queda. Depois de recuperado, uma falha nova abre outra sequência.
func TestSyncFailureLogIsRateLimited(t *testing.T) {
	sink, log := newLogSink()
	snd := &scriptSender{}
	clk := &clock{now: t0}
	sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Now: clk.Now, Log: log}
	ctx := context.Background()
	step := func(err error, d time.Duration) {
		t.Helper()
		clk.advance(d)
		snd.set(err)
		_, _ = sy.SyncOnce(ctx)
	}

	step(dnsErr(), 0) // t0: primeira falha
	for i := 0; i < 5; i++ {
		step(dnsErr(), time.Minute) // t0+1..5 min: omitidas
	}
	if got := len(sink.lines(t)); got != 1 {
		t.Fatalf("repetições dentro do intervalo deveriam ser omitidas: %d linha(s)", got)
	}
	step(dnsErr(), 5*time.Minute)                                          // t0+10 min: persiste
	step(&uplink.HTTPError{Status: 503, Code: "unavailable"}, time.Minute) // t0+11 min: mudou
	step(&uplink.HTTPError{Status: 503, Code: "unavailable"}, time.Minute) // t0+12 min: omitida
	step(nil, time.Minute)                                                 // t0+13 min: recuperado
	step(nil, time.Minute)                                                 // nada
	step(&uplink.HTTPError{Status: 404, Code: "not_found"}, time.Minute)   // nova queda
	step(context.Canceled, time.Minute)                                    // desligamento: nada
	step(fmt.Errorf("embrulhado: %w", context.Canceled), time.Second)      // idem

	lines := sink.lines(t)
	want := []struct {
		level, msgPrefix, class string
		extra                   map[string]any
	}{
		{"WARN", "falha no sync com a nuvem: a coleta continua", uplink.ClassDNS, nil},
		{"WARN", "falha no sync com a nuvem persiste", uplink.ClassDNS, map[string]any{"duracao": "10m0s", "falhas": 7.0, "omitidas": 5.0}},
		{"WARN", "falha no sync com a nuvem mudou de causa", uplink.ClassHTTP5xx, map[string]any{"classe_anterior": uplink.ClassDNS, "status": 503.0, "codigo": "unavailable", "duracao": "11m0s", "falhas": 8.0}},
		{"INFO", "sync com a nuvem recuperado", uplink.ClassHTTP5xx, map[string]any{"duracao": "13m0s", "falhas": 9.0}},
		{"WARN", "falha no sync com a nuvem: a coleta continua", uplink.ClassHTTP4xx, map[string]any{"status": 404.0}},
	}
	if len(lines) != len(want) {
		t.Fatalf("quer %d linhas, teve %d: %v", len(want), len(lines), lines)
	}
	for i, w := range want {
		l := lines[i]
		if l["level"] != w.level || !strings.HasPrefix(l["msg"].(string), w.msgPrefix) || l["classe"] != w.class {
			t.Errorf("linha %d = %v; quer %s %q classe %s", i, l, w.level, w.msgPrefix, w.class)
		}
		for k, v := range w.extra {
			if l[k] != v {
				t.Errorf("linha %d: %s = %v, quer %v (%v)", i, k, l[k], v, l)
			}
		}
		if w.level == "WARN" && l["erro"] == nil {
			t.Errorf("linha %d sem o erro: %v", i, l)
		}
	}
}

// O 401 tem o alarme próprio (OnBlocked): o syncer não duplica a linha de falha,
// mas a queda entra na conta e a volta é registrada com a duração.
func TestUnauthorizedIsNotLoggedTwiceButRecoveryIs(t *testing.T) {
	sink, log := newLogSink()
	snd := &scriptSender{}
	clk := &clock{now: t0}
	sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Now: clk.Now, Log: log}
	alarms := 0
	sy.OnBlocked = func(error) { alarms++ }

	snd.set(&uplink.HTTPError{Status: 401, Code: "token_revoked"})
	_, _ = sy.SyncOnce(context.Background())
	if n := len(sink.lines(t)); n != 0 || alarms != 1 {
		t.Fatalf("401: %d linha(s) do syncer, %d alarme(s); quer 0 e 1", n, alarms)
	}
	clk.advance(2 * time.Hour)
	snd.set(nil)
	sy.Unblock()
	if _, err := sy.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	lines := sink.lines(t)
	if len(lines) != 1 || lines[0]["msg"] != "sync com a nuvem recuperado" || lines[0]["classe"] != uplink.ClassUnauthorized || lines[0]["duracao"] != "2h0m0s" {
		t.Fatalf("recuperação: %v", lines)
	}
}

// Falha da fila local aparece como classe "buffer", não como falha da nuvem.
func TestQueueFailureIsLoggedAsBuffer(t *testing.T) {
	sink, log := newLogSink()
	sy := &uplink.Syncer{Sender: &scriptSender{}, Queue: emptyQueue{peekErr: errors.New("database is locked")}, Log: log}
	_, err := sy.SyncOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "uplink: lendo a fila: database is locked") {
		t.Fatalf("erro: %v", err)
	}
	if lines := sink.lines(t); len(lines) != 1 || lines[0]["classe"] != uplink.ClassBuffer {
		t.Fatalf("log: %v", lines)
	}
}

func closedAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

// syncErr faz um /sync de verdade com o transporte dado e devolve o erro.
func syncErr(t *testing.T, baseURL string, tr *http.Transport, timeout time.Duration) error {
	t.Helper()
	c, err := uplink.New(uplink.Options{BaseURL: baseURL, Token: token, AgentVersion: "0.1.0",
		HTTPClient: &http.Client{Transport: tr, Timeout: timeout}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Sync(context.Background(), &contracts.SyncRequest{})
	if err == nil {
		t.Fatal("o /sync deveria falhar")
	}
	return err
}

// Classes das falhas que o campo mais vê, com erros reais do transporte do Go
// (proxy, TLS, conexão, timeout) e os da API.
func TestFailureClass(t *testing.T) {
	// Proxy corporativo que exige autenticação: o CONNECT volta 407.
	proxy407 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			t.Errorf("proxy recebeu %s", r.Method)
		}
		w.WriteHeader(http.StatusProxyAuthRequired)
	}))
	defer proxy407.Close()
	proxyURL, _ := url.Parse(proxy407.URL)
	deadProxy, _ := url.Parse("http://" + closedAddr(t))

	// Nuvem atrás de inspeção SSL (CA desconhecida).
	tlsSrv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	tlsSrv.Config.ErrorLog = stdlog.New(io.Discard, "", 0) // sem o "TLS handshake error" no stderr
	tlsSrv.StartTLS()
	defer tlsSrv.Close()

	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer slow.Close()
	defer close(release) // antes do Close, que espera os handlers

	hangup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	}))
	defer hangup.Close()

	noProxy := func() *http.Transport {
		return &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	}
	viaProxy := func(u *url.URL) *http.Transport { tr := noProxy(); tr.Proxy = http.ProxyURL(u); return tr }
	dnsFail := noProxy()
	dnsFail.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return nil, &net.OpError{Op: "dial", Net: network, Err: &net.DNSError{Err: "no such host", Name: "oee.exemplo.com.br", IsNotFound: true}}
	}

	cases := []struct {
		name string
		err  error
		want string
	}{
		{"proxy pede autenticação (407)", syncErr(t, "https://oee.exemplo.invalid", viaProxy(proxyURL), 5*time.Second), uplink.ClassProxy},
		{"proxy fora do ar", syncErr(t, "https://oee.exemplo.invalid", viaProxy(deadProxy), 5*time.Second), uplink.ClassProxy},
		{"CA desconhecida", syncErr(t, tlsSrv.URL, noProxy(), 5*time.Second), uplink.ClassTLS},
		{"DNS", syncErr(t, "https://oee.exemplo.com.br", dnsFail, 5*time.Second), uplink.ClassDNS},
		{"conexão recusada", syncErr(t, "http://"+closedAddr(t), noProxy(), 5*time.Second), uplink.ClassConnection},
		{"conexão derrubada", syncErr(t, hangup.URL, noProxy(), 5*time.Second), uplink.ClassConnection},
		{"timeout", syncErr(t, slow.URL, noProxy(), 50*time.Millisecond), uplink.ClassTimeout},
		{"DNS sintético", dnsErr(), uplink.ClassDNS},
		{"prazo do contexto", context.DeadlineExceeded, uplink.ClassTimeout},
		{"401", &uplink.HTTPError{Status: 401, Code: "unauthorized"}, uplink.ClassUnauthorized},
		{"429", &uplink.HTTPError{Status: 429}, uplink.ClassHTTP4xx},
		{"404", &uplink.HTTPError{Status: 404}, uplink.ClassHTTP4xx},
		{"500", &uplink.HTTPError{Status: 500}, uplink.ClassHTTP5xx},
		{"502", fmt.Errorf("embrulhado: %w", &uplink.HTTPError{Status: 502}), uplink.ClassHTTP5xx},
		{"outro", errors.New("uplink: resposta 200 inválida"), uplink.ClassOther},
	}
	for _, c := range cases {
		if got := uplink.FailureClass(c.err); got != c.want {
			t.Errorf("%s: classe %q, quer %q (erro: %v)", c.name, got, c.want, c.err)
		}
	}
	if uplink.FailureClass(nil) != "" {
		t.Error("sem erro, sem classe")
	}
}

// ---------------------------------------------------------------------------
// Marcador de credencial recusada
// ---------------------------------------------------------------------------

func readMarker(t *testing.T, path string) *uplink.BlockedMarker {
	t.Helper()
	m, err := uplink.ReadBlockedMarker(path)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// Bloqueado por 401, o agente grava o marcador (0600) ao lado da credencial e o
// atualiza a cada sonda recusada, mantendo o início; quando a sonda passa, apaga.
func TestUnauthorizedWritesBlockedMarkerUntilAccepted(t *testing.T) {
	var mu sync.Mutex
	refusals := 2 // envio e primeira sonda: 401; segunda sonda: 200
	fc := newCloud(t, func(req contracts.SyncRequest) (int, any, http.Header) {
		mu.Lock()
		defer mu.Unlock()
		if refusals > 0 {
			refusals--
			return apiErr(401, "token_revoked", nil)
		}
		return ok(req, 10)
	})
	store, _ := newStore(t, 2, 0)
	sy := newSyncer(t, fc, store)
	sink, log := newLogSink()
	sy.Log = log
	marker := uplink.BlockedMarkerPath(filepath.Join(t.TempDir(), "credentials.json"))
	sy.MarkerPath = marker
	clock := t0
	sy.Now = func() time.Time { return clock }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var seen []*uplink.BlockedMarker
	sy.Sleep = func(ctx context.Context, d time.Duration) error {
		seen = append(seen, readMarker(t, marker))
		if len(seen) == 1 {
			if st, err := os.Stat(marker); err != nil || st.Mode().Perm() != 0o600 {
				t.Errorf("marcador deveria ter 0600: %v (%v)", st, err)
			}
		}
		clock = clock.Add(d)
		if len(seen) == 3 {
			cancel()
			return ctx.Err()
		}
		return nil
	}
	if err := sy.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run: %v", err)
	}
	first := t0.Format(time.RFC3339)
	probe := t0.Add(uplink.DefaultProbeEvery).Format(time.RFC3339)
	if m := seen[0]; m == nil || m.Since != first || m.Last != first || m.Status != 401 || m.Code != "token_revoked" {
		t.Fatalf("depois do 401: %+v", m)
	}
	if m := seen[1]; m == nil || m.Since != first || m.Last != probe {
		t.Fatalf("depois da sonda recusada (início mantido, último atualizado): %+v", m)
	}
	if seen[2] != nil {
		t.Fatalf("depois da sonda aceita o marcador deveria sumir: %+v", seen[2])
	}
	var removedLogged bool
	for _, l := range sink.lines(t) {
		if strings.HasPrefix(l["msg"].(string), "nuvem voltou a aceitar o token") {
			removedLogged = true
		}
	}
	if !removedLogged {
		t.Fatalf("a remoção do marcador deveria ir para o log: %v", sink.lines(t))
	}
}

// Marcador antigo (agente reiniciado bloqueado, rede voltou): o primeiro 200 apaga;
// um 409 também prova que o token foi aceito. Sem MarkerPath, nada é gravado.
func TestBlockedMarkerClearedBySuccessOr409(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"200", nil},
		{"409", &uplink.HTTPError{Status: 409, Code: "config_outdated"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), uplink.BlockedMarkerFile)
			if err := uplink.WriteBlockedMarker(marker, &uplink.BlockedMarker{Since: "2026-11-01T00:00:00Z", Status: 401}); err != nil {
				t.Fatal(err)
			}
			_, log := newLogSink()
			snd := &scriptSender{err: tc.err}
			sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Log: log, MarkerPath: marker}
			_, _ = sy.SyncOnce(context.Background())
			if m := readMarker(t, marker); m != nil {
				t.Fatalf("marcador deveria ser apagado: %+v", m)
			}
		})
	}

	// 5xx não prova nada sobre o token: o marcador fica.
	marker := filepath.Join(t.TempDir(), uplink.BlockedMarkerFile)
	if err := uplink.WriteBlockedMarker(marker, &uplink.BlockedMarker{Since: "2026-11-01T00:00:00Z", Status: 401}); err != nil {
		t.Fatal(err)
	}
	_, log := newLogSink()
	sy := &uplink.Syncer{Sender: &scriptSender{err: &uplink.HTTPError{Status: 503}}, Queue: emptyQueue{}, Log: log, MarkerPath: marker}
	_, _ = sy.SyncOnce(context.Background())
	if readMarker(t, marker) == nil {
		t.Fatal("503 não deveria apagar o marcador")
	}

	// Sem MarkerPath o 401 não grava nada.
	dir := t.TempDir()
	sy = &uplink.Syncer{Sender: &scriptSender{err: &uplink.HTTPError{Status: 401}}, Queue: emptyQueue{}, Log: log}
	_, _ = sy.SyncOnce(context.Background())
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("nada deveria ser gravado: %v", entries)
	}
}

func TestBlockedMarkerReadWrite(t *testing.T) {
	dir := t.TempDir()
	if got := uplink.BlockedMarkerPath(filepath.Join(dir, "credentials.json")); got != filepath.Join(dir, "auth-blocked") {
		t.Fatalf("caminho: %s", got)
	}
	path := filepath.Join(dir, uplink.BlockedMarkerFile)
	if m := readMarker(t, path); m != nil {
		t.Fatalf("ausente deveria ser nil: %+v", m)
	}
	if removed, err := uplink.RemoveBlockedMarker(path); removed || err != nil {
		t.Fatalf("remover ausente: %v %v", removed, err)
	}
	in := &uplink.BlockedMarker{Since: "2026-11-10T08:00:00Z", Last: "2026-11-10T08:15:00Z", Status: 401, Code: "unauthorized"}
	if err := uplink.WriteBlockedMarker(path, in); err != nil {
		t.Fatal(err)
	}
	if m := readMarker(t, path); m == nil || *m != *in {
		t.Fatalf("lido: %+v", m)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("a escrita atômica não deveria deixar temporários: %v", entries)
	}
	// Conteúdo ilegível ainda conta como marcador.
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if m := readMarker(t, path); m == nil {
		t.Fatal("conteúdo ilegível deveria contar como marcador")
	}
	if removed, err := uplink.RemoveBlockedMarker(path); !removed || err != nil {
		t.Fatalf("remover: %v %v", removed, err)
	}
}

// Queda que alterna entre duas classes (cache do resolvedor expirando: dns ↔
// timeout; proxy instável) não registra toda tentativa: cada classe nova na queda
// sai na hora, e uma que volta segue o mesmo limite da repetição (com as classes
// vistas). Antes, cada troca saía na hora: 62 tentativas, 62 linhas.
func TestAlternatingFailureClassesAreRateLimited(t *testing.T) {
	sink, log := newLogSink()
	snd := &scriptSender{}
	clk := &clock{now: t0}
	sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Now: clk.Now, Log: log}
	timeoutErr := &url.Error{Op: "Post", URL: "https://oee.exemplo.com.br/api/gateway/v1/sync",
		Err: &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}}
	if c := uplink.FailureClass(timeoutErr); c != uplink.ClassTimeout {
		t.Fatalf("classe do erro de prazo: %s", c)
	}

	// t0, t0+10 s, ..., t0+610 s: dns nas pares, timeout nas ímpares.
	for i := 0; i <= 61; i++ {
		if i > 0 {
			clk.advance(10 * time.Second)
		}
		if i%2 == 0 {
			snd.set(dnsErr())
		} else {
			snd.set(timeoutErr)
		}
		_, _ = sy.SyncOnce(context.Background())
	}
	clk.advance(10 * time.Second)
	snd.set(nil)
	if _, err := sy.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	lines := sink.lines(t)
	if len(lines) != 4 {
		var msgs []string
		for _, l := range lines {
			msgs = append(msgs, fmt.Sprintf("%v (%v)", l["msg"], l["classe"]))
		}
		t.Fatalf("quer 4 linhas (primeira, classe nova, persiste, recuperado), teve %d:\n%s", len(lines), strings.Join(msgs, "\n"))
	}
	both := []any{uplink.ClassDNS, uplink.ClassTimeout}
	checks := []struct {
		msg   string
		class string
		extra map[string]any
	}{
		{"falha no sync com a nuvem: a coleta continua e os dados ficam no buffer", uplink.ClassDNS, nil},
		{"falha no sync com a nuvem mudou de causa", uplink.ClassTimeout, map[string]any{"classe_anterior": uplink.ClassDNS, "omitidas": 0.0}},
		// Só 600 s depois da última linha (t0+10 s): t0+610 s, tentativa 62.
		{"falha no sync com a nuvem persiste", uplink.ClassTimeout, map[string]any{"duracao": "10m10s", "falhas": 62.0, "omitidas": 59.0}},
		{"sync com a nuvem recuperado", uplink.ClassTimeout, map[string]any{"duracao": "10m20s", "falhas": 62.0}},
	}
	for i, c := range checks {
		l := lines[i]
		if l["msg"] != c.msg || l["classe"] != c.class {
			t.Errorf("linha %d = %v; quer %q classe %s", i, l, c.msg, c.class)
		}
		for k, v := range c.extra {
			if l[k] != v {
				t.Errorf("linha %d: %s = %v, quer %v", i, k, l[k], v)
			}
		}
	}
	for _, i := range []int{1, 2, 3} {
		if got := fmt.Sprint(lines[i]["classes"]); got != fmt.Sprint(both) {
			t.Errorf("linha %d: classes = %v, quer %v", i, got, both)
		}
	}
	if _, ok := lines[0]["classes"]; ok {
		t.Errorf("com uma classe só, sem o campo classes: %v", lines[0])
	}
}

// rawProxy responde a todo CONNECT com a linha de status dada: proxies reais usam
// frases fora do padrão, vazias ou nenhuma.
func rawProxy(t *testing.T, statusLine string) *url.URL {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				if _, err := http.ReadRequest(bufio.NewReader(c)); err != nil {
					return
				}
				_, _ = io.WriteString(c, statusLine+"\r\nContent-Length: 0\r\n\r\n")
			}()
		}
	}()
	u, _ := url.Parse("http://" + ln.Addr().String())
	return u
}

// A recusa do CONNECT é "proxy" seja qual for a frase do status (o transporte do
// Go só devolve a frase, sem o código): o cliente a tipa (ProxyConnectError) com o
// código e a frase como vieram. Os erros sem tipo, com o mesmo texto ou não, não
// viram "proxy".
func TestConnectRefusalWithAnyReasonPhraseIsProxy(t *testing.T) {
	via := func(u *url.URL) *http.Transport {
		return &http.Transport{Proxy: http.ProxyURL(u), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	}
	for _, c := range []struct {
		line   string
		status int
		reason string
	}{
		{"HTTP/1.1 407 Proxy Authentication Required", 407, "Proxy Authentication Required"},
		{"HTTP/1.1 407 Authentication Required", 407, "Authentication Required"},
		{"HTTP/1.1 403 Forbidden", 403, "Forbidden"},
		{"HTTP/1.1 403 Tunnel or SSL Forbidden", 403, "Tunnel or SSL Forbidden"},
		{"HTTP/1.1 407 ", 407, ""}, // frase vazia
		{"HTTP/1.1 407", 407, ""},  // sem frase ("unknown status code" no transporte)
		{"HTTP/1.0 502 Proxy Error", 502, "Proxy Error"},
	} {
		proxy := rawProxy(t, c.line)
		err := syncErr(t, "https://oee.exemplo.invalid", via(proxy), 5*time.Second)
		if got := uplink.FailureClass(err); got != uplink.ClassProxy {
			t.Errorf("CONNECT %q: classe %q, quer proxy (erro: %v)", c.line, got, err)
		}
		var pr *uplink.ProxyConnectError
		if !errors.As(err, &pr) {
			t.Errorf("CONNECT %q: erro sem tipo: %v", c.line, err)
			continue
		}
		if pr.Status != c.status || pr.Reason != c.reason || pr.Proxy != proxy.Host {
			t.Errorf("CONNECT %q: %+v, quer status %d, frase %q, proxy %s", c.line, *pr, c.status, c.reason, proxy.Host)
		}
		if !strings.Contains(err.Error(), fmt.Sprint(c.status)) {
			t.Errorf("CONNECT %q: o código não aparece no erro: %v", c.line, err)
		}
	}

	ue := func(err error) error {
		return &url.Error{Op: "Post", URL: "https://oee.exemplo.com.br/api/gateway/v1/sync", Err: err}
	}
	for _, c := range []struct {
		err  error
		want string
	}{
		{ue(io.EOF), uplink.ClassConnection},
		{ue(io.ErrUnexpectedEOF), uplink.ClassConnection},
		{ue(errors.New("stopped after 10 redirects")), uplink.ClassOther},
		{ue(http.ErrSchemeMismatch), uplink.ClassOther},
		{ue(errors.New("net/http: request canceled")), uplink.ClassOther},
		{ue(context.Canceled), uplink.ClassOther},
		// Erros sem tipo do net/http (badStringError), com ou sem proxy.
		{ue(errors.New(`malformed HTTP response "lixo"`)), uplink.ClassOther},
		{ue(errors.New(`malformed HTTP status code "abc"`)), uplink.ClassOther},
		// O mesmo texto da recusa, sem o tipo, não prova CONNECT nenhum.
		{ue(errors.New("Proxy Authentication Required")), uplink.ClassOther},
		{errors.New("Forbidden"), uplink.ClassOther}, // sem url.Error não veio do transporte
		{fmt.Errorf("embrulhado: %w", &uplink.ProxyConnectError{Status: 407}), uplink.ClassProxy},
	} {
		if got := uplink.FailureClass(c.err); got != c.want {
			t.Errorf("%v: classe %q, quer %q", c.err, got, c.want)
		}
	}
}

// garbageServer lê a requisição e responde com a linha de status dada (HTTP sem
// TLS): o net/http devolve "malformed HTTP response"/"malformed HTTP status code"
// num erro sem tipo, o mesmo tipo da recusa do CONNECT.
func garbageServer(t *testing.T, statusLine string) string {
	t.Helper()
	u := rawProxy(t, statusLine) // o mesmo servidor: lê uma requisição e responde a linha
	return "http://" + u.Host
}

// tunnelProxy aceita todo CONNECT (200) e liga o túnel ao destino pedido.
func tunnelProxy(t *testing.T) *url.URL {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				br := bufio.NewReader(c)
				req, err := http.ReadRequest(br)
				if err != nil || req.Method != http.MethodConnect {
					return
				}
				dst, err := net.Dial("tcp", req.Host)
				if err != nil {
					_, _ = io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
					return
				}
				defer dst.Close()
				if _, err := io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n"); err != nil {
					return
				}
				go func() { _, _ = io.Copy(dst, br); dst.Close() }()
				_, _ = io.Copy(c, dst)
			}()
		}
	}()
	u, _ := url.Parse("http://" + ln.Addr().String())
	return u
}

// replyFirstConn faz o servidor responder antes de o cliente escrever qualquer byte
// da requisição: a leitura só começa quando o transporte tenta escrever, e a escrita
// fica presa até a conexão fechar sem escrever nada. O transporte do Go devolve então
// o erro da leitura cru (nothingWrittenError, sem "net/http: HTTP/1.x transport
// connection broken"), do mesmo jeito que devolve a resposta ilegível ao CONNECT.
type replyFirstConn struct {
	net.Conn
	writing, closed      chan struct{}
	writeOnce, closeOnce sync.Once
}

func (c *replyFirstConn) Read(p []byte) (int, error) {
	select {
	case <-c.writing:
	case <-c.closed:
	}
	return c.Conn.Read(p)
}

func (c *replyFirstConn) Write([]byte) (int, error) {
	c.writeOnce.Do(func() { close(c.writing) })
	<-c.closed
	return 0, net.ErrClosed
}

func (c *replyFirstConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

// Sem proxy, erro sem tipo do net/http não é "proxy": nem a resposta malformada
// do servidor (um serviço que não é HTTP na porta), nem o esquema que o transporte
// não conhece ("unsupported protocol scheme"). Depois de um CONNECT aceito, a
// resposta malformada da nuvem do outro lado do túnel também não é do proxy.
//
// A regra antiga (pelo texto do erro) já excluía o prefixo "net/http:", então os
// casos em que o servidor lê a requisição e responde lixo, que chegam decorados,
// só guardam esse caminho contra regressão. O que prova a regra nova é o erro cru,
// sem decoração, como a recusa do CONNECT chegava (antes era "proxy"): o esquema
// errado, a resposta antes de qualquer byte da requisição (replyFirstConn) e as
// linhas sintéticas de TestConnectRefusalWithAnyReasonPhraseIsProxy.
func TestMalformedResponseIsNotProxy(t *testing.T) {
	noProxy := func() *http.Transport {
		return &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	}
	for _, line := range []string{
		"lixo",            // malformed HTTP response
		"HTTP/1.1 abc OK", // malformed HTTP status code
		"HTTP/1.1 99 OK",  // idem (< 100)
	} {
		err := syncErr(t, garbageServer(t, line), noProxy(), 5*time.Second)
		var ue *url.Error
		if !errors.As(err, &ue) || !strings.HasPrefix(fmt.Sprint(ue.Err), "net/http: HTTP/1.x transport connection broken: malformed HTTP") {
			t.Fatalf("%q: o teste quer o erro decorado do net/http, veio %v", line, err)
		}
		if got := uplink.FailureClass(err); got != uplink.ClassOther {
			t.Errorf("%q sem proxy: classe %q, quer outro (erro: %v)", line, got, err)
		}
	}

	// Sem proxy, a resposta ilegível antes de qualquer byte da requisição: o erro
	// chega cru, com o mesmo texto da resposta ilegível ao CONNECT.
	first := noProxy()
	first.DialContext = func(context.Context, string, string) (net.Conn, error) {
		cli, srv := net.Pipe()
		go func() {
			defer srv.Close()
			_, _ = io.WriteString(srv, "lixo\r\n\r\n")
		}()
		return &replyFirstConn{Conn: cli, writing: make(chan struct{}), closed: make(chan struct{})}, nil
	}
	err := syncErr(t, "http://oee.exemplo.invalid", first, 5*time.Second)
	var ue *url.Error
	if !errors.As(err, &ue) || !strings.HasPrefix(fmt.Sprint(ue.Err), "malformed HTTP response") {
		t.Fatalf("resposta antes da requisição: o teste quer o erro cru do net/http, veio %v", err)
	}
	if got := uplink.FailureClass(err); got != uplink.ClassOther {
		t.Errorf("resposta antes da requisição, sem proxy: classe %q, quer outro (erro: %v)", got, err)
	}

	err = syncErr(t, "htps://oee.exemplo.com.br", noProxy(), 5*time.Second)
	if !errors.As(err, &ue) || !strings.HasPrefix(ue.Err.Error(), "unsupported protocol scheme") {
		t.Fatalf("esquema errado: o teste quer o erro cru do net/http, veio %v", err)
	}
	if got := uplink.FailureClass(err); got != uplink.ClassOther {
		t.Errorf("esquema errado, sem proxy: classe %q, quer outro (erro: %v)", got, err)
	}

	// Pelo túnel: a nuvem (TLS) aceita o handshake e responde lixo dentro dele.
	cloud := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = buf.WriteString("lixo\r\n\r\n")
		_ = buf.Flush()
	}))
	cloud.Config.ErrorLog = stdlog.New(io.Discard, "", 0)
	cloud.StartTLS()
	defer cloud.Close()
	pool := x509.NewCertPool()
	pool.AddCert(cloud.Certificate())
	tr := &http.Transport{Proxy: http.ProxyURL(tunnelProxy(t)), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}}
	err = syncErr(t, cloud.URL, tr, 5*time.Second)
	if !strings.Contains(err.Error(), "malformed HTTP response") {
		t.Fatalf("pelo túnel: o teste quer o erro sem tipo do net/http, veio %v", err)
	}
	if got := uplink.FailureClass(err); got != uplink.ClassOther {
		t.Errorf("CONNECT aceito e resposta malformada: classe %q, quer outro (erro: %v)", got, err)
	}
}

// O proxy que responde ao CONNECT com algo que nem é HTTP (porta ou esquema do
// proxy errados: SOCKS, TLS) é "proxy": o transporte devolve o "malformed HTTP
// ..." cru, e o cliente o tipa só porque a requisição foi por um proxy.
func TestProxyGarbageConnectReplyIsProxy(t *testing.T) {
	for _, line := range []string{"lixo", "HTTP/1.1 abc OK", "\x15\x03\x01\x00\x02\x02\x46"} {
		proxy := rawProxy(t, line)
		tr := &http.Transport{Proxy: http.ProxyURL(proxy), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
		err := syncErr(t, "https://oee.exemplo.invalid", tr, 5*time.Second)
		var pce *uplink.ProxyConnectError
		if !errors.As(err, &pce) || pce.Status != 0 || pce.Proxy != proxy.Host || !strings.Contains(fmt.Sprint(pce.Err), "malformed HTTP") {
			t.Errorf("CONNECT respondido com %q: erro %v, quer ProxyConnectError sem status do proxy %s", line, err, proxy.Host)
		}
		if got := uplink.FailureClass(err); got != uplink.ClassProxy {
			t.Errorf("CONNECT respondido com %q: classe %q, quer proxy (erro: %v)", line, got, err)
		}
	}
}

// Com o cliente de fora (HTTPClient), o OnProxyConnectResponse que já existia
// continua sendo chamado antes, e o transporte de quem chamou não muda.
func TestInjectedTransportKeepsItsConnectHook(t *testing.T) {
	calls := 0
	tr := &http.Transport{Proxy: http.ProxyURL(rawProxy(t, "HTTP/1.1 407 Proxy Authentication Required")),
		OnProxyConnectResponse: func(context.Context, *url.URL, *http.Request, *http.Response) error { calls++; return nil }}
	err := syncErr(t, "https://oee.exemplo.invalid", tr, 5*time.Second)
	var pr *uplink.ProxyConnectError
	if !errors.As(err, &pr) || pr.Status != http.StatusProxyAuthRequired || uplink.FailureClass(err) != uplink.ClassProxy {
		t.Fatalf("erro %v (classe %q), quer ProxyConnectError 407", err, uplink.FailureClass(err))
	}
	if calls != 1 {
		t.Errorf("o gancho de quem chamou rodou %d vez(es), quer 1", calls)
	}
	// O gancho do transporte original é o de quem chamou, sem o do cliente.
	if err := tr.OnProxyConnectResponse(context.Background(), nil, nil, &http.Response{StatusCode: 407, Status: "407 X"}); err != nil {
		t.Errorf("o New mudou o transporte de quem chamou: %v", err)
	}
	// Quando o gancho de quem chamou recusa, vale o erro dele.
	own := errors.New("recusado pelo gancho de quem chamou")
	tr2 := &http.Transport{Proxy: tr.Proxy,
		OnProxyConnectResponse: func(context.Context, *url.URL, *http.Request, *http.Response) error { return own }}
	if err := syncErr(t, "https://oee.exemplo.invalid", tr2, 5*time.Second); !errors.Is(err, own) {
		t.Errorf("erro %v, quer o do gancho de quem chamou", err)
	}
}

// Enlace instável (roteador 4G, proxy sobrecarregado, timeout ocasional): quedas
// curtas em sequência dividem o limite do log. Antes, cada sucesso fechava a queda
// e zerava o limite, e cada falha seguinte abria outra com linha na hora: um /sync
// a cada 10 s alternando falha e sucesso dava 360 linhas em 1 h.
func TestFlappingLinkLogVolumeIsBounded(t *testing.T) {
	for _, tc := range []struct {
		name    string
		pattern []error // um /sync a cada 10 s, em ciclo
		want    int     // linhas em 1 h
		skipped float64 // quedas_omitidas na segunda abertura
	}{
		// Por janela de 10 min: abertura e volta.
		{"falha e sucesso alternados", []error{context.DeadlineExceeded, nil}, 12, 29},
		// A segunda falha da queda curta não pode sair como "persiste" na hora.
		{"duas falhas e um sucesso", []error{context.DeadlineExceeded, context.DeadlineExceeded, nil}, 12, 19},
		// A classe vista numa queda anterior da janela não é nova na seguinte: por
		// janela, abertura, mudança de causa e volta.
		{"duas classes por queda", []error{context.DeadlineExceeded, dnsErr(), nil}, 18, 19},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sink, log := newLogSink()
			snd := &scriptSender{}
			clk := &clock{now: t0}
			sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Now: clk.Now, Log: log}
			for i := 0; i < 360; i++ {
				clk.advance(10 * time.Second)
				snd.set(tc.pattern[i%len(tc.pattern)])
				_, _ = sy.SyncOnce(context.Background())
			}
			lines := sink.lines(t)
			if len(lines) != tc.want {
				t.Fatalf("enlace instável: %d linhas em 1 h, quer %d", len(lines), tc.want)
			}
			var opens []map[string]any
			for _, l := range lines {
				if strings.HasPrefix(l["msg"].(string), "falha no sync com a nuvem: a coleta continua") {
					opens = append(opens, l)
				}
			}
			if len(opens) != 6 {
				t.Fatalf("quer uma abertura a cada 10 min (6), teve %d", len(opens))
			}
			if _, ok := opens[0]["quedas_omitidas"]; ok {
				t.Errorf("a primeira abertura não omitiu queda nenhuma: %v", opens[0])
			}
			// As quedas curtas que ficaram sem linha aparecem na abertura seguinte.
			if got := opens[1]["quedas_omitidas"]; got != tc.skipped {
				t.Errorf("quedas_omitidas = %v, quer %v (%v)", got, tc.skipped, opens[1])
			}
		})
	}
}

// Quedas curtas dividem o limite: a que começa menos de FailureLogEvery depois da
// última abertura registrada, com uma classe já vista desde então, fica quieta (e
// a volta dela também); se durar, a regra de repetição de sempre, contada daquela
// abertura, a registra. Classe nova abre na hora, e a volta do 401 sempre sai.
func TestShortOutagesShareTheFailureLogLimit(t *testing.T) {
	sink, log := newLogSink()
	snd := &scriptSender{}
	clk := &clock{now: t0}
	sy := &uplink.Syncer{Sender: snd, Queue: emptyQueue{}, Now: clk.Now, Log: log}
	step := func(err error, d time.Duration) {
		t.Helper()
		clk.advance(d)
		snd.set(err)
		_, _ = sy.SyncOnce(context.Background())
	}
	const s10 = 10 * time.Second

	step(dnsErr(), 0)                                                // t0: abre (1)
	step(nil, s10)                                                   // t0+10 s: recuperado (2)
	step(dnsErr(), s10)                                              // t0+20 s: queda curta, classe já vista: quieta
	step(dnsErr(), s10)                                              // t0+30 s: idem, sem "persiste" na hora
	step(nil, s10)                                                   // t0+40 s: volta sem linha
	step(&uplink.HTTPError{Status: 503}, s10)                        // t0+50 s: classe nova: abre (3)
	step(nil, s10)                                                   // t0+60 s: recuperado (4)
	step(dnsErr(), s10)                                              // t0+70 s: quieta...
	step(&uplink.HTTPError{Status: 401, Code: "token_revoked"}, s10) // t0+80 s: ...até o 401 (alarme do OnBlocked)
	sy.Unblock()                                                     //
	step(nil, s10)                                                   // t0+90 s: a volta do 401 sai sempre (5)
	step(dnsErr(), s10)                                              // t0+100 s: queda quieta que vai durar
	for i := 0; i < 9; i++ {
		step(dnsErr(), time.Minute) // até t0+10 min 40 s: persiste (6)
	}
	step(nil, s10)      // t0+10 min 50 s: recuperado (7)
	step(dnsErr(), s10) // t0+11 min: janela nova, abre (8)

	lines := sink.lines(t)
	open := "falha no sync com a nuvem: a coleta continua e os dados ficam no buffer"
	want := []struct {
		msg, class string
		extra      map[string]any
	}{
		{open, uplink.ClassDNS, nil},
		{"sync com a nuvem recuperado", uplink.ClassDNS, map[string]any{"duracao": "10s", "falhas": 1.0}},
		{open, uplink.ClassHTTP5xx, map[string]any{"quedas_omitidas": 1.0, "status": 503.0}},
		{"sync com a nuvem recuperado", uplink.ClassHTTP5xx, nil},
		{"sync com a nuvem recuperado", uplink.ClassUnauthorized, map[string]any{"duracao": "20s", "falhas": 2.0}},
		{"falha no sync com a nuvem persiste", uplink.ClassDNS, map[string]any{"duracao": "9m0s", "falhas": 10.0, "omitidas": 9.0}},
		{"sync com a nuvem recuperado", uplink.ClassDNS, map[string]any{"duracao": "9m10s", "falhas": 10.0}},
		{open, uplink.ClassDNS, nil},
	}
	if len(lines) != len(want) {
		var msgs []string
		for _, l := range lines {
			msgs = append(msgs, fmt.Sprintf("%v (%v)", l["msg"], l["classe"]))
		}
		t.Fatalf("quer %d linhas, teve %d:\n%s", len(want), len(lines), strings.Join(msgs, "\n"))
	}
	for i, w := range want {
		l := lines[i]
		if l["msg"] != w.msg || l["classe"] != w.class {
			t.Errorf("linha %d = %v; quer %q classe %s", i, l, w.msg, w.class)
		}
		for k, v := range w.extra {
			if l[k] != v {
				t.Errorf("linha %d: %s = %v, quer %v (%v)", i, k, l[k], v, l)
			}
		}
	}
	for _, i := range []int{0, 7} {
		if _, ok := lines[i]["quedas_omitidas"]; ok {
			t.Errorf("linha %d: nenhuma queda ficou sem linha desde a abertura anterior: %v", i, lines[i])
		}
	}
}

// oldTLSServer responde ao ClientHello com um ServerHello em TLS 1.0 (middlebox
// antigo): o crypto/tls recusa com um erro sem tipo ("tls: server selected
// unsupported protocol version 301").
func oldTLSServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				_, _ = c.Read(make([]byte, 4096))
				body := append([]byte{0x03, 0x01}, make([]byte, 32)...) // versão e random
				body = append(body, 0x00, 0x00, 0x2f, 0x00)             // sessão, cifra, compressão
				hs := append([]byte{0x02, 0, 0, byte(len(body))}, body...)
				_, _ = c.Write(append([]byte{0x16, 0x03, 0x01, 0, byte(len(hs))}, hs...))
				_, _ = io.Copy(io.Discard, c)
			}()
		}
	}()
	return "https://" + ln.Addr().String()
}

// Falhas de handshake que o crypto/tls devolve sem tipo (errors.New/fmt.Errorf sem
// %w) são "tls", mesmo sem proxy nenhum; antes caíam na recusa do CONNECT
// ("proxy") e mandavam o técnico procurar um proxy que não existe.
func TestUntypedTLSHandshakeErrorsAreTLS(t *testing.T) {
	noProxy := func() *http.Transport {
		return &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	}
	if err := syncErr(t, oldTLSServer(t), noProxy(), 5*time.Second); uplink.FailureClass(err) != uplink.ClassTLS {
		t.Errorf("TLS 1.0, sem proxy: classe %q, quer tls (erro: %v)", uplink.FailureClass(err), err)
	}

	// Inspeção SSL com certificado de serial negativo: o Go >= 1.23 recusa no parse.
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(0x40), Subject: pkix.Name{CommonName: "127.0.0.1"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	i := bytes.Index(der, []byte{0xa0, 0x03, 0x02, 0x01, 0x02, 0x02, 0x01, 0x40}) // versão v3, serial 0x40
	if i < 0 {
		t.Fatal("serial não achado no DER")
	}
	der[i+7] = 0xc0 // INTEGER com o bit de sinal: serial negativo
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}})
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler(), ErrorLog: stdlog.New(io.Discard, "", 0)}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()
	if err := syncErr(t, "https://"+ln.Addr().String(), noProxy(), 5*time.Second); uplink.FailureClass(err) != uplink.ClassTLS {
		t.Errorf("serial negativo, sem proxy: classe %q, quer tls (erro: %v)", uplink.FailureClass(err), err)
	}

	// Os mesmos erros depois de um CONNECT aceito chegam iguais no url.Error.
	ue := func(err error) error {
		return &url.Error{Op: "Post", URL: "https://oee.exemplo.com.br/api/gateway/v1/sync", Err: err}
	}
	for _, e := range []error{
		errors.New("tls: server selected unsupported protocol version 301"),
		errors.New("tls: failed to parse certificate from server: x509: negative serial number"),
		errors.New("tls: server's certificate contains an unsupported type of public key: *dsa.PublicKey"),
		errors.New("x509: malformed certificate"),
	} {
		if got := uplink.FailureClass(ue(e)); got != uplink.ClassTLS {
			t.Errorf("%v: classe %q, quer tls", e, got)
		}
	}
}
