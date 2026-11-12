# 16 — Projeto do gateway

Projeto executável do gateway de OEE: o que ele faz, como é o software, a rede e a instalação, o comissionamento em campo, a preparação na Engemase e o ciclo de vida.

> **Como ler:** este documento traz as **definições canônicas**. Os detalhes estão nos rascunhos em `docs/rascunhos/`: `gateway-software.md`, `gateway-rede-e-instalacao.md`, `gateway-comissionamento-local.md` e `gateway-preparacao-e-ciclo-de-vida.md`. **Onde um rascunho divergir deste documento, vale este documento.** Complementa os docs [03](03-gateway.md), [04](04-protocolo-gateway-nuvem.md), [11](11-integracao-modbus.md) e [12](12-acesso-remoto-vpn.md).

## 1. Princípios

1. **A coleta nunca depende da nuvem.** Com uma configuração válida salva, o gateway coleta e grava, esteja online ou offline.
2. **Nenhuma peça se perde nem é contada duas vezes**, nem com queda de rede, queda de energia, `kill -9` ou reinício. É o invariante principal dos testes ("conservação de peças").
3. **Somente leitura no CLP, por construção.** Nenhuma interface interna tem método de escrita, e o lint barra as chamadas de escrita da biblioteca Modbus.
4. **Um mestre por barramento.** Toda leitura num RS-485 (coleta, comando da web, CLI, página local) passa pela mesma fila.
5. **Poupar o eMMC:** gravação em lote e nada de escrita por leitura.
6. **Privilégio mínimo:** o agente roda sem root, e só dois componentes pequenos e separados têm privilégio (seção 4).
7. **No MVP, a nuvem nunca altera a rede do gateway.** Um erro deixaria um equipamento remoto inacessível. A rede é definida na bancada e ajustada no local (seção 5).

## 2. Funções do gateway (corte de MVP)

| Grupo | MVP | Fase 2 ou depois |
|---|---|---|
| **Coleta** | Modbus TCP (conexão persistente por dispositivo), Modbus RTU (uma fila por barramento, até 3), RTU sobre TCP, planejador de blocos (≤ 125 registradores; divide o bloco ao receber exceção 02), decodificação (bool, bit, int16/uint16, int32/uint32, float32; ABCD/CDAB/BADC/DCBA; escala), saúde por dispositivo, detector de segundo mestre no RS-485 | int64, float64 e string; protocolos nativos (S7, EtherNet/IP, OPC UA) |
| **Processamento** | Debounce (padrão **1 s**), estado da máquina (`signals`, `state_code`, `count_derived`, `NO_COMM`, heartbeat do bloco OEE), contadores (overflow, reset, salto absurdo), minutos e eventos | Amostras `custom` (entram no MVP só se houver folga) |
| **Armazenamento e nuvem** | Outbox SQLite (fila principal + fila de amostras), `/enroll`, `/sync`, `/config` (aplicação por diferença e volta à última config boa), proxy HTTP e CA corporativa, relógio (diferença para o `server_time`) | MQTT/Sparkplug |
| **Comandos** | `tag.read`, `device.test`, `config.reload`, `agent.restart` | `modbus.scan` remoto, `token.rotate`, `gateway.identify`, `net.*` pela nuvem |
| **Operação local** | CLI de campo, página local **reduzida** (seção 6), LEDs de estado, watchdog, logs com limites, telemetria de saúde (CPU, RAM, disco, temperatura, desgaste do eMMC) | Página local completa; exportação do buffer para pendrive (F3) |
| **Atualização** | **OTA mínimo** (`.deb` assinado, atualizador separado, rollback) + `logs.upload` e `log.level` mínimos, se a decisão D29 confirmar | Canais e ondas de rollout; pacote de plataforma (kernel e driver) |
| **Acesso remoto** | — | VPN sob demanda ([12](12-acesso-remoto-vpn.md)) |

**Fora do gateway, de propósito:** cálculo de OEE, calendário, motivos e micro-paradas ficam na nuvem (ADR-006).

## 3. Arquitetura do software

**Processos:**

| Processo | Usuário | Quando roda | Fase |
|---|---|---|---|
| `oee-gateway run` (agente de coleta) | `oee` | Sempre (systemd, `Type=notify` com `WatchdogSec=30s` e verificação real de saúde: ciclo do motor, leitores e gravação no SQLite) | MVP |
| `oee-localui` (página local) | `oee-ui` | Ativado pelo socket na porta 443, só na interface OT e no endereço de serviço | MVP (reduzida) |
| `oee-helper` (ajudante privilegiado) | root | Ativado por socket local, com operações fechadas: aplicar rede com checkpoint, ajustar relógio, reset de fábrica, ler pendrive de diagnóstico | MVP |
| `oee-updater` (atualizador) | root | Só durante uma atualização e na verificação pós-boot | M4b (OTA mínimo) |
| `oee-remote-access` (VPN) | `oee-ra` | Só em sessão aprovada | F2 |

O ajudante privilegiado é **um único processo com operações fechadas**: validação por schema e identificação do chamador (`SO_PEERCRED`). Isso evita meia dúzia de serviços root na fronteira entre OT e IT. O atualizador fica separado porque precisa sobreviver a um agente novo que não sobe.

**Módulos do agente (Go):**
- `config`
- `modbus`: transporte TCP/RTU, planejador de blocos e codec
- `scheduler`: uma fila por barramento
- `signal`
- `engine`: estados, contadores, minutos e eventos
- `buffer`: outbox SQLite
- `uplink`
- `commands`
- `health`
- `localapi`: socket para a CLI e a página local

O esqueleto já está em `gateway/` (Fase 0).

**Armazenamento local:**
- Um arquivo SQLite (WAL, `synchronous=FULL`, gravação em lote) com:
  - a outbox principal (eventos e minutos);
  - a outbox de amostras;
  - o estado persistido dos contadores (gravado **na mesma transação** do minuto);
  - a config atual e a anterior;
  - eventos locais.
- Retenção de 30 dias ou 1 GB. Se for preciso descartar, saem primeiro as amostras e é registrado um evento `data_loss`.

**Watchdog (verificação real de saúde):** o agente só manda `WATCHDOG=1` (a cada 10 s, `WatchdogSec=30s`) quando passam três checagens:
- **motor:** houve tick nos últimos 5 s, contados a partir do fim da última gravação;
- **gravação:** nenhuma gravação no SQLite está presa há mais de 30 s, e a próxima tentativa não atrasou mais de 30 s (o backoff de uma gravação que falha é respeitado, também depois de uma troca de config);
- **leitores:** cada leitor deu sinal de vida dentro de `max(3 × (maior poll + pior leitura), 30 s)`. Leitura que falha conta como sinal de vida (CLP desligado não reinicia o agente); o prazo é estendido durante o backoff e suspenso enquanto o leitor espera o motor consumir.

Se uma falhar, o agente registra `watchdog não alimentado` (warn, `verificacao=motor|gravacao|leitor`) e o systemd o reinicia.

**Um leitor por linha física:** cada barramento RS-485 do gateway e cada conversor RTU sobre TCP (mesmo `host:porta`) tem um único leitor, que faz uma requisição por vez. Vários escravos atrás de um conversor transparente nunca são lidos em paralelo. Dispositivos Modbus TCP nativos têm um leitor cada.

**Tempo não observado:** a soma de cada minuto é sempre 60 s. O tempo em que o gateway não observou a máquina (boot, crash, queda de energia, salto de relógio, máquina removida da config) entra em **`no_comm_s`**. Minuto parcial nunca é enviado.

**Sincronização:** o ritmo é **comandado pelo servidor** (`next_sync_s`). O agente só antecipa o envio quando tem uma mudança de estado (com debounce de 1 s). O modo de comissionamento é o "modo interativo" do [04](04-protocolo-gateway-nuvem.md): `next_sync_s = 1` enquanto houver uma tela de comissionamento aberta, renovado a cada 5 min.

## 4. Caminhos, usuários e identidade (canônico)

| Item | Valor |
|---|---|
| Partições | `boot`, `root`, **`/data`** (dados e identidade, separada da raiz) |
| Estado do agente | `/var/lib/oee-gateway` (montado de `/data/oee`): SQLite, config, **`credentials.json` (0600)** |
| Identidade da unidade | `/data/identity/hw.json` (número de série, MACs, CID do eMMC, versão da imagem), gravada na bancada, somente leitura para o agente |
| Config local mínima | `/etc/oee-gateway/gateway.yaml`: URL da plataforma, caminhos, nível de log |
| Rede, proxy e CA | `/etc/oee-gateway/network.json` é **a única fonte**. O ajudante privilegiado gera dela os perfis do NetworkManager (amarrados por MAC), o nftables, o `proxy.env` e o pacote de CAs usado pelo agente |
| Número de série | `EGW-00042` (sequencial Engemase) |
| Hostname | `egw-00042` |
| Usuários | `oee` (agente), `oee-ui` (página local), `oee-ra` (VPN, F2), `tecnico` (só console local, sem SSH) |
| Sudo do `tecnico` | Só subcomandos explícitos, executados como o usuário `oee`: `oee-gateway diag` e `enroll --code` (Fase 0); `status` e `net show/set/confirm/rollback` entram com a CLI da Fase 1. **Sem** reset de fábrica, URL personalizada, `--config`, `--force` ou acesso remoto |
| Domínio dos gateways | `gw.oee.engemase.com.br` (proposta, decisão D28) |

## 5. Rede e instalação

**Interfaces:**

| Porta do R1000 | Papel | Padrão de fábrica |
|---|---|---|
| **ETH0** (Gigabit nativa do CM4) | **OT** (CLPs, módulos de I/O) | IP estático definido na bancada pela ficha de TI, mais o **endereço de serviço 169.254.x.x** sempre ativo, para o técnico chegar com um notebook |
| **ETH1** (10/100) | **IT** (internet) | DHCP ou IP fixo conforme a ficha de TI |

**Firewall (nftables):**
- `ip_forward=0`: o gateway nunca roteia entre as redes.
- **Saída IT:** só 443 para os domínios da plataforma, DNS e NTP. Os conjuntos de DNS e NTP são regenerados quando o DHCP muda os servidores.
- **Saída OT:** só para os **IP:porta cadastrados** na config. `device.test` libera temporariamente (5 min) um IP da sub-rede OT ainda não cadastrado, com limite de taxa e auditoria.
- **Exceção da Fase 0:** enquanto o `oee-helper` (que regenera as regras a partir da config) não existe, uma regra provisória deixa **só o processo do agente** abrir TCP para faixas privadas e link-local. É mais larga que a regra final e sai quando o helper entrar.
- **Entrada:** só a página local na OT e no endereço de serviço.

**Rede do cliente na bancada (Fase 0):** IP estático da OT, IP/gateway/DNS da IT, NTP e proxy vêm da ficha de TI e entram **na gravação** (`deploy/image/flash/flash-emmc.sh --ot-address --it-address --it-gateway --it-dns --ntp --proxy`). A inicialização de fábrica valida os valores (valor inválido acende o LED vermelho) e gera os perfis do NetworkManager, o `proxy.env` e as fontes do chrony.

**Mudança de rede:**
- Só no local, pela CLI ou pela página local (Fase 1, com o `oee-helper`).
- Usa o **checkpoint do NetworkManager**: se a mudança não for confirmada em 120 s, ou se a nuvem não for alcançada em 300 s, volta sozinha.
- Pendrive `OEE/net-reset` como último recurso.
- A mudança pela nuvem (`net.apply`) fica para a F2 (D31).

**Proxy:** HTTP CONNECT, com autenticação Basic se houver, e CA corporativa. Proxy NTLM e inspeção SSL são identificados pelo `diag` e exigem exceção ou aceite por escrito do TI.

**Instalação física:**
- Trilho DIN e fonte 24 VDC dedicada com disjuntor.
- Proteção contra surto (DPS) e aterramento.
- RS-485 em cascata, com terminação de 120 Ω nas pontas (o resistor do R1000 não vem montado) e comum no `GND_ISO`.
- **Polarização do RS-485:** a confirmar na bancada se o R1000 polariza. Até lá, usar a polarização de um escravo ou de um terminador com bias.

**Falta de energia:**
- Ação padrão **`reboot`**, sem o overlay `gpio-shutdown`. Há relato de que o CM4 não religa se a energia voltar no meio de um desligamento.
- O SuperCAP e o desligamento controlado só são adotados depois do teste T-PWR-3 na bancada (D27).

**Watchdog:** o systemd alimenta o watchdog do SoC (`RuntimeWatchdogSec=10s`). O watchdog do RTC do R1000 **não é armado no MVP**; validar na bancada.

**Topologias e roteiro de instalação:** ver o rascunho de rede (§5 e §6). Inclui a ficha de TI, a lista de materiais, os testes de aceite T1–T10 e o tempo estimado.

## 6. Comissionamento local

**Página local reduzida (MVP, ~1–1,5 semana):**
- Processo `oee-localui`, HTTPS na porta 443 só na OT e no endereço de serviço, **login só com senha local** (5 tentativas erradas → bloqueio de 15 min).
- Telas:
  - **Status:** nuvem, versão, relógio, fila, CPU, memória, disco, temperatura.
  - **Diagnóstico:** DNS, HTTPS para a plataforma, NTP, proxy.
  - **Rede:** alteração com confirmação e retorno automático.
  - **Leitura ao vivo:** registradores, com a predefinição do bloco OEE padrão.
  - **Tags e máquinas:** valores ao vivo e estado calculado.
  - **Logs.**
- Tudo somente leitura no CLP.
- **Fica para a F2:** login com a conta da plataforma, varredura do barramento e monitor de quadros, atualização por arquivo, reset de fábrica pela página.

**Senha local:**
- Gerada no primeiro boot na bancada e entregue em **cartão lacrado**, nunca na etiqueta.
- Também guardada no cofre da plataforma, com exibição auditada e aviso ao admin do cliente.
- Pode ver a senha: a equipe Engemase com atribuição ao cliente (D-g2).

**CLI de campo** (hoje existem `run`, `version`, `diag`, `enroll`, `modbus read` e `config validate`; o resto é Fase 1):
- `oee-gateway status`, `diag`, `enroll --code`
- `modbus read` (com `--oee-block` para ler o bloco padrão inteiro), `modbus scan` (local)
- `config show`, `buffer stats`, `logs`
- `net show/set/confirm/rollback`
- `support-bundle`

**LEDs (tabela única):**

| Estado lógico | Indicação |
|---|---|
| Coletando e nuvem OK | Verde fixo |
| Coletando sem nuvem (buffer enchendo) | Verde piscando |
| Sem config / aguardando ativação | Âmbar piscando |
| Falha de comunicação com todos os CLPs | Vermelho fixo |
| Erro crítico (disco, relógio, agente) | Vermelho piscando |
| Identificar (`gateway.identify`, F2) | Azul piscando |

O mapeamento físico depende de o R1000 ter LED RGB ou três LEDs (a confirmar). O acesso aos LEDs pelo usuário `oee` exige uma regra udev.

**Fluxo de comissionamento:**
1. O gateway sai da bancada **já registrado** no cliente e com a configuração da rede.
2. Ao ser energizado no local, **coleta assim que houver config válida**, mesmo sem internet, e guarda no buffer.
3. O técnico confere tudo pela página local e pela plataforma.
4. O "Confirmar instalação" na plataforma só muda o estado do ciclo de vida. **Não bloqueia a coleta.**

## 7. Preparação na Engemase e ciclo de vida

**Imagem própria:**
- Raspberry Pi OS **Trixie**; plano B: **Bookworm**, se o driver da Seeed falhar no kernel 6.12.
- Gerada por script versionado (`rpi-image-gen`).
- **Sem netplan e sem cloud-init.** **A imagem da Seeed nunca vai a campo.**
- Pacote `engemase-r1000-support`: overlay e módulo do RTC compilados para o **kernel fixado** (`apt-mark hold`).
- SSH mascarado, `unattended-upgrades` só com segurança e janelas que não se sobrepõem às do OTA, `journald` com limite e `fstrim` semanal.

**Gravação:**
- `rpiboot` + `bmaptool` no eMMC do CM4.
- Na primeira inicialização, um `factory init` grava a identidade, gera a senha local e roda os autotestes.

**Teste de aceite em bancada (burn-in reduzido no MVP):**
- B0: inspeção e identidade;
- B2: as 3 RS-485 e as 2 Ethernet contra o simulador;
- B3: rede e firewall;
- B4: **24 h** de coleta com conservação de peças;
- B5: **30 cortes de energia**;
- B6: relatório.

Bancada inicial de **4 posições** (~R$ 4–8 mil, mais 2–3 R1000 e SuperCAP).

**Inventário no MVP:** número de série, MACs, CID do eMMC, versão da imagem e relatório do burn-in, numa planilha controlada até existir a tabela `gateway_unit` na plataforma.

**Estados do ciclo de vida (MVP simplificado):** em estoque → reservado para cliente → instalado → em operação → em manutenção → substituído → descartado.

**Troca de um gateway com defeito:**
1. O novo gateway é registrado no mesmo registro de gateway e herda a configuração.
2. Os contadores recomeçam com marca de troca, para não haver contagem dupla.
3. O buffer do gateway antigo é recuperado, se for possível.

**Descarte:** apagar credencial e dados (LGPD).

**Fica para a F2:** os 14 estados completos, inventário na plataforma com reserva e selo automatizados, registro por identidade de fábrica com TPM, secure boot, bancada de 16 posições, rollout em ondas.

## 8. Impacto no contrato e no banco

- **Contrato (`packages/contracts`):**
  - agora: `no_comm_s` para o tempo não observado (já previsto), `log.level` e `logs.upload` mínimos (se D29), eventos `data_loss`, `counter_reset`, `clock_jump`, `power_loss` e `agent_start`;
  - na F2: `gateway.identify`, `net.*`, `localui.*`.
- **Banco (`packages/db`):**
  - agora: `gateway_unit` mínimo (inventário) e `gateway_network_config` (estado reportado, somente leitura no MVP);
  - na F2: `gateway_credential`, `gateway_unit_binding`, `inventory_lot`, releases.
- **Docs ajustados por este documento:**
  - [03](03-gateway.md): caminho da credencial, portas e debounce;
  - [08](08-seguranca-e-operacao.md): interface OT/IT e SSH;
  - [11](11-integracao-modbus.md): polarização a confirmar;
  - [15](15-multi-cliente-e-acesso.md): `device.test` em IP da sub-rede OT.

## 9. Prazo e riscos

**Prazo:**
- Somando o software (~11,5 semanas), a página local reduzida (~1,5), a rede local com checkpoint (~2) e a imagem com a bancada (~2–3), **a trilha do gateway passa a ser o caminho crítico**. Com 1 desenvolvedor, o piloto fica nas **semanas 19 a 21**.
- **Para voltar às semanas 14–16 do `docs/17`:**
  - um **segundo desenvolvedor ou técnico em tempo parcial** para a imagem, a bancada e a rede;
  - **e** o corte de MVP deste documento.

**Riscos principais:**

| Risco | Mitigação |
|---|---|
| Fatos do R1000 sem verificação: bornes × `ttyAMA2/3/5`, modo RS-485, LEDs, UPS, watchdog do RTC, ETH1 por USB | Comprar já 2–3 unidades da placa v1.1 e rodar na primeira semana um roteiro de verificação com critério de aceite |
| Driver da Seeed acoplado ao kernel | Kernel fixado, módulo compilado no CI, pacote de plataforma validado na bancada |
| Perder acesso a um gateway remoto por erro de rede | Sem `net.apply` pela nuvem no MVP; checkpoint com retorno; endereço de serviço; pendrive de reset |
| Contagem dupla ou perda em casos de borda | `no_comm_s`, testes de propriedade, 500 cortes de energia, `kill -9` repetido e saltos de relógio no CI noturno e na bancada |
| Desgaste do eMMC | Medir os bytes escritos por dia no teste de 14 dias; alerta pelo indicador de vida do eMMC; `/data` separada |
| Pacote do OTA maior que o limite de 4,5 MB das Vercel Functions | Baixar do Vercel Blob (FQDN na ficha de TI) ou por streaming no domínio `gw.`, validado na Fase 0 |
| TI do cliente com inspeção SSL ou proxy NTLM | Ficha de TI e teste do `/ping` antes da visita; `diag` que identifica o problema; roteador 4G homologado como alternativa |
| Correção no piloto exigir ida à fábrica | OTA mínimo com `logs.upload`; piloto perto da Engemase |

## 10. Decisões para o dono do produto

| # | Decisão | Proposta |
|---|---|---|
| D36 | Prazo: aceitar o gateway como caminho crítico (piloto nas semanas 19–21), reforçar a equipe ou cortar escopo? | Reforço parcial + corte de MVP (piloto nas semanas 14–16) |
| D30 | Página local no MVP? | Sim, versão reduzida (~1–1,5 semana) |
| D31 | Mudança de rede pela nuvem | F2; no MVP, só no local |
| D29 | OTA mínimo antes do piloto | Sim, com `logs.upload` e `log.level` mínimos |
| D-g1 | Sistema base | Trixie (plano B Bookworm), imagem própria já no MVP |
| D27 | SuperCAP em todas as unidades | Só depois do teste T-PWR-3; até lá, `reboot` |
| D28 | Domínio dos gateways e origem do pacote OTA | `gw.oee.engemase.com.br`; OTA pelo Vercel Blob |
| D-g2 | Senha local | Cartão lacrado + cofre; visível só para a equipe Engemase com atribuição |
| D-g3 | `device.test` em IP ainda não cadastrado | Sim, só na sub-rede OT, com limite e auditoria |
| D2 | Hardware vendido ou em comodato | — |
| D-g4 | Comprar a bancada inicial agora e definir o responsável | Sim (~R$ 4–8 mil + 2–3 R1000) |
| D-g5 | Caixa pré-montada, switch OT e IPv6 | Caixa como opcional de venda; switch fornecido pela Engemase quando a planta não tiver; IPv6 fora do MVP |
| D-g6 | Nomes | Série `EGW-00042`, hostname `egw-00042`, comando `gateway.identify` |
