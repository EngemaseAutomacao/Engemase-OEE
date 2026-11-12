#!/bin/bash
# Grava a imagem Engemase no eMMC do CM4 de um reComputer R1000 (docs/16 §7) e
# deixa na partição de boot a SEMENTE que o factory init lê no 1º boot
# (número de série EGW-NNNNN, versão da imagem, estação e operador).
#
# Estação: Linux (PC ou Raspberry Pi) com rpiboot (usbboot) e bmaptool:
#   sudo apt install rpiboot bmap-tools      # Raspberry Pi OS / Debian
#
# Por unidade (passo a passo completo em deploy/image/README.md):
#   1. chave lateral de boot do R1000 em "Flash" (nRPI-BOOT);
#   2. cabo USB-C de DADOS da estação ao R1000, depois os 24 V;
#   3. sudo deploy/image/flash/flash-emmc.sh --image <...>.img.zst --serial EGW-00042
#   4. chave em "Normal", desligar e religar os 24 V: o 1º boot faz o resto.
#
# Opções:
#   --image ARQ        imagem (.img.zst ou .img) gerada pelo build.sh
#   --bmap ARQ         mapa de blocos (padrão: <imagem sem .zst>.bmap ao lado)
#   --serial EGW-NNNNN número de série Engemase (sequencial, nunca reaproveitado)
#   --operator NOME    quem gravou (só ASCII: letras, números, espaço . _ - @)
#   --station NOME     estação de gravação (padrão: hostname desta máquina)
#   --device /dev/sdX  disco do eMMC já exposto (pula o rpiboot)
#   --gadget-dir DIR   diretório mass-storage-gadget64 do usbboot (padrão:
#                      procura em /usr/share/rpiboot e /usr/local/share/rpiboot)
#   --log ARQ          registro CSV das gravações (padrão: ./egw-gravacoes.csv)
#   --yes              não pede confirmação antes de apagar o disco
#   --dry-run          mostra o que faria, sem gravar nada
#   --allow-non-usb    SÓ PARA TESTE (dispositivo loop): aceita disco não USB
#   -h, --help
#
# Saída: 0 = gravado; 1 = erro; 2 = uso incorreto.
set -Eeuo pipefail
umask 022

usage() { sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; }
die() { printf 'flash: ERRO: %s\n' "$*" >&2; exit 1; }
bad() { printf 'flash: %s (veja --help)\n' "$*" >&2; exit 2; }
log() { printf 'flash: %s\n' "$*"; }
run() { if [[ $dry == 1 ]]; then printf 'flash: [dry-run] %s\n' "$*"; else "$@"; fi; }

image="" bmap="" serial="" operator="" station="" device="" gadget_dir="" logf=./egw-gravacoes.csv
yes=0 dry=0 allow_non_usb=0
while (( $# )); do
	case $1 in
		--image) image=${2:?}; shift 2 ;;
		--bmap) bmap=${2:?}; shift 2 ;;
		--serial) serial=${2:?}; shift 2 ;;
		--operator) operator=${2:?}; shift 2 ;;
		--station) station=${2:?}; shift 2 ;;
		--device) device=${2:?}; shift 2 ;;
		--gadget-dir) gadget_dir=${2:?}; shift 2 ;;
		--log) logf=${2:?}; shift 2 ;;
		--yes) yes=1; shift ;;
		--dry-run) dry=1; shift ;;
		--allow-non-usb) allow_non_usb=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) bad "opção desconhecida: $1" ;;
	esac
done

# --- Entradas ----------------------------------------------------------------------------
[[ $(id -u) -eq 0 ]] || die "precisa de root (sudo)"
[[ $serial =~ ^EGW-[0-9]{5}$ ]] || bad "--serial obrigatório no formato EGW-NNNNN (ex.: EGW-00042)"
[[ -n $image && -f $image ]] || bad "--image obrigatório (arquivo .img.zst ou .img do build.sh)"
if [[ -z $bmap ]]; then
	bmap=${image%.zst}.bmap
fi
[[ -f $bmap ]] || die "mapa de blocos não encontrado: $bmap (use --bmap)"
station=${station:-$(hostname -s 2>/dev/null || echo estacao)}
safe_re='^[A-Za-z0-9 ._:/@+,=-]{0,200}$'   # o mesmo filtro do factory init (egw_read_kv)
[[ $operator =~ $safe_re ]] || bad "--operator com caracteres não aceitos (sem acentos)"
[[ $station =~ $safe_re ]] || bad "--station com caracteres não aceitos"
for t in bmaptool lsblk blkid mount umount sha256sum; do
	command -v "$t" >/dev/null 2>&1 || die "ferramenta ausente: $t"
done

imgdir=$(cd -- "$(dirname -- "$image")" && pwd)
imgbase=$(basename -- "$image")
# Versão: do manifest.json do build.sh ou do nome egw-os_<versão>_arm64_r1000.img[.zst].
img_version=""
if [[ -f $imgdir/manifest.json ]]; then
	img_version=$(sed -n 's/^ *"image_version": *"\([0-9.]*\)".*/\1/p' "$imgdir/manifest.json" | head -n1)
	if grep -q '"variant": *"bancada-fase0"' "$imgdir/manifest.json"; then
		log "ATENÇÃO: imagem de BANCADA (Fase 0). Não vai a campo."
	fi
fi
if [[ -z $img_version && $imgbase =~ ^egw-os_([0-9]{2}\.[0-9]{4}\.[0-9]{1,2}\.[0-9]+)_ ]]; then
	img_version=${BASH_REMATCH[1]}
fi
[[ -n $img_version ]] || die "não sei a versão da imagem (sem manifest.json e nome fora do padrão)"

# Integridade do arquivo antes de gravar (SHA256SUMS do build.sh).
if [[ -f $imgdir/SHA256SUMS ]]; then
	log "conferindo SHA256SUMS"
	(cd "$imgdir" && sha256sum --quiet --ignore-missing -c SHA256SUMS) || die "SHA256SUMS não confere: arquivo corrompido?"
else
	log "AVISO: sem SHA256SUMS ao lado da imagem; integridade só pelo bmap"
fi
img_sha=$(sha256sum "$image" | cut -d' ' -f1)

# --- Expor o eMMC por USB (rpiboot) --------------------------------------------------------
usb_disks() { lsblk -dnpo NAME,TRAN 2>/dev/null | awk '$2 == "usb" { print $1 }' | sort; }

if [[ -z $device ]]; then
	command -v rpiboot >/dev/null 2>&1 || die "rpiboot ausente (sudo apt install rpiboot) ou use --device"
	if [[ -z $gadget_dir ]]; then
		for d in /usr/share/rpiboot/mass-storage-gadget64 /usr/local/share/rpiboot/mass-storage-gadget64; do
			if [[ -d $d ]]; then gadget_dir=$d; break; fi
		done
	fi
	[[ -n $gadget_dir && -d $gadget_dir ]] || die "mass-storage-gadget64 não encontrado (use --gadget-dir; CONFIRMAR o caminho do pacote rpiboot da estação)"
	before=$(usb_disks)
	log "aguardando o R1000 em modo Flash (chave em Flash, USB-C de dados, 24 V)..."
	if [[ $dry == 1 ]]; then
		log "[dry-run] rpiboot -d $gadget_dir"
		device=/dev/sdX
	else
		rpiboot -d "$gadget_dir"
		for _ in $(seq 1 60); do
			new=$(comm -13 <(printf '%s\n' "$before") <(usb_disks) | head -n1)
			if [[ -n $new ]]; then device=$new; break; fi
			sleep 1
		done
		[[ -n $device ]] || die "o eMMC não apareceu como disco USB em 60 s (cabo de dados? chave em Flash?)"
	fi
fi

# --- Conferências do disco de destino ----------------------------------------------------------
if [[ $dry == 0 ]]; then
	[[ -b $device ]] || die "$device não é um dispositivo de bloco"
	dtype=$(lsblk -dno TYPE "$device" | tr -d ' ')
	if [[ $dtype != disk && ! ($dtype == loop && $allow_non_usb == 1) ]]; then
		die "$device não é um disco inteiro (TYPE=${dtype:-?}; não use partição)"
	fi
	tran=$(lsblk -dno TRAN "$device" | tr -d ' ')
	if [[ $tran != usb && $allow_non_usb == 0 ]]; then
		die "$device não é USB (TRAN=${tran:-?}): recuso gravar num disco interno"
	fi
	if lsblk -nro MOUNTPOINT "$device" | grep -q .; then
		die "$device tem partições montadas: desmonte (ou escolha o disco certo)"
	fi
	bytes=$(lsblk -bdno SIZE "$device" | tr -d ' ')
	# R10xx-00: eMMC de 16 GB (~14,6 GiB). Aceita 8 a 64 GB (outros lotes), recusa o resto.
	(( bytes >= 7000000000 && bytes <= 70000000000 )) || die "$device tem $bytes bytes: não parece o eMMC do CM4"
	echo
	lsblk -o NAME,SIZE,TRAN,MODEL,SERIAL "$device"
	echo
	log "vai APAGAR $device e gravar $imgbase ($img_version) para a unidade $serial"
	if [[ $yes == 0 ]]; then
		read -r -p "Digite o número de série ($serial) para confirmar: " ans
		[[ $ans == "$serial" ]] || die "cancelado"
	fi
fi

# --- Gravação ---------------------------------------------------------------------------------
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "gravando com bmaptool (só os blocos usados, com conferência de hash por faixa)"
run bmaptool copy --bmap "$bmap" "$image" "$device"
run sync

# --- Semente para o factory init ----------------------------------------------------------------
part1() { if [[ $1 =~ [0-9]$ ]]; then printf '%sp1' "$1"; else printf '%s1' "$1"; fi; }
bootpart=$(part1 "$device")
seed=$(cat <<EOF
# Engemase OEE - semente da gravação (docs/16 §7). Lida UMA vez pelo factory
# init no 1º boot e depois movida para /data/identity/flash-seed.conf.
EGW_SERIAL=$serial
EGW_IMAGE_VERSION=$img_version
EGW_IMAGE_SHA256=$img_sha
EGW_FLASHED_AT=$started
EGW_STATION=$station
EGW_OPERATOR=$operator
EOF
)
if [[ $dry == 1 ]]; then
	log "[dry-run] gravaria em $bootpart:/egw-seed.conf:"
	printf '%s\n' "$seed"
else
	if command -v partprobe >/dev/null 2>&1; then partprobe "$device" || true; else blockdev --rereadpt "$device" || true; fi
	command -v udevadm >/dev/null 2>&1 && udevadm settle --timeout=30 || true
	for _ in $(seq 1 10); do [[ -b $bootpart ]] && break; sleep 1; done
	[[ -b $bootpart ]] || die "partição de boot $bootpart não apareceu"
	label=$(blkid -o value -s LABEL "$bootpart" 2>/dev/null || true)
	[[ $label == BOOT ]] || die "$bootpart tem rótulo '${label:-?}', esperado BOOT (imagem errada?)"
	mnt=$(mktemp -d)
	trap 'umount "$mnt" 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true' EXIT
	mount -t vfat -o nodev,nosuid,noexec "$bootpart" "$mnt"
	printf '%s\n' "$seed" > "$mnt/egw-seed.conf.tmp"
	sync
	mv -f "$mnt/egw-seed.conf.tmp" "$mnt/egw-seed.conf"
	sync
	umount "$mnt"
	rmdir "$mnt"
	trap - EXIT
	blockdev --flushbufs "$device" 2>/dev/null || true
	command -v eject >/dev/null 2>&1 && eject "$device" 2>/dev/null || true
fi

# --- Registro (planilha de inventário do MVP, docs/16 §7) ---------------------------------------
if [[ $dry == 0 ]]; then
	[[ -s $logf ]] || echo "gravado_em,serie,imagem,sha256_arquivo,disco,estacao,operador" > "$logf"
	model=$(lsblk -dno MODEL "$device" 2>/dev/null | tr -d ',' | xargs || true)
	printf '%s,%s,%s,%s,%s,%s,%s\n' "$started" "$serial" "$img_version" "$img_sha" "${model:-?}" "$station" "$operator" >> "$logf"
	log "registrado em $logf"
fi

if [[ $dry == 1 ]]; then
	log "dry-run: nada foi gravado"
	exit 0
fi
cat <<EOF

Gravação concluída: $serial  imagem $img_version
Agora:
  1. desligue os 24 V e tire o USB-C;
  2. chave lateral em "Normal";
  3. ligue os 24 V com HDMI/teclado (ou só observe os LEDs):
       âmbar piscando  = factory init rodando (3 a 5 min; não desligue)
       verde fixo      = B0 APROVADO
       vermelho piscando = falhou: veja o console ou "sudo egw-factory-init status"
  4. espete o pendrive EGWBANCADA para exportar o cartão da senha local.
EOF
