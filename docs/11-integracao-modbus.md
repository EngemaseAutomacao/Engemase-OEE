# 11 — Integração Modbus (TCP e RTU/RS-485)

Na **versão 1**, o gateway conversa com os CLPs **só por Modbus**: **Modbus TCP** (Ethernet) ou **Modbus RTU** (serial RS-485). Este guia orienta engenharia e campo. Ver também [ADR-011](10-decisoes-arquiteturais.md#adr-011--modbus-tcp-e-rtu-como-únicos-protocolos-do-mvp).

> **Status das informações:** a tabela de suporte por CLP veio de conhecimento técnico e de pesquisa, **sem conferência em todos os manuais**. Antes de prometer algo a um cliente, confirme no manual do modelo e teste em bancada.

## 1. A realidade: "ler sem mexer no CLP" raramente funciona

O Modbus é universal, mas há dois obstáculos frequentes:

1. **O CLP precisa estar configurado como servidor (TCP) ou escravo (RTU).** Em várias marcas isso exige bloco no programa ou módulo extra.
2. **Mesmo quando o Modbus é nativo, os dados de OEE costumam estar fora do mapa.** Contadores, estado da máquina e código de falha muitas vezes ficam em variáveis internas que o Modbus não enxerga.

Por isso a recomendação central deste guia é o **bloco OEE padrão Engemase** (seção 3).

## 2. Suporte por marca de CLP

Legenda da última coluna: ✅ provável leitura sem alterar o programa · ⚙️ só configuração/parâmetro (sem mexer na lógica) · ✏️ exige bloco no programa ou módulo.

| CLP | Modbus TCP | Modbus RTU (RS-485) | Leitura |
|---|---|---|---|
| **Schneider M221** (modelos Ethernet) | Servidor nativo; %MWn = HR n | SL1/SL2 como escravo (a SL1 costuma estar com a IHM) | ✅ se os dados estiverem em %MW |
| **Schneider M241 / M251** | Servidor nativo (pode estar desabilitado); só %MW localizadas | M241 tem seriais | ⚙️ |
| **Schneider M340 / M580** | Servidor nativo (CPU Ethernet, NOE/NOC); atenção ao controle de acesso por IP | M340: serial pode ser escravo | ✅ (%MW) |
| **Delta DVP** | Nativo nos modelos Ethernet ou com DVP-EN01-SL | **Escravo nativo** (COM2 RS-485). **Padrão de fábrica: Modbus ASCII 9600 7E1**; RTU via D1120/M1143. Mapa fixo: D0 = 0x1000, M0 = 0x0800, X0 = 0x0400, Y0 = 0x0500 | ✅ se a porta estiver livre |
| **Delta AS** | Servidor nativo | COM1/COM2 configuráveis (HWCONFIG) | ✅ provável |
| **WEG PLC300** | Servidor nativo | Mestre e escravo nativos | ✅ provável |
| **WEG PLC500** (CODESYS) | Adicionar "Modbus TCP Slave" no projeto | Idem | ✏️ |
| **WEG CLIC02 / TPW04** | A confirmar | A confirmar | A confirmar |
| **Mitsubishi FX5U** | MODBUS/TCP por parâmetro | RS-485 embutida, MODBUS_RTU por parâmetro | ⚙️ |
| **Mitsubishi FX3U/FX3G, iQ-R** | Só com módulo | Só com módulo/adaptador | ✏️ |
| **Rockwell Micro800** (820/850/870) | Nativo; preencher a tabela "Modbus Mapping" no CCW | Nativo | ⚙️ |
| **Rockwell CompactLogix/ControlLogix** | Não nativo (AOI de sockets ou ProSoft) | ProSoft | ✏️ (futuro: EtherNet/IP) |
| **Siemens S7-1200 / S7-1500** | Só com **MB_SERVER** no programa (uma instância por cliente) | Exige **CM/CB 1241** + Modbus_Slave | ✏️ (futuro: S7comm PUT/GET, que só lê DBs **não otimizados**) |
| **Siemens LOGO! 8** (FS4+) | Nativo; habilitar a conexão de servidor no LOGO!Soft | — | ⚙️ |
| **Omron CP1, NX1P, NJ** | Só com FBs sobre sockets | CP1: nativo **só como mestre** | ✏️ (futuro: FINS / EtherNet/IP) |
| **Altus Nexto** | Nativo; adicionar a instância de servidor no MasterTool | Nativo (COM) | ⚙️ |
| **Altus Duo** | DU351 | COM1/COM2 | A confirmar |

**Quando o CLP não colabora** (fechado pelo fabricante da máquina, sem porta livre, sem acesso ao programa): use um **módulo de I/O remoto Modbus TCP** ligado a sinais da máquina (rodando, falha, pulso de ciclo, refugo). Os pulsos devem ir para o **contador de hardware** do módulo, nunca para leitura por polling.

## 3. Bloco OEE padrão Engemase

Bloco de **holding registers contíguos** que a Engemase inclui nos programas dos CLPs que ela própria programa ou altera. Benefícios:
- uma única leitura em bloco (1 transação) por máquina;
- **template de máquina pronto** na plataforma: cadastrar uma máquina vira "informar IP/endereço";
- mesmo significado em qualquer marca, o que simplifica suporte e comissionamento.

Proposta inicial (32 HR a partir de um endereço base configurável, por exemplo HR 1000):

| Offset | Tipo | Nome | Descrição |
|---|---|---|---|
| 0 | uint16 | `versao_bloco` | Versão do layout (começa em 1) |
| 1 | uint16 | `heartbeat` | Incrementado pelo CLP a cada ciclo de scan ou a cada 1 s (detecta CLP "congelado") |
| 2 | uint16 | `estado` | 0 = parada · 1 = produzindo · 2 = falha · 3 = setup · 4 = manual · 5 = emergência |
| 3 | uint16 | `codigo_falha` | Código do alarme ativo (0 = nenhum) |
| 4–5 | uint32 | `contador_total` | Ciclos/peças acumulados (nunca zerar por programa; overflow tratado pelo gateway) |
| 6–7 | uint32 | `contador_refugo` | Peças refugadas acumuladas |
| 8–9 | uint32 | `contador_bons` | Opcional (se 0, o gateway calcula total − refugo) |
| 10 | uint16 | `produto` | Código do produto/receita atual |
| 11 | uint16 | `velocidade` | Velocidade atual (unidade definida por máquina) |
| 12 | uint16 | `ciclo_ultimo_ms` | Duração do último ciclo, em ms (opcional) |
| 13 | uint16 | `bits_status` | Bit 0 automático · bit 1 porta aberta · bit 2 falta material · bit 3 manutenção... |
| 14–31 | — | reservado | Expansão futura (não usar) |

Regras:
- **Ordem das words em 32 bits:** definida por padrão como **CDAB** (word baixa primeiro), que é o comum em CLPs. Fica registrada no template e pode ser trocada por máquina.
- O bloco é **somente leitura** para o gateway (o gateway nunca escreve no v1).
- A especificação do bloco vira um documento versionado e uma biblioteca de FB/rotina por fabricante (Delta, WEG, Schneider, Siemens, Rockwell...), mantidos pela Engemase.

## 4. RS-485: boas práticas de instalação

| Item | Regra |
|---|---|
| Topologia | **Barramento em cascata** (daisy chain). Nada de estrela. Derivações curtas (< 20 m segundo a especificação Modbus) |
| Terminação | **120 Ω só nas duas pontas** (a especificação Modbus também admite 150 Ω, ou 120 Ω + 1 nF). No reComputer R1000 o resistor **não vem montado**: usar resistor externo no borne da última estação |
| Polarização (fail-safe) | **Um único par** de resistores (450–650 Ω) no barramento, normalmente no mestre. **No reComputer R1000, ainda não se sabe se a porta polariza** (confirmar na bancada). Até lá, usar a polarização de um escravo ou de um terminador com bias. Não duplicar |
| Cabo | Par trançado blindado de 120 Ω (22–24 AWG) **+ condutor de comum (0 V)**. Malha aterrada em **um só ponto** (no gateway). Longe de cabos de motor e inversor |
| Isolação | Porta RS-485 **isolada** no gateway. Muitos CLPs baratos têm porta não isolada. A isolação **não dispensa** o fio de comum (no R1000, o comum vai no `GND_ISO`) |
| Limites | 32 cargas unitárias por segmento (mais com transceptores de 1/4 ou 1/8 UL ou com repetidor) · ~1.000–1.200 m em baixa velocidade · endereços 1–247 (0 é broadcast, nunca ler) |
| Velocidade e formato | 9600 ou **19200 bps (padrão Modbus)**; formato da especificação **8E1** (ou 8N2), mas na prática há muito 8N1. Todos os escravos do barramento com a **mesma** configuração |
| Controle de direção | Por hardware ou pelo **modo RS-485 do kernel** (`TIOCSRS485`), já configurado pelo fabricante do gateway. **Nunca** alternar RTS em espaço de usuário (perde bytes) |

### Quanto cabe num barramento?

Leitura de 10 registradores (FC03) por escravo; turnaround do CLP de 5 a 20 ms:

| Velocidade | Tempo por transação (fio) | Ciclo de 10 escravos | Leituras por escravo |
|---|---|---|---|
| 9600 bps | ~46 ms | 0,5–0,7 s | ~1,5–2 por segundo |
| **19200 bps** | ~23 ms | **0,3–0,4 s** | **~2,3–3,6 por segundo** |
| 115200 bps | ~7 ms | 0,1–0,3 s | ~3,7–8,6 por segundo (o turnaround domina) |

**Conclusão:** para OEE (leitura a cada 1 s), **19200 bps com até ~10 escravos** atende com folga. Ler 125 registradores por escravo a 9600 bps leva ~0,3 s **por escravo**: leia só o necessário, em blocos contíguos. O bloco OEE padrão (32 HR) a 19200 bps fica em ~40 ms por máquina.

Um escravo desligado consome o timeout inteiro a cada ciclo. Por isso o agente usa **timeout curto (200–500 ms), 1 nova tentativa e backoff** para o escravo que está falhando, sem travar o resto do barramento.

## 5. Um mestre por barramento

O Modbus RTU tem **um único mestre** por barramento. Se a IHM já é mestre na serial do CLP, **o gateway não pode entrar nesse barramento** (haveria colisões e timeouts na IHM). Alternativas, da melhor para a pior:

1. **Modbus TCP no CLP.** Servidores TCP aceitam vários clientes. Atenção ao limite de conexões simultâneas do CLP (IHM e SCADA também consomem conexões).
2. **Segunda porta serial do CLP**, configurada como escravo.
3. **IHM como ponte** (servidor Modbus TCP ou pass-through), se o fabricante permitir. Exige mudar o projeto da IHM.
4. **Gateway TCP↔RTU com arbitragem multimestre** (porta escravo para a IHM). Um conversor simples **não** resolve: ele continua sendo um segundo mestre.
5. **Modo proxy no nosso gateway** (duas RS-485: uma atende a IHM, a outra é mestre do CLP). Funciona, mas coloca o gateway no caminho do controle. Só com bypass e aprovação do cliente.

## 6. Endereçamento e erros comuns

| Área | Tamanho | Acesso | Funções | Convenção |
|---|---|---|---|---|
| Coils | 1 bit | Leitura/escrita | FC01 | 0xxxx |
| Discrete inputs | 1 bit | Leitura | FC02 | 1xxxx |
| Input registers | 16 bits | Leitura | FC04 | 3xxxx |
| Holding registers | 16 bits | Leitura/escrita | FC03 | 4xxxx |

- **Endereço base 0 vs. convenção 4xxxx:** "40001" é o holding register de **endereço 0** no protocolo. O deslocamento de 1 é o erro nº 1 de integração. A plataforma guarda o **endereço base 0** e mostra a convenção ao lado.
- **32 bits e float:** a ordem das words/bytes varia (**ABCD, CDAB, BADC, DCBA**). Sempre testar com um valor conhecido (ex.: contador = 100.000).
- **Limites por leitura:** até **125 registradores** (FC03/FC04) ou **2.000 bits** (FC01/FC02) por transação.
- **Exceções Modbus** comuns: 01 (função não suportada), 02 (endereço inválido), 03 (valor inválido), 04 (falha no escravo), 0B (gateway sem resposta do escravo).
- Modbus TCP **não tem autenticação nem criptografia**: só na rede OT, nunca exposto na rede IT. É um dos motivos das duas interfaces de rede no gateway.

## 7. Checklist de comissionamento em campo

1. CLP: modelo, firmware, porta usada (TCP/RTU), endereço/IP, unit id, velocidade e formato serial.
2. Confirmar que **não há outro mestre** no barramento RS-485 (seção 5).
3. Cabeamento RS-485: cascata, terminação nas pontas, polarização única, comum ligado, malha aterrada em um ponto.
4. Na plataforma: cadastrar a máquina (ou aplicar o template do bloco OEE padrão) e usar **"Testar conexão"** e **"Ler agora"** em cada tag.
5. Validar os contadores com um valor conhecido (ordem de words, escala).
6. Forçar uma parada e uma falha na máquina e conferir o estado na tela ao vivo.
7. Desligar o cabo de rede IT por alguns minutos e conferir que **nenhuma contagem se perde** (buffer do gateway).
8. Registrar fotos do painel e da ligação no cadastro do gateway.
