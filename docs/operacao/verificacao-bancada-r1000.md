# Verificação de bancada do reComputer R1000 (antes de expedir)

Roteiro para conferir **cada R1000 novo** na bancada da Engemase antes de ele ir para um cliente. Segue o teste de aceite reduzido do MVP ([docs/16 §7](../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida): B0, B2, B3, B4, B5 e relatório), o rascunho de preparação (`docs/rascunhos/gateway-preparacao-e-ciclo-de-vida.md` §4) e as ferramentas de imagem em construção em `deploy/image` e `deploy/gateway`.

> **Duas partes, porque a imagem de produção não tem root.** Na imagem Engemase o root fica bloqueado, o SSH fica desligado e o usuário `tecnico` só tem o `sudo` restrito do [docs/16 §4](../16-projeto-do-gateway.md#4-caminhos-usuários-e-identidade-canônico) (que roda como o usuário do agente, `oee`). Por isso:
> - **Parte A — Fatos do hardware:** na **primeira unidade de cada lote ou revisão de placa**, com uma **imagem de engenharia com root** (pode ser a imagem da Seeed: ela é usada **só na bancada**, nunca vai a campo). Confirma o que os documentos ainda não sabem do R1000 ([docs/16 §9](../16-projeto-do-gateway.md#9-prazo-e-riscos)).
> - **Parte B — Aceite da unidade:** em **todas as unidades**, com a **imagem Engemase de produção**, usando só o `tecnico`, a plataforma e a automação do 1º boot.
>
> **Marcações:** **CONFIRMAR NA BANCADA** = fato do hardware ainda não verificado: anote o valor na tabela da seção 4 e atualize este roteiro. **(Fase 1)** = depende de algo ainda não pronto (imagem gerada, binários do agente, LEDs pelo agente, página local); faça o equivalente indicado ou registre "não aplicável".

A mesma bancada tem uma terceira parte, que **não é por unidade**:
- **Parte C — CLPs das marcas prioritárias (D26):** Siemens, Schneider, Rockwell e ABB. Qualifica o bloco OEE v1 e o agente em um CLP real de cada marca, antes do primeiro cliente e a cada versão nova do agente, do FB ou do firmware (seção 6). Base: [adaptações por fabricante](adaptacoes-por-fabricante.md).

## 1. Material

| Item | Para quê |
|---|---|
| R1000 em teste (série **R10xx-00**, 2 GB / 16 GB, placa v1.1) | Unidade sob teste |
| Fonte 24 VDC em trilho DIN + disjuntor + relé ou tomada controlada | Alimentação e cortes de energia |
| Estação Linux com o repositório, Go, `rpiboot` e `bmaptool` | Gravação (`deploy/image/flash/flash-emmc.sh`), `tools/plc-sim`, conferências |
| Switch com duas VLANs: **IT-bancada** (DHCP e internet só 443/53/123) e **OT-bancada** (sem internet) | Simular a planta |
| Chicote RS-485 (A–A, B–B, `GND_ISO`, 120 Ω nas pontas) | Parte A: laço entre portas |
| Escravos Modbus RTU: um por porta (módulos de I/O da bancada) **ou** adaptador USB-RS485 + simulador de escravo RTU na estação | Modbus RTU (o `plc-sim` só fala Modbus TCP) |
| Pendrive FAT com rótulo **`EGWBANCADA`** | Recebe a exportação cifrada da senha local no 1º boot |
| Multímetro, testador de cabo, patch cords, teclado USB e cabo HDMI | Medidas e console |
| Gateway de bancada na plataforma (organização **Engemase Lab**, nome "Bancada-NN") | Registro e sincronização |
| Etiquetadora | Etiquetas |
| Um CLP de cada marca prioritária, com fonte 24 VDC e 4 botões (rodando, falha, peça boa, refugo) | Parte C (lista na seção 6.1) |
| Notebook com o software de programação de cada marca e as licenças (só o TIA Portal é pago na lista da seção 6.1) | Parte C |

## 2. Registro da unidade

Antes de começar, abra a linha da unidade na planilha de inventário do MVP ([docs/16 §7](../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida)). O `flash-emmc.sh` também grava um registro CSV das gravações na estação. Cada verificação tem uma coluna **OK** e um campo para o valor medido.

## 3. Parte A — Fatos do hardware (imagem de engenharia, com root)

Faça na primeira unidade de cada lote ou revisão de placa. Depois, regrave a unidade com a imagem Engemase e siga a Parte B.

### 3.1 Recebimento, identidade e rede

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| A0.1 | Modelo sem rádio | Etiqueta do fabricante e nota | Série **R10xx-00** (sem Wi-Fi/BLE), 2 GB RAM, 16 GB eMMC | ☐ |
| A0.2 | Revisão da placa | Nota e etiqueta do lote. **CONFIRMAR NA BANCADA** onde a revisão aparece na placa | **v1.1** (exigida por causa do pino DE das RS-485) | ☐ |
| A0.3 | Modelo reportado | `cat /proc/device-tree/model` | **CONFIRMAR NA BANCADA** o texto (é o que o `enroll` envia como modelo) | ☐ |
| A0.4 | Porta física × interface | Ligar um cabo de cada vez; `ip -br link` | **ETH0 (OT) = `eth0`** (Gigabit do CM4) e **ETH1 (IT) = `eth1`** (10/100 via USB). **CONFIRMAR NA BANCADA** | ☐ |
| A0.5 | MAC da ETH1 estável | `cat /sys/class/net/eth1/address`; reiniciar; conferir | Mesmo MAC depois do reboot (**CONFIRMAR NA BANCADA** também entre lotes) | ☐ |
| A0.6 | Tempo de boot | Do 24 V até o login | **CONFIRMAR NA BANCADA** e anotar | ☐ |

### 3.2 RS-485

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| A1.1 | Dispositivos | `ls -l /dev/ttyAMA2 /dev/ttyAMA3 /dev/ttyAMA5` | Os três existem | ☐ |
| A1.2 | Polarização | Porta sozinha, sem resistor e sem outro equipamento; multímetro entre A e B em repouso | **CONFIRMAR NA BANCADA**: ≥ 200 mV = a porta polariza; perto de 0 V = não polariza (no campo, usar a polarização de um escravo) | ☐ |
| A1.3 | Laço entre portas | Chicote ligando duas portas. Nas duas: `stty -F /dev/ttyAMA3 19200 cs8 -parenb -cstopb raw -echo` (idem a outra). Num terminal: `timeout 5 cat /dev/ttyAMA3 \| od -c`. Em outro: `printf 'ENGEMASE-2-3\n' > /dev/ttyAMA2`. Repetir 3→5 e 5→2 | O texto chega inteiro nas três combinações. Se não chegar, suspeitar do modo RS-485 no boot (**CONFIRMAR NA BANCADA** o controle de direção na placa v1.1) | ☐ |
| A1.4 | Borne × dispositivo | Repetir A1.3 ligando um borne de cada vez | **CONFIRMAR NA BANCADA**: anotar RS485-1/2/3 ↔ `ttyAMA2/3/5` (o perfil do agente assume `rs485-1` = `ttyAMA2`, `rs485-2` = `ttyAMA3`, `rs485-3` = `ttyAMA5`) | ☐ |
| A1.5 | LEDs de tráfego | Durante A1.3 | **CONFIRMAR NA BANCADA** se o LED da porta pisca em TX e em RX | ☐ |
| A1.6 | Modbus RTU direto | Escravo RTU a 19200 8E1, unit id 1: `oee-gateway modbus read --target "rtu:///dev/ttyAMA2?baud=19200&parity=E&stop_bits=1" --unit 1 --offset 0 --count 10`; repetir 100 vezes num laço contando as falhas | Zero falhas nas três portas | ☐ |

### 3.3 Modbus TCP contra o `plc-sim`

Na estação, na VLAN OT:

```bash
cd tools/plc-sim
go run . --host 0.0.0.0 --port 1502 --machines 3 --start-total 100000 --seed 42
```

A porta 1502 evita precisar de root na estação. Com `--start-total 100000`, o contador total começa num valor conhecido para conferir a ordem das words.

| # | Verificação | Como (na unidade) | Resultado esperado | OK |
|---|---|---|---|---|
| A2.1 | Bloco OEE | `oee-gateway modbus read --target tcp://<IP da estação>:1502 --unit 1 --offset 1000 --count 14 --oee-block --decode uint32:CDAB@4 --decode uint32:ABCD@4` | `versao_bloco 1`; `uint32:CDAB@4` ≥ 100000 (correto) e `uint32:ABCD@4` com valor enorme (errado de propósito); `produto` entre 1001 e 1003 | ☐ |
| A2.2 | Heartbeat | Repetir depois de 5 s | `heartbeat` subiu ~5 | ☐ |

### 3.4 Watchdog, LEDs e buzzer

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| A3.1 | Agente travado **(Fase 1: pacote `.deb`)** | Agente instalado e coletando: `sudo kill -STOP $(pidof oee-gateway)` | O systemd reinicia o agente em até ~35 s (`WatchdogSec=30s`); na plataforma, `agent_start` com `clean_shutdown = false` | ☐ |
| A3.2 | Kernel travado | `echo c \| sudo tee /proc/sysrq-trigger` | A unidade reinicia sozinha pelo watchdog do SoC (`RuntimeWatchdogSec=10s`). **CONFIRMAR NA BANCADA** o tempo (esperado em torno de 20 s) | ☐ |
| A3.3 | Watchdog do RTC | `ls /dev/watchdog*` | **Não é armado no MVP** ([docs/16 §5](../16-projeto-do-gateway.md#5-rede-e-instalação)). **CONFIRMAR NA BANCADA** se existe um segundo dispositivo | ☐ |
| A3.4 | LEDs de usuário | `ls /sys/class/leds/`; `echo 1 \| sudo tee /sys/class/leds/led-green/brightness` (depois `0`); idem `led-red` e `led-blue` | **CONFIRMAR NA BANCADA**: nomes, se são três LEDs ou um RGB, e que cada cor acende | ☐ |
| A3.5 | Buzzer | Conforme o pino da placa | **CONFIRMAR NA BANCADA** o pino (GPIO21 na v1.0 ou expansor de E/S na v1.1) e o dispositivo (`gpio-beeper`?) | ☐ |

### 3.5 Energia e relógio

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| A4.1 | RTC | Acertar pelo NTP, desligar 10 min, religar **sem** cabo IT; `timedatectl` | **CONFIRMAR NA BANCADA**: hora certa com diferença menor que 2 s (RTC, bateria e `rtcsync`) | ☐ |
| A4.2 | Consumo | Amperímetro na entrada de 24 V: ocioso, coletando, com SuperCAP carregando | Típico ≤ 5,5 W. Anotar mínimo, típico e máximo | ☐ |
| A4.3 | SuperCAP (só se houver) | Teste T-PWR-3: quedas com retorno em 1, 10 e 60 s e **durante o desligamento** | Sempre volta sozinho. **Até este teste ser aprovado, o padrão é `reboot`, sem desligamento controlado** (D27) | ☐ |

## 4. Tabela de fatos do hardware (preencher na Parte A)

| Fato | Verificação | Valor encontrado | Data / unidade |
|---|---|---|---|
| Revisão da placa e onde aparece | A0.2 | | |
| Texto de `/proc/device-tree/model` | A0.3 | | |
| RJ45 físico ↔ `eth0`/`eth1` | A0.4 | | |
| MAC da ETH1 estável entre boots | A0.5 | | |
| Tempo de boot | A0.6 | | |
| Polarização da RS-485 (tensão A–B em repouso) | A1.2 | | |
| Modo RS-485 no boot e controle de direção (DE/RTS) | A1.3 | | |
| Borne RS485-1/2/3 ↔ `ttyAMA2/3/5` | A1.4 | | |
| LEDs de tráfego das RS-485 | A1.5 | | |
| Tempo de reinício pelo watchdog do SoC | A3.2 | | |
| Existência do watchdog do RTC | A3.3 | | |
| LEDs de usuário: nomes; três LEDs ou um RGB | A3.4 | | |
| Pino e dispositivo do buzzer | A3.5 | | |
| RTC mantém a hora (bateria, `rtcsync`) | A4.1 | | |
| Consumo em 24 V (mínimo, típico, máximo) | A4.2 | | |
| Proteção contra inversão de polaridade | Manual do fabricante | | |
| Borne de terra funcional | Manual / inspeção | | |
| Função do furo de reset | Manual / teste | | |

## 5. Parte B — Aceite de cada unidade (imagem Engemase)

### 5.1 Gravação e 1º boot

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| B0.1 | Inspeção | Visual; etiqueta do fabricante | Série **R10xx-00**, sem dano, revisão do lote qualificado na Parte A | ☐ |
| B0.2 | Gravação **(Fase 1: imagem gerada)** | Chave lateral em **Flash**, USB-C de dados na estação, depois os 24 V. Na estação: `sudo deploy/image/flash/flash-emmc.sh --image <imagem>.img.zst --serial EGW-NNNNN --operator <nome>`. Para a bancada, **sem** opções de rede (IT em DHCP e OT só com o endereço de serviço) | Gravação concluída e conferida; linha no CSV de gravações | ☐ |
| B0.3 | 1º boot e autoteste B0 **(Fase 1)** | Chave em **Normal**, pendrive `EGWBANCADA` espetado, religar os 24 V. O *factory init* roda sozinho (identidade, senha local, rede de fábrica, autotestes `egw-selftest`) | LED **âmbar piscando** enquanto roda e **verde fixo** no fim (aprovado). **Vermelho piscando** = reprovado (ver o relatório no pendrive) | ☐ |
| B0.4 | Senha local | Exportação cifrada no pendrive `EGWBANCADA` | Senha decifrada só na estação da bancada; vai para o **cartão lacrado** e para o cofre da plataforma. **Nunca na etiqueta, nunca em log** | ☐ |

### 5.2 Conferência no console (usuário `tecnico`)

Entre no console (HDMI + teclado) com o usuário `tecnico` e a senha local. Os comandos abaixo não precisam de root.

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| B1.1 | Identidade | `hostname`; `ip -br link` | `egw-NNNNN`; MACs iguais aos anotados pelo *factory init* | ☐ |
| B1.2 | Sem rádio | `ls /sys/class/net` | Só `lo`, `eth0`, `eth1` | ☐ |
| B1.3 | Memória e disco | `free -m`; `lsblk`; `df -h /data` | ~2 GB de RAM; eMMC de 16 GB com `/data` montada | ☐ |
| B1.4 | Ethernet | `cat /sys/class/net/eth0/speed /sys/class/net/eth1/speed`; `ip -br addr`; `ip route` | 1000 e 100; IP de DHCP na `eth1`; endereço de serviço 169.254.x.y na `eth0`; rota padrão **só** pela `eth1` | ☐ |
| B1.5 | Sem roteamento | `sysctl net.ipv4.ip_forward` | `= 0` | ☐ |
| B1.6 | Portas abertas | `ss -tuln` | Nada escutando na IT; só a página local na 443 da OT **(Fase 1)** | ☐ |
| B1.7 | Nada aberto na IT | Da estação na VLAN IT: `nmap -p- <IP da eth1>` | Zero portas abertas | ☐ |
| B1.8 | Watchdog configurado | `systemctl show -p RuntimeWatchdogUSec`; `systemctl show oee-gateway -p WatchdogUSec` | 10 s e 30 s | ☐ |
| B1.9 | Relógio | `timedatectl` | `System clock synchronized: yes`; hora certa | ☐ |

### 5.3 Registro, config e coleta

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| B2.1 | Código de ativação | Na plataforma, no gateway "Bancada-NN" da Engemase Lab | Código `XXXX-XXXX`, válido por 24 h | ☐ |
| B2.2 | Registro | `sudo -u oee oee-gateway enroll --code XXXX-XXXX` (roda como o usuário `oee`, dono da credencial, como no [docs/03](../03-gateway.md); o `sudo` do `tecnico` não aceita `--url`: vale a URL do `gateway.yaml` gravado na imagem) | `Gateway registrado na organização ... (id ...)` | ☐ |
| B2.3 | Diagnóstico | `sudo oee-gateway diag` | `config local`, `credencial` e `DNS da nuvem` em `ok`. TLS, NTP, serial e links aparecem como `pendente` até a Fase 1 | ☐ |
| B2.4 | Config | Na plataforma, cadastrar no "Bancada-NN": 3 máquinas no `plc-sim` da estação (template bloco OEE, base 1000, porta 1502, unit 1 a 3) e **um escravo RTU em cada porta** `rs485-1/2/3`; publicar | Config publicada | ☐ |
| B2.5 | Agente | `systemctl status oee-gateway` | `coletando 6/6 dispositivos · nuvem online` | ☐ |
| B2.6 | Sincronização | Detalhe do gateway na plataforma | Online em até ~10 s; config aplicada; diferença de relógio abaixo de 2 s; fila perto de zero | ☐ |
| B2.7 | Modbus TCP e bloco OEE | Tela ao vivo das 3 máquinas do `plc-sim` | Estados e contadores acompanhando o log do `plc-sim` | ☐ |
| B2.8 | RS-485 (B2) | Aba Conexões Modbus / Saúde | Os 3 escravos RTU `connected`, com `errors_1m = 0` por 15 min | ☐ |
| B2.9 | LEDs de estado **(Fase 1)** | Agente com e sem nuvem, com e sem CLP | Tabela do [docs/16 §6](../16-projeto-do-gateway.md#6-comissionamento-local): verde fixo, verde piscando, âmbar piscando, vermelho fixo, vermelho piscando | ☐ |

### 5.4 Duração e energia

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| B3.1 | 24 h de coleta (B4) | Anotar os contadores do `plc-sim` no início; 24 h de coleta, com **1 h sem internet** no meio (cabo IT desligado ou bloqueio na VLAN) | **Conservação de peças 100%**: soma dos minutos na plataforma = delta dos contadores do `plc-sim`; zero `data_loss`; fila zerada em menos de 10 min depois da volta | ☐ |
| B3.2 | 30 cortes de energia (B5) | Nas últimas 4 h de B3.1, relé cortando a alimentação: ligado de 5 a 300 s, desligado de 2 a 30 s | 30/30 voltam sozinhos; conservação de peças 100%; nenhuma peça duplicada; primeiro `/sync` em menos de 120 s depois de cada volta | ☐ |
| B3.3 | Temperatura | `cat /sys/class/thermal/thermal_zone0/temp` ao fim de B3.1 | SoC abaixo de 80 °C em ambiente de ~25 °C | ☐ |

### 5.5 Preparação para o cliente

A unidade sai da bancada **já registrada no cliente e com a rede da ficha de TI** ([docs/16 §6](../16-projeto-do-gateway.md#6-comissionamento-local)). Como não há root na unidade e a mudança de rede pelo ajudante é da Fase 1, o caminho hoje é **regravar** a unidade com a rede do cliente: isso também apaga os dados da bancada.

| # | Verificação | Como | Resultado esperado | OK |
|---|---|---|---|---|
| B4.1 | Fila da bancada vazia | Detalhe do "Bancada-NN" | Itens pendentes = 0 (os dados da bancada podem ser descartados) | ☐ |
| B4.2 | Regravação com a rede do cliente | `sudo deploy/image/flash/flash-emmc.sh --image ... --serial EGW-NNNNN` (o **mesmo** número de série) com as opções da [ficha de TI preenchida](ficha-tecnica-ti-cliente.md#9-checklist-para-preencher): `--ot-address`, `--it-address`/`--it-gateway`/`--it-dns` (ou DHCP), `--ntp`, `--proxy` | *Factory init* aprovado de novo (LED verde fixo); **nova senha local** exportada para o cartão lacrado do cliente | ☐ |
| B4.3 | Rede aplicada | `ip -br addr`; `ip route` | OT no IP da ficha (sugestão `.250`) + endereço de serviço; IT conforme a ficha | ☐ |
| B4.4 | Registro no cliente | Código gerado **para o gateway do cliente** na plataforma; `sudo -u oee oee-gateway enroll --code ...` | Gateway registrado no cliente, estado "aguardando instalação" | ☐ |

Ponto em aberto: depois de registrada, a unidade desligada (em estoque ou em trânsito) pode disparar "Gateway offline" para o cliente. Confirmar com o time da plataforma se o alerta fica suprimido até "Confirmar instalação".

### 5.6 Etiqueta e expedição

| # | Verificação | Resultado esperado | OK |
|---|---|---|---|
| B5.1 | Etiqueta permanente na frente | `ENGEMASE OEE GATEWAY`, `EGW-NNNNN`, modelo e revisão, **MAC ETH0 (OT)** e **MAC ETH1 (IT)**, **endereço de serviço 169.254.x.y**, QR com o link da unidade na plataforma (sem segredo), telefone de suporte | ☐ |
| B5.2 | Portas identificadas | "OT — ETH0" e "IT — ETH1" ao lado dos RJ45; bornes RS-485 com o dispositivo (`RS485-1 = ttyAMA2`, conforme a Parte A) | ☐ |
| B5.3 | Cartão lacrado | Senha local + impressão digital do certificado da página local + endereço de serviço; acompanha a unidade, separado da caixa | ☐ |
| B5.4 | Chave de boot | Em **Normal** (em "Flash" a unidade não sobe do eMMC) | ☐ |
| B5.5 | Relatório | Planilha: identificadores, resultados das Partes A (lote) e B, versão da imagem e do agente, operador, data. Unidade em "reservado para cliente" | ☐ |

**Reprovação:** falha em B2.8 (RS-485) ou B1.4 (Ethernet) → trocar cabo ou chicote e repetir **uma vez**. Falha repetida, autoteste B0 reprovado, ou falha em B3.1 ou B3.2 → unidade reprovada, separada para devolução ao fornecedor.

## 6. Parte C — CLPs das marcas prioritárias (D26)

Qualifica a integração de cada marca prioritária com o [bloco OEE v1](bloco-oee-v1.md) e o agente. **Não é por unidade de R1000:** faça uma vez antes do primeiro cliente de cada marca e repita na seção 6.5. Use um R1000 já aprovado na Parte B, registrado no "Bancada-NN", e o notebook com a CLI `oee-gateway` para as leituras diretas. Os detalhes de cada marca (endereços, unit id, licenças, fontes oficiais) estão nas [adaptações por fabricante](adaptacoes-por-fabricante.md).

### 6.1 CLPs de bancada

O modelo mais barato de cada marca com **Modbus TCP**, todos em 24 VDC. Os preços são só ordem de grandeza (distribuidores no exterior, nov/2026): **cotar no Brasil** antes de comprar.

| Marca | Modelo sugerido | Por quê | Software | Ordem de grandeza | Opcional, se aparecer cliente |
|---|---|---|---|---|---|
| Siemens | S7-1200 **CPU 1211C DC/DC/DC** (6ES7211-1AE40-0XB0) | Menor S7-1200 com PROFINET; o `MB_SERVER` é o mesmo do S7-1500 | TIA Portal **STEP 7 Basic** (pago) | US$ 270–290 | CB 1241 RS-485 (teste RTU); S7-1500 (exige STEP 7 Professional) |
| Schneider | M221 **TM221CE16T** (24 VDC; a TM221CE16R é a versão com relé e fonte CA) | Menor M221 com Ethernet e servidor Modbus TCP nativo | Machine Expert – Basic (gratuito) | US$ 290–400 | M241 (ex.: TM241CE24T) para o caminho CODESYS e o Modbus TCP Slave Device |
| Rockwell | **Micro820** com Ethernet (ex.: 2080-LC20-20QBB; conferir a porta no catálogo 2080-TD001) | Menor Micro800 com Modbus TCP nativo | Connected Components Workbench Standard (gratuito, confirmar) | US$ 325–400 | CompactLogix + gateway de protocolo, só depois da decisão sobre o caminho Logix ([adaptações §13](adaptacoes-por-fabricante.md#13-pendências-e-decisões)) |
| ABB | AC500-eCo V3 **PM5012-T-ETH**, firmware 3.4.1 ou superior | Menor eCo V3 com Ethernet e servidor Modbus TCP | Automation Builder Basic (gratuito) | £ 175–235 | PM5032-T-ETH (8 conexões Modbus TCP em vez de 3) |

### 6.2 Preparação (igual nas quatro marcas)

1. Programe o `FB_OEE_ENGEMASE` com as notas de portabilidade ([adaptações §10](adaptacoes-por-fabricante.md#10-portabilidade-do-fb_oee_engemase)): uma máquina, bloco no HR 1000 (ou na base da marca), escrita word a word todo ciclo.
2. Ligue os 4 botões às entradas do FB (rodando, falha, peça boa, refugo) ou force as variáveis online.
3. Ligue o CLP na VLAN **OT-bancada**, com IP fixo.
4. Na plataforma, cadastre o CLP no "Bancada-NN" com o template **bloco OEE** (base e unit id da marca).
5. Anote na seção 6.4 o firmware do CLP, a versão do software de programação e a versão do agente.

### 6.3 Matriz de testes por marca

`<base>` e `<unit>` são os da marca ([adaptações §3](adaptacoes-por-fabricante.md#3-endereços-a-fonte-nº-1-de-erro)). As leituras diretas são feitas do notebook, com o agente parado ou com o CLP fora da config publicada.

| # | Teste | Como | Esperado | Siemens S7-1200 | Schneider M221 | Rockwell Micro820 | ABB PM5012 |
|---|---|---|---|---|---|---|---|
| C1 | Leitura do bloco | `oee-gateway modbus read --target tcp://<IP>:502 --unit <unit> --offset <base> --count 32 --oee-block` | `versao_bloco` = 1; offsets 14–31 em 0; sem exceção 02 | ☐ `HR_Start_Offset` = 1000 | ☐ | ☐ 32 variáveis sem lacuna | ☐ |
| C2 | Unit id | Repetir C1 com unit 1, 0 e 255 | Anotar quais respondem | ☐ confirmar | ☐ esperado: 255 | ☐ confirmar | ☐ confirmar |
| C3 | Deslocamento | Procurar o valor 1 e o heartbeat | 1 no offset 0, heartbeat no offset 1 | ☐ | ☐ | ☐ | ☐ |
| C4 | Ordem CDAB | Forçar o contador total do FB em 100.000; `--decode uint32:CDAB@4 --decode uint32:ABCD@4` | Offsets 4 e 5 = 34464 e 1; CDAB = 100000 | ☐ | ☐ | ☐ | ☐ |
| C5 | Ordem nativa (informativo) | Gravar 100.000 numa variável de 32 bits de teste mapeada direto numa área livre e ler com as duas ordens. Os registradores que um %MD ocupa mudam com o software ([adaptações §4](adaptacoes-por-fabricante.md#4-ordem-de-bytes-e-de-words)) | Anotar a ordem nativa | ☐ esperado ABCD | ☐ esperado CDAB | ☐ esperado ABCD | ☐ esperado CDAB |
| C6 | Heartbeat | Ler de novo depois de 5 s | Subiu cerca de 5 | ☐ | ☐ | ☐ | ☐ |
| C7 | Estados | Forçar parada, produção, falha com código, setup, manual e emergência | `estado` e `codigo_falha` seguem; tela ao vivo também | ☐ | ☐ | ☐ | ☐ |
| C8 | Contagem | 10 peças boas e 1 refugo | Total +11, refugo +1, boas +10 | ☐ | ☐ | ☐ | ☐ |
| C9 | Virada da word baixa (consistência) | Com o CLP **fora** da config do agente: FB com 1.000 peças por pulso e pulsos a 5 Hz (a word baixa vira a cada ~13 s). Ler com `--json` num laço de 100 ms por 10 min. Depois, voltar as peças por pulso para 1 | O total nunca diminui entre duas leituras (uma queda = leitura "rasgada") | ☐ | ☐ | ☐ | ☐ |
| C10 | Retenção | Desligar e religar o CLP | Contadores mantidos | ☐ | ☐ | ☐ | ☐ |
| C11 | Download | Mudar uma lógica fora do FB e baixar pelo procedimento recomendado da marca | Contadores mantidos; nenhum `counter_reset` | ☐ "carregar sem reinicialização" | ☐ confirmar | ☐ confirmar | ☐ PERSISTENT ou procedimento equivalente |
| C12 | CLP em STOP | Colocar o CLP em STOP | `NO_COMM` em até ~10 s na tela ao vivo | ☐ | ☐ | ☐ | ☐ |
| C13 | Escrita externa | Escrever 9999 no HR `<base>`+4 com um cliente Modbus | O valor volta no ciclo seguinte (ou exceção, se a escrita estiver bloqueada) | ☐ | ☐ | ☐ | ☐ esperado: exceção (proteção de %MB) |
| C14 | Conexões | Agente coletando + 2 clientes lendo ao mesmo tempo | Todos leem; anotar o limite | ☐ 1 instância de `MB_SERVER` por cliente | ☐ confirmar | ☐ confirmar | ☐ limite: 3 |
| C15 | Tempo de resposta | 100 leituras de 14 registradores; campo `read_ms` do `--json` | Média abaixo de 200 ms | ☐ | ☐ | ☐ | ☐ |
| C16 | Conservação na plataforma | 1 h de coleta pelo agente, com 10 min sem internet no meio | Soma dos minutos = delta dos contadores do CLP | ☐ | ☐ | ☐ | ☐ |
| C17 | Modbus RTU (opcional) | Escravo RTU a 19200 8E1; 100 leituras de 14 registradores pela RS-485 do R1000 | Zero falhas | ☐ CB 1241 | ☐ SL1 em RS-485 (a única serial do TM221CE16T) | ☐ porta serial embarcada | ☐ COM (confirmar no modelo) |

**Aprovação** (vale só para o modelo e o firmware testados):

| Resultado | Decisão |
|---|---|
| C1–C4 e C6–C16 aprovados | Marca **liberada** para clientes em Modbus TCP. C5 é só informativo |
| C17 aprovado | Libera também o Modbus RTU na marca. Reprovado ou não feito: só Modbus TCP |
| C9 reprovado (leitura rasgada; regra G8 da [especificação](bloco-oee-v1.md#2-regras-gerais)) | Marca **não liberada**. Registre a pendência nas [adaptações §13](adaptacoes-por-fabricante.md#13-pendências-e-decisões). No **M221** não há alternativa documentada: a Schneider fica sem liberação nesse modelo até haver solução escrita nas [adaptações §7.1](adaptacoes-por-fabricante.md#71-m221-machine-expert--basic). Trocar para o Modbus TCP Slave Device ([adaptações §7.2](adaptacoes-por-fabricante.md#72-m241-m251-e-m262-machine-expert)) só vale quando o teste for repetido num M241, M251 ou M262 (seção 6.5) |
| C15 reprovado (média acima de 200 ms; [especificação §7](bloco-oee-v1.md#7-requisitos-de-temporização-no-clp)) | Marca **não liberada**. Revise o tempo de ciclo e a tarefa do servidor Modbus no CLP e repita a marca inteira |
| Qualquer outra reprovação | Marca **não liberada**. Corrija o guia de adaptações ou o FB e repita a marca inteira |

### 6.4 Fatos por marca (preencher na Parte C)

| Fato | Siemens S7-1200 | Schneider M221 | Rockwell Micro820 | ABB PM5012 |
|---|---|---|---|---|
| Firmware do CLP e versão do software | | | | |
| Versão do agente e do FB | | | | |
| Unit id que responde (C2) | | | | |
| Ordem nativa de 32 bits (C5) | | | | |
| Limite de conexões Modbus TCP (C14) | | | | |
| Tempo médio de resposta (C15) | | | | |
| Procedimento de download que mantém os contadores (C11) | | | | |
| Data, operador e resultado | | | | |

Depois de preencher, atualize as marcações "confirmar" do [guia de adaptações](adaptacoes-por-fabricante.md) com o que foi visto.

### 6.5 Quando repetir

- Versão nova do agente que mexa no Modbus, nos contadores ou nos estados.
- Versão nova do `FB_OEE_ENGEMASE` ou do bloco.
- Firmware de CLP de um cliente diferente do testado.
- Família nova de uma marca prioritária (ex.: S7-1500, M241, AC500 V3, CompactLogix com gateway de protocolo): só os testes C1–C16 dessa família.
