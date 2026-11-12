# Imagem do gateway OEE (`deploy/image`)

Imagem própria do gateway (docs/16 §7): **Raspberry Pi OS / Debian 13 "Trixie" arm64** para o **Seeed reComputer R1000** (R10xx-00: CM4 sem rádio, 2 GB, eMMC de 16 GB), gerada com o `rpi-image-gen` oficial, **sem netplan e sem cloud-init**. A imagem da Seeed nunca vai a campo.

Este diretório tem três partes:

| Parte | Quem usa | Onde |
|---|---|---|
| Gerar a imagem | Engenharia (host ARM64) | `build.sh`, `config/`, `layer/`, `image/`, `pins.env` |
| Gravar o eMMC | Técnico da bancada | `flash/flash-emmc.sh` |
| 1º boot: identidade, `/data`, senha local, rede, autoteste B0 | A própria unidade | `factory/` |

O pacote do agente (`oee-gateway`, units, sudo, firewall) é de [`deploy/gateway`](../gateway/README.md).

---

## 1. Passo a passo do técnico (bancada Engemase)

### 1.1 Uma vez: preparar a estação de gravação

Estação: um PC Linux ou uma Raspberry Pi com Raspberry Pi OS.

```sh
sudo apt install rpiboot bmap-tools
git clone <repositório engemase-oee>          # só deploy/image/flash é usado
```

- Confira onde o pacote `rpiboot` instalou o `mass-storage-gadget64` (normalmente `/usr/share/rpiboot/mass-storage-gadget64`). Se for outro lugar, passe `--gadget-dir`. **CONFIRMAR NA BANCADA.**
- Tenha à mão: o pendrive de bancada (FAT, **rótulo `EGWBANCADA`**), cabo **USB-C de dados** (não só de carga), fonte 24 VDC, monitor HDMI e teclado ABNT2.
- Baixe da engenharia a pasta da imagem: `egw-os_<versão>_arm64_r1000.img.zst`, `.img.bmap`, `manifest.json`, `SHA256SUMS` (e `manifest.json.sig`). Não renomeie os arquivos.

### 1.2 Recebimento da unidade

1. **Não ligue a unidade na rede** com a imagem da Seeed (usuário e senha de fábrica conhecidos). Ela vai direto para a gravação.
2. Anote na planilha de inventário: lote de compra, revisão da placa (pedir à Seeed a confirmação de que é v1.1).
3. Pegue o próximo **número de série** livre: `EGW-NNNNN` (sequencial, nunca reaproveitado).
4. Pegue a **ficha de TI** do cliente, se a unidade já tem destino (IP fixo da OT, IT fixa ou DHCP, DNS, NTP, proxy). Sem destino, grave sem rede: a ficha pode ir depois numa nova gravação.

### 1.3 Gravar

1. Chave lateral de boot do R1000 em **Flash** (nRPI-BOOT). **CONFIRMAR NA BANCADA** se a chave fica acessível com a unidade no trilho DIN.
2. USB-C de dados da estação ao R1000; **depois** ligue os 24 V.
3. Grave, informando a série e (se houver) a ficha de TI:

```sh
cd <pasta da imagem>
sudo <repo>/deploy/image/flash/flash-emmc.sh \
     --image egw-os_13.2026.11.1_arm64_r1000.img.zst \
     --serial EGW-00042 --operator "Joao Silva" \
     --ot-address 192.168.10.250/24 \
     --it-address 10.20.0.50/24 --it-gateway 10.20.0.1 --it-dns 10.20.0.10,10.20.0.11 \
     --ntp 10.20.0.5 --proxy http://10.20.0.5:3128
```

   O script confere o `SHA256SUMS`, roda o `rpiboot`, espera o eMMC aparecer como disco USB, mostra o disco e **pede para digitar a série** antes de apagar. Grava com `bmaptool` (só os blocos usados, com conferência de hash) e escreve a **semente** `egw-seed.conf` na partição de boot. Recusa disco que não seja USB, disco montado ou de tamanho estranho. Sem as opções de rede: IT em DHCP e OT só com o endereço de serviço.
   Cada gravação entra na planilha `/var/lib/egw-estacao/gravacoes.csv` da estação (série, imagem, hash, data, operador).
4. Desligue os 24 V, tire o USB-C, chave em **Normal**.

Teste antes, sem gravar: acrescente `--dry-run` (mostra a semente que seria gravada).

### 1.4 Primeiro boot (factory init)

Ligue os 24 V com HDMI e teclado (ou só observe os LEDs). O `egw-factory-init` roda **uma vez** (3 a 5 min; **não desligue**):

| LED | Significado |
|---|---|
| Âmbar piscando (vermelho + verde) | Factory init rodando |
| Verde fixo | **B0 aprovado** |
| Vermelho piscando | Falhou: leia o console (o resumo fica na tela) |
| Azul piscando por 2 s | Exportação para o pendrive concluída |

O que ele faz:

1. Cria a partição **`/data`** com o resto do eMMC (`systemd-repart`; plano B: `sfdisk`) e monta `/data/oee` (estado do agente) e `/data/journal`.
2. Lê a semente; a série vira o **hostname** (`EGW-00042` → `egw-00042`).
3. Coleta MACs da ETH0 (OT, Gigabit nativa) e ETH1 (IT, 10/100 USB), CID do eMMC, serial do CM4, RAM, bootloader.
4. Gera chaves de host SSH (o SSH continua mascarado), a chave Ed25519 da unidade e o certificado da página local.
5. Gera a **senha local** (16 caracteres, ex.: `K7QM-4XTD-9WRB-2HNP`): vira a senha do usuário `tecnico` no console e o hash da página local. Ela **nunca** aparece em claro: sai **cifrada** para o certificado da bancada (`EGW-00042.card.p7m`).
6. Escreve a rede: `/etc/oee-gateway/network.json` (a única fonte) e, a partir dela, os perfis do NetworkManager **amarrados pelo MAC**, o `proxy.env` e as fontes NTP. A OT sempre tem o **endereço de serviço** `169.254.a.b/16` (derivado do MAC da ETH0; vai na etiqueta).
7. Grava **`/data/identity/hw.json`** (identidade, somente leitura para o agente) e roda o **autoteste B0** (33 itens: CM4, overlay do R1000, RAM, eMMC e saúde, sem rádio, TPM, expansor, RTC, LEDs, as 3 RS-485, watchdog do SoC armado, ETH0/ETH1, `/data`, versão e integridade da imagem, `dpkg --verify`, sem cloud-init/netplan, SSH mascarado, portas abertas, firewall, temperatura, identidade e senha). Relatório: `/data/identity/b0-report.json`.

Se a semente faltar ou estiver errada (série inválida, rede inválida), o LED fica vermelho piscando e nada é gravado em `/data/identity`: **regrave** com os dados certos.

### 1.5 Exportar a senha local (cartão lacrado)

1. Espete o pendrive `EGWBANCADA` (pode ser durante o 1º boot ou depois). A unidade copia para `EGW/EGW-00042/`: `EGW-00042.card.p7m` (cifrado), `hw.json` e `b0-report.json`.
2. No computador da bancada (onde está a chave **privada**, nunca na unidade):
   ```sh
   openssl cms -decrypt -inform PEM -in EGW-00042.card.p7m -recip bench-export.pem -inkey bench-export.key
   ```
3. Imprima o cartão (série, senha, endereço de serviço, impressão digital do certificado da página local), lacre o envelope e registre a senha no cofre da plataforma.
4. Crie no pendrive o arquivo vazio `EGW/EGW-00042/ACK-<export_id>` (o `export_id` está no `hw.json`) e espete o pendrive de novo: a unidade apaga a cópia local do cartão.

Nova senha (troca, recondicionamento): só regravando, na Fase 0 (não há root na unidade).

### 1.6 Registrar e testar

1. Ligue a ETH1 (IT) na rede da bancada com internet e entre no console como `tecnico` (senha do cartão).
2. Confira e ative:
   ```sh
   sudo oee-gateway diag                         # config, credencial, buffer, DNS da nuvem
   sudo oee-gateway enroll --code ABCD-1234      # código gerado na plataforma
   journalctl -u oee-gateway -f                  # log do agente
   ```
   O `sudo` do técnico só aceita esses subcomandos e roda como o usuário do agente (`oee`).
3. Testes de aceite na bancada (docs/16 §7), pela plataforma: **B2** (as 3 RS-485 e as 2 Ethernet contra o simulador), **B3** (rede e firewall: `nmap` da IT sem nenhuma porta aberta), **B4** (24 h de coleta com conservação de peças), **B5** (30 cortes de energia), **B6** (relatório).
4. Etiqueta permanente (série, MACs, endereço de serviço, QR) e inventário (série, MACs, CID do eMMC, versão da imagem, relatório B0/burn-in).

### 1.7 Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `flash`: o eMMC não aparece em 60 s | Cabo de dados? Chave em Flash? 24 V ligados **depois** do USB-C? |
| `flash`: `SHA256SUMS não confere` | Baixe a imagem de novo |
| Vermelho piscando no 1º boot | Leia o resumo no HDMI. Sem semente ou rede inválida: regrave. B0 reprovado: veja `b0-report.json` no pendrive |
| B0.02/B0.08/B0.13 falham (overlay, expansor, RS-485 sem alimentação) | Imagem sem o pacote de plataforma (só serve na bancada) ou placa de outra revisão |
| B0.07 (TPM) ou B0.09 (RTC) falham | Driver da Seeed com o kernel fixado: avise a engenharia (plano B Bookworm, §2.4) |
| Nenhum escravo RS-485 responde | 1º: alimentação das RS-485 (B0.13); 2º: A/B invertidos; 3º: terminação 120 Ω (o resistor do R1000 não vem montado) e polarização |
| Agente parado | LED vermelho piscando; `journalctl -u oee-gateway` |

---

## 2. Gerar a imagem (engenharia)

### 2.1 Host e entradas

- Host **ARM64** com Debian ou Raspberry Pi OS **Bookworm ou Trixie** (ex.: Raspberry Pi 5 de 8 GB dedicada), usuário comum, dependências do rpi-image-gen (`sudo <rpi-image-gen>/install_deps.sh`), `zstd`, `bmap-tools`, `git`.
- `pins.env`: commit do rpi-image-gen, commit dos overlays da Seeed, **snapshot do Debian** (vira `SOURCE_DATE_EPOCH`), ABI do kernel fixado, versão da plataforma e hardware esperado do lote. Só `KEY=valor`: o `build.sh` lê sem executar.
- Fora do git (`.gitignore`):

| Caminho | Conteúdo |
|---|---|
| `debs/oee-gateway_<v>_arm64.deb` | `deploy/gateway/build-deb.sh --build --arch arm64 --version <v> --out deploy/image/debs` |
| `debs/engemase-r1000-support_<v>_arm64.deb` | Pacote de plataforma (§2.5) |
| `debs/platform/linux-image-<ABI>_*.deb` | Kernel fixado (opcional; senão vem do repositório da Raspberry Pi) |
| `keys/bench-export.pem` | Certificado **público** da bancada (a chave privada nunca entra aqui) |

### 2.2 Comandos

```sh
deploy/image/build.sh --version 13.2026.11.1 --check     # confere entradas e mostra o comando
deploy/image/build.sh --version 13.2026.11.1             # produção (exige agente e plataforma)
deploy/image/build.sh --version 13.2026.11.2 --fase0     # BANCADA: aceita faltar agente/plataforma
deploy/image/build.sh --version 13.2026.11.1 --sign-key /caminho/seguro/ota-ed25519.pem
```

O `build.sh` clona o rpi-image-gen no commit fixado (ou usa `--igtop`), roda `rpi-image-gen build -S deploy/image -c egw-r1000.yaml` com a versão, os commits e o snapshot como overrides e gera em `out/<versão>/`:

- `egw-os_<versão>_arm64_r1000.img.zst` e `.img.bmap`;
- `manifest.json` (versão, variante `producao`/`bancada-fase0`, commits, snapshot, kernel, `.deb` do agente, SHA-256) e, com `--sign-key`, `manifest.json.sig` (Ed25519);
- `SHA256SUMS`.

Versão: `<debian>.<ano>.<mês>.<n>` (`13.*` = Trixie). Mudou `pins.env`, camada ou `.deb` = versão nova.

### 2.3 O que vai na imagem

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Dispositivo | `rpi-cm4` (rpi-image-gen), `variant: 16G`, `storage_type: emmc` | CM4 com eMMC |
| Base | `debian-trixie-arm64-minbase-snapshot` + `rpi-debian-trixie` | Debian por snapshot + repositório Raspberry Pi |
| `egw-base` | `layer/egw-base.yaml` + `egw-base.d/` | Pacotes; **remove** cloud-init, netplan, rádio, avahi, rsyslog, timesyncd, compiladores; SSH e login serial **mascarados**; root bloqueado; NetworkManager só com perfis gerados (`no-auto-default=*`); chrony; nftables de fábrica; `unattended-upgrades` só de segurança, fora da janela do OTA; journald com limite; `fstrim` semanal; watchdog do SoC; `systemd-repart` cria a `/data` |
| `egw-r1000` | `layer/egw-r1000.yaml` + `egw-r1000.d/` | `config.txt` (overlay `reComputer-R100x`, watchdog, **sem `gpio-shutdown`**: falta de energia = `reboot`), `cmdline.txt` (`net.ifnames=0`, `panic=10`, sem console serial), kernel fixado em `hold`, `engemase-r1000-support` |
| `egw-agent` | `layer/egw-agent.yaml` + `egw-agent.d/` | `.deb` do agente, factory init, exportação para o pendrive, `/etc/engemase-release` e a **verificação final** que reprova o build (cloud-init, netplan, SSH, nftables, sudo sem `ALL`, kernel em hold, machine-id vazio, sem chaves de host) |
| Layout | `image/egw-gpt/` | GPT: `boot` (FAT32, 512 MiB) + `root` (ext4, 4 GiB, tipo root-arm64). A `data` nasce no 1º boot com o resto do eMMC. Partições por `/dev/disk/by-slot/*`, só do dispositivo de boot |

Nada único por unidade sai na imagem (machine-id, chaves SSH, estado do agente, journal, perfis de rede): tudo nasce no factory init.

### 2.4 Trixie e o plano B Bookworm

O alvo é o **Trixie** (`config/egw-r1000.yaml`). O **Bookworm** fica como **plano B documentado** (docs/16 §7, D-g1), só para o caso de o overlay ou o módulo do RTC da Seeed não funcionarem no kernel 6.12:

```sh
deploy/image/build.sh --version 12.2026.11.1 --plano-b-bookworm
```

Usa `config/egw-r1000-bookworm.yaml` (inclui a config do Trixie e troca só a base), a camada `egw-debian-bookworm-arm64-snapshot` (o rpi-image-gen não traz snapshot do Bookworm) e `templates/bookworm-snapshot.sources`. Mantido porque a decisão D-g1 o prevê e o risco do driver só se resolve na bancada; quando o Trixie for validado com o lote, esses três arquivos podem sair. No Bookworm (systemd 252), `RestartSteps=` do agente e `MakeDirectories=` do repart são ignorados (o factory init cria os diretórios da `/data` de qualquer jeito).

### 2.5 Pacote de plataforma (`engemase-r1000-support`) — PENDENTE

Leva o `reComputer-R100x.dtbo` (do commit fixado dos overlays da Seeed) e o módulo `rtc-pcf8563w.ko` **compilado para a ABI exata do kernel fixado** (`EGW_KERNEL_ABI`). Sem ele: sem RTC, sem LEDs e **sem alimentação nas RS-485** (o `RS485_POWER_EN` fica no expansor PCA9535 que o overlay configura). **A receita desse pacote ainda não existe neste repositório**; até existir, só há imagem de bancada (`--fase0`). O script da Seeed nunca roda na unidade.

### 2.6 Validar sem gerar

```sh
sudo deploy/image/validate.sh --igtop <clone do rpi-image-gen>   # camadas, coerência, factory init, flash, build --check
sudo deploy/gateway/validate.sh                                   # scripts, YAML, nftables de fábrica, pacote
```

---

## 3. Decisões tomadas aqui

- **Rede da ficha de TI na semente da gravação (Fase 0).** Sem root na unidade e sem o `oee-helper`, é o único jeito de a unidade sair da bancada com a rede do cliente (docs/16 §5 e §6). O factory init confere tudo e recusa valor errado (LED vermelho). Mudança de rede no campo: Fase 1 (`net set` com checkpoint); até lá, regravar.
- **Firewall de fábrica na mesma tabela do pacote** (`inet oee_gateway`) + `include` por curinga do arquivo renderizado, com uma regra **provisória** que deixa só o agente falar TCP com redes privadas (detalhe no README do pacote, §5).
- **Sem `sudoers`, regra de LED e bind de `/var/lib/oee-gateway` na imagem**: são do pacote, que se atualiza pelo OTA (um lado só). O sudoers antigo da imagem usava `*` (aceitava `enroll --code X --url ...`).
- **Sem ping de entrada** na fábrica (docs/16 §5: só a página local entra).

## 4. A confirmar na bancada (CONFIRMAR NA BANCADA)

1. Overlay `reComputer-R100x` e `rtc-pcf8563w` no kernel 6.12 do Trixie (senão, plano B).
2. Bornes × `ttyAMA2/3/5`; modo RS-485 do overlay; polarização do barramento.
3. `dwc2,dr_mode=host` e `enable_uart` no `config.txt`; ETH1 (USB) estável como `eth1` com `net.ifnames=0`; MAC da ETH1 estável entre boots.
4. Console HDMI sem o driver KMS (`display_auto_detect=0`).
5. `systemd-repart` no 1º boot (Trixie) e o plano B `sfdisk`; ordem das montagens da `/data`.
6. Caminho do `mass-storage-gadget64` do pacote `rpiboot`; chave de boot acessível no trilho DIN; tempo de gravação.
7. LEDs (três LEDs separados, ativos em nível baixo) e a cor "âmbar" = vermelho + verde.
8. TPM (B0.07) e watchdog do RTC desarmado (B0.15).
9. `rtcsync` do chrony com o RTC da Seeed; NTP do DHCP (`/run/chrony-dhcp`).
10. Repositório da Raspberry Pi em HTTPS nas fontes de produção.
