# shellcheck shell=bash
# Engemase OEE gateway - funções comuns do factory init e do autoteste B0.
# Carregado com "source"; não executa nada sozinho.
#
# As variáveis EGW_* abaixo podem ser trocadas no ambiente (testes em árvore
# falsa); em produção ficam nos valores padrão.

EGW_LIB_DIR=${EGW_LIB_DIR:-/usr/lib/engemase/factory}
EGW_IDENTITY_DIR=${EGW_IDENTITY_DIR:-/data/identity}
EGW_LOCALUI_DIR=${EGW_LOCALUI_DIR:-/data/localui}
EGW_SEED_FILE=${EGW_SEED_FILE:-/boot/firmware/egw-seed.conf}
EGW_RELEASE_FILE=${EGW_RELEASE_FILE:-/etc/engemase-release}
EGW_PLATFORM_FILE=${EGW_PLATFORM_FILE:-/usr/share/engemase/platform.env}
EGW_BENCH_CERT=${EGW_BENCH_CERT:-/usr/share/engemase/keys/bench-export.pem}
EGW_SYSFS=${EGW_SYSFS:-}            # prefixo de /sys e /proc (testes)
EGW_TECH_USER=${EGW_TECH_USER:-tecnico}

# Base32 de Crockford: sem I, L, O, U (não confunde na leitura do cartão).
EGW_CROCKFORD=0123456789ABCDEFGHJKMNPQRSTVWXYZ

# --- Mensagens ---------------------------------------------------------------------
egw_log()  { printf '%s\n' "$*"; }
egw_warn() { printf 'AVISO: %s\n' "$*" >&2; }
egw_err()  { printf 'ERRO: %s\n' "$*" >&2; }

# --- Validações ----------------------------------------------------------------------
# Número de série Engemase: EGW-00042 (docs/16 §4).
egw_valid_serial() { [[ ${1:-} =~ ^EGW-[0-9]{5}$ ]]; }

# EGW-00042 -> egw-00042
egw_hostname_from_serial() {
	egw_valid_serial "${1:-}" || return 1
	printf 'egw-%s\n' "${1#EGW-}"
}

egw_valid_mac() { [[ ${1:-} =~ ^[0-9a-f]{2}(:[0-9a-f]{2}){5}$ ]]; }

# Endereço de serviço da OT, derivado do MAC da ETH0 (rascunho de rede §1.2):
# 169.254.a.b com a = 1 + (byte5 mod 254) e b = byte6. Sai em 169.254.1.0 a
# 169.254.254.255 (faixa válida do RFC 3927) e não colide entre unidades.
egw_service_address() {
	local mac=${1,,} b5 b6
	egw_valid_mac "$mac" || return 1
	b5=$((16#${mac:12:2}))
	b6=$((16#${mac:15:2}))
	printf '169.254.%d.%d\n' $((1 + b5 % 254)) "$b6"
}

# --- Senha local ------------------------------------------------------------------------
# 16 símbolos base32 Crockford (80 bits) no formato XXXX-XXXX-XXXX-XXXX.
# Cada byte de /dev/urandom vira um símbolo pelos 5 bits baixos: 256 é múltiplo
# de 32, então a distribuição é uniforme.
egw_gen_password() {
	local -a bytes
	local out="" i
	read -r -a bytes < <(od -An -v -tu1 -N16 "${EGW_URANDOM:-/dev/urandom}" | tr -s ' \n' '  ')
	(( ${#bytes[@]} == 16 )) || return 1
	for i in "${!bytes[@]}"; do
		out+=${EGW_CROCKFORD:$(( bytes[i] & 31 )):1}
		if (( i % 4 == 3 && i < 15 )); then out+=-; fi
	done
	printf '%s\n' "$out"
}

# Forma canônica para o hash da página local: sem hífen e em maiúsculas
# (a página aceita com ou sem hífen, sem diferenciar maiúsculas).
egw_normalize_password() {
	local p=${1//-/}
	p=${p// /}
	printf '%s\n' "${p^^}"
}

# --- JSON ---------------------------------------------------------------------------------
# Imprime a string entre aspas, escapada para JSON.
egw_json_str() {
	local s=${1-}
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	s=${s//$'\n'/\\n}
	s=${s//$'\r'/\\r}
	s=${s//$'\t'/\\t}
	s=$(printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037')
	printf '"%s"' "$s"
}

# Valor JSON: null para vazio, número se for inteiro, senão string.
egw_json_val() {
	local v=${1-}
	if [[ -z $v ]]; then printf 'null'
	elif [[ $v =~ ^-?(0|[1-9][0-9]{0,17})$ ]]; then printf '%s' "$v"
	else egw_json_str "$v"
	fi
}

# --- Arquivos chave=valor (semente da gravação, engemase-release) -----------------------
# Lê só linhas EGW_[A-Z0-9_]=valor com caracteres seguros, sem executar nada
# (o arquivo vem da partição FAT de boot). Resultado no array associativo
# indicado (nome passado em $2).
egw_read_kv() {
	local file=$1 line key val
	local -n _kv=$2
	local re_skip='^[[:space:]]*(#|$)'
	local re_kv='^(EGW_[A-Z0-9_]{1,40})=(.*)$'
	local re_dq='^"(.*)"$' re_sq="^'(.*)'\$"
	local re_safe='^[A-Za-z0-9 ._:/@+,=-]{0,200}$'
	[[ -r $file ]] || return 1
	while IFS= read -r line || [[ -n $line ]]; do
		line=${line%$'\r'}
		[[ $line =~ $re_skip ]] && continue
		if [[ $line =~ $re_kv ]]; then
			key=${BASH_REMATCH[1]}
			val=${BASH_REMATCH[2]}
			if [[ $val =~ $re_dq || $val =~ $re_sq ]]; then val=${BASH_REMATCH[1]}; fi
			if [[ $val =~ $re_safe ]]; then
				_kv[$key]=$val
			else
				egw_warn "$file: valor recusado para $key"
			fi
		else
			egw_warn "$file: linha ignorada"
		fi
	done < "$file"
}

# --- Escrita atômica ------------------------------------------------------------------------
# egw_atomic_write <arquivo> <modo> [dono:grupo]  (conteúdo pela entrada padrão)
# Sobrevive a queda de energia: grava ao lado, sincroniza e renomeia.
egw_atomic_write() {
	local dst=$1 mode=$2 owner=${3:-} tmp
	tmp=$(mktemp "${dst%/*}/.${dst##*/}.XXXXXX")
	cat > "$tmp"
	chmod "$mode" "$tmp"
	if [[ -n $owner ]]; then chown "$owner" "$tmp"; fi
	sync "$tmp"
	mv -f "$tmp" "$dst"
	sync "${dst%/*}"
}

# --- Hardware ---------------------------------------------------------------------------------
egw_sys() { printf '%s%s' "$EGW_SYSFS" "$1"; }

# Lê um arquivo de sysfs/devicetree sem NUL nem quebra de linha final.
egw_read_sys() {
	local f
	f=$(egw_sys "$1")
	[[ -r $f ]] || return 1
	tr -d '\000' < "$f" | head -c 4096 | sed -e 's/[[:space:]]*$//'
}

# Interfaces Ethernet físicas: "nome driver usb(0|1) mac" por linha.
egw_list_ethernet() {
	local d n drv usb mac
	for d in "$(egw_sys /sys/class/net)"/*; do
		n=${d##*/}
		[[ -e $d/device ]] || continue                     # só físicas
		[[ $(cat "$d/type" 2>/dev/null) == 1 ]] || continue  # ARPHRD_ETHER
		[[ -d $d/wireless || -d $d/phy80211 ]] && continue
		drv=$(basename "$(readlink -f "$d/device/driver" 2>/dev/null)" 2>/dev/null || true)
		if [[ $(readlink -f "$d/device") == */usb* ]]; then usb=1; else usb=0; fi
		mac=$(tr '[:upper:]' '[:lower:]' < "$d/address")
		printf '%s %s %s %s\n' "$n" "${drv:-?}" "$usb" "$mac"
	done
}

# Descobre ETH0 (OT, Gigabit nativa do CM4, driver bcmgenet) e ETH1 (IT,
# 10/100 via USB). Define EGW_ETH0_IF/MAC e EGW_ETH1_IF/MAC.
egw_detect_ports() {
	local n drv usb mac
	EGW_ETH0_IF="" EGW_ETH0_MAC="" EGW_ETH1_IF="" EGW_ETH1_MAC=""
	while read -r n drv usb mac; do
		if [[ $drv == bcmgenet && -z $EGW_ETH0_IF ]]; then
			EGW_ETH0_IF=$n EGW_ETH0_MAC=$mac
		elif [[ $usb == 1 && -z $EGW_ETH1_IF ]]; then
			EGW_ETH1_IF=$n EGW_ETH1_MAC=$mac
		fi
	done < <(egw_list_ethernet)
	[[ -n $EGW_ETH0_IF && -n $EGW_ETH1_IF ]]
}

# Disco de boot (ex.: /dev/mmcblk0), a partir da raiz montada.
egw_boot_disk() {
	local src pk
	src=$(findmnt -nvo SOURCE / 2>/dev/null || true)
	pk=$(lsblk -ndo PKNAME "$src" 2>/dev/null || true)
	if [[ -n $pk ]]; then printf '/dev/%s\n' "$pk"; else printf '/dev/mmcblk0\n'; fi
}

# --- LEDs (overlay reComputer-R100x: led-red, led-green, led-blue) -------------------------
egw_led() { # egw_led <cor> off|on|blink
	local d
	d=$(egw_sys "/sys/class/leds/led-$1")
	[[ -d $d ]] || return 0
	case $2 in
		off)   echo none > "$d/trigger" 2>/dev/null; echo 0 > "$d/brightness" 2>/dev/null ;;
		on)    echo none > "$d/trigger" 2>/dev/null; echo 1 > "$d/brightness" 2>/dev/null ;;
		blink) echo timer > "$d/trigger" 2>/dev/null
		       echo 500 > "$d/delay_on" 2>/dev/null; echo 500 > "$d/delay_off" 2>/dev/null ;;
	esac
	return 0
}
egw_leds() { # egw_leds off|on|blink <cores...>; "amber" = vermelho + verde
	local mode=$1 c
	shift
	for c in red green blue; do egw_led "$c" off; done
	for c in "$@"; do
		if [[ $c == amber ]]; then egw_led red "$mode"; egw_led green "$mode"; else egw_led "$c" "$mode"; fi
	done
}
