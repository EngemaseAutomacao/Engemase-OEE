package app

import (
	"encoding/json"
	"net"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

// eventID lê o "id" de um evento já serializado.
func eventID(b []byte) string {
	var v struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(b, &v)
	return v.ID
}

// peekVersion lê config_version de um corpo que não passou na validação.
func peekVersion(body []byte) int {
	var v struct {
		ConfigVersion int `json:"config_version"`
	}
	_ = json.Unmarshal(body, &v)
	return v.ConfigVersion
}

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// readBootID devolve o boot_id do kernel (muda a cada boot).
func readBootID() string {
	b, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(string(b))
	if !uuidRe.MatchString(id) {
		return ""
	}
	return id
}

// ---------------------------------------------------------------------------
// sd_notify sem dependências (protocolo do systemd sobre socket unixgram)
// ---------------------------------------------------------------------------

func sdNotify(state string) error {
	sock := os.Getenv("NOTIFY_SOCKET")
	if sock == "" {
		return nil // fora do systemd
	}
	if strings.HasPrefix(sock, "@") {
		sock = "\x00" + sock[1:] // socket abstrato
	}
	conn, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: sock, Net: "unixgram"})
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Write([]byte(state))
	return err
}

// watchdogInterval devolve de quanto em quanto alimentar o watchdog (WatchdogSec/3).
func watchdogInterval() time.Duration {
	usec, err := strconv.ParseInt(os.Getenv("WATCHDOG_USEC"), 10, 64)
	if err != nil || usec <= 0 {
		return 0
	}
	if pid := os.Getenv("WATCHDOG_PID"); pid != "" && pid != strconv.Itoa(os.Getpid()) {
		return 0
	}
	return time.Duration(usec) * time.Microsecond / 3
}

// ---------------------------------------------------------------------------
// Saúde do processo e do sistema (mínimo do MVP; temperatura e eMMC: pendência)
// ---------------------------------------------------------------------------

type healthSample struct {
	cpuPct     float64
	memMB      float64
	diskFreeMB float64
	bootID     string
}

type healthCollector struct {
	mu       sync.Mutex
	dir      string
	lastWall time.Time
	lastCPU  time.Duration
	bootID   string
}

func newHealthCollector(dir string) *healthCollector {
	return &healthCollector{dir: dir, bootID: readBootID()}
}

func (h *healthCollector) collect(now time.Time) healthSample {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := healthSample{bootID: h.bootID}

	var ru syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &ru) == nil {
		cpu := time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
		if !h.lastWall.IsZero() {
			if wall := now.Sub(h.lastWall); wall > 0 {
				pct := float64(cpu-h.lastCPU) / float64(wall) / float64(runtime.NumCPU()) * 100
				s.cpuPct = clamp(pct, 0, 100)
			}
		}
		h.lastWall, h.lastCPU = now, cpu
	}
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	s.memMB = float64(ms.Sys) / (1 << 20)

	var st syscall.Statfs_t
	if syscall.Statfs(h.dir, &st) == nil {
		s.diskFreeMB = float64(st.Bavail) * float64(st.Bsize) / (1 << 20)
	}
	return s
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
