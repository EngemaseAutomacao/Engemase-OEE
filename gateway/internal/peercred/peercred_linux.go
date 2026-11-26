package peercred

import (
	"errors"
	"net"
	"syscall"
)

// Of lê o chamador do socket Unix (SO_PEERCRED).
func Of(c net.Conn) (Peer, error) {
	uc, ok := c.(*net.UnixConn)
	if !ok {
		return Peer{}, errors.New("conexão não é de socket Unix")
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return Peer{}, err
	}
	var cred *syscall.Ucred
	var serr error
	if err := raw.Control(func(fd uintptr) {
		cred, serr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil {
		return Peer{}, err
	}
	if serr != nil {
		return Peer{}, serr
	}
	return Peer{PID: cred.Pid, UID: cred.Uid, GID: cred.Gid, Root: cred.Uid == 0}, nil
}
