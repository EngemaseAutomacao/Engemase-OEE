package helper

import (
	"syscall"
	"time"
)

// setSystemClock acerta o relógio de parede (CAP_SYS_TIME; a unit libera @clock).
func setSystemClock(t time.Time) error {
	tv := syscall.NsecToTimeval(t.UnixNano())
	return syscall.Settimeofday(&tv)
}
