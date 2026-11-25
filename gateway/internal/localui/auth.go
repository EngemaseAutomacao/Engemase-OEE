package localui

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Regras do login (docs/16 §6): 5 senhas erradas seguidas de um mesmo endereço
// bloqueiam esse endereço por 15 min; 20 erradas no gateway em 1 h suspendem o
// login por 1 h (contra quem troca de IP na OT). A sessão vale 30 min sem uso e no
// máximo 8 h.
const (
	maxFailsPerIP    = 5
	ipLockFor        = 15 * time.Minute
	maxFailsGlobal   = 20
	globalWindow     = time.Hour
	globalLockFor    = time.Hour
	sessionIdle      = 30 * time.Minute
	sessionMax       = 8 * time.Hour
	maxSessions      = 16
	maxTrackedIPs    = 256
	lockStateFile    = "lock.json"
	sessionCookie    = "__Host-oee_sessao"
	sessionTokenSize = 32
)

// lockState é o bloqueio (gravado em lock.json: sobrevive a um reinício da página).
type lockState struct {
	IPs          map[string]*ipFails `json:"ips"`
	GlobalFails  []time.Time         `json:"global_fails"`
	GlobalLocked time.Time           `json:"global_locked_until"`
}

type ipFails struct {
	Fails       int       `json:"fails"`
	LockedUntil time.Time `json:"locked_until"`
	Last        time.Time `json:"last"`
}

// limiter conta as tentativas erradas.
type limiter struct {
	mu   sync.Mutex
	path string
	st   lockState
}

func newLimiter(dir string) *limiter {
	l := &limiter{path: filepath.Join(dir, lockStateFile), st: lockState{IPs: map[string]*ipFails{}}}
	if b, err := os.ReadFile(l.path); err == nil {
		var st lockState
		if json.Unmarshal(b, &st) == nil && st.IPs != nil {
			l.st = st
		}
	}
	return l
}

// blocked diz até quando o login está bloqueado para o endereço (zero = livre).
func (l *limiter) blocked(ip string, now time.Time) time.Time {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Before(l.st.GlobalLocked) {
		return l.st.GlobalLocked
	}
	if f := l.st.IPs[ip]; f != nil && now.Before(f.LockedUntil) {
		return f.LockedUntil
	}
	return time.Time{}
}

// fail registra uma senha errada.
func (l *limiter) fail(ip string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f := l.st.IPs[ip]
	if f == nil {
		if len(l.st.IPs) >= maxTrackedIPs {
			l.evict(now)
		}
		f = &ipFails{}
		l.st.IPs[ip] = f
	}
	f.Fails++
	f.Last = now
	if f.Fails >= maxFailsPerIP {
		f.LockedUntil = now.Add(ipLockFor)
		f.Fails = 0
	}
	kept := l.st.GlobalFails[:0]
	for _, t := range l.st.GlobalFails {
		if now.Sub(t) < globalWindow {
			kept = append(kept, t)
		}
	}
	l.st.GlobalFails = append(kept, now)
	if len(l.st.GlobalFails) >= maxFailsGlobal {
		l.st.GlobalLocked = now.Add(globalLockFor)
		l.st.GlobalFails = nil
	}
	l.save()
}

// ok zera os erros do endereço depois de um login certo.
func (l *limiter) ok(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, had := l.st.IPs[ip]; had {
		delete(l.st.IPs, ip)
		l.save()
	}
}

func (l *limiter) evict(now time.Time) {
	var oldest string
	var ot time.Time
	for ip, f := range l.st.IPs {
		if now.After(f.LockedUntil) && (oldest == "" || f.Last.Before(ot)) {
			oldest, ot = ip, f.Last
		}
	}
	if oldest != "" {
		delete(l.st.IPs, oldest)
	}
}

func (l *limiter) save() {
	b, err := json.Marshal(l.st)
	if err != nil {
		return
	}
	tmp := l.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, l.path)
	}
}

// sessions guarda as sessões em memória (pelo SHA-256 do token): reiniciar a
// página derruba todas, o que é o esperado.
type sessions struct {
	mu sync.Mutex
	m  map[[32]byte]*session
}

type session struct {
	created, seen time.Time
	ip            string
}

func newSessions() *sessions { return &sessions{m: map[[32]byte]*session{}} }

func (s *sessions) create(ip string, now time.Time) (string, error) {
	b := make([]byte, sessionTokenSize)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gc(now)
	if len(s.m) >= maxSessions { // derruba a mais antiga
		var oldK [32]byte
		var old *session
		for k, v := range s.m {
			if old == nil || v.seen.Before(old.seen) {
				oldK, old = k, v
			}
		}
		delete(s.m, oldK)
	}
	s.m[sha256.Sum256([]byte(tok))] = &session{created: now, seen: now, ip: ip}
	return tok, nil
}

// valid confere e renova a sessão.
func (s *sessions) valid(tok string, now time.Time) bool {
	if tok == "" || len(tok) > 64 {
		return false
	}
	k := sha256.Sum256([]byte(tok))
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.m[k]
	if v == nil {
		return false
	}
	if now.Sub(v.seen) > sessionIdle || now.Sub(v.created) > sessionMax {
		delete(s.m, k)
		return false
	}
	v.seen = now
	return true
}

func (s *sessions) drop(tok string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, sha256.Sum256([]byte(tok)))
}

func (s *sessions) gc(now time.Time) {
	for k, v := range s.m {
		if now.Sub(v.seen) > sessionIdle || now.Sub(v.created) > sessionMax {
			delete(s.m, k)
		}
	}
}
