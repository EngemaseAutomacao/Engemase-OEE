//go:build !linux

package modbus

import "net"

// bytesNaoReconhecidos fora do Linux: sem consulta à fila de envio (ok=false). O
// escoamento do RTU sobre TCP vale só pelo silêncio, e o Modbus TCP não confere o ACK.
func bytesNaoReconhecidos(net.Conn) (int, bool) { return 0, false }
