// Package buildinfo guarda versão, commit e data do build (preenchidos por -ldflags -X).
package buildinfo

import (
	"fmt"
	"runtime"
)

// Preenchidos no build:
//
//	go build -ldflags "-X github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo.Version=1.0.0 ..."
var (
	Version = "0.1.0-dev"
	Commit  = "desconhecido"
	Date    = "desconhecida"
)

// UserAgent é o User-Agent enviado à nuvem (ex.: oee-gateway/1.0.0 (linux; arm64)).
func UserAgent() string {
	return fmt.Sprintf("oee-gateway/%s (%s; %s)", Version, runtime.GOOS, runtime.GOARCH)
}

// String resume a versão para a CLI.
func String() string {
	return fmt.Sprintf("oee-gateway %s (commit %s, %s, %s, %s/%s)", Version, Commit, Date, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}
