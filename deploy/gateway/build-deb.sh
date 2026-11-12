#!/bin/sh
# Gera os pacotes .deb do gateway com o nfpm (docs/16 §3–§5).
#
# Uso (de qualquer diretório):
#   deploy/gateway/build-deb.sh --arch arm64 --version 0.1.0
#   deploy/gateway/build-deb.sh --package all --arch amd64 --version 0.1.0-rc.1 --out /tmp/debs
#
# Opções:
#   --package NOME   oee-gateway (padrão) | oee-gateway-updater | all
#   --arch ARQ       arm64 | amd64 (padrão: a da máquina)
#   --version VER    versão semver (padrão: 0.0.0-dev)
#   --dist DIR       diretório dos binários <DIR>/<arq>/oee-gateway e oee-updater
#                    (padrão: gateway/dist, relativo à raiz do repositório)
#   --out DIR        onde gravar o .deb (padrão: o --dist)
#   --nfpm CMD       comando do nfpm (padrão: "nfpm" no PATH; senão "go run" da
#                    versão fixada abaixo, se houver Go)
#   -h, --help
#
# A data dos arquivos no pacote vem de SOURCE_DATE_EPOCH (padrão: data do
# último commit), para o .deb ser reproduzível.
set -eu

NFPM_VERSION=v2.43.1 # a última que compila com Go 1.24

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }
die() {
	echo "build-deb: ERRO: $*" >&2
	exit 1
}

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$here/../.." && pwd)

package=oee-gateway
arch=""
version=0.0.0-dev
dist=gateway/dist
out=""
nfpm_cmd=""

while [ $# -gt 0 ]; do
	case "$1" in
		--package) package=${2:?}; shift 2 ;;
		--arch) arch=${2:?}; shift 2 ;;
		--version) version=${2:?}; shift 2 ;;
		--dist) dist=${2:?}; shift 2 ;;
		--out) out=${2:?}; shift 2 ;;
		--nfpm) nfpm_cmd=${2:?}; shift 2 ;;
		-h | --help) usage; exit 0 ;;
		*) die "opção desconhecida: $1 (veja --help)" ;;
	esac
done

if [ -z "$arch" ]; then
	case "$(uname -m)" in
		x86_64) arch=amd64 ;;
		aarch64 | arm64) arch=arm64 ;;
		*) die "arquitetura da máquina não suportada; use --arch arm64|amd64" ;;
	esac
fi
case "$arch" in arm64 | amd64) ;; *) die "--arch deve ser arm64 ou amd64" ;; esac
case "$package" in oee-gateway | oee-gateway-updater | all) ;; *) die "--package inválido: $package" ;; esac
# semver simples (o nfpm valida de novo com version_schema: semver)
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$' ||
	die "--version não é semver: $version"

# Caminhos relativos ao repositório (o nfpm resolve "src" a partir do diretório corrente).
case "$dist" in
	/*) dist_abs=$dist ;;
	*) dist_abs=$repo/$dist ;;
esac
[ -n "$out" ] || out=$dist_abs
case "$out" in /*) ;; *) out=$(pwd)/$out ;; esac
mkdir -p "$out"

if [ -z "$nfpm_cmd" ]; then
	if command -v nfpm >/dev/null 2>&1; then
		nfpm_cmd=nfpm
	elif command -v go >/dev/null 2>&1; then
		nfpm_cmd="go run github.com/goreleaser/nfpm/v2/cmd/nfpm@$NFPM_VERSION"
	else
		die "nfpm não encontrado (instale: go install github.com/goreleaser/nfpm/v2/cmd/nfpm@$NFPM_VERSION)"
	fi
fi

if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
	SOURCE_DATE_EPOCH=$(git -C "$repo" log -1 --format=%ct 2>/dev/null || date +%s)
fi
export SOURCE_DATE_EPOCH

build_one() {
	pkg=$1
	case "$pkg" in
		oee-gateway) cfg=deploy/gateway/nfpm.yaml bin=oee-gateway ;;
		oee-gateway-updater) cfg=deploy/gateway/nfpm-updater.yaml bin=oee-updater ;;
	esac
	[ -f "$dist_abs/$arch/$bin" ] ||
		die "binário ausente: $dist_abs/$arch/$bin (gere com o build do gateway; ver README)"
	echo "build-deb: $pkg $version ($arch) a partir de $dist_abs/$arch/$bin"
	# shellcheck disable=SC2086 # nfpm_cmd pode ser "go run ..."
	(cd "$repo" && OEE_VERSION=$version OEE_ARCH=$arch OEE_DIST=$dist_abs \
		$nfpm_cmd pkg --config "$cfg" --packager deb --target "$out/")
}

if [ "$package" = all ]; then
	build_one oee-gateway
	build_one oee-gateway-updater
else
	build_one "$package"
fi
