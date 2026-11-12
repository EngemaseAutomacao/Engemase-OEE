// Comando oee-gateway: agente de borda da plataforma Engemase OEE.
//
//	oee-gateway run                      # serviço (systemd)
//	oee-gateway enroll --code ABCD-1234  # registro na plataforma
//	oee-gateway modbus read --target tcp://192.168.10.23 --offset 1000 --count 14 --oee-block
//	oee-gateway diag | version | config validate ARQUIVO
package main

import (
	"os"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/cli"
)

func main() {
	os.Exit(cli.Execute(os.Args[1:], os.Stdout, os.Stderr))
}
