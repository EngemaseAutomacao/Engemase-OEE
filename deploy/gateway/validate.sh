#!/bin/bash
# Validação local do empacotamento do gateway (deploy/gateway) e dos arquivos
# da imagem que dependem dele (deploy/image). Não instala nada no sistema:
# tudo roda num diretório temporário e, onde precisa de usuários ou arquivos em
# /etc e /usr, num namespace de montagem privado (unshare -m) que some no fim.
# Etapa cuja ferramenta falta é PULADA com aviso (e conta no resumo).
#
# Uso:
#   deploy/gateway/validate.sh [--keep] [--tmp DIR] [--version VER] [--gateway-src DIR]
#     --keep         mantém o diretório temporário (binários, .deb, raiz de teste)
#     --tmp DIR      usa DIR como diretório temporário (padrão: mktemp -d)
#     --version      versão dos .deb de teste (padrão: 0.0.0-validate)
#     --gateway-src  código do agente a compilar (padrão: gateway/ do repositório;
#                    ex.: um "git archive HEAD gateway" quando a árvore está no meio
#                    de uma mudança)
#
# Etapas:
#   1. sintaxe (sh -n / bash -n) e shellcheck de todos os scripts de deploy/;
#   2. YAML (nfpm, configs e camadas do rpi-image-gen) com python3 + PyYAML;
#   3. sudoers: visudo -cf e matriz de permitidos/negados com o sudo REAL
#      (root + unshare + overlayfs);
#   4. nftables: modelo renderizado, firewall de fábrica da imagem e os dois
#      juntos com nft -c; carga real num netns descartável (unshare -n);
#   5. Go: compila o agente (amd64 e arm64, GOTOOLCHAIN=local) e confere o
#      etc/gateway.yaml com o parser real ("oee-gateway diag --config");
#   6. nfpm: gera os .deb (amd64 e arm64) e confere campos, arquivos, modos,
#      conffiles e que nenhuma unit da Fase 1 entrou;
#   7. systemd-analyze verify e security --offline nas units do pacote;
#   8. scripts do pacote com DPKG_ROOT numa raiz temporária: preinst,
#      postinst (2x, idempotência), prerm e postrm purge.
set -uo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../.." && pwd)
image=$repo/deploy/image

keep=no tmp="" version=0.0.0-validate gwsrc=$repo/gateway
while (( $# )); do
	case $1 in
		--keep) keep=yes; shift ;;
		--tmp) tmp=${2:?}; shift 2 ;;
		--version) version=${2:?}; shift 2 ;;
		--gateway-src) gwsrc=$(cd -- "${2:?}" && pwd); shift 2 ;;
		-h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "opção desconhecida: $1" >&2; exit 2 ;;
	esac
done
if [[ -z $tmp ]]; then tmp=$(mktemp -d); else mkdir -p "$tmp"; fi
cleanup() { if [[ $keep == no ]]; then rm -rf "$tmp"; else echo "mantido: $tmp"; fi; }
trap cleanup EXIT

PASS=0 FAIL=0 SKIP=0
ok() { printf '  [ok]     %s\n' "$*"; PASS=$((PASS + 1)); }
ko() { printf '  [FALHA]  %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [pulado] %s\n' "$*"; SKIP=$((SKIP + 1)); }
step() { printf '\n== %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
is_root() { [[ $(id -u) -eq 0 ]]; }

# --- 1. Scripts -------------------------------------------------------------------------
step "1. Scripts: sintaxe e shellcheck"
mapfile -t scripts < <(
	{
		find "$repo/deploy" -type f \( -name '*.sh' -o -path '*/scripts/*' -o -path '*/libexec/*' \
			-o -path '*/hooks/*' -o -path '*/factory/egw-*' \) ! -name '*.service' ! -name '*.rules'
	} | sort -u)
for f in "${scripts[@]}"; do
	first=$(head -n1 "$f")
	case $first in
		*bash*) shell='bash' ;;
		'#!/bin/sh'*) shell='sh' ;;
		*) if grep -q 'shellcheck shell=bash' "$f"; then shell='bash'; else continue; fi ;;
	esac
	if $shell -n "$f" 2>"$tmp/syn.err"; then ok "$shell -n ${f#"$repo"/}"; else ko "$shell -n ${f#"$repo"/}: $(cat "$tmp/syn.err")"; fi
done
if have shellcheck; then
	for f in "${scripts[@]}"; do
		# -x segue os "source" (factory/egw-common.sh); -S warning ignora estilo.
		if (cd "$(dirname "$f")" && shellcheck -x -S warning "$(basename "$f")") >"$tmp/sc.out" 2>&1; then
			ok "shellcheck ${f#"$repo"/}"
		else
			ko "shellcheck ${f#"$repo"/}"; sed 's/^/      /' "$tmp/sc.out" | head -30
		fi
	done
else
	skip "shellcheck ausente (pip install shellcheck-py)"
fi

# --- 2. YAML ---------------------------------------------------------------------------
step "2. YAML"
if have python3 && python3 -c 'import yaml' 2>/dev/null; then
	mapfile -t yamls < <(find "$repo/deploy" -type f \( -name '*.yaml' -o -name '*.yml' \) ! -path '*/work/*' | sort)
	for f in "${yamls[@]}"; do
		if python3 -I -c 'import sys, yaml; list(yaml.safe_load_all(open(sys.argv[1], encoding="utf-8")))' "$f" 2>"$tmp/y.err"; then
			ok "${f#"$repo"/}"
		else
			ko "${f#"$repo"/}: $(tail -n2 "$tmp/y.err")"
		fi
	done
else
	skip "python3 com PyYAML ausente"
fi

# --- 3. sudoers ------------------------------------------------------------------------
step "3. sudoers do tecnico"
sudoers=$here/sudoers.d/oee-tecnico
if have visudo; then
	if visudo -cqf "$sudoers"; then ok "visudo -cf sudoers.d/oee-tecnico"; else ko "visudo -cf sudoers.d/oee-tecnico"; fi
else
	skip "visudo ausente"
fi
cat >"$tmp/sudo-matrix.sh" <<'EOF'
set -u
T=$1 SUDOERS_SRC=$2
mount --make-rprivate /
cp /etc/passwd /etc/group /etc/shadow "$T/"
printf 'tecnico:x:1500:1500::/home/tecnico:/bin/bash\noee:x:1501:1501::/var/lib/oee-gateway:/usr/sbin/nologin\n' >>"$T/passwd"
printf 'tecnico:x:1500:\noee:x:1501:\n' >>"$T/group"
printf 'tecnico:!:19000::::::\noee:!:19000::::::\n' >>"$T/shadow"
for f in passwd group shadow; do mount --bind "$T/$f" "/etc/$f"; done
install -m 0440 "$SUDOERS_SRC" "$T/oee-tecnico"
# Só no teste: sem senha, para o sudo responder na hora se permite ou não.
printf 'Defaults env_reset\nroot ALL=(ALL:ALL) ALL\n@include %s\nDefaults:tecnico !authenticate\n' "$T/oee-tecnico" >"$T/sudoers"
chmod 0440 "$T/sudoers"; mount --bind "$T/sudoers" /etc/sudoers
mkdir -p "$T/up" "$T/work"
mount -t overlay overlay -o "lowerdir=/usr/bin,upperdir=$T/up,workdir=$T/work" /usr/bin || exit 3
printf '#!/bin/sh\necho "EXECUTOU-COMO-$(id -un)"\n' >/usr/bin/oee-gateway; chmod 0755 /usr/bin/oee-gateway
fail=0
check() { exp=$1 u=$2; shift 2
	if [ "$u" = - ]; then out=$(su tecnico -s /bin/sh -c "sudo -n $*" 2>&1 </dev/null); else out=$(su tecnico -s /bin/sh -c "sudo -n -u $u $*" 2>&1 </dev/null); fi
	case "$out" in *EXECUTOU-COMO-oee*) got=permitido ;; *EXECUTOU*) got=permitido-como-outro ;; *) got=negado ;; esac
	if [ "$u" = - ]; then pre=""; else pre="-u $u "; fi
	if [ "$got" = "$exp" ]; then echo "  [ok]     $exp: sudo $pre$*"; else echo "  [FALHA]  esperado $exp, deu $got: sudo $pre$* -> $out"; fail=1; fi
}
G=/usr/bin/oee-gateway
check permitido - $G diag
check permitido - $G diag --json
check permitido - $G enroll --code ABCD-1234
check permitido - $G enroll --code abcd1234
check permitido - $G status
check permitido - $G net show
check permitido - $G net set ot --static --address 192.168.10.250/24 --gw 192.168.10.1
check permitido - $G net confirm
check permitido - $G net rollback
check permitido oee $G diag
check negado - $G enroll --code ABCD-1234 --url https://evil.example
check negado - $G enroll --url https://evil.example --code ABCD-1234
check negado - $G enroll --code ABCD-1234 --force
check negado - $G enroll --code ABCD-1234 --hostname x
check negado - $G diag --config /tmp/x.yaml
check negado - $G --config /tmp/x.yaml diag
check negado - $G run
check negado - $G modbus read --target tcp://192.168.10.23:502
check negado - $G factory-reset
check negado - $G remote-access on
check negado - $G net set ot --config /tmp/x
check negado - $G net apply
check negado - /bin/sh
check negado root $G diag
exit $fail
EOF
if is_root && have unshare && have sudo && have su; then
	mkdir -p "$tmp/sudo"
	if out=$(unshare -m bash "$tmp/sudo-matrix.sh" "$tmp/sudo" "$sudoers" 2>&1); then
		printf '%s\n' "$out"; PASS=$((PASS + $(grep -c '\[ok\]' <<<"$out")))
	else
		printf '%s\n' "$out"; ko "matriz do sudo"
	fi
else
	skip "matriz do sudo real (precisa de root, unshare, sudo e su)"
fi

# --- 4. nftables ---------------------------------------------------------------------------
step "4. nftables"
cat >"$tmp/nft.sh" <<'EOF'
set -eu
T=$1 TPL=$2 FAB=$3 MODE=$4
mount --make-rprivate /
cp /etc/passwd "$T/passwd"
getent passwd oee >/dev/null || echo 'oee:x:1501:1501::/var/lib/oee-gateway:/usr/sbin/nologin' >>"$T/passwd"
getent passwd _apt >/dev/null || echo '_apt:x:42:65534::/nonexistent:/usr/sbin/nologin' >>"$T/passwd"
mount --bind "$T/passwd" /etc/passwd
sed -e 's|@IF_OT@|eth0|g' -e 's|@IF_IT@|eth1|g' -e 's|@UID_OEE@|1501|g' -e 's|@UIDS_IT_HTTPS@|1501, 42|g' "$TPL" >"$T/nftables.nft"
cat >>"$T/nftables.nft" <<'X'
add element inet oee_gateway ot_nets { 192.168.10.0/24 }
add element inet oee_gateway ot_targets { 192.168.10.21 . 502, 192.168.10.23 . 502 }
add element inet oee_gateway it_dns { 10.20.0.10 }
add element inet oee_gateway it_ntp { 10.20.0.5 }
add element inet oee_gateway it_proxy { 10.20.0.5 . 3128 }
add element inet oee_gateway ot_targets { 192.168.10.99 . 502 timeout 5m }
X
sed "s|/etc/oee-gateway/nftables.nf\[t\]|$T/inexistente.nf[t]|" "$FAB" >"$T/fab-sem.conf"
sed "s|/etc/oee-gateway/nftables.nf\[t\]|$T/nftables.nf[t]|" "$FAB" >"$T/fab-com.conf"
if [ "$MODE" = check ]; then
	nft -c -f "$T/nftables.nft" && echo "  [ok]     nft -c: modelo do pacote renderizado"
	nft -c -f "$T/fab-sem.conf" && echo "  [ok]     nft -c: firewall de fábrica da imagem (sem arquivo renderizado)"
	nft -c -f "$T/fab-com.conf" && echo "  [ok]     nft -c: fábrica + renderizado incluído"
else
	nft -f "$T/fab-sem.conf"
	nft list ruleset | grep -q '10.0.0.0/8' && echo "  [ok]     carga real (netns): fábrica com a regra provisória da Fase 0"
	nft -f "$T/fab-com.conf"
	if nft list ruleset | grep -q '10.0.0.0/8'; then echo "  [FALHA]  regra provisória continuou depois do include"; exit 1; fi
	nft list set inet oee_gateway ot_targets | grep -q '192.168.10.21 . 502' &&
		echo "  [ok]     carga real (netns): include trocou a fábrica pelas regras renderizadas"
	[ "$(nft list tables)" = "table inet oee_gateway" ] && echo "  [ok]     uma única tabela (inet oee_gateway)"
fi
EOF
if is_root && have nft && have unshare; then
	mkdir -p "$tmp/nft"
	fab=$image/layer/egw-base.d/customize.overlay/etc/nftables.conf
	if out=$(unshare -m bash "$tmp/nft.sh" "$tmp/nft" "$here/nftables/oee-gateway.nft" "$fab" check 2>&1); then
		printf '%s\n' "$out"; PASS=$((PASS + $(grep -c '\[ok\]' <<<"$out")))
	else
		printf '%s\n' "$out"; ko "nft -c"
	fi
	if out=$(unshare -m -n bash "$tmp/nft.sh" "$tmp/nft" "$here/nftables/oee-gateway.nft" "$fab" load 2>&1); then
		printf '%s\n' "$out"; PASS=$((PASS + $(grep -c '\[ok\]' <<<"$out")))
	else
		printf '%s\n' "$out"; ko "carga real do nftables num netns"
	fi
else
	skip "nftables (precisa de root, nft e unshare)"
fi

# --- 5. Go ------------------------------------------------------------------------------------
step "5. Agente (Go)"
dist=$tmp/dist
built=no
if have go; then
	built=yes
	for arch in amd64 arm64; do
		mkdir -p "$dist/$arch"
		if (cd "$gwsrc" && GOTOOLCHAIN=local CGO_ENABLED=0 GOOS=linux GOARCH=$arch \
			go build -trimpath -ldflags "-s -w" -o "$dist/$arch/oee-gateway" ./cmd/oee-gateway) 2>"$tmp/go.err"; then
			ok "go build linux/$arch ./cmd/oee-gateway (${gwsrc#"$repo"/})"
		else
			ko "go build linux/$arch: $(tail -n5 "$tmp/go.err")"; built=no
		fi
	done
	if [[ $(uname -m) == x86_64 && -x $dist/amd64/oee-gateway ]]; then
		out=$("$dist/amd64/oee-gateway" diag --config "$here/etc/gateway.yaml" 2>&1)
		if grep -qE '^\[ok +\] config local' <<<"$out"; then
			ok "etc/gateway.yaml aceito pelo parser do agente (diag: config local ok)"
		else
			ko "etc/gateway.yaml recusado pelo agente:"; sed 's/^/      /' <<<"$out"
		fi
	fi
else
	skip "Go ausente"
fi

# --- 6. nfpm ------------------------------------------------------------------------------------
step "6. Pacotes .deb (nfpm)"
debs=$tmp/debs
if [[ $built == yes ]] && { have nfpm || [[ -n ${NFPM:-} ]]; }; then
	nfpm_opt=()
	[[ -n ${NFPM:-} ]] && nfpm_opt=(--nfpm "$NFPM")
	for arch in amd64 arm64; do
		if "$here/build-deb.sh" "${nfpm_opt[@]}" --arch "$arch" --version "$version" --dist "$dist" --out "$debs" >"$tmp/nfpm.out" 2>&1; then
			ok "build-deb.sh --arch $arch"
		else
			ko "build-deb.sh --arch $arch"; sed 's/^/      /' "$tmp/nfpm.out"
		fi
	done
	deb=$(find "$debs" -name 'oee-gateway_*_amd64.deb' | head -n1)
	if [[ -n $deb ]] && have dpkg-deb; then
		f() { dpkg-deb -f "$deb" "$1"; }
		[[ $(f Package) == oee-gateway ]] && ok "Package: oee-gateway" || ko "Package: $(f Package)"
		[[ $(f Breaks) == *'sudo (<< 1.9.10)'* ]] && ok "Breaks: sudo (<< 1.9.10)" || ko "Breaks sem sudo"
		[[ $(f Depends) == *'systemd (>= 252)'* ]] && ok "Depends: systemd (>= 252)" || ko "Depends: $(f Depends)"
		list=$(dpkg-deb -c "$deb")
		for p in ./usr/bin/oee-gateway ./usr/lib/systemd/system/oee-gateway.service \
			'./usr/lib/systemd/system/var-lib-oee\\x2dgateway.mount' ./usr/lib/systemd/system/oee-gateway-datadir.service \
			./usr/lib/sysusers.d/oee-gateway.conf ./usr/lib/tmpfiles.d/oee-gateway.conf \
			./usr/lib/udev/rules.d/70-oee-gateway.rules ./usr/lib/oee-gateway/oee-led-fault \
			./etc/oee-gateway/gateway.yaml ./etc/sudoers.d/oee-tecnico ./usr/share/oee-gateway/nftables/oee-gateway.nft; do
			grep -qF -- " $p" <<<"$list" && ok "contém ${p#.}" || ko "falta ${p#.}"
		done
		grep -E 'oee-(localui|helper)|oee-gateway(-ui)?\.socket' <<<"$list" && ko "unit da Fase 1 no pacote" || ok "nenhuma unit da Fase 1 no pacote"
		grep -qE '^-r--r----- root/root .* ./etc/sudoers.d/oee-tecnico$' <<<"$list" && ok "sudoers 0440" || ko "sudoers sem modo 0440"
		grep -qE '^-rw-r----- root/root .* ./etc/oee-gateway/gateway.yaml$' <<<"$list" && ok "gateway.yaml 0640" || ko "gateway.yaml sem modo 0640"
		conff=$(dpkg-deb --ctrl-tarfile "$deb" | tar -xO ./conffiles)
		[[ $conff == $'/etc/oee-gateway/gateway.yaml\n/etc/sudoers.d/oee-tecnico' ]] && ok "conffiles: gateway.yaml e sudoers" || ko "conffiles: $conff"
		darm=$(find "$debs" -name 'oee-gateway_*_arm64.deb' | head -n1)
		if [[ -n $darm ]]; then
			mkdir -p "$tmp/arm64x"
			dpkg-deb -x "$darm" "$tmp/arm64x"
			[[ $(od -An -tx1 -j18 -N2 "$tmp/arm64x/usr/bin/oee-gateway" | tr -d ' ') == b700 ]] &&
				ok "binário do .deb arm64 é aarch64 (ELF e_machine 0xb7)" || ko "binário do .deb arm64 não é aarch64"
		fi
	fi
else
	skip "nfpm ausente ou agente não compilado (go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.1, ou NFPM=...)"
fi

# --- 7. systemd ---------------------------------------------------------------------------------
step "7. Units (systemd-analyze)"
deb=$(find "$debs" -name 'oee-gateway_*_amd64.deb' 2>/dev/null | head -n1)
if [[ -n $deb ]] && is_root && have unshare && have systemd-analyze; then
	r=$tmp/sa-root; mkdir -p "$r" "$tmp/sa-ovl/up" "$tmp/sa-ovl/work"
	dpkg-deb -x "$deb" "$r"
	cat >"$tmp/sa.sh" <<'EOF'
set -u
R=$1 W=$2
mount --make-rprivate /
mount -t overlay overlay -o "lowerdir=$R/usr:/usr,upperdir=$W/up,workdir=$W/work" /usr || exit 3
cd /usr/lib/systemd/system || exit 3
if systemd-analyze verify --man=no oee-gateway.service oee-gateway-datadir.service 'var-lib-oee\x2dgateway.mount'; then
	echo "  [ok]     systemd-analyze verify (agente, datadir, bind de /data/oee)"
else
	echo "  [FALHA]  systemd-analyze verify"; exit 1
fi
score=$(systemd-analyze security --offline=yes oee-gateway.service 2>/dev/null | awk '/Overall exposure level/ { print $(NF-2) }')
echo "  [info]   exposição do oee-gateway.service: ${score:-?} (meta <= 2,0)"
awk -v s="${score:-9}" 'BEGIN { exit !(s <= 2.0) }' && echo "  [ok]     exposição <= 2,0" || { echo "  [FALHA]  exposição ${score:-?} > 2,0"; exit 1; }
EOF
	if out=$(unshare -m bash "$tmp/sa.sh" "$r" "$tmp/sa-ovl" 2>&1); then
		printf '%s\n' "$out"; PASS=$((PASS + $(grep -c '\[ok\]' <<<"$out")))
	else
		printf '%s\n' "$out"; ko "systemd-analyze"
	fi
else
	skip "systemd-analyze (precisa do .deb, root, unshare e systemd-analyze)"
fi

# --- 8. Scripts do pacote com DPKG_ROOT -----------------------------------------------------------
step "8. Scripts do pacote (DPKG_ROOT)"
if [[ -n $deb ]] && is_root && have systemd-sysusers && have systemd-tmpfiles && have systemctl; then
	root=$tmp/dpkgroot ctrl=$tmp/ctrl
	mkdir -p "$root/etc" "$root/var/lib" "$root/home" "$ctrl"
	dpkg-deb -x "$deb" "$root"; dpkg-deb -e "$deb" "$ctrl"
	run_ms() { DPKG_ROOT=$root "$ctrl/$1" "${@:2}" >"$tmp/ms.out" 2>&1; }
	run_ms preinst install && ok "preinst install" || { ko "preinst install"; cat "$tmp/ms.out"; }
	run_ms postinst configure && ok "postinst configure (1ª instalação)" || { ko "postinst configure"; cat "$tmp/ms.out"; }
	run_ms postinst configure 0.0.1 && ok "postinst configure de novo (idempotente)" || { ko "postinst 2x"; cat "$tmp/ms.out"; }
	for u in oee oee-ui tecnico; do grep -q "^$u:" "$root/etc/passwd" && ok "usuário $u criado" || ko "usuário $u ausente"; done
	grep -qE '^oee-admin:.*tecnico' "$root/etc/group" && ok "tecnico em oee-admin" || ko "tecnico fora de oee-admin"
	grep -qE '^dialout:.*oee' "$root/etc/group" && ok "oee em dialout" || ko "oee fora de dialout"
	[[ -L $root/etc/systemd/system/multi-user.target.wants/oee-gateway.service ]] && ok "oee-gateway.service habilitado" || ko "oee-gateway.service não habilitado"
	[[ -L "$root/etc/systemd/system/local-fs.target.wants/var-lib-oee\\x2dgateway.mount" ]] && ok "bind de /data/oee habilitado" || ko "bind de /data/oee não habilitado"
	[[ $(stat -c %a "$root/var/lib/oee-gateway") == 750 ]] && ok "/var/lib/oee-gateway 0750" || ko "/var/lib/oee-gateway $(stat -c %a "$root/var/lib/oee-gateway")"
	run_ms prerm remove && ok "prerm remove" || { ko "prerm remove"; cat "$tmp/ms.out"; }
	run_ms postrm purge && ok "postrm purge" || { ko "postrm purge"; cat "$tmp/ms.out"; }
	[[ -z $(find "$root/etc/systemd/system" -type l 2>/dev/null) ]] && ok "purge removeu os links de habilitação" || ko "links sobraram no purge"
	[[ -d $root/var/lib/oee-gateway ]] && ok "purge preservou /var/lib/oee-gateway (buffer)" || ko "purge apagou o estado"
else
	skip "scripts do pacote (precisa do .deb, root, systemd-sysusers, systemd-tmpfiles e systemctl)"
fi

printf '\n== Resultado: %d ok, %d falha(s), %d etapa(s) pulada(s)\n' "$PASS" "$FAIL" "$SKIP"
(( FAIL == 0 ))
