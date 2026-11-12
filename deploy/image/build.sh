#!/bin/bash
# Gera a imagem do gateway Engemase OEE (docs/16 §7) com o rpi-image-gen e
# prepara os artefatos de gravação: .img.zst, .bmap, SHA256SUMS e manifest.json.
#
# Roda num host ARM64 com Debian/Raspberry Pi OS Bookworm ou Trixie (ex.:
# Raspberry Pi 5 de 8 GB dedicada), como usuário comum, com as dependências
# do rpi-image-gen instaladas (sudo <rpi-image-gen>/install_deps.sh).
#
# Uso:
#   deploy/image/build.sh --version 13.2026.11.1
#   deploy/image/build.sh --version 13.2026.11.2 --fase0          # bancada
#   deploy/image/build.sh --version 12.2026.11.1 --plano-b-bookworm
#   deploy/image/build.sh --version 13.2026.11.1 --check          # só confere
#
# Opções:
#   --version V         versão da imagem <debian>.<ano>.<mês>.<n> (13.* = Trixie,
#                       12.* = Bookworm no plano B). Obrigatória.
#   --plano-b-bookworm  usa config/egw-r1000-bookworm.yaml (docs/16 §7, D-g1:
#                       só se o driver da Seeed falhar no kernel 6.12 do Trixie)
#   --fase0             imagem de BANCADA da Fase 0: aceita faltar o .deb do
#                       agente e o engemase-r1000-support (require_* = n).
#                       Nunca vai a campo.
#   --igtop DIR         rpi-image-gen já clonado (deve estar no commit fixado em
#                       pins.env); padrão: clona em <work>/rpi-image-gen
#   --work DIR          diretório de trabalho (padrão: deploy/image/work)
#   --out DIR           saída dos artefatos (padrão: deploy/image/out/<versão>)
#   --sign-key ARQ      chave privada Ed25519 (PEM) para assinar o manifest.json
#                       (manifest.json.sig). Nunca versionar a chave.
#   --check             só confere entradas e mostra o comando; não gera nada
#   -h, --help
#
# Entradas (fora do git, ver .gitignore):
#   debs/oee-gateway_<versão>_arm64.deb      (deploy/gateway/build-deb.sh --build)
#   debs/engemase-r1000-support_<v>_arm64.deb e debs/platform/linux-image-<ABI>_*.deb
#   keys/bench-export.pem                    certificado PÚBLICO da bancada
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../.." && pwd)

usage() { sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; }
die() { printf 'build: ERRO: %s\n' "$*" >&2; exit 1; }
warn() { printf 'build: AVISO: %s\n' "$*" >&2; }
log() { printf 'build: %s\n' "$*"; }

version="" plan_b=no fase0=no igtop="" work="" out="" sign_key="" check_only=no
while (( $# )); do
	case $1 in
		--version) version=${2:?}; shift 2 ;;
		--plano-b-bookworm) plan_b=yes; shift ;;
		--fase0) fase0=yes; shift ;;
		--igtop) igtop=${2:?}; shift 2 ;;
		--work) work=${2:?}; shift 2 ;;
		--out) out=${2:?}; shift 2 ;;
		--sign-key) sign_key=${2:?}; shift 2 ;;
		--check) check_only=yes; shift ;;
		-h|--help) usage; exit 0 ;;
		*) die "opção desconhecida: $1 (veja --help)" ;;
	esac
done

# --- Versão e variante --------------------------------------------------------------
[[ $version =~ ^[0-9]{2}\.[0-9]{4}\.[0-9]{1,2}\.[0-9]+$ ]] ||
	die "--version obrigatória no formato <debian>.<ano>.<mês>.<n> (ex.: 13.2026.11.1)"
if [[ $plan_b == yes ]]; then
	config=egw-r1000-bookworm.yaml codename=bookworm
	[[ $version == 12.* ]] || die "plano B (Bookworm) exige versão 12.*"
else
	config=egw-r1000.yaml codename=trixie
	[[ $version == 13.* ]] || die "Trixie exige versão 13.* (Bookworm só com --plano-b-bookworm)"
fi
name="egw-os_${version}_arm64_r1000"
work=${work:-$here/work}
out=${out:-$here/out/$version}

# --- pins.env: só KEY=valor simples, sem executar nada ---------------------------------
declare -A PIN=()
while IFS= read -r line || [[ -n $line ]]; do
	[[ $line =~ ^[[:space:]]*(#|$) ]] && continue
	[[ $line =~ ^(EGW_[A-Z0-9_]+)=([A-Za-z0-9._:/@+-]*)$ ]] || die "pins.env: linha inválida: $line"
	PIN[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
done < "$here/pins.env"
for k in EGW_RPI_IMAGE_GEN_URL EGW_RPI_IMAGE_GEN_COMMIT EGW_SEEED_OVERLAYS_COMMIT EGW_DEBIAN_SNAPSHOT \
	EGW_PLATFORM_VERSION EGW_EXPECT_RAM_GB EGW_EXPECT_EMMC_GB; do
	[[ -n ${PIN[$k]:-} ]] || die "pins.env: $k vazio"
done
[[ ${PIN[EGW_RPI_IMAGE_GEN_COMMIT]} =~ ^[0-9a-f]{40}$ ]] || die "pins.env: EGW_RPI_IMAGE_GEN_COMMIT deve ser um hash completo"
[[ ${PIN[EGW_DEBIAN_SNAPSHOT]} =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]] ||
	die "pins.env: EGW_DEBIAN_SNAPSHOT fora do formato AAAAMMDDTHHMMSSZ"
snap_iso="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}T${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}Z"
SOURCE_DATE_EPOCH=$(date -u -d "$snap_iso" +%s)
export SOURCE_DATE_EPOCH
kernel_abi=${PIN[EGW_KERNEL_ABI]:-}
commit=$(git -C "$repo" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
if [[ -n $(git -C "$repo" status --porcelain -- deploy 2>/dev/null) ]]; then
	warn "deploy/ tem mudanças não commitadas: a imagem não é reproduzível a partir de $commit"
	commit="$commit-dirty"
fi

# --- Host ------------------------------------------------------------------------------
host_ok=yes
[[ $(uname -m) == aarch64 ]] || { warn "host $(uname -m): o rpi-image-gen exige ARM64"; host_ok=no; }
host_codename=$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-}")
case $host_codename in
	bookworm|trixie) ;;
	*) warn "host '${host_codename:-?}': o rpi-image-gen é suportado em Debian/Raspberry Pi OS Bookworm ou Trixie"; host_ok=no ;;
esac
for t in git zstd sha256sum bmaptool; do
	command -v "$t" >/dev/null 2>&1 || { warn "ferramenta ausente no host: $t"; host_ok=no; }
done

# --- Entradas ----------------------------------------------------------------------------
shopt -s nullglob
agent_debs=("$here"/debs/oee-gateway_*_arm64.deb)
support_debs=("$here"/debs/engemase-r1000-support_*_arm64.deb "$here"/debs/platform/engemase-r1000-support_*_arm64.deb)
shopt -u nullglob
require_agent=y require_platform=y
if [[ $fase0 == yes ]]; then
	require_agent=n require_platform=n
	warn "imagem de BANCADA (--fase0): pode sair sem agente e sem engemase-r1000-support; nunca vai a campo"
fi
if (( ${#agent_debs[@]} == 0 )); then
	[[ $require_agent == n ]] || die "falta debs/oee-gateway_*_arm64.deb (deploy/gateway/build-deb.sh --build --arch arm64 --version X --out deploy/image/debs)"
	warn "sem o .deb do agente"
elif (( ${#agent_debs[@]} > 1 )); then
	die "mais de um debs/oee-gateway_*_arm64.deb"
else
	log "agente: ${agent_debs[0]##*/}"
fi
if (( ${#support_debs[@]} == 0 )); then
	[[ $require_platform == n ]] || die "falta debs/engemase-r1000-support_*_arm64.deb (README, \"Pacote de plataforma\")"
	warn "sem o engemase-r1000-support: sem RTC, LEDs e alimentação das RS-485"
fi
[[ -n $kernel_abi ]] || warn "EGW_KERNEL_ABI vazio em pins.env: kernel NÃO fixado (só Fase 0)"
if [[ -s $here/keys/bench-export.pem ]]; then
	grep -q 'PRIVATE KEY' "$here/keys/bench-export.pem" && die "keys/bench-export.pem contém chave PRIVADA"
else
	warn "sem keys/bench-export.pem: o factory init não gera a senha local e o B0 reprova"
fi
[[ -z $sign_key || -r $sign_key ]] || die "--sign-key ilegível: $sign_key"

overrides=(
	"IGconf_image_name=$name"
	"IGconf_deploy_compression=none"
	"IGconf_egw_image_version=$version"
	"IGconf_egw_image_commit=$commit"
	"IGconf_egw_debian_snapshot=${PIN[EGW_DEBIAN_SNAPSHOT]}"
	"IGconf_egw_rpi_image_gen_commit=${PIN[EGW_RPI_IMAGE_GEN_COMMIT]}"
	"IGconf_egw_seeed_overlays_commit=${PIN[EGW_SEEED_OVERLAYS_COMMIT]}"
	"IGconf_egw_kernel_abi=$kernel_abi"
	"IGconf_egw_platform_version=${PIN[EGW_PLATFORM_VERSION]}"
	"IGconf_egw_expect_ram_gb=${PIN[EGW_EXPECT_RAM_GB]}"
	"IGconf_egw_expect_emmc_gb=${PIN[EGW_EXPECT_EMMC_GB]}"
	"IGconf_egw_require_agent=$require_agent"
	"IGconf_egw_require_platform=$require_platform"
)
log "imagem $name (Debian $codename, config/$config, snapshot ${PIN[EGW_DEBIAN_SNAPSHOT]}, commit $commit)"
log "comando: rpi-image-gen build -S $here -c $config -B $work -- ${overrides[*]}"
if [[ $check_only == yes ]]; then
	[[ $host_ok == yes ]] || warn "este host não gera a imagem (veja os avisos acima)"
	log "--check: nada gerado"
	exit 0
fi
[[ $host_ok == yes ]] || die "host inadequado (veja os avisos acima)"

# --- rpi-image-gen no commit fixado ----------------------------------------------------------
mkdir -p "$work"
if [[ -z $igtop ]]; then
	igtop=$work/rpi-image-gen
	if [[ ! -d $igtop/.git ]]; then
		git clone --quiet "${PIN[EGW_RPI_IMAGE_GEN_URL]}" "$igtop"
	fi
	git -C "$igtop" fetch --quiet origin || warn "sem rede para atualizar o rpi-image-gen; usando o clone local"
	git -C "$igtop" checkout --quiet --detach "${PIN[EGW_RPI_IMAGE_GEN_COMMIT]}"
fi
got=$(git -C "$igtop" rev-parse HEAD)
[[ $got == "${PIN[EGW_RPI_IMAGE_GEN_COMMIT]}" ]] || die "rpi-image-gen em $got, esperado ${PIN[EGW_RPI_IMAGE_GEN_COMMIT]} (pins.env)"

# --- Build ---------------------------------------------------------------------------------------
"$igtop/rpi-image-gen" build -S "$here" -c "$config" -B "$work" -- "${overrides[@]}"

img=$work/image-$name/$name.img
[[ -f $img ]] || img=$(find "$work" -maxdepth 3 -name "$name.img" -print -quit)
[[ -n $img && -f $img ]] || die "imagem $name.img não encontrada em $work"

# --- Artefatos de gravação ------------------------------------------------------------------------
mkdir -p "$out"
log "bmap e compressão (zstd -19)"
bmaptool create -o "$out/$name.img.bmap" "$img"
zstd -q -f -T0 -19 "$img" -o "$out/$name.img.zst"
img_sha=$(sha256sum "$img" | cut -d' ' -f1)
img_size=$(stat -c %s "$img")
shopt -s nullglob
for f in "$work"/deploy-*/*.spdx.json "$work"/deploy-*/*sbom*; do cp -f "$f" "$out/"; done
shopt -u nullglob
cat > "$out/manifest.json" <<EOF
{
  "schema": "egw-image-manifest/1",
  "name": "$name",
  "image_version": "$version",
  "debian": "$codename",
  "variant": "$([[ $fase0 == yes ]] && echo bancada-fase0 || echo producao)",
  "image_commit": "$commit",
  "debian_snapshot": "${PIN[EGW_DEBIAN_SNAPSHOT]}",
  "rpi_image_gen_commit": "${PIN[EGW_RPI_IMAGE_GEN_COMMIT]}",
  "seeed_overlays_commit": "${PIN[EGW_SEEED_OVERLAYS_COMMIT]}",
  "kernel_abi": "${kernel_abi:-unpinned}",
  "platform_version": "${PIN[EGW_PLATFORM_VERSION]}",
  "agent_deb": "$( (( ${#agent_debs[@]} )) && echo "${agent_debs[0]##*/}" || echo none)",
  "img": { "file": "$name.img", "bytes": $img_size, "sha256": "$img_sha" },
  "zst": { "file": "$name.img.zst", "sha256": "$(sha256sum "$out/$name.img.zst" | cut -d' ' -f1)" },
  "bmap": { "file": "$name.img.bmap", "sha256": "$(sha256sum "$out/$name.img.bmap" | cut -d' ' -f1)" },
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
(cd "$out" && sha256sum "$name.img.zst" "$name.img.bmap" manifest.json > SHA256SUMS)
if [[ -n $sign_key ]]; then
	openssl pkeyutl -sign -rawin -inkey "$sign_key" -in "$out/manifest.json" -out "$out/manifest.json.sig"
	log "manifest.json assinado (Ed25519)"
else
	warn "manifest.json NÃO assinado (--sign-key): só para bancada"
fi
log "pronto: $out"
ls -l "$out"
