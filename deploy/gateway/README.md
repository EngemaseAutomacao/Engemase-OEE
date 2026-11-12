# Empacotamento do gateway OEE (`deploy/gateway`)

Empacotamento do agente do gateway: pacotes `.deb`, units do systemd, usuários, diretórios, firewall, sysctl, udev, sudo e journald, conforme o [docs/16](../../docs/16-projeto-do-gateway.md), §3 a §5. Onde um rascunho de `docs/rascunhos/` diverge, vale o docs/16.

> **Situação:** o binário do agente (`gateway/dist/<arq>/oee-gateway`) e o do atualizador (`gateway/dist/<arq>/oee-updater`) **ainda não existem**. O build do `gateway/` precisa gerá-los (`CGO_ENABLED=0`, `-trimpath`, `linux/arm64` e `linux/amd64`). Até lá, os pacotes só são gerados com binários fictícios, para testar o empacotamento (`validate.sh`).

## 1. Pacotes

| Pacote | Conteúdo | Por que separado |
|---|---|---|
| `oee-gateway` ([nfpm.yaml](nfpm.yaml)) | Binário `oee-gateway` (agente, CLI, página local e ajudante), units, sysusers, tmpfiles, sysctl, udev, journald, watchdog, modelo do nftables, `gateway.yaml` e sudoers do técnico | — |
| `oee-gateway-updater` ([nfpm-updater.yaml](nfpm-updater.yaml)) | Binário `oee-updater` e as units do OTA mínimo (M4b) | O atualizador precisa sobreviver a um agente novo que não sobe (docs/16 §3). Nunca é trocado na mesma transação do agente |

Dependências mínimas: `systemd (>= 252)` e `ca-certificates` (o atualizador, só `systemd`). Recomendados: `nftables`, `network-manager`, `chrony` e `sudo`. O `oee-gateway` declara `Breaks: sudo (<< 1.9.10)`, porque o sudoers usa expressão regular nos argumentos.

## 2. Processos, usuários e sockets

| Unit | Processo | Usuário | Como sobe |
|---|---|---|---|
| `oee-gateway.service` | `oee-gateway run` (agente de coleta) | `oee` | Sempre (`WantedBy=multi-user.target`), `Type=notify`, `WatchdogSec=30s`, `Restart=always` |
| `oee-gateway.socket` | `/run/oee-gateway/agent.sock` (CLI) | `oee:oee-admin` 0660 | Entregue ao agente (`FileDescriptorName=cli`) |
| `oee-gateway-ui.socket` | `/run/oee-gateway/ui.sock` (página ↔ agente) | `oee:oee-ui` 0660 | Entregue ao agente (`FileDescriptorName=ui`) |
| `oee-localui.socket` + `.service` | `oee-gateway localui serve` (página local) | `oee-ui` | Ativação por socket: **TCP 443 só na interface OT** (`BindToDevice=eth0`, `FreeBind=yes`), o que cobre os IPs da OT e o endereço de serviço 169.254.a.b |
| `oee-helper.socket` + `.service` | `oee-gateway helper serve` (ajudante privilegiado) | root, confinado | Ativação por socket em `/run/oee-gateway/helper.sock` (`root:oee` 0660) |
| `oee-gateway-updater.path` + `.service` | `oee-updater apply` | root | Quando o agente grava `/var/lib/oee-gateway/update/request.json` |
| `oee-gateway-update-check.service` | `oee-updater boot-check` | root | Todo boot, antes do agente |
| `var-lib-oee\x2dgateway.mount` + `oee-gateway-datadir.service` | bind de `/data/oee` em `/var/lib/oee-gateway` | — | No `local-fs.target`, só se `/data` estiver montada |

Usuários (`sysusers.d`): `oee` (agente; grupos `dialout`, `gpio`, `systemd-journal`), `oee-ui` (página local), `tecnico` (console local, senha bloqueada até o factory init gravar a senha local; membro de `oee-admin`) e o grupo `oee-admin` (CLI de leitura sem sudo). O `oee-ra` (VPN) entra na F2.

### Contrato com o código do `gateway/` (a implementar)

- Subcomandos: `oee-gateway run --config …`, `oee-gateway localui serve`, `oee-gateway helper serve`; `oee-updater apply --request …` e `oee-updater boot-check`.
- Ativação por socket: o agente recebe dois fds e os distingue por `$LISTEN_FDNAMES` (`cli` e `ui`); a página recebe `https`; o ajudante, `helper`. Todos conferem o chamador por `SO_PEERCRED`.
- O agente notifica `READY=1` e manda `WATCHDOG=1` a cada ~10 s **só** com o motor, os pollers e o gravador SQLite saudáveis; pode usar `STATUS=`.
- O agente só lê `/etc/oee-gateway` (o `ProtectSystem=strict` deixa escrever apenas em `/var/lib/oee-gateway`, `/run/oee-gateway/agent` e nos LEDs). Proxy pelo `EnvironmentFile=/etc/oee-gateway/proxy.env`, gerado pelo ajudante.
- A página local roda **sem rede própria** (`PrivateNetwork=yes`, só `AF_UNIX`): tudo que ela mostra vem do agente pelo `ui.sock`.
- O ajudante grava só em `/etc/oee-gateway`, `/var/lib/oee-gateway`, `/var/lib/oee-localui`, `/etc/NetworkManager/system-connections`, `/etc/chrony/sources.d` e no drop-in da página local. Tem `CAP_NET_ADMIN`, `CAP_SYS_TIME`, `CAP_CHOWN`, `CAP_FOWNER` e `CAP_DAC_*`, e **não** tem `CAP_SYS_ADMIN`: o pendrive deve ser lido sem montar (FAT em espaço de usuário, `DeviceAllow=block-sd r`). Se precisar montar, acrescentar `CAP_SYS_ADMIN` e liberar `@mount` num drop-in revisado.
- O `oee-updater` instala com `dpkg -i --force-confdef --force-confold` (sem pergunta de conffile), guarda o pacote anterior no seu `StateDirectory` (root) e, no `boot-check`, **não** espera o agente (ele vem antes do agente): só enfileira o `oee-gateway-updater.service` com `--no-block`.

## 3. Arquivos e destinos

| Arquivo no repositório | Instalado em | Função |
|---|---|---|
| `systemd/oee-gateway.service` | `/usr/lib/systemd/system/` | Agente: `Type=notify`, watchdog, reinício sem limite, recursos e hardening forte (`ProtectSystem=strict`, sem capabilities, `DevicePolicy=closed` + `DeviceAllow` das seriais e do GPIO, `SystemCallFilter`). `ExecStopPost` liga o LED vermelho piscando |
| `systemd/oee-gateway.socket`, `oee-gateway-ui.socket` | idem | API local da CLI e da página |
| `systemd/oee-localui.socket`, `oee-localui.service` | idem | Página local na 443 só na OT; processo sem rede própria, `PrivateUsers`, 64 MB |
| `systemd/oee-helper.socket`, `oee-helper.service` | idem | Ajudante root confinado, operações fechadas |
| `systemd/oee-gateway-state.mount` | `/usr/lib/systemd/system/var-lib-oee\x2dgateway.mount` | Bind de `/data/oee`. No repositório tem outro nome porque `\` não é válido em nomes de arquivo no Windows |
| `systemd/oee-gateway-datadir.service` | `/usr/lib/systemd/system/` | Cria `/data/oee` se faltar, antes do bind |
| `systemd/oee-gateway-updater.path`, `oee-gateway-updater.service`, `oee-gateway-update-check.service` | idem (pacote do atualizador) | OTA mínimo |
| `system.conf.d/50-oee-watchdog.conf` | `/usr/lib/systemd/system.conf.d/` | `RuntimeWatchdogSec=10s` (watchdog do SoC) e `RebootWatchdogSec=2min`. Vale no próximo boot |
| `journald.conf.d/50-oee-gateway.conf` | `/usr/lib/systemd/journald.conf.d/` | 256 MB, 1 GB livre, 30 dias, gravação a cada 5 min. Vale após reiniciar o journald |
| `sysusers.d/oee-gateway.conf` | `/usr/lib/sysusers.d/` | Usuários e grupos |
| `tmpfiles.d/oee-gateway.conf` | `/usr/lib/tmpfiles.d/` | `/var/lib/oee-gateway` (oee 0750), `/etc/oee-gateway` e modos dos arquivos gerados, `/run/oee-gateway`, drop-in da página, `/home/tecnico` |
| `sysctl.d/90-oee-gateway.conf` | `/usr/lib/sysctl.d/` | `ip_forward=0`, IPv6 desligado, rp_filter, sem redirects, ARP por interface |
| `udev/70-oee-gateway.rules` + `libexec/oee-led-perms` | `/usr/lib/udev/rules.d/`, `/usr/lib/oee-gateway/` | LEDs (`led-red/green/blue`) e buzzer (`gpio-beeper`) no grupo `oee`; `gpiochip*` no grupo `gpio` |
| `libexec/oee-led-fault` | `/usr/lib/oee-gateway/` | Liga o gatilho `timer` no LED vermelho quando o agente para |
| `nftables/oee-gateway.nft` | `/usr/share/oee-gateway/nftables/` | **Modelo** do firewall, com placeholders, renderizado pelo ajudante em `/etc/oee-gateway/nftables.nft` |
| `etc/gateway.yaml` | `/etc/oee-gateway/gateway.yaml` (**conffile**, 0640 `root:oee`) | Config local mínima (aceita pelo `internal/config` do agente) |
| `sudoers.d/oee-tecnico` | `/etc/sudoers.d/oee-tecnico` (**conffile**, 0440) | Sudo do técnico só com os subcomandos do docs/16 §4 |
| `scripts/oee-gateway/{preinst,postinst,prerm,postrm}` | scripts do `.deb` | Ver §5 |
| `scripts/oee-gateway-updater/{postinst,prerm,postrm}` | scripts do `.deb` do atualizador | Habilita a `.path` e a verificação pós-boot; nunca reinicia o atualizador |
| `build-deb.sh` | — | Gera os `.deb` com o nfpm |
| `install.sh` | — | Instalação manual em bancada/VM com verificações |
| `validate.sh` | — | Validação local completa (§7) |

Os arquivos de configuração do sistema ficam em `/usr/lib` (padrão do fornecedor): para mudar, crie um arquivo de **mesmo nome** em `/etc/...` (prevalece) ou um drop-in `/etc/systemd/system/<unit>.d/*.conf`. Só `/etc/oee-gateway/gateway.yaml` e `/etc/sudoers.d/oee-tecnico` são conffiles.

## 4. Firewall (modelo)

`nftables/oee-gateway.nft` cria a tabela `inet oee_gateway` (recria só ela; não mexe nas outras), com política `drop` em entrada, saída e encaminhamento:

- **Entrada:** só TCP 443 pela interface OT, vindo de `@ot_nets` (sub-redes OT e `169.254.0.0/16`, o endereço de serviço). Ping de entrada não é liberado.
- **Saída IT:** DHCP; DNS só para `@it_dns`; NTP só para `@it_ntp`; TCP 443 (direto ou pelo `@it_proxy`) só para os UIDs de `@UIDS_IT_HTTPS@` (`oee` e `_apt`).
- **Saída OT:** só o agente (`skuid oee`) e só para `@ot_targets` (IP . porta cadastrados). `device.test` entra com `timeout 5m`. Ping só para `@ot_nets`.
- IPv6 descartado; `forward` em `drop`; contadores nomeados `drop_in`, `drop_out` e `drop_fwd` para a saúde.

Placeholders: `@IF_OT@`, `@IF_IT@`, `@UID_OEE@` e `@UIDS_IT_HTTPS@`. Os conjuntos são preenchidos com `add element` (exemplos no fim do arquivo). A imagem carrega o arquivo renderizado no boot (`/etc/nftables.conf` com `include "/etc/oee-gateway/nftables.nft"` e `nftables.service` habilitado).

## 5. Scripts do pacote

Todos são POSIX `sh`, idempotentes e respeitam `DPKG_ROOT` (raiz alternativa). Funcionam com o systemd rodando (bancada, OTA), no chroot de build da imagem (só cria usuários, diretórios e links de habilitação) e com `DPKG_ROOT`.

- **`preinst`:** recusa instalar com menos de 64 MiB livres em `/usr` (a raiz do R1000 tem 4 GiB). Ponto para futuras migrações de conffile (`dpkg-maintscript-helper`).
- **`postinst`:** `systemd-sysusers` → valida o sudoers com `visudo -cf` (inválido = erro, e o OTA volta à versão anterior) → `daemon-reload` → migra o estado da raiz para `/data/oee` se for preciso (só para um destino vazio; nunca apaga a origem) → monta o bind → `systemd-tmpfiles` → habilita as units no estilo do debhelper (`deb-systemd-helper`: habilita na 1ª instalação e units novas; **respeita** o que foi desabilitado depois, como a página local desligada por política) → recarrega o udev e o sysctl → inicia (instalação nova) ou reinicia só o que estava ativo (atualização). Tudo que inicia unit usa `--no-block`, porque o script pode rodar dentro do `oee-gateway-update-check.service`, ordenado antes do agente.
- **`prerm`:** na remoção, para serviços e sockets; na atualização, não para nada (o `postinst` novo reinicia).
- **`postrm`:** `daemon-reload`; no `purge`, remove os links de habilitação e o drop-in da página. **Não apaga** `/var/lib/oee-gateway` (buffer não enviado e credencial), os usuários nem os arquivos de rede gerados. Descarte e LGPD: `oee-gateway factory-reset` (docs/16 §7).

## 6. Gerar o `.deb`

Requer o nfpm **v2.43.1** (a última versão que compila com Go 1.24; as seguintes exigem Go 1.25+):

```sh
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.1
```

Da raiz do repositório (os caminhos `src` do nfpm são relativos ao diretório corrente):

```sh
# com o wrapper (usa SOURCE_DATE_EPOCH do último commit: .deb reproduzível)
deploy/gateway/build-deb.sh --arch arm64 --version 0.1.0
deploy/gateway/build-deb.sh --package all --arch amd64 --version 0.1.0 --out /tmp/debs

# ou direto
OEE_VERSION=0.1.0 OEE_ARCH=arm64 OEE_DIST=gateway/dist \
  nfpm pkg --config deploy/gateway/nfpm.yaml --packager deb --target gateway/dist/
```

Saída: `oee-gateway_<versão>_<arq>.deb` e `oee-gateway-updater_<versão>_<arq>.deb`. Não versione `.deb` nem binários.

## 7. Validar

```sh
deploy/gateway/validate.sh          # tudo; apaga os artefatos no fim
deploy/gateway/validate.sh --keep   # mantém o diretório temporário para inspeção
```

O `validate.sh` não instala nada no sistema e pula, com aviso, a etapa cuja ferramenta faltar:

1. `shellcheck` em todos os scripts;
2. `visudo -cf` no sudoers e uma matriz de comandos permitidos e negados, testada com o **sudo real** num namespace de montagem privado (`unshare -m`, sem tocar no `/etc`); sem `unshare`, com `grep -E` (mesma família de regex, POSIX ERE);
3. `nft -c -f` no modelo renderizado com valores de exemplo;
4. `udevadm verify` na regra;
5. nfpm: gera os dois pacotes (amd64 e arm64) com binários fictícios e confere campos, conffiles, modos e scripts;
6. `systemd-analyze verify` nas units extraídas do pacote e `systemd-analyze security --offline` (exposição);
7. scripts do pacote com `DPKG_ROOT` numa raiz temporária: `preinst`, `postinst` duas vezes (idempotência), `prerm`, `postrm purge`.

Ferramentas: `shellcheck` (ex.: `pip install shellcheck-py`), `nft`, `systemd-analyze`, `udevadm`, `visudo`, `dpkg-deb`, `nfpm`.

## 8. Instalar numa bancada

```sh
sudo deploy/gateway/install.sh --check                      # só verificações
sudo deploy/gateway/install.sh --ot-iface enp2s0 --it-iface enp3s0
sudo deploy/gateway/install.sh --deb /tmp/debs/oee-gateway_0.1.0_amd64.deb --yes
sudo deploy/gateway/install.sh --firewall --ot-targets 192.168.10.21:502,192.168.10.23:502
```

Use numa bancada (R1000 ou PC amd64 dedicado) ou numa VM, **nunca na sua estação de trabalho**: o pacote desliga o IPv6 e o roteamento, limita o journald, arma o watchdog de hardware no próximo boot e cria usuários e sudoers. O `install.sh` grava a interface OT no drop-in `/etc/systemd/system/oee-localui.socket.d/10-iface.conf` (no R1000 o ajudante reescreve pelo MAC), instala com `apt-get --no-install-recommends` (para não puxar o NetworkManager numa VM) e confere usuários, grupos, units, sockets, porta 443 presa à OT, montagem de `/data`, modos, sudoers, `ip_forward` e a exposição das units. O `--firewall` só deve ser usado com acesso pelo console ou pela OT: pela IT não entra mais nada.

## 9. Integração com a imagem (`deploy/image`)

O pacote não faz o que é da imagem:

- partição `/data` (systemd-repart no 1º boot) e o bind do journal em `/data/journal`;
- `/etc/nftables.conf` incluindo `/etc/oee-gateway/nftables.nft` e um nftables de fábrica até o ajudante gerar o primeiro;
- endurecimento do kernel (`kernel.*`, `fs.*`), SSH mascarado, serviços removidos;
- factory init: identidade em `/data/identity/hw.json`, senha local (hash do `tecnico` e da página), `network.json` de fábrica.

Se a imagem também instalar sysusers, sudoers ou journald para o `tecnico`/gateway, manter **um lado só** (o pacote é atualizado pelo OTA; a imagem, só por reflash).

## 10. Decisões tomadas aqui (e divergências dos rascunhos)

- **Página local na porta 443, processo `oee-localui` separado, usuário `oee-ui`** (docs/16), e não na 8443 dentro do agente (rascunho de software). O systemd abre a porta; ninguém precisa de `CAP_NET_BIND_SERVICE`. Sem porta 80 e sem `127.0.0.1:8443` no MVP (o túnel da VPN é F2).
- **Um ajudante root (`oee-helper`)** no lugar do `oee-netd` e do `oee-gateway-reset@` dos rascunhos (docs/16 §3).
- **`oee-admin`** (dos rascunhos): o docs/16 não cita, mas a CLI de campo (§6) tem comandos de leitura fora da lista do sudo (§4). O técnico entra nesse grupo e o agente autoriza por `SO_PEERCRED` (leitura para `oee-admin`, mudança só para root).
- **Sudoers com expressão regular** nos argumentos: `--url`, `--config` e qualquer opção fora da lista são recusados; `enroll --code` só com o formato do contrato. Manter em sincronia com a CLI.
- **`purge` não apaga o buffer**: perder dados não enviados contraria o princípio 2 do docs/16.
- **sysctl aplicado na hora** pelo `postinst` (o que está instalado é o que vale); journald e watchdog no próximo boot.
- **Watchdog do SoC** (`system.conf.d`) no pacote, porque faz parte do contrato de robustez do agente; o do RTC não é armado (docs/16 §5).

## 11. A confirmar na bancada

1. `ReadWritePaths=/sys/class/leds/led-*` seguindo o link simbólico até o dispositivo com `ProtectKernelTunables=yes` (plano B: drop-in com `ProtectKernelTunables=no`).
2. Evento `change` com `TRIGGER=timer` ao mudar o gatilho do LED (para o udev liberar `delay_on`/`delay_off`); nomes `led-red/green/blue` no lote; LED RGB ou três LEDs.
3. Buzzer: `gpio-beeper` (dispositivo de entrada) ou GPIO direto; nome do dispositivo de entrada (`*beeper*|*buzzer*`).
4. Nomes de `/proc/devices` (`ttyAMA`, `gpiochip`, `input`) para o `DeviceAllow=`; mapeamento `rs485-1..3` → `ttyAMA2/3/5`.
5. `BindToDevice=` + `FreeBind=` no systemd do Trixie; nome do kernel da ETH0 (`eth0`?) e da ETH1; comportamento se a OT subir depois do socket.
6. Página com `PrivateNetwork=yes`, `PrivateUsers=yes` e `RestrictAddressFamilies=AF_UNIX` aceitando conexões no fd herdado.
7. `SystemCallFilter=~@privileged @resources` com o binário Go real (agente e página) e `~@mount …` no ajudante.
8. Nota do `systemd-analyze security` com o binário real (meta do agente ≤ 2,0).
9. `RuntimeWatchdogSec=10s` no `bcm2835_wdt` e `RebootWatchdogSec=2min`.
10. Ordem `data.mount` → `oee-gateway-datadir` → bind → `systemd-tmpfiles-setup` no 1º boot (com a `/data` recém-criada pelo systemd-repart).
11. `rp_filter=1` com rotas OT atrás de roteador e o endereço de serviço; `arp_ignore`/`arp_announce` com as duas redes.
12. sudo do Trixie (1.9.16) com as expressões regulares; `log_output` e onde gravar o I/O log (`/var/log/sudo-io` na raiz).
13. Fluxo completo do OTA com o `oee-updater` real: `dpkg -i` dentro do `oee-gateway-updater.service`, queda de energia no meio, `boot-check` → `dpkg --configure -a` sem travar o boot.

## 12. Pendências fora da bancada

- E-mail do mantenedor nos `nfpm*.yaml` (`a-definir@engemase.invalid`).
- Binários em `gateway/dist/<arq>/` e subcomandos `localui serve`, `helper serve` e `oee-updater` (gateway/).
- Lista exata de opções de `net set` na CLI (o sudoers e o `validate.sh` precisam acompanhar); `net apply`/`net test` não estão no sudo porque o docs/16 §4 não os lista.
- Domínio dos gateways (D28) no `gateway.yaml`.
- Assinatura do `.deb`/manifesto (Ed25519, `tools/release-sign`) e publicação no Vercel Blob: fora deste diretório.
