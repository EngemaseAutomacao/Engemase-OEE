//go:build !linux

package peercred

import (
	"errors"
	"net"
)

// Of só existe no Linux (o gateway); em outros sistemas recusa todo chamador.
func Of(net.Conn) (Peer, error) {
	return Peer{}, errors.New("SO_PEERCRED só no Linux")
}
