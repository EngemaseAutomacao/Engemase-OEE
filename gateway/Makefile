# Atalhos do agente oee-gateway. GOTOOLCHAIN=local: usa o Go instalado (1.24), sem baixar outro.
export GOTOOLCHAIN := local
PKG     := github.com/engemaseautomacao/engemase-oee/gateway
VERSION ?= 0.1.0-dev
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo desconhecido)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X $(PKG)/internal/buildinfo.Version=$(VERSION) -X $(PKG)/internal/buildinfo.Commit=$(COMMIT) -X $(PKG)/internal/buildinfo.Date=$(DATE)

.PHONY: test test-race test-integration vet build build-arm64 build-all

test:
	go test ./...

test-race:
	go test -race -cover ./...

test-integration: ## sobe o tools/plc-sim e lê o bloco OEE
	go test -tags integration -v ./test/integration/

vet:
	gofmt -l . | (! grep .) && go vet ./... && go vet -tags integration ./test/integration/

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/oee-gateway ./cmd/oee-gateway

build-arm64: ## reComputer R1000
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/oee-gateway-linux-arm64 ./cmd/oee-gateway

build-all: build-arm64
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/oee-gateway-linux-amd64 ./cmd/oee-gateway
	CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/oee-gateway-linux-armv7 ./cmd/oee-gateway
