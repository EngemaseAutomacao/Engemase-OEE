package modbus

import "net"

// AbrirComPendentes é Open com a consulta de bytes não reconhecidos (SIOCOUTQ) trocada
// por f. Num teste local o kernel do outro lado reconhece tudo na hora: o caminho caído
// (requisição escrita que não chegou) só se simula assim.
func AbrirComPendentes(t Target, f func(net.Conn) (int, bool)) (Reader, error) {
	r, err := Open(t)
	if err != nil {
		return nil, err
	}
	r.(*client).pendentes = f
	return r, nil
}

// BytesNaoReconhecidos expõe a consulta real à fila de envio do socket.
var BytesNaoReconhecidos = bytesNaoReconhecidos
