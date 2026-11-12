#!/bin/sh
# Instalação manual do agente OEE numa BANCADA (R1000 ou PC amd64) ou numa VM
# de desenvolvimento, com verificações antes e depois (docs/16 §3–§5).
# Em campo, o pacote já vem na imagem e se atualiza pelo OTA.
#
# NÃO use na sua estação de trabalho: o pacote desliga o IPv6 e o roteamento
# (sysctl), limita o journald, arma o watchdog de hardware no próximo boot e
# cria os usuários oee, oee-ui e tecnico, com um sudoers para o tecnico.
#
# Uso:
#   sudo deploy/gateway/install.sh [opções]
#
# Opções:
#   --deb ARQ           instala este .deb (senão gera com build-deb.sh)
#   --dist DIR          binários para gerar o .deb: <DIR>/<arq>/oee-gateway
#                       (padrão: gateway/dist)
#   --version VER       versão do .deb gerado (padrão: 0.0.0-dev)
#   --ot-iface NOME     interface OT, onde a página local escuta (padrão: eth0)
#   --it-iface NOME     interface IT (padrão: eth1); usada no --firewall
#   --firewall          renderiza o modelo do nftables e CARREGA (cuidado: pela
#                       IT só saem 443/DNS/NTP e não entra nada, nem SSH)
#   --ot-targets LISTA  com --firewall: IP:porta liberados na OT, separados por
#                       vírgula (ex.: 192.168.10.21:502,192.168.10.23:502)
#   --check             só as verificações (não instala nada)
#   --yes               não pede confirmação
#   -h, --help
set -eu

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }
die() {
	echo "install: ERRO: $*" >&2
	exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }

ERRORS=0
WARNINGS=0
ok() { printf '  [ok]    %s\n' "$*"; }
info() { printf '  [info]  %s\n' "$*"; }
warn() {
	printf '  [aviso] %s\n' "$*"
	WARNINGS=$((WARNINGS + 1))
}
fail() {
	printf '  [ERRO]  %s\n' "$*"
	ERRORS=$((ERRORS + 1))
}

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$here/../.." && pwd)

deb=""
dist=gateway/dist
version=0.0.0-dev
ot_iface=eth0
it_iface=eth1
firewall=no
ot_targets=""
check_only=no
assume_yes=no

while [ $# -gt 0 ]; do
	case "$1" in
		--deb) deb=${2:?}; shift 2 ;;
		--dist) dist=${2:?}; shift 2 ;;
		--version) version=${2:?}; shift 2 ;;
		--ot-iface) ot_iface=${2:?}; shift 2 ;;
		--it-iface) it_iface=${2:?}; shift 2 ;;
		--firewall) firewall=yes; shift ;;
		--ot-targets) ot_targets=${2:?}; shift 2 ;;
		--check) check_only=yes; shift ;;
		--yes) assume_yes=yes; shift ;;
		-h | --help) usage; exit 0 ;;
		*) die "opção desconhecida: $1 (veja --help)" ;;
	esac
done

valid_iface() { echo "$1" | grep -Eq '^[A-Za-z0-9._-]{1,15}$'; }
valid_iface "$ot_iface" || die "--ot-iface inválida: $ot_iface"
valid_iface "$it_iface" || die "--it-iface inválida: $it_iface"
[ "$ot_iface" != "$it_iface" ] || die "OT e IT não podem ser a mesma interface"
if [ -n "$ot_targets" ]; then
	echo "$ot_targets" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}(,([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5})*$' ||
		die "--ot-targets inválido (ex.: 192.168.10.21:502,192.168.10.23:502)"
fi

tmpdir=""
cleanup() { if [ -n "$tmpdir" ]; then rm -rf "$tmpdir"; fi; }
trap cleanup EXIT

arch=$(dpkg --print-architecture 2>/dev/null || echo desconhecida)
case "$dist" in /*) dist_abs=$dist ;; *) dist_abs=$repo/$dist ;; esac

UNITS_ENABLED="oee-gateway.socket oee-gateway-ui.socket oee-helper.socket oee-localui.socket oee-gateway.service"

# ---------------------------------------------------------------------------
preflight() {
	echo "== Verificações antes da instalação"
	if [ "$(id -u)" = 0 ]; then ok "rodando como root"; else fail "precisa de root (sudo)"; fi
	if [ -d /run/systemd/system ]; then
		ok "systemd é o init"
	else
		fail "systemd não é o init (container?): o pacote precisa do systemd rodando"
	fi
	if have dpkg; then ok "dpkg presente"; else fail "sem dpkg: só Debian / Raspberry Pi OS"; fi
	case "$arch" in
		amd64 | arm64) ok "arquitetura $arch" ;;
		*) fail "arquitetura $arch não suportada (arm64 ou amd64)" ;;
	esac
	if [ -r /etc/os-release ]; then
		# shellcheck disable=SC1091 # arquivo do sistema
		info "sistema: $(. /etc/os-release && echo "${PRETTY_NAME:-?}")"
	fi
	sdver=$(systemctl --version 2>/dev/null | awk 'NR == 1 { print $2 }')
	case "$sdver" in '' | *[!0-9]*) sdver=0 ;; esac
	if [ "$sdver" -ge 252 ]; then
		ok "systemd $sdver"
		[ "$sdver" -ge 254 ] || warn "systemd $sdver (< 254): RestartSteps/RestartMaxDelaySec serão ignorados"
	else
		fail "systemd $sdver: precisa de >= 252 (Bookworm) — o alvo é o Trixie (257)"
	fi
	for c in systemd-sysusers systemd-tmpfiles; do
		if have "$c"; then ok "$c presente"; else fail "$c ausente"; fi
	done
	if have sudo; then
		sv=$(sudo -V 2>/dev/null | awk 'NR == 1 { print $3 }')
		if dpkg --compare-versions "${sv:-0}" ge 1.9.10; then
			ok "sudo $sv (aceita expressão regular no sudoers)"
		else
			fail "sudo ${sv:-?} < 1.9.10: o sudoers do tecnico quebraria o sudo"
		fi
	else
		warn "sudo ausente: o tecnico não terá os subcomandos com sudo"
	fi
	if have nft; then ok "nftables presente"; else warn "nftables ausente: o firewall não será aplicado"; fi
	if have nmcli; then ok "NetworkManager presente"; else warn "NetworkManager ausente: o oee-helper não conseguirá aplicar rede"; fi
	if [ -e "/sys/class/net/$ot_iface" ]; then
		ok "interface OT $ot_iface existe"
	else
		warn "interface OT $ot_iface não existe: a página local não sobe (use --ot-iface)"
	fi
	if [ -e "/sys/class/net/$it_iface" ]; then
		ok "interface IT $it_iface existe"
	else
		warn "interface IT $it_iface não existe (use --it-iface)"
	fi
	if have ss; then
		if ss -Hltn 'sport = :443' 2>/dev/null | grep -v "%$ot_iface:" | grep -q .; then
			warn "outro processo já escuta na porta 443: a página local pode não abrir"
		else
			ok "porta 443 livre (fora a própria página local)"
		fi
	fi
	if have mountpoint && mountpoint -q /data; then
		ok "/data montada: o estado do agente vai para /data/oee (bind em /var/lib/oee-gateway)"
	else
		info "/data não montada: o estado fica em /var/lib/oee-gateway na raiz (normal em bancada x86/VM)"
	fi
	if getent group dialout >/dev/null 2>&1; then ok "grupo dialout existe"; else warn "grupo dialout ausente (será criado pelo sysusers)"; fi
	serials=$(find /dev -maxdepth 1 \( -name 'ttyAMA*' -o -name 'ttyUSB*' -o -name 'ttyACM*' \) 2>/dev/null | sort | tr '\n' ' ')
	if [ -n "$serials" ]; then info "seriais: $serials"; else info "nenhuma serial ttyAMA/ttyUSB/ttyACM agora"; fi
	cur=$(dpkg-query -W -f='${Version}' oee-gateway 2>/dev/null || true)
	if [ -n "$cur" ]; then info "oee-gateway $cur já instalado (será atualizado)"; fi
}

# ---------------------------------------------------------------------------
elf_arch() {
	magic=$(head -c 4 "$1" | od -An -t x1 | tr -d ' \n')
	[ "$magic" = 7f454c46 ] || {
		echo nao-elf
		return 0
	}
	case "$(od -An -t x1 -j 18 -N 2 "$1" | tr -d ' \n')" in
		3e00) echo amd64 ;;
		b700) echo arm64 ;;
		*) echo outra ;;
	esac
}

obtain_deb() {
	if [ -n "$deb" ]; then
		[ -f "$deb" ] || die "arquivo não encontrado: $deb"
		pkg=$(dpkg-deb -f "$deb" Package)
		[ "$pkg" = oee-gateway ] || die "$deb é do pacote '$pkg', não oee-gateway"
		darch=$(dpkg-deb -f "$deb" Architecture)
		[ "$darch" = "$arch" ] || die "$deb é $darch; esta máquina é $arch"
		case "$deb" in /*) ;; *) deb=$(pwd)/$deb ;; esac
		return 0
	fi
	bin=$dist_abs/$arch/oee-gateway
	[ -f "$bin" ] || die "binário ausente: $bin
  O build do agente (gateway/) ainda não gera gateway/dist/<arq>/oee-gateway.
  Gere o binário (CGO_ENABLED=0 GOARCH=$arch go build -o $bin ./cmd/oee-gateway,
  dentro de gateway/) ou passe um pacote pronto com --deb."
	ea=$(elf_arch "$bin")
	[ "$ea" = "$arch" ] || die "$bin não é um executável $arch (detectado: $ea)"
	tmpdir=$(mktemp -d)
	"$here/build-deb.sh" --package oee-gateway --arch "$arch" --version "$version" \
		--dist "$dist_abs" --out "$tmpdir"
	deb=$(find "$tmpdir" -maxdepth 1 -name 'oee-gateway_*.deb' | head -n 1)
	[ -n "$deb" ] || die "o build não gerou o .deb"
}

confirm() {
	echo "== O pacote vai, NESTA máquina:"
	echo "  - criar os usuários oee, oee-ui e tecnico e o grupo oee-admin;"
	echo "  - instalar /etc/sudoers.d/oee-tecnico (sudo restrito do tecnico);"
	echo "  - desligar agora o IPv6 e o roteamento IPv4 (sysctl);"
	echo "  - limitar o journald e armar o watchdog de hardware (10 s) no próximo boot;"
	echo "  - abrir a porta 443 só na interface $ot_iface (página local);"
	echo "  - habilitar e iniciar o agente, a página local (socket) e o ajudante (socket)."
	if [ "$firewall" = yes ]; then
		echo "  - CARREGAR o firewall: pela $it_iface só saem 443/DNS/NTP e não entra nada;"
		echo "    na $ot_iface só a página local entra e o agente só alcança: ${ot_targets:-(nenhum alvo)}."
	fi
	[ "$assume_yes" = yes ] && return 0
	printf 'Continuar? [s/N] '
	read -r ans || ans=""
	case "$ans" in
		s | S | sim | y | yes) ;;
		*) die "cancelado" ;;
	esac
}

write_iface_dropin() {
	d=/etc/systemd/system/oee-localui.socket.d
	mkdir -p "$d"
	cat >"$d/10-iface.conf" <<EOF
# Gerado por deploy/gateway/install.sh (bancada). No R1000, o oee-helper
# reescreve este arquivo com a interface OT resolvida pelo MAC da ETH0.
[Socket]
BindToDevice=$ot_iface
EOF
}

install_deb() {
	echo "== Instalando $(basename "$deb")"
	if have apt-get; then
		DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
			-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$deb"
	else
		dpkg --force-confdef --force-confold -i "$deb"
	fi
}

render_firewall() {
	echo "== Firewall"
	have nft || die "nftables ausente"
	tpl=/usr/share/oee-gateway/nftables/oee-gateway.nft
	[ -f "$tpl" ] || die "modelo ausente: $tpl"
	uid_oee=$(id -u oee)
	uids=$uid_oee
	if uid_apt=$(id -u _apt 2>/dev/null); then uids="$uids, $uid_apt"; fi
	# Sub-redes da OT (rotas de enlace), sem 169.254/16 (já está no modelo).
	nets=$(ip -4 route show dev "$ot_iface" scope link 2>/dev/null |
		awk '$1 ~ /\// && $1 !~ /^169\.254\./ { print $1 }' | sort -u | paste -sd, -)
	dns=$(awk '$1 == "nameserver" && $2 ~ /^[0-9.]+$/ && $2 !~ /^127\./ { print $2 }' /etc/resolv.conf 2>/dev/null | sort -u | paste -sd, -)
	if [ -z "$dns" ] && have resolvectl; then
		dns=$(resolvectl dns "$it_iface" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9.]+$' | sort -u | paste -sd, -)
	fi
	ntp=""
	if have chronyc; then
		ntp=$(chronyc -n -c sources 2>/dev/null | awk -F, '$3 ~ /^[0-9.]+$/ { print $3 }' | sort -u | paste -sd, -)
	fi
	targets=$(echo "$ot_targets" | tr ',' '\n' | sed -n 's/^\(.*\):\([0-9]*\)$/\1 . \2/p' | paste -sd, -)
	out=/etc/oee-gateway/nftables.nft
	tmp=$(mktemp)
	{
		sed -e "s|@IF_OT@|$ot_iface|g" -e "s|@IF_IT@|$it_iface|g" \
			-e "s|@UID_OEE@|$uid_oee|g" -e "s|@UIDS_IT_HTTPS@|$uids|g" "$tpl"
		echo
		echo "# --- Gerado por deploy/gateway/install.sh (bancada) ---"
		[ -z "$nets" ] || echo "add element inet oee_gateway ot_nets { $nets }"
		[ -z "$targets" ] || echo "add element inet oee_gateway ot_targets { $targets }"
		[ -z "$dns" ] || echo "add element inet oee_gateway it_dns { $dns }"
		[ -z "$ntp" ] || echo "add element inet oee_gateway it_ntp { $ntp }"
	} >"$tmp"
	nft -c -f "$tmp" || die "o firewall renderizado não passou no nft -c ($tmp)"
	install -m 0600 "$tmp" "$out"
	rm -f "$tmp"
	nft -f "$out"
	ok "firewall carregado de $out (OT: ${nets:-só 169.254/16}; DNS: ${dns:-nenhum}; NTP: ${ntp:-nenhum})"
	[ -n "$dns" ] || warn "nenhum DNS na IT detectado: a resolução de nomes vai falhar"
	[ -n "$ntp" ] || warn "nenhum NTP detectado (chronyc): o relógio não sincroniza"
	info "para carregar no boot: /etc/nftables.conf com include \"$out\" e nftables.service habilitado"
}

# ---------------------------------------------------------------------------
postflight() {
	echo "== Verificações depois da instalação"
	if ! dpkg-query -W -f='${Status}' oee-gateway 2>/dev/null | grep -q 'install ok installed'; then
		fail "pacote oee-gateway não está instalado"
		return 0
	fi
	ok "oee-gateway $(dpkg-query -W -f='${Version}' oee-gateway) instalado"
	for u in oee oee-ui tecnico; do
		if getent passwd "$u" >/dev/null; then ok "usuário $u"; else fail "usuário $u ausente"; fi
	done
	if getent group oee-admin >/dev/null; then ok "grupo oee-admin"; else fail "grupo oee-admin ausente"; fi
	for g in dialout gpio systemd-journal; do
		if id -nG oee 2>/dev/null | tr ' ' '\n' | grep -qx "$g"; then ok "oee no grupo $g"; else fail "oee fora do grupo $g"; fi
	done
	for u in $UNITS_ENABLED; do
		st=$(systemctl is-enabled "$u" 2>/dev/null || true)
		if [ "$st" = enabled ]; then ok "$u habilitada"; else fail "$u: ${st:-desconhecida}"; fi
	done
	for s in agent ui helper; do
		if [ -S "/run/oee-gateway/$s.sock" ]; then ok "/run/oee-gateway/$s.sock"; else fail "/run/oee-gateway/$s.sock ausente"; fi
	done
	if have ss && ss -Hltn 'sport = :443' 2>/dev/null | grep -q "%$ot_iface:"; then
		ok "porta 443 escutando presa à $ot_iface"
	else
		warn "porta 443 não está presa à $ot_iface (systemctl status oee-localui.socket)"
	fi
	st=$(systemctl is-active oee-gateway.service 2>/dev/null || true)
	case "$st" in
		active) ok "agente ativo" ;;
		activating) warn "agente ainda subindo (systemctl status oee-gateway)" ;;
		*) fail "agente $st: journalctl -u oee-gateway -n 50" ;;
	esac
	if have mountpoint && mountpoint -q /data; then
		if mountpoint -q /var/lib/oee-gateway; then ok "/var/lib/oee-gateway montado de /data/oee"; else fail "/var/lib/oee-gateway não está montado de /data/oee"; fi
	fi
	check_mode /var/lib/oee-gateway oee:oee 750
	check_mode /etc/oee-gateway/gateway.yaml root:oee 640
	check_mode /etc/sudoers.d/oee-tecnico root:root 440
	if have visudo; then
		if visudo -cq >/dev/null 2>&1; then ok "sudoers válido (visudo -c)"; else fail "sudoers inválido: visudo -c"; fi
	fi
	if [ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null)" = 0 ]; then ok "ip_forward=0"; else fail "ip_forward != 0"; fi
	if out=$(systemd-analyze verify /usr/lib/systemd/system/oee-gateway.service \
		/usr/lib/systemd/system/oee-localui.service /usr/lib/systemd/system/oee-helper.service 2>&1); then
		ok "systemd-analyze verify sem erros"
	else
		warn "systemd-analyze verify: $out"
	fi
	for svc in oee-gateway.service oee-localui.service oee-helper.service; do
		score=$(systemd-analyze security --no-pager "$svc" 2>/dev/null | awk '/Overall exposure level/ { print $(NF-1), $NF }')
		info "exposição $svc: ${score:-?} (meta do agente: <= 2,0)"
	done
}

check_mode() {
	[ -e "$1" ] || {
		fail "$1 ausente"
		return 0
	}
	got=$(stat -c '%U:%G %a' "$1")
	if [ "$got" = "$2 $3" ]; then ok "$1 $got"; else fail "$1 está $got (esperado $2 $3)"; fi
}

summary() {
	echo "== Resultado: $ERRORS erro(s), $WARNINGS aviso(s)"
}

# ---------------------------------------------------------------------------
preflight
if [ "$check_only" = yes ]; then
	postflight
	summary
	[ "$ERRORS" -eq 0 ]
	exit $?
fi
if [ "$ERRORS" -gt 0 ]; then
	summary
	die "corrija os erros acima antes de instalar"
fi

obtain_deb
confirm
write_iface_dropin
install_deb
if [ "$firewall" = yes ]; then
	render_firewall
fi
# Dá tempo de o agente e os sockets subirem.
sleep 3
postflight
summary
cat <<'EOF'

Próximos passos:
  sudo oee-gateway enroll --code XXXX-XXXX     # ativar na plataforma
  sudo oee-gateway localui passwd --generate   # senha local (página e tecnico)
  systemctl status oee-gateway                 # estado e STATUS= do agente
  journalctl -u oee-gateway -f                 # logs
EOF
[ "$ERRORS" -eq 0 ]
