package localui

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/localapi"
)

const cardPassword = "K7QP-4MZX-9TRD-2HWA"

type fakeAgent struct {
	st  *localapi.Status
	err error
}

func (f fakeAgent) Status(context.Context) (*localapi.Status, error) { return f.st, f.err }

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newPageServer(t *testing.T, agent StatusSource, withPassword bool) (*Server, *clock) {
	t.Helper()
	dir := t.TempDir()
	if withPassword {
		phc, err := HashPassword(NormalizePassword(cardPassword))
		if err != nil {
			t.Fatal(err)
		}
		if err := WritePasswordHash(dir, phc); err != nil {
			t.Fatal(err)
		}
	}
	c := &clock{t: time.Date(2026, 11, 24, 13, 0, 0, 0, time.UTC)}
	return &Server{StateDir: dir, Agent: agent, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: c.now}, c
}

type browser struct {
	t      *testing.T
	h      http.Handler
	cookie *http.Cookie
	ip     string
}

func (b *browser) do(method, path string, form url.Values, origin string) *httptest.ResponseRecorder {
	b.t.Helper()
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req := httptest.NewRequest(method, "https://192.168.10.250"+path, body)
	req.Host = "192.168.10.250"
	req.RemoteAddr = b.ip + ":51000"
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if b.cookie != nil {
		req.AddCookie(b.cookie)
	}
	w := httptest.NewRecorder()
	b.h.ServeHTTP(w, req)
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie {
			if c.MaxAge < 0 {
				b.cookie = nil
			} else {
				b.cookie = c
			}
		}
	}
	return w
}

const origin = "https://192.168.10.250"

func (b *browser) login(pw string) *httptest.ResponseRecorder {
	return b.do(http.MethodPost, "/entrar", url.Values{"senha": {pw}}, origin)
}

func sampleStatus(now time.Time) *localapi.Status {
	lastOK := now.Add(-20 * time.Second)
	lat, counter, oldest := int64(12), int64(100234), int64(40)
	return &localapi.Status{
		Agent: localapi.Agent{Version: "1.2.0", StartedAt: now.Add(-time.Hour), ConfigVersion: 7, ConfigState: "applied"},
		Cloud: localapi.Cloud{URL: "https://engemase-oee.vercel.app", Registered: true, LastOKAt: &lastOK},
		Queue: localapi.Queue{Pending: 3, OldestS: &oldest},
		Devices: []localapi.Device{
			{ID: "dev-1", Name: "CLP Injetora 1", Protocol: "modbus-tcp", Status: "connected", LatencyMS: &lat, LastOKAt: now.Format(time.RFC3339)},
			{ID: "dev-2", Protocol: "modbus-rtu", Status: "disconnected", Errors1m: 12, LastError: "timeout <script>"},
		},
		Machines: []localapi.Machine{
			{ID: "m-1", Name: "Injetora 1", State: "RUNNING", StateSince: now.Add(-5 * time.Minute).Format(time.RFC3339), CounterTotal: &counter,
				At: now.Format(time.RFC3339)},
			{ID: "m-2", Name: "Prensa 2"},
		},
	}
}

func TestLoginAndStatus(t *testing.T) {
	now := time.Date(2026, 11, 24, 13, 0, 0, 0, time.UTC)
	s, clk := newPageServer(t, fakeAgent{st: sampleStatus(now)}, true)
	b := &browser{t: t, h: s.Handler(), ip: "192.168.10.30"}

	if w := b.do(http.MethodGet, "/", nil, ""); w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/entrar" {
		t.Fatalf("sem sessão: %d %s", w.Code, w.Header().Get("Location"))
	}
	if w := b.do(http.MethodGet, "/entrar", nil, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `name="senha"`) {
		t.Fatalf("tela de login: %d", w.Code)
	}
	if w := b.login("errada-123"); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "Senha incorreta") {
		t.Fatalf("senha errada: %d", w.Code)
	}
	// A do cartão, digitada em minúsculas e sem hífens, entra.
	w := b.login(strings.ToLower(strings.ReplaceAll(cardPassword, "-", "")))
	if w.Code != http.StatusSeeOther || b.cookie == nil {
		t.Fatalf("login: %d", w.Code)
	}
	if !b.cookie.Secure || !b.cookie.HttpOnly || b.cookie.SameSite != http.SameSiteStrictMode || b.cookie.Path != "/" {
		t.Fatalf("cookie sem as proteções: %+v", b.cookie)
	}
	w = b.do(http.MethodGet, "/", nil, "")
	body := w.Body.String()
	if w.Code != 200 {
		t.Fatalf("status: %d", w.Code)
	}
	for _, want := range []string{"Conectado", "CLP Injetora 1", "Modbus TCP", "12 ms", "Sem comunicação", "Produzindo", "100234",
		"Prensa 2", "sem leitura ainda", "Itens a enviar", "há 40 s", "versão 7 (aplicada)", "timeout &lt;script&gt;"} {
		if !strings.Contains(body, want) {
			t.Errorf("status sem %q", want)
		}
	}
	if strings.Contains(body, "<script>") {
		t.Fatal("texto do agente sem escape")
	}
	// Sessão expira depois de 30 min parada.
	clk.add(sessionIdle + time.Second)
	if w := b.do(http.MethodGet, "/", nil, ""); w.Code != http.StatusSeeOther {
		t.Fatalf("sessão vencida: %d", w.Code)
	}
}

func TestLogout(t *testing.T) {
	s, _ := newPageServer(t, fakeAgent{st: sampleStatus(time.Now())}, true)
	b := &browser{t: t, h: s.Handler(), ip: "192.168.10.31"}
	if w := b.login(cardPassword); w.Code != http.StatusSeeOther {
		t.Fatalf("login: %d", w.Code)
	}
	old := *b.cookie
	if w := b.do(http.MethodPost, "/sair", url.Values{}, origin); w.Code != http.StatusSeeOther {
		t.Fatalf("sair: %d", w.Code)
	}
	b.cookie = &old // o cookie antigo não vale mais
	if w := b.do(http.MethodGet, "/", nil, ""); w.Code != http.StatusSeeOther {
		t.Fatalf("depois de sair: %d", w.Code)
	}
}

func TestLockout(t *testing.T) {
	s, clk := newPageServer(t, fakeAgent{st: sampleStatus(time.Now())}, true)
	b := &browser{t: t, h: s.Handler(), ip: "192.168.10.40"}
	for i := 0; i < maxFailsPerIP-1; i++ {
		if w := b.login("errada-xx"); w.Code != http.StatusUnauthorized {
			t.Fatalf("erro %d: %d", i+1, w.Code)
		}
	}
	if w := b.login("errada-xx"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("5º erro: %d", w.Code)
	}
	// Bloqueado: nem a senha certa entra.
	if w := b.login(cardPassword); w.Code != http.StatusTooManyRequests || b.cookie != nil {
		t.Fatalf("bloqueado com a senha certa: %d", w.Code)
	}
	// Outro notebook na OT não é afetado.
	other := &browser{t: t, h: s.Handler(), ip: "192.168.10.41"}
	if w := other.login(cardPassword); w.Code != http.StatusSeeOther {
		t.Fatalf("outro endereço: %d", w.Code)
	}
	// O bloqueio sobrevive a um reinício da página (lock.json).
	s2 := &Server{StateDir: s.StateDir, Log: s.Log, Now: clk.now}
	b2 := &browser{t: t, h: s2.Handler(), ip: "192.168.10.40"}
	if w := b2.login(cardPassword); w.Code != http.StatusTooManyRequests {
		t.Fatalf("depois de reiniciar: %d", w.Code)
	}
	clk.add(ipLockFor + time.Second)
	if w := b2.login(cardPassword); w.Code != http.StatusSeeOther {
		t.Fatalf("depois de 15 min: %d", w.Code)
	}
}

func TestGlobalLockout(t *testing.T) {
	s, _ := newPageServer(t, nil, true)
	h := s.Handler()
	for i := 0; i < maxFailsGlobal; i++ { // cada erro de um endereço diferente
		b := &browser{t: t, h: h, ip: "10.0.0." + strconv.Itoa(i+1)}
		b.login("errada-xx")
	}
	b := &browser{t: t, h: h, ip: "10.0.1.1"}
	if w := b.login(cardPassword); w.Code != http.StatusTooManyRequests {
		t.Fatalf("suspensão global: %d", w.Code)
	}
}

func TestCSRFAndNoPassword(t *testing.T) {
	s, _ := newPageServer(t, nil, true)
	b := &browser{t: t, h: s.Handler(), ip: "192.168.10.50"}
	for _, o := range []string{"", "https://evil.example", "http://192.168.10.250"} {
		if w := b.do(http.MethodPost, "/entrar", url.Values{"senha": {cardPassword}}, o); w.Code != http.StatusForbidden {
			t.Errorf("Origin %q: %d", o, w.Code)
		}
	}
	s2, _ := newPageServer(t, nil, false)
	b2 := &browser{t: t, h: s2.Handler(), ip: "192.168.10.51"}
	if w := b2.do(http.MethodGet, "/entrar", nil, ""); !strings.Contains(w.Body.String(), "ainda não foi definida") {
		t.Fatal("sem senha: a página deveria explicar")
	}
	if w := b2.login("qualquer-coisa"); w.Code != http.StatusServiceUnavailable || b2.cookie != nil {
		t.Fatalf("login sem senha definida: %d", w.Code)
	}
}

func TestAgentDown(t *testing.T) {
	s, _ := newPageServer(t, fakeAgent{err: errors.New("connection refused")}, true)
	b := &browser{t: t, h: s.Handler(), ip: "192.168.10.60"}
	b.login(cardPassword)
	w := b.do(http.MethodGet, "/", nil, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "não respondeu") {
		t.Fatalf("agente fora: %d %s", w.Code, w.Body.String())
	}
}

func TestPasswordHash(t *testing.T) {
	phc, err := HashPassword("ABCDEFGH1234")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(phc, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("formato: %s", phc)
	}
	if ok, err := VerifyPassword(phc, "ABCDEFGH1234"); !ok || err != nil {
		t.Fatalf("certa: %v %v", ok, err)
	}
	if ok, _ := VerifyPassword(phc, "ABCDEFGH1235"); ok {
		t.Fatal("errada aceita")
	}
	// Hash do utilitário argon2 (fallback do factory init) com memória que cabe.
	ext := "$argon2id$v=19$m=4096,t=3,p=1$c29tZXNhbHRzYWx0$" // salt "somesaltsalt"
	// Gerado com os mesmos parâmetros pela própria biblioteca (formato PHC padrão).
	if ok, err := VerifyPassword(ext+"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "X"); ok || err != nil {
		t.Fatalf("PHC externo: %v %v", ok, err)
	}
	for _, bad := range []string{"", "$argon2i$v=19$m=4096,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
		"$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA"} {
		if _, err := VerifyPassword(bad, "X"); !errors.Is(err, ErrBadHash) {
			t.Errorf("deveria recusar %q: %v", bad, err)
		}
	}
	if _, err := HashPassword("curta"); err == nil {
		t.Fatal("senha curta aceita")
	}
	g, err := GeneratePassword()
	if err != nil || len(g) != 19 || strings.Count(g, "-") != 3 || strings.ContainsAny(g, "01OIL") {
		t.Fatalf("gerada: %q %v", g, err)
	}
	if NormalizePassword("k7qp-4mzx 9trd-2hwa\n") != "K7QP4MZX9TRD2HWA" {
		t.Fatal("normalização")
	}
}

// A chave do factory init (tls.crt/tls.key) tem preferência: a impressão digital
// dela vai no cartão lacrado.
func TestFactoryCertPreferred(t *testing.T) {
	state := t.TempDir()
	own := filepath.Join(state, "tls")
	// Um par gerado à parte faz o papel do factory init.
	dirX := t.TempDir()
	if _, err := LoadOrCreateCert(dirX); err != nil {
		t.Fatal(err)
	}
	k, _ := os.ReadFile(filepath.Join(dirX, "key.pem"))
	c, _ := os.ReadFile(filepath.Join(dirX, "cert.pem"))
	_ = os.WriteFile(filepath.Join(state, "tls.key"), k, 0o600)
	_ = os.WriteFile(filepath.Join(state, "tls.crt"), c, 0o644)
	got, err := LoadServerCert(state, own)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := LoadOrCreateCert(dirX)
	if string(got.Certificate[0]) != string(want.Certificate[0]) {
		t.Fatal("não usou o certificado do factory init")
	}
	if _, err := os.Stat(own); !os.IsNotExist(err) {
		t.Fatal("gerou chave própria tendo a do factory init")
	}
}
