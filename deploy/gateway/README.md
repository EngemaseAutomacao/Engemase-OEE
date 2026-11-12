# Empacotamento do gateway OEE (`deploy/gateway`)

Pacote `.deb` do agente do gateway e tudo que vai com ele no Linux: units do systemd, usuários, diretórios, firewall, sysctl, udev, sudo do técnico, journald e watchdog, conforme o [docs/16](../../docs/16-projeto-do-gateway.md) §3 a §5. Onde um rascunho de `docs/rascunhos/` diverge, vale o docs/16.

A imagem do sistema (Trixie, partição `/data`, factory init, gravação do eMMC) fica em [`deploy/image`](../image/README.md).

## 1. Situação: o que é Fase 0 e o que é Fase 1

O agente de hoje (`gateway/cmd/oee-gateway`) é o da **Fase 0**. O pacote leva **só o que esse agente usa**. O resto fica no repositório como contrato, mas **fora do `.deb`**, até o código existir.

| Peça | Arquivo(s) | Situação |
|---|---|---|
| Agente + CLI (`run`, `version`, `diag`, `enroll`, `modbus read`, `config validate`) | `/usr/bin/oee-gateway` | **Fase 0, empacotado** |
| `oee-gateway.service` (usuário `oee`, `Type=notify`, `WatchdogSec=30s`) | `systemd/oee-gateway.service` | **Fase 0, empacotado** |
| Bind `/data/oee` → `/var/lib/oee-gateway` | `systemd/oee-gateway-state.mount`, `oee-gateway-datadir.service` | **Fase 0, empacotado** |
| sysusers, tmpfiles, sysctl, udev (RS-485, LEDs), journald, watchdog do SoC | `sysusers.d/`, `tmpfiles.d/`, `sysctl.d/`, `udev/`, `journald.conf.d/`, `system.conf.d/` | **Fase 0, empacotado** |
| sudo restrito do `tecnico` | `sudoers.d/oee-tecnico` | **Fase 0, empacotado** (`diag` e `enroll` já existem; `status` e `net` são da Fase 1) |
| Modelo do firewall | `nftables/oee-gateway.nft` | **Fase 0, empacotado** (renderizado na bancada pelo `install.sh --firewall`; na Fase 1, pelo `oee-helper`) |
| API local da CLI e da página (`agent.sock`, `ui.sock`) | `systemd/fase1/oee-gateway.socket`, `oee-gateway-ui.socket` | **Fase 1, fora do pacote**: o agente ainda não aceita ativação por socket (`$LISTEN_FDS`) |
| Página local (`oee-localui`, porta 443 só na OT) | `systemd/fase1/oee-localui.{socket,service}` | **Fase 1, fora do pacote**: falta `oee-gateway localui serve` |
| Ajudante privilegiado (`oee-helper`) | `systemd/fase1/oee-helper.{socket,service}` | **Fase 1, fora do pacote**: falta `oee-gateway helper serve` |
| Atualizador OTA (`oee-gateway-updater`) | `nfpm-updater.yaml`, `systemd/oee-gateway-updater.*`, `oee-gateway-update-check.service`, `scripts/oee-gateway-updater/` | **M4b**: falta `gateway/cmd/oee-updater`; o `build-deb.sh` recusa gerar esse pacote com mensagem clara |
| VPN sob demanda (`oee-remote-access`, usuário `oee-ra`) | — | **F2** ([docs/12](../../docs/12-acesso-remoto-vpn.md)). O usuário `oee-ra` já nasce na imagem |

Quando uma peça da Fase 1 ficar pronta: mova a unit de `systemd/fase1/` para `systemd/`, acrescente no `nfpm.yaml`, nas listas de units do `postinst`/`prerm`/`postrm` e do `install.sh`, e na matriz do `validate.sh`.

## 2. Processos, usuários e caminhos

| Unit | Processo | Usuário | Como sobe |
|---|---|---|---|
| `oee-gateway.service` | `oee-gateway run --config /etc/oee-gateway/gateway.yaml` | `oee` (grupos `dialout`, `gpio`, `systemd-journal`) | Sempre (`multi-user.target`), `Restart=always`, sem limite de tentativas |
| `var-lib-oee\x2dgateway.mount` + `oee-gateway-datadir.service` | bind de `/data/oee` em `/var/lib/oee-gateway` | — | No `local-fs.target`, só se `/data` for ponto de montagem (no R1000). Sem `/data` (VM, PC de bancada), a condição falha sem erro e o estado fica na raiz |

| Usuário/grupo | Para quê |
|---|---|
| `oee` | Agente. Lê `/etc/oee-gateway/gateway.yaml` (root:oee 0640), escreve só em `/var/lib/oee-gateway` |
| `oee-ui` | Página local (Fase 1). Já criado porque o factory init grava a chave TLS e o hash da senha local em `/data/localui` |
| `tecnico` | Console local (HDMI + teclado), **sem SSH**. Senha = senha local da unidade (factory init). Grupos `oee-admin` (CLI da Fase 1) e `systemd-journal` (lê `journalctl -u oee-gateway` na Fase 0) |
| `oee-admin` | Grupo do `agent.sock` (Fase 1) |

| Caminho | Dono / modo | Conteúdo |
|---|---|---|
| `/etc/oee-gateway/gateway.yaml` | root:oee 0640, conffile | Config local mínima (§4) |
| `/etc/oee-gateway/network.json` | root:oee 0640 | Rede, proxy e NTP: a única fonte (escrito pelo factory init; Fase 1: `oee-helper`) |
| `/etc/oee-gateway/proxy.env` | root:oee 0640 | `HTTPS_PROXY`/`NO_PROXY` lidos pelo agente (`EnvironmentFile=`) |
| `/etc/oee-gateway/nftables.nft` | root 0600 | Firewall renderizado (§5) |
| `/var/lib/oee-gateway/` | oee:oee 0750 | `buffer.db` (SQLite), config atual e anterior |
| `/var/lib/oee-gateway/credentials.json` | oee 0600 | Credencial do enroll. O tmpfiles conserta o dono se alguém registrar como root |
| `/data/identity/hw.json` | root 0644 | Identidade da unidade (factory init da imagem) |
| `/dev/oee/rs485-1..3` | link para `ttyAMA2/3/5` | Nomes lógicos para o técnico (o agente abre o `ttyAMA` direto) |

## 3. Contrato com o código do agente (conferido no código, Fase 0)

- **Notificação:** o agente manda `READY=1` depois de abrir o buffer e aplicar a última config salva, e `STOPPING=1` no `SIGTERM` (`internal/app`, sd_notify próprio, sem cgo). Por isso `Type=notify` e `NotifyAccess=main`.
- **Watchdog:** com `WatchdogSec=30s`, o agente manda `WATCHDOG=1` + `STATUS=` a cada 10 s, **só se** (com config carregada) passarem as três checagens do docs/16 §3: o **motor** rodou um tick nos últimos 5 s (contados a partir do fim da última gravação); a **gravação** no SQLite não está presa há mais de 30 s e não deixou de ser tentada além do prazo; e cada **leitor** (poller) deu sinal de vida dentro de `max(3 × (maior poll + pior leitura), 30 s)`, prazo estendido durante o backoff de um CLP que não responde e suspenso enquanto o leitor espera o motor consumir. Quando uma falha, o agente registra `watchdog não alimentado` (nível warn, campo `verificacao=motor|gravacao|leitor`) e não manda o ping; o systemd reinicia o serviço.
- **Parada:** no `SIGTERM`, os leitores voltam antes da gravação final. A leitura em curso termina pelo prazo (a biblioteca Modbus não a interrompe) e o `Close` do transporte espera a linha ficar quieta, para a resposta atrasada não cair no próximo leitor da mesma linha: até 1× `timeout_ms` no Modbus TCP, 3× no RS-485 e 6× no conversor RTU sobre TCP (`poller.StopBound`; o pior caso é o ACK da requisição chegando no limite do escoamento com a linha falando). Com `timeout_ms` no máximo do contrato (10 s), são até 60 s, mais a gravação final, o `agent_stop` e o fechamento do buffer: `TimeoutStopSec=80s` (conferido por `TestTimeoutStopSecCobreAParadaDosPollers`). Com os padrões (300–500 ms), os leitores voltam em até 3 s.
- **Sem ativação por socket:** a unit não declara `Sockets=` (ver §1).
- **`gateway.yaml`:** o parser recusa chave desconhecida (`KnownFields`). Chaves aceitas: `schema`, `cloud.{url,timeout_s,extra_ca_file}`, `paths.{state_dir,credentials,buffer,identity}`, `hardware.{profile,serial_ports}`, `log.level`. O `etc/gateway.yaml` do pacote é conferido com o parser real no `validate.sh`.
- **Enroll:** `oee-gateway enroll` grava `credentials.json` com o usuário que o rodou. Por isso o sudo do técnico roda como `oee` (§6) e, na bancada, use `sudo -u oee oee-gateway enroll --code ...`.
- **Proxy:** o cliente HTTP usa `http.ProxyFromEnvironment` → `HTTPS_PROXY` do `proxy.env`. Uma CA corporativa vai em `cloud.extra_ca_file`.
- **LEDs:** o agente da Fase 0 não acende LED. A unit liga o vermelho piscando quando o agente para (`ExecStopPost=oee-led-fault set`, gatilho `timer` do kernel) e apaga ao iniciar (`ExecStartPre=oee-led-fault clear`).

## 4. Arquivos e destinos

| Arquivo no repositório | Instalado em | Função |
|---|---|---|
| `systemd/oee-gateway.service` | `/usr/lib/systemd/system/` | Agente: hardening forte (`ProtectSystem=strict`, sem capabilities, `DevicePolicy=closed` + `DeviceAllow` das seriais, GPIO e entrada, `SystemCallFilter`), recursos limitados, `RequiresMountsFor=/var/lib/oee-gateway`. `systemd-analyze security`: **1,5** (meta ≤ 2,0) |
| `systemd/oee-gateway-state.mount` | `/usr/lib/systemd/system/var-lib-oee\x2dgateway.mount` | Bind de `/data/oee`. No repositório tem outro nome porque `\` não é válido em nome de arquivo no Windows |
| `systemd/oee-gateway-datadir.service` | `/usr/lib/systemd/system/` | Cria `/data/oee` se faltar, antes do bind |
| `system.conf.d/50-oee-watchdog.conf` | `/usr/lib/systemd/system.conf.d/` | `RuntimeWatchdogSec=10s` (watchdog do SoC, docs/16 §5) e `RebootWatchdogSec=2min`. Vale no próximo boot |
| `journald.conf.d/50-oee-gateway.conf` | `/usr/lib/systemd/journald.conf.d/` | 256 MB, 1 GB livre, 30 dias, gravação a cada 5 min |
| `sysusers.d/oee-gateway.conf` | `/usr/lib/sysusers.d/` | Usuários e grupos (§2) |
| `tmpfiles.d/oee-gateway.conf` | `/usr/lib/tmpfiles.d/` | Estado do agente, modos dos arquivos de `/etc/oee-gateway`, dono da credencial, home do técnico |
| `sysctl.d/90-oee-gateway.conf` | `/usr/lib/sysctl.d/` | `ip_forward=0`, IPv6 desligado, `rp_filter`, sem redirects, ARP por interface |
| `udev/70-oee-gateway.rules` + `libexec/oee-led-perms` | `/usr/lib/udev/rules.d/`, `/usr/lib/oee-gateway/` | RS-485 (`ttyAMA2/3/5`: `dialout` 0660, links `/dev/oee/rs485-N`, fora do ModemManager), LEDs `led-red/green/blue` graváveis pelo grupo `oee`, buzzer e `gpiochip` |
| `libexec/oee-led-fault` | `/usr/lib/oee-gateway/` | LED vermelho piscando com o agente parado |
| `nftables/oee-gateway.nft` | `/usr/share/oee-gateway/nftables/` | **Modelo** do firewall (§5) |
| `etc/gateway.yaml` | `/etc/oee-gateway/gateway.yaml` (**conffile**) | Config local mínima |
| `sudoers.d/oee-tecnico` | `/etc/sudoers.d/oee-tecnico` (**conffile**, 0440) | Sudo restrito do técnico (§6) |
| `scripts/oee-gateway/{preinst,postinst,prerm,postrm}` | scripts do `.deb` | §7 |
| `build-deb.sh`, `install.sh`, `validate.sh` | — | Gerar, instalar numa bancada, validar |

Os arquivos de sistema ficam em `/usr/lib` (padrão do fornecedor): para mudar, crie um arquivo de **mesmo nome** em `/etc/...` ou um drop-in `/etc/systemd/system/oee-gateway.service.d/*.conf`. Só `gateway.yaml` e o sudoers são conffiles.

## 5. Firewall

O modelo `nftables/oee-gateway.nft` cria a tabela `inet oee_gateway` com política `drop` em entrada, saída e encaminhamento (docs/16 §5):

- **Entrada:** só TCP 443 pela interface OT, vindo das sub-redes OT ou de `169.254.0.0/16` (página local, Fase 1). Sem SSH, sem ping.
- **Saída IT:** DHCP; DNS só para `@it_dns`; NTP só para `@it_ntp`; TCP 443 (direto ou pelo `@it_proxy`) só para os UIDs `oee` e `_apt`.
- **Saída OT:** só o agente (`skuid oee`) e só para `@ot_targets` (IP . porta cadastrados). `device.test` entra com `timeout 5m` (Fase 1). Ping só para `@ot_nets`.
- IPv6 descartado; contadores `drop_in`, `drop_out`, `drop_fwd`.

O arquivo renderizado vai para `/etc/oee-gateway/nftables.nft`. **Na imagem**, o `/etc/nftables.conf` carrega no boot as regras de **fábrica** na **mesma tabela** e depois inclui esse arquivo por curinga (`include "/etc/oee-gateway/nftables.nf[t]"`): se ele existir, o `delete table` do modelo troca a fábrica pelas regras definitivas na mesma transação. O `validate.sh` testa isso com uma carga real num netns descartável.

> **Fase 0 (provisório):** sem o `oee-helper`, nada mantém o `@ot_targets` na unidade. As regras de fábrica da imagem deixam **o agente, e só ele**, abrir TCP para redes privadas e link-local (CLPs, conversores RTU/TCP, proxy). É mais largo que o docs/16 §5 pede ("só os IP:porta cadastrados"); fecha quando o arquivo renderizado existir. Numa bancada x86 com root, `install.sh --firewall --ot-targets ...` já aplica as regras definitivas.

## 6. Sudo do técnico

O `tecnico` digita `sudo oee-gateway ...` e o comando roda **como `oee`** (`runas_default=oee`), não como root: o enroll grava a credencial com o dono certo, o firewall só deixa o `oee` sair na 443 e nada aqui precisa de root.

| Comando | Fase |
|---|---|
| `sudo oee-gateway diag` / `diag --json` | 0 |
| `sudo oee-gateway enroll --code ABCD-1234` | 0 |
| `sudo oee-gateway status [--json]` | 1 |
| `sudo oee-gateway net show [--json]`, `net set ...`, `net confirm`, `net rollback` | 1 |

Os argumentos são conferidos por expressão regular (sudo ≥ 1.9.10, por isso o pacote declara `Breaks: sudo (<< 1.9.10)`): `--url`, `--config`, `--force`, `--hostname`, `run`, `modbus`, `factory-reset`, `remote-access` e qualquer outro são recusados, e o técnico não consegue `-u root`. A matriz completa roda com o **sudo real** no `validate.sh`.

Fase 0, sem a API local: `oee-gateway modbus read` pelo técnico não alcança CLP (o firewall só libera o `oee`, e o técnico não está em `dialout`). Isso é de propósito: a leitura de campo da Fase 1 passa pela fila do agente (um mestre por barramento, docs/16 §1).

## 7. Scripts do pacote

POSIX `sh`, idempotentes, respeitam `DPKG_ROOT`. Funcionam com o systemd rodando (bancada, OTA), no chroot de build da imagem (só cria usuários, diretórios e links de habilitação) e com `DPKG_ROOT`.

- **`preinst`:** recusa instalar com menos de 64 MiB livres em `/usr`.
- **`postinst`:** `systemd-sysusers` → `visudo -cf` no sudoers (inválido = erro, e o OTA volta à versão anterior) → `daemon-reload` → migra o estado da raiz para `/data/oee` se for preciso (só para destino vazio; nunca apaga a origem) → monta o bind → `systemd-tmpfiles` → habilita no estilo do debhelper (`deb-systemd-helper`: respeita o que foi desabilitado depois) → recarrega o udev (tty, leds, input, gpio) e o sysctl → inicia (instalação nova) ou reinicia o agente se ele estava rodando (atualização). Tudo com `--no-block`, porque o script pode rodar dentro do `oee-gateway-update-check.service`, ordenado antes do agente.
- **`prerm`:** na remoção, para o agente; na atualização, não para nada.
- **`postrm`:** `daemon-reload`; no `purge`, remove os links de habilitação. **Não apaga** `/var/lib/oee-gateway` (buffer não enviado e credencial: princípio 2 do docs/16), os usuários nem os arquivos de rede. Descarte e LGPD: reset de fábrica (docs/16 §7, Fase 1).

## 8. Gerar o `.deb`

Requer Go 1.24 e o nfpm **v2.43.1** (a última que compila com Go 1.24):

```sh
GOTOOLCHAIN=local go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.1
```

De qualquer diretório:

```sh
# compila o agente (CGO_ENABLED=0, -trimpath, versão/commit/data no buildinfo) e empacota
deploy/gateway/build-deb.sh --build --arch arm64 --version 0.1.0
deploy/gateway/build-deb.sh --build --arch amd64 --version 0.1.0-rc.1 --out /tmp/debs

# para a imagem do R1000
deploy/gateway/build-deb.sh --build --arch arm64 --version 0.1.0 --out deploy/image/debs
```

Saída: `oee-gateway_<versão>_<arq>.deb` (pré-release `-rc.1` vira `~rc.1`). Binários vão para `gateway/dist/<arq>/` (ignorado pelo git). A data dos arquivos vem do último commit (`SOURCE_DATE_EPOCH`): o `.deb` é reproduzível. O `--package oee-gateway-updater` só funciona quando existir o `gateway/cmd/oee-updater` (M4b).

## 9. Validar

```sh
sudo deploy/gateway/validate.sh          # tudo; não instala nada no sistema
sudo deploy/gateway/validate.sh --keep   # mantém binários, .deb e a raiz de teste
deploy/image/validate.sh                 # parte estática da imagem
```

Root é necessário só para as etapas que usam namespace (`unshare`): o sudo real, a carga do nftables num netns descartável, o `systemd-analyze verify` com os arquivos do pacote sobrepostos em `/usr`. Sem root, essas etapas são puladas com aviso. Etapas: sintaxe e `shellcheck` de todos os scripts de `deploy/`; YAML; `visudo` e matriz do sudo; `nft -c` do modelo, da fábrica e dos dois juntos + carga real; build do agente (amd64 e arm64) e o `gateway.yaml` pelo parser real; `.deb` amd64 e arm64 (campos, arquivos, modos, conffiles, nenhuma unit da Fase 1, binário aarch64); `systemd-analyze verify` e `security --offline`; scripts do pacote com `DPKG_ROOT` (2× para idempotência, `purge` preserva o buffer).

Ferramentas: `shellcheck` (`pip install shellcheck-py`), `python3-yaml`, `nft`, `visudo`/`sudo`, `systemd-analyze`, `systemd-sysusers`, `systemd-tmpfiles`, `dpkg-deb`, `go`, `nfpm`, `bmaptool`.

## 10. Instalar numa bancada (PC amd64, VM ou R1000 com root)

```sh
sudo deploy/gateway/install.sh --check                       # só verificações
sudo deploy/gateway/install.sh --build --yes                 # compila, empacota e instala
sudo deploy/gateway/install.sh --deb /tmp/debs/oee-gateway_0.1.0_amd64.deb --yes
sudo deploy/gateway/install.sh --firewall --ot-iface enp2s0 --it-iface enp3s0 \
     --ot-targets 192.168.10.21:502,192.168.10.23:502
```

Use numa bancada ou VM, **nunca na sua estação de trabalho**: o pacote desliga o IPv6 e o roteamento, limita o journald, arma o watchdog de hardware no próximo boot e cria usuários e sudoers. Num PC, o usuário `tecnico` nasce sem senha (`passwd tecnico` para testar o sudo). O `--firewall` só deve ser usado com acesso pelo console: pela IT não entra mais nada.

Depois:

```sh
sudo -u oee oee-gateway diag                        # config, credencial, buffer, DNS
sudo -u oee oee-gateway enroll --code ABCD-1234     # ativação (credencial com dono oee)
systemctl status oee-gateway                        # STATUS= do agente
journalctl -u oee-gateway -f
```

Proxy corporativo numa bancada: `/etc/oee-gateway/proxy.env` (root:oee 0640) com `HTTPS_PROXY=http://IP:porta` e `NO_PROXY=localhost,127.0.0.1`, e `systemctl restart oee-gateway`. No R1000, o proxy vem da gravação (`flash-emmc.sh --proxy`, ver `deploy/image`).

## 11. Integração com a imagem (`deploy/image`): um lado só

| Assunto | Dono |
|---|---|
| Bind `/data/oee` → `/var/lib/oee-gateway` | **Pacote** (mount unit). O fstab da imagem não tem essa linha: uma linha lá geraria uma unit de mesmo nome que esconderia a do pacote |
| Partição `/data`, bind do journal em `/data/journal`, `/etc/nftables.conf` de fábrica, hardening do kernel, SSH mascarado, serviços removidos | **Imagem** |
| Sudo do técnico | **Pacote** (atualizado pelo OTA). A imagem só apaga o `ALL` que o rpi-image-gen cria |
| Regras udev dos LEDs e RS-485 | **Pacote** |
| Usuários `oee`, `oee-ui` | Os dois declaram, com os **mesmos** campos (a imagem precisa deles antes do pacote, para o nftables e o tmpfiles da `/data`); o `validate.sh` da imagem confere |
| journald e watchdog | Os dois, com os mesmos valores (o drop-in do pacote tem número maior e prevalece) |
| Identidade, senha local, rede de fábrica e da ficha de TI (`network.json`, perfis do NetworkManager, `proxy.env`, NTP) | **Factory init da imagem** (Fase 0); `oee-helper` na Fase 1 |

## 12. Decisões tomadas aqui (e divergências dos rascunhos)

- **Só a Fase 0 no pacote.** Units que chamam subcomandos inexistentes ficam em `systemd/fase1/`.
- **Sudo como `oee`, não root** (`runas_default=oee`). O docs/16 §4 lista os subcomandos; não diz com que usuário. Root deixaria a credencial ilegível para o agente e seria barrado pelo firewall.
- **Página local na 443, processo `oee-localui` separado, usuário `oee-ui`** (docs/16), e não na 8443 dentro do agente (rascunho de software). **Um ajudante root (`oee-helper`)** no lugar do `oee-netd` (rascunhos).
- **ETH0 = OT, ETH1 = IT** (docs/16 §5). O rascunho de software (§2.9 e §5.1) diz o contrário; vale o docs/16.
- **`oee-admin`** (dos rascunhos): o docs/16 não cita; é o grupo do `agent.sock` da Fase 1.
- **`tecnico` em `systemd-journal`** na Fase 0, para ler o log do agente sem o comando `logs`.
- **`purge` não apaga o buffer** (princípio 2 do docs/16).
- **Regra de firewall provisória na imagem** (§5) até o `oee-helper`.

## 13. A confirmar na bancada (CONFIRMAR NA BANCADA)

1. Nomes de `/proc/devices` (`ttyAMA`, `gpiochip`, `input`) para o `DeviceAllow=` no kernel fixado; correspondência bornes × `ttyAMA2/3/5` (vai na etiqueta).
2. `ReadWritePaths=/sys/class/leds/led-*` seguindo o link com `ProtectKernelTunables=yes` (plano B: drop-in com `ProtectKernelTunables=no`); evento `change` com `TRIGGER=timer` para o udev liberar `delay_on/off`; nomes `led-red/green/blue` no lote.
3. `SystemCallFilter=~@privileged @resources` com o binário real (o Go tenta `setrlimit`); nota do `systemd-analyze security` no Trixie.
4. `RuntimeWatchdogSec=10s` no `bcm2835_wdt` e `RebootWatchdogSec=2min`; watchdog do RTC desarmado.
5. Ordem `data.mount` → `oee-gateway-datadir` → bind → `systemd-tmpfiles-setup` no 1º boot (com a `/data` recém-criada pelo `systemd-repart`).
6. `rp_filter=1` com rotas OT atrás de roteador e o endereço de serviço; `arp_ignore`/`arp_announce` com as duas redes.
7. sudo do Trixie (1.9.16) com as expressões regulares e `runas_default` por usuário (testado aqui com 1.9.15); onde fica o I/O log (`/var/log/sudo-io`, na raiz).
8. Buzzer: `gpio-beeper` (dispositivo de entrada) ou GPIO direto; nome do dispositivo.

## 14. Pendências fora da bancada

- E-mail do mantenedor nos `nfpm*.yaml` (`a-definir@engemase.invalid`).
- Código da Fase 1 no `gateway/`: ativação por socket (`localapi`), `localui serve`, `helper serve`, `status`, `net`, `logs`, `support-bundle`, LEDs; e o `oee-updater` (M4b).
- Domínio dos gateways (D28) no `gateway.yaml`.
- Assinatura do `.deb`/manifesto (Ed25519, `tools/release-sign`) e publicação no Vercel Blob: fora deste diretório.
