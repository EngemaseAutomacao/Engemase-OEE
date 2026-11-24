//go:build !linux

package helper

import (
	"errors"
	"net"
)

// peerCred só existe no Linux (o gateway); em outros sistemas recusa todo chamador.
func peerCred(net.Conn) (Peer, error) {
	return Peer{}, errors.New("SO_PEERCRED só no Linux")
}
