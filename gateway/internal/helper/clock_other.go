//go:build !linux

package helper

import (
	"errors"
	"time"
)

func setSystemClock(time.Time) error { return errors.New("ajuste do relógio só no Linux") }
