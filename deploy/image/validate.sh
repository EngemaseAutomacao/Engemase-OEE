#!/bin/bash
# Validação estática da imagem (deploy/image). A imagem em si só é gerada num
# host ARM64 com o rpi-image-gen (build.sh); aqui conferimos o que dá para
# conferir em qualquer Linux. A sintaxe/shellcheck dos scripts, o YAML e o
# nftables de fábrica já estão no deploy/gateway/validate.sh (rode os dois).
#
# Uso: deploy/image/validate.sh [--igtop DIR]
#   --igtop DIR  clone do rpi-image-gen (commit de pins.env): confere também
#                se as camadas embutidas citadas existem nele
#
# Etapas:
#   1. camadas: toda camada citada nas configs/camadas existe (nossa ou do
#      rpi-image-gen) e o nome no METABEGIN bate com o arquivo;
#   2. coerência imagem x pacote oee-gateway (fstab, nftables, sysusers, sudo,
#      regra de LED): "um lado só";
#   3. testes das funções do factory init (egw-common.sh);
#   4. factory init e autoteste: --help/status numa árvore falsa;
#   5. flash-emmc.sh --dry-run (precisa de root) e build.sh --check.
set -uo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../.." && pwd)
gw=$repo/deploy/gateway
igtop=""
while (( $# )); do
	case $1 in
		--igtop) igtop=${2:?}; shift 2 ;;
		-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "opção desconhecida: $1" >&2; exit 2 ;;
	esac
done
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

PASS=0 FAIL=0 SKIP=0
ok() { printf '  [ok]     %s\n' "$*"; PASS=$((PASS + 1)); }
ko() { printf '  [FALHA]  %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [pulado] %s\n' "$*"; SKIP=$((SKIP + 1)); }
step() { printf '\n== %s\n' "$*"; }
expect() { # expect <descrição> <esperado> <obtido>
	if [[ $2 == "$3" ]]; then ok "$1"; else ko "$1: esperado '$2', obtido '$3'"; fi
}

# --- 1. Camadas --------------------------------------------------------------------------
step "1. Camadas do rpi-image-gen"
declare -A OURS=()
while IFS= read -r f; do
	n=$(sed -n 's/^# X-Env-Layer-Name: *//p' "$f" | head -n1)
	[[ -n $n ]] && OURS[$n]=$f
done < <(find "$here/layer" "$here/image" -name '*.yaml' -type f)
for n in "${!OURS[@]}"; do ok "camada própria $n (${OURS[$n]#"$here"/})"; done
# Embutidas usadas (rpi-image-gen fb44a4c): conferidas com --igtop.
builtin=(rpi-cm4 debian-trixie-arm64-minbase-snapshot rpi-debian-trixie rpi-debian-bookworm
	device-base systemd-min network-manager chrony ca-certificates locale-base image-base rpi-storage-binder)
mapfile -t referenced < <(
	{
		sed -n 's/^  \(layer\|distro\|rpi\|engemase\): *\([a-z0-9-]*\)$/\2/p' "$here"/config/*.yaml
		sed -n 's/^# X-Env-Layer-Requires: *//p; s/^#  \([a-z0-9-]*\),\{0,1\}$/\1/p' "$here"/layer/*.yaml "$here"/image/*/image.yaml |
			tr ',' '\n'
	} | tr -d ' ' | grep -v '^$' | sort -u)
for n in "${referenced[@]}"; do
	if [[ -n ${OURS[$n]:-} ]]; then
		ok "referência $n: camada própria"
	elif printf '%s\n' "${builtin[@]}" | grep -qx "$n"; then
		if [[ -n $igtop ]]; then
			if grep -rqs "^# X-Env-Layer-Name: $n\$" "$igtop/layer" "$igtop/device" "$igtop/image"; then
				ok "referência $n: embutida no rpi-image-gen"
			else
				ko "referência $n: não existe no rpi-image-gen em $igtop"
			fi
		else
			skip "referência $n: embutida (use --igtop para conferir)"
		fi
	else
		ko "referência $n: camada desconhecida"
	fi
done

# --- 2. Coerência imagem x pacote --------------------------------------------------------------
step "2. Imagem x pacote oee-gateway (um lado só)"
fstab=$here/image/egw-gpt/image.d/customize.overlay/etc/fstab
grep -qE '^[^#]*[[:space:]]/var/lib/oee-gateway[[:space:]]' "$fstab" &&
	ko "fstab da imagem monta /var/lib/oee-gateway (o bind é do pacote)" || ok "bind de /var/lib/oee-gateway só no pacote"
grep -q 'What=/data/oee' "$gw/systemd/oee-gateway-state.mount" && ok "pacote: bind /data/oee -> /var/lib/oee-gateway" || ko "mount do pacote sem What=/data/oee"
grep -qE '^table inet oee_gateway' "$here/layer/egw-base.d/customize.overlay/etc/nftables.conf" &&
	grep -qE '^table inet oee_gateway \{' "$gw/nftables/oee-gateway.nft" && ok "mesma tabela nftables (inet oee_gateway) na fábrica e no modelo" ||
	ko "tabelas nftables diferentes entre imagem e pacote"
grep -q 'include "/etc/oee-gateway/nftables.nf\[t\]"' "$here/layer/egw-base.d/customize.overlay/etc/nftables.conf" &&
	ok "fábrica inclui o arquivo renderizado por curinga" || ko "fábrica não inclui /etc/oee-gateway/nftables.nft"
[[ -z $(find "$here" -path '*sudoers.d*' -type f) ]] && ok "sudoers só no pacote (sem cópia na imagem)" || ko "a imagem tem sudoers próprio"
[[ -z $(find "$here" -name '*leds*.rules' -type f) ]] && ok "regra de LED só no pacote" || ko "a imagem tem regra de LED própria"
img_sysusers=$here/layer/egw-base.d/customize.overlay/etc/sysusers.d/engemase-image.conf
for u in oee oee-ui; do
	a=$(awk -v u="$u" '$1 == "u" && $2 == u { $1 = $2 = $3 = ""; print }' "$img_sysusers" | tr -s ' ')
	b=$(awk -v u="$u" '$1 == "u" && $2 == u { $1 = $2 = $3 = ""; print }' "$gw/sysusers.d/oee-gateway.conf" | tr -s ' ')
	expect "usuário $u igual na imagem e no pacote" "$b" "$a"
done
grep -q '^RuntimeWatchdogSec=10s' "$gw/system.conf.d/50-oee-watchdog.conf" &&
	grep -q '^RuntimeWatchdogSec=10s' "$here/layer/egw-base.d/customize.overlay/etc/systemd/system.conf.d/40-egw-watchdog.conf" &&
	ok "watchdog do SoC 10 s nos dois (docs/16 §5)" || ko "watchdog do SoC divergente"
grep -q 'fw_ok() .*table inet oee_gateway' "$here/factory/egw-selftest" && ok "autoteste B0.27 procura a tabela certa" || ko "B0.27 procura outra tabela"
grep -qE '^(device|image|layer):' "$here/config/egw-r1000.yaml" && grep -q 'debian_codename: trixie' "$here/config/egw-r1000.yaml" &&
	ok "config principal: Trixie" || ko "config principal não é Trixie"
grep -q 'debian_codename: bookworm' "$here/config/egw-r1000-bookworm.yaml" && ok "plano B: Bookworm (só com --plano-b-bookworm)" || ko "plano B inconsistente"
! grep -rqsE '^[[:space:]]*-[[:space:]]*(cloud-init|netplan\.io)[[:space:]]*$' "$here"/layer/*.yaml && ok "nenhuma camada instala cloud-init/netplan" || ko "camada instala cloud-init/netplan"

# --- 3. Funções do factory init ----------------------------------------------------------------
step "3. egw-common.sh"
# shellcheck source=factory/egw-common.sh
. "$here/factory/egw-common.sh"
egw_valid_serial EGW-00042 && ok "série EGW-00042 válida" || ko "série EGW-00042 recusada"
! egw_valid_serial EGW-42 && ! egw_valid_serial egw-00042 && ! egw_valid_serial 'EGW-00042;x' && ok "séries inválidas recusadas" || ko "série inválida aceita"
expect "hostname da série" egw-00042 "$(egw_hostname_from_serial EGW-00042)"
expect "endereço de serviço (MAC d8:3a:dd:12:7e:3a)" 169.254.127.58 "$(egw_service_address d8:3a:dd:12:7e:3a)"
expect "endereço de serviço (byte5 = 0xff)" 169.254.2.0 "$(egw_service_address d8:3a:dd:12:ff:00)"
pw=$(egw_gen_password)
[[ $pw =~ ^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$ ]] && ok "senha local no formato Crockford XXXX-XXXX-XXXX-XXXX" || ko "senha fora do formato: $pw"
expect "normalização da senha" K7QM4XTD9WRB2HNP "$(egw_normalize_password k7qm-4xtd-9wrb-2hnp)"
printf 'EGW_SERIAL=EGW-00042\nEGW_OPERATOR="Joao Teste"\nEGW_X=$(rm -rf /)\nlixo\n' >"$tmp/seed"
declare -A KV=()
egw_read_kv "$tmp/seed" KV 2>/dev/null
expect "semente: série" EGW-00042 "${KV[EGW_SERIAL]:-}"
expect "semente: operador entre aspas" "Joao Teste" "${KV[EGW_OPERATOR]:-}"
expect "semente: valor com \$( ) recusado" "" "${KV[EGW_X]:-}"
expect "JSON escapado" '"a\"b\\c"' "$(egw_json_str 'a"b\c')"
expect "JSON número" 42 "$(egw_json_val 42)"
expect "JSON vazio = null" null "$(egw_json_val '')"

# --- 4. Factory init e autoteste numa árvore falsa ---------------------------------------------
step "4. Factory init e autoteste"
export EGW_LIB_DIR=$here/factory EGW_IDENTITY_DIR=$tmp/identity
out=$("$here/factory/egw-factory-init" status 2>&1) && [[ $out == *"sem identidade"* ]] && ok "egw-factory-init status (sem identidade)" || ko "egw-factory-init status: $out"
"$here/factory/egw-factory-init" --help >/dev/null 2>&1 && ok "egw-factory-init --help" || ko "egw-factory-init --help"
"$here/factory/egw-selftest" --help >/dev/null 2>&1 && ok "egw-selftest --help" || ko "egw-selftest --help"
"$here/factory/egw-factory-init" comando-invalido >/dev/null 2>&1; expect "comando inválido sai com 2" 2 "$?"
unset EGW_LIB_DIR EGW_IDENTITY_DIR

# Rede da ficha de TI (semente) -> network.json, perfis do NM, proxy.env, NTP.
# Roda num namespace com o grupo oee falso (os arquivos são root:oee).
cat >"$tmp/net.sh" <<'EOF'
set -u
here=$1 t=$2 caso=$3
mount --make-rprivate /
cp /etc/group "$t/group"; getent group oee >/dev/null || echo 'oee:x:1501:' >>"$t/group"
mount --bind "$t/group" /etc/group
export EGW_LIB_DIR=$here/factory EGW_IDENTITY_DIR=$t/identity EGW_NETWORK_JSON=$t/etc/network.json \
	EGW_PROXY_ENV=$t/etc/proxy.env EGW_NM_DIR=$t/nm EGW_CHRONY_SOURCES_DIR=$t/chrony
# shellcheck source=factory/egw-factory-init
. "$here/factory/egw-factory-init"
set +e
HOSTNAME_NEW=egw-00042 EGW_ETH0_MAC=d8:3a:dd:12:7e:3a EGW_ETH1_MAC=00:11:22:33:44:55 F_SERVICE_ADDR=169.254.127.58
case $caso in
	completa) SEED=([EGW_OT_ADDRESS]=192.168.10.250/24 [EGW_IT_ADDRESS]=10.20.0.50/24 [EGW_IT_GATEWAY]=10.20.0.1
		[EGW_IT_DNS]=10.20.0.10,10.20.0.11 [EGW_NTP_SERVERS]=10.20.0.5 [EGW_HTTPS_PROXY]=http://10.20.0.5:3128) ;;
	fabrica) SEED=() ;;
	ot-servico) SEED=([EGW_OT_ADDRESS]=169.254.10.1/16) ;;
	dns-sem-ip) SEED=([EGW_IT_DNS]=10.20.0.10) ;;
	it-sem-gw) SEED=([EGW_IT_ADDRESS]=10.20.0.50/24 [EGW_IT_DNS]=10.20.0.10) ;;
	proxy-ruim) SEED=([EGW_HTTPS_PROXY]='http://x;rm -rf /:3128') ;;
	ip-ruim) SEED=([EGW_OT_ADDRESS]=192.168.10.256/24) ;;
esac
net_from_seed 2>/dev/null || exit 10
(write_network) || exit 11
EOF
if [[ $(id -u) -eq 0 ]] && command -v unshare >/dev/null && command -v python3 >/dev/null; then
	n=$tmp/net-completa; mkdir -p "$n"
	if unshare -m bash "$tmp/net.sh" "$here" "$n" completa; then
		python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["it"]["mode"]=="static" and d["ot"]["addresses"]==["192.168.10.250/24"] and d["proxy"]["url"].endswith(":3128") and d["ntp"]["servers"]==["10.20.0.5"]' "$n/etc/network.json" &&
			ok "network.json válido com a ficha de TI" || ko "network.json inválido: $(cat "$n/etc/network.json")"
		grep -qx 'address1=10.20.0.50/24,10.20.0.1' "$n/nm/oee-it.nmconnection" && grep -qx 'dns=10.20.0.10;10.20.0.11;' "$n/nm/oee-it.nmconnection" &&
			ok "perfil oee-it: IP fixo, gateway e DNS" || ko "perfil oee-it: $(cat "$n/nm/oee-it.nmconnection")"
		grep -qx 'address1=192.168.10.250/24' "$n/nm/oee-ot.nmconnection" && grep -qx 'address2=169.254.127.58/16' "$n/nm/oee-ot.nmconnection" &&
			grep -qx 'never-default=true' "$n/nm/oee-ot.nmconnection" && ok "perfil oee-ot: IP da OT + endereço de serviço, sem rota padrão" ||
			ko "perfil oee-ot: $(cat "$n/nm/oee-ot.nmconnection")"
		grep -qx 'HTTPS_PROXY=http://10.20.0.5:3128' "$n/etc/proxy.env" && [[ $(stat -c %a "$n/etc/proxy.env") == 640 ]] &&
			ok "proxy.env (0640)" || ko "proxy.env"
		grep -qx 'server 10.20.0.5 iburst' "$n/chrony/egw-ficha-ti.sources" && ok "NTP do cliente no chrony" || ko "NTP do cliente"
		[[ $(stat -c %a "$n/nm/oee-it.nmconnection") == 600 ]] && ok "perfis do NM 0600" || ko "perfis do NM sem 0600"
	else
		ko "rede da ficha de TI: factory init falhou"
	fi
	n=$tmp/net-fabrica; mkdir -p "$n"
	if unshare -m bash "$tmp/net.sh" "$here" "$n" fabrica; then
		grep -qx 'method=auto' "$n/nm/oee-it.nmconnection" && grep -qx 'address1=169.254.127.58/16' "$n/nm/oee-ot.nmconnection" &&
			[[ ! -e $n/etc/proxy.env ]] && ok "sem ficha: IT em DHCP e OT só com o endereço de serviço" || ko "rede de fábrica"
	else
		ko "rede de fábrica: factory init falhou"
	fi
	for caso in ot-servico dns-sem-ip it-sem-gw proxy-ruim ip-ruim; do
		n=$tmp/net-$caso; mkdir -p "$n"
		unshare -m bash "$tmp/net.sh" "$here" "$n" "$caso"; expect "semente com rede inválida recusada ($caso)" 10 "$?"
	done
else
	skip "rede da ficha de TI (precisa de root, unshare e python3)"
fi

# --- 5. Gravação e build ----------------------------------------------------------------------------
step "5. flash-emmc.sh e build.sh"
if [[ $(id -u) -eq 0 ]] && command -v bmaptool >/dev/null 2>&1; then
	mkdir -p "$tmp/out"
	v=13.2026.11.1 n=egw-os_13.2026.11.1_arm64_r1000
	truncate -s 8M "$tmp/out/$n.img"
	bmaptool create -o "$tmp/out/$n.img.bmap" "$tmp/out/$n.img" 2>/dev/null
	(cd "$tmp/out" && sha256sum "$n.img" "$n.img.bmap" >SHA256SUMS)
	out=$("$here/flash/flash-emmc.sh" --image "$tmp/out/$n.img" --serial EGW-00042 --device /dev/null --dry-run --operator 'Joao Teste' 2>&1)
	if [[ $out == *"EGW_SERIAL=EGW-00042"* && $out == *"EGW_IMAGE_VERSION=$v"* && $out == *"nada foi gravado"* ]]; then
		ok "flash-emmc.sh --dry-run monta a semente (série e versão)"
	else
		ko "flash-emmc.sh --dry-run:"; sed 's/^/      /' <<<"$out"
	fi
	# Ponta a ponta: a semente que a estação grava é aceita pelo factory init.
	out=$("$here/flash/flash-emmc.sh" --image "$tmp/out/$n.img" --serial EGW-00042 --device /dev/null --dry-run \
		--ot-address 192.168.10.250/24 --it-address 10.20.0.50/24 --it-gateway 10.20.0.1 --it-dns 10.20.0.10,10.20.0.11 \
		--ntp 10.20.0.5 --proxy http://10.20.0.5:3128 2>&1)
	grep '^EGW_' <<<"$out" >"$tmp/seed.conf"
	if (
		export EGW_LIB_DIR=$here/factory EGW_IDENTITY_DIR=$tmp/identity
		# shellcheck source=factory/egw-factory-init
		. "$here/factory/egw-factory-init"
		egw_read_kv "$tmp/seed.conf" SEED && read_seed_ok=$(egw_valid_serial "${SEED[EGW_SERIAL]:-}" && echo y) &&
			[[ $read_seed_ok == y && ${SEED[EGW_IT_DNS]:-} == 10.20.0.10,10.20.0.11 ]] && net_from_seed
	) >/dev/null 2>&1; then
		ok "semente com a ficha de TI gravada pela estação é aceita pelo factory init"
	else
		ko "semente da estação recusada pelo factory init: $(cat "$tmp/seed.conf")"
	fi
	"$here/flash/flash-emmc.sh" --image "$tmp/out/$n.img" --serial EGW-00042 --dry-run --it-dns 10.0.0.1 >/dev/null 2>&1
	expect "flash recusa DNS sem IP fixo da IT (saída 2)" 2 "$?"
	"$here/flash/flash-emmc.sh" --image "$tmp/out/$n.img" --serial EGW-42 --dry-run >/dev/null 2>&1; expect "série inválida recusada (saída 2)" 2 "$?"
	echo corrompido >>"$tmp/out/$n.img.bmap"
	"$here/flash/flash-emmc.sh" --image "$tmp/out/$n.img" --serial EGW-00042 --device /dev/null --dry-run >/dev/null 2>&1; expect "SHA256SUMS divergente recusado (saída 1)" 1 "$?"
else
	skip "flash-emmc.sh --dry-run (precisa de root e bmaptool)"
fi
out=$("$here/build.sh" --version 13.2026.11.1 --fase0 --check 2>&1); rc=$?
if (( rc == 0 )) && [[ $out == *"IGconf_egw_image_version=13.2026.11.1"* && $out == *"egw-r1000.yaml"* ]]; then
	ok "build.sh --check (Trixie, Fase 0) monta o comando do rpi-image-gen"
else
	ko "build.sh --check: $out"
fi
"$here/build.sh" --version 12.2026.11.1 --check >/dev/null 2>&1; expect "build.sh recusa 12.* sem --plano-b-bookworm" 1 "$?"
out=$("$here/build.sh" --version 12.2026.11.1 --plano-b-bookworm --fase0 --check 2>&1)
[[ $out == *"egw-r1000-bookworm.yaml"* ]] && ok "build.sh --plano-b-bookworm usa a config do Bookworm" || ko "plano B: $out"

printf '\n== Resultado: %d ok, %d falha(s), %d pulado(s)\n' "$PASS" "$FAIL" "$SKIP"
(( FAIL == 0 ))
