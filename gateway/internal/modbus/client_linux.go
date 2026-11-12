//go:build linux

package modbus

import (
	"net"
	"syscall"
	"unsafe"
)

// bytesNaoReconhecidos devolve quantos bytes escritos no socket o outro lado ainda não
// reconheceu: na fila de envio ou enviados sem ACK (ioctl SIOCOUTQ, igual a TIOCOUTQ).
// ok=false se o socket não permite a consulta (já fechado). Fora do Linux, ver
// client_other.go.
func bytesNaoReconhecidos(conn net.Conn) (int, bool) {
	sc, ok := conn.(syscall.Conn)
	if !ok {
		return 0, false
	}
	rc, err := sc.SyscallConn()
	if err != nil {
		return 0, false
	}
	var (
		n     int32
		errno syscall.Errno
	)
	if err := rc.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, uintptr(syscall.TIOCOUTQ), uintptr(unsafe.Pointer(&n)))
	}); err != nil || errno != 0 {
		return 0, false
	}
	return int(n), true
}
