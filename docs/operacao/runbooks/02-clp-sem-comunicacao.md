# RB-02 — CLP sem comunicação

| | |
|---|---|
| **Severidade típica** | Aviso (uma máquina); alta se forem todas as máquinas de um gateway |
| **Alerta** | "Sem comunicação / dados atrasados" ([docs/13](../../13-notificacoes-e-alertas.md#catálogo-inicial-de-alertas-presets-por-cliente)) |
| **Quem atende** | N1 (suporte Engemase); manutenção ou automação do cliente; técnico de campo |
| **Perde dados?** | O **tempo** em que a máquina ficou sem leitura entra como `NO_COMM` (padrão: parada não planejada com motivo "Sem comunicação" e selo "dados incompletos", decisão D21). As **peças** não se perdem se o CLP continuou contando: na volta, o delta do contador inclui o que foi produzido no intervalo |

## 1. Sintoma

O gateway está **online**, mas uma ou mais máquinas aparecem como **"sem comunicação"** (estado `NO_COMM`). Se o gateway inteiro estiver offline, use o [RB-01](01-gateway-offline.md).

## 2. Como aparece na plataforma e nos alertas

- **Tela ao vivo, TV e linha do tempo:** a máquina em "sem comunicação", com o selo de dados incompletos.
- **Alerta "Sem comunicação / dados atrasados"** (aviso), depois de 5 min sem dados da máquina. Não dispara se o gateway já estiver offline.
- **Detalhe do gateway**, aba **Conexões Modbus** e aba **Saúde**: status do dispositivo (campos do `/sync`, [docs/04](../../04-protocolo-gateway-nuvem.md)):

| Status | Quando |
|---|---|
| `connected` | Última leitura boa |
| `degraded` | 1 ou 2 falhas seguidas depois de já ter lido bem |
| `disconnected` | 3 falhas seguidas ou mais. O agente entra em **espera crescente** (1, 2, 5, 10 e 30 s) para não travar o barramento |
| `disabled` | Dispositivo desativado na config |

- Campos úteis: `last_error`, `last_ok_at`, `errors_1m`, `timeouts_1m`, `exceptions_1m` (por código), `latency_ms`. Por barramento RS-485 (`buses[]`, **Fase 1**): `status` (`port_unavailable` = porta serial ausente ou ocupada), `busy_pct`, `unsolicited_bytes_1m` (bytes que o gateway não pediu: **indício de um segundo mestre**).
- **Heartbeat parado:** o servidor Modbus responde, mas o `heartbeat` do [bloco OEE](../bloco-oee-v1.md#52-heartbeat-offset-1) não muda por mais de `heartbeat_timeout_s` (template: 5 s). O dispositivo fica `connected` e a máquina vai para `NO_COMM`: CLP em STOP, programa travado ou FB que deixou de ser chamado.
- **LED (Fase 1):** vermelho fixo quando **todos** os CLPs do gateway estão sem comunicação.

## 3. Causas prováveis

**Modbus TCP**
1. CLP desligado, em manutenção ou trocado (o CLP novo veio com o IP de fábrica).
2. Cabo, switch OT ou porta do switch.
3. **Limite de conexões Modbus TCP do CLP esgotado** (IHM, SCADA, notebook de alguém).
4. Servidor Modbus desabilitado depois de um download de programa, ou instância do servidor removida.
5. IP, porta ou unit id errados na config (alguns servidores só respondem ao unit id 255 ou 0).
6. Conflito de IP na rede OT.
7. IP do CLP fora das sub-redes OT configuradas no gateway, ou ainda não liberado no firewall local (a saída OT só vai para os IP:porta cadastrados na config).

**Modbus RTU (RS-485)**
1. **Segundo mestre no barramento** (IHM ou outro equipamento como mestre): colisões e timeouts ([docs/11 §5](../../11-integracao-modbus.md#5-um-mestre-por-barramento)).
2. **A e B invertidos** (a nomenclatura muda entre fabricantes).
3. Terminação ausente ou duplicada; polarização ausente ou duplicada; comum (`GND_ISO`) não ligado; malha aterrada nos dois lados; cabo junto de cabos de motor e inversor.
4. Parâmetros seriais diferentes (velocidade, paridade, stop bits). **Delta DVP sai de fábrica em Modbus ASCII 9600 7E1**, que o gateway não fala.
5. Unit id errado ou duplicado no barramento.
6. Porta lógica errada na config (`rs485-1/2/3` × borne físico).
7. Um escravo desligado consome o timeout a cada ciclo e deixa os outros mais lentos.

**Mapa de registradores** (o CLP responde, mas com erro)
- **Exceção 02** (endereço inválido): deslocamento de 1 (base 0 × 4xxxx), endereço base errado (ex.: Delta DVP, D1000 = HR 5096) ou bloco fora da área mapeada no CLP.
- **Exceção 01** (função não suportada): leitura de holding (FC03) num CLP que expõe só input registers (FC04), ou o contrário.
- **Exceção 0B** (gateway sem resposta do escravo): conversor Modbus TCP→RTU sem resposta do escravo dele.

## 4. Diagnóstico

### 4.1 Pela plataforma (sempre primeiro)

1. **Quantas máquinas?**
   - **Uma** → lado do CLP ou do cabo daquela máquina.
   - **Todas de um barramento RS-485** → barramento ou porta serial do gateway.
   - **Todos os dispositivos TCP** → link OT do gateway (cabo da ETH0, switch OT, IP OT do gateway).
2. **Mudou alguma coisa?** Auditoria: config publicada pouco antes (evento `config_applied`)? Compare com a versão anterior: endereço, unit id, porta, barramento.
3. **Leia o `last_error` e as exceções** e use a tabela abaixo.
4. **"Testar conexão"** (`device.test`) e **"Ler agora"** (`tag.read`) no detalhe do gateway **(Fase 1)**. O comando só chega ao gateway na resposta do próximo `/sync` (até 10 s; depois, ~1 s no modo interativo).

| Erro (`last_error` ou código do comando) | Significa | Próximo passo |
|---|---|---|
| `modbus: timeout` / `read_timeout` | O dispositivo não respondeu no prazo (500 ms TCP, 300 ms RTU) | TCP: CLP ligado? Cabo? RTU: velocidade, paridade, A/B, unit id, segundo mestre |
| `modbus: conexão recusada` / `connection_failed` | O IP responde, mas não aceita conexão na porta | Servidor Modbus desligado no CLP, porta errada ou limite de conexões esgotado |
| `modbus: porta serial indisponível` / `port_unavailable` | A porta serial do gateway não abre | Porta lógica errada na config ou problema no gateway (seção 6) |
| `modbus: exceção 02 (endereço inválido) na função 03` | O CLP não tem aquele endereço | Endereço base e área (seção 3) |
| `modbus: exceção 01 (função não suportada) ...` | Área errada | Holding × input registers |
| `modbus: exceção 11 (gateway sem resposta do escravo) ...` | Exceção 0B (decimal 11): conversor TCP→RTU sem resposta do escravo | Lado RTU do conversor |
| Dispositivo `connected`, máquina `NO_COMM` | Heartbeat parado | CLP em STOP ou FB não chamado |

### 4.2 Remoto

1. **Manutenção ou automação do cliente:** o CLP foi desligado, trocado ou reprogramado? A IHM foi trocada ou reconfigurada? Alguém ligou um notebook ou um SCADA novo no CLP? Peça fotos do CLP, dos LEDs de rede e do borne RS-485.
2. **F2:** com a VPN de manutenção, rodar os comandos da seção 4.3 por SSH, sem ir ao local. O encaminhamento para o CLP (um IP:porta, com aprovação própria) permite usar o software do fabricante para conferir o servidor Modbus.

### 4.3 No local

**Primeiro, sem mexer no gateway:**
1. LEDs de rede do CLP e do switch; LED de tráfego da porta RS-485 do gateway (**CONFIRMAR NA BANCADA** o comportamento): se só o gateway transmite e ninguém responde, o escravo não está ouvindo.
2. **Notebook no switch OT** com um cliente Modbus (mbpoll, QModMaster, Modbus Poll): ler o mesmo endereço do CLP. Se o notebook também não lê, o problema não é o gateway.
3. **RS-485 pelo notebook:** com um adaptador USB-RS485 isolado, ler o escravo **no lugar do gateway**: antes, desligue os fios A/B do gateway desse barramento (um mestre por barramento). Mesma velocidade, paridade e unit id da config.
4. **RS-485 com tudo desligado:** resistência entre A e B ≈ **60 Ω** (duas terminações de 120 Ω). ≈ 120 Ω = falta uma terminação; ≈ 40 Ω = terminação a mais. Em repouso e energizado, tensão A–B ≥ 200 mV (polarização). Conferir o comum ligado em todas as estações.

**No gateway** (página local **(Fase 1)**: telas Dispositivos e Leitura ao vivo; ou console com o usuário `tecnico`):

```bash
ping -c 3 192.168.10.23                              # o CLP responde na rede OT?
sudo oee-gateway diag                                # hoje: config, credencial, buffer, DNS
sudo oee-gateway status                              # (Fase 1) dispositivos, erros por minuto, máquinas
oee-gateway modbus read --device <id> --offset 1000 --count 14   # (Fase 1) leitura pela fila do agente
oee-gateway modbus oee-block --device <id>           # (Fase 1) lê e confere o bloco OEE pela fila do agente
oee-gateway modbus scan --bus rs485-1 --units 1-32   # (Fase 1) varredura de unit ids pela fila do agente
oee-gateway logs --since 1h --level warn            # (Fase 1) entradas e saídas de espera dos dispositivos
```

**Por que não ler direto pelo gateway em campo:** o `oee-gateway modbus read --target ...` de hoje lê **sem passar pela fila do agente**. Na imagem de produção ele não serve ao `tecnico`: o firewall só deixa o **usuário do agente** (`oee`) falar com a rede OT, e só com os IP:porta cadastrados; as portas seriais são do grupo `dialout`, do qual o `tecnico` não faz parte; e não há root para parar o agente. Em RS-485, uma leitura direta com o agente rodando ainda seria um **segundo mestre** no barramento. A leitura direta fica para a bancada (imagem de engenharia) e para o notebook; em campo, use as leituras pela fila do agente **(Fase 1)**, a página local **(Fase 1)** ou o notebook (passos 2 e 3).

**No CLP** (com o responsável do cliente): servidor Modbus habilitado, IP, unit id, área mapeada, limite de conexões. Em RTU: endereço do escravo, velocidade, paridade e se existe outro mestre no barramento. Detalhes por marca: [adaptações por fabricante](../adaptacoes-por-fabricante.md).

## 5. Correção

| Causa | O que fazer |
|---|---|
| CLP desligado ou em manutenção | Nada no gateway: a comunicação volta sozinha. Se a parada foi planejada, o supervisor classifica o período na plataforma |
| CLP trocado ou com IP novo | Ajustar o IP no CLP (preferível) ou na config da plataforma e publicar |
| Limite de conexões esgotado | Liberar conexões no CLP (remover clientes esquecidos) ou aumentar o limite, se o CLP permitir |
| Servidor Modbus desabilitado | Habilitar no programa do CLP (com o responsável do cliente) |
| Endereço, área ou unit id errados | Corrigir na config da plataforma e publicar. **Mudar o endereço de um contador gera nova base** (`counter_rebaseline`): nada é contado em dobro |
| Segundo mestre no RS-485 | Tirar o gateway desse barramento e escolher uma alternativa do [docs/11 §5](../../11-integracao-modbus.md#5-um-mestre-por-barramento) (de preferência Modbus TCP no CLP ou a segunda porta serial) |
| A/B, terminação, polarização, comum, malha | Corrigir a fiação conforme o [docs/11 §4](../../11-integracao-modbus.md#4-rs-485-boas-práticas-de-instalação) |
| Parâmetros seriais | Igualar todos os escravos ao barramento cadastrado (19200 8E1 é o padrão do Modbus). Delta DVP: configurar RTU por D1120/M1143 |
| Heartbeat parado | Colocar o CLP em RUN; conferir se o FB do bloco OEE é chamado todo ciclo |
| IP fora da sub-rede OT do gateway | Ajustar a rede OT do gateway no local (`net set`, **Fase 1**, com confirmação e volta automática) ou pedir uma rota OT |

**Para dar por resolvido:** dispositivo `connected` e `errors_1m = 0` por **15 min seguidos**, heartbeat mudando e a máquina com o estado certo na tela ao vivo (critério de "máquina no ar" do comissionamento).

## 6. Quando escalar

| Situação | Para quem |
|---|---|
| `port_unavailable` com a config certa, ou a porta RS-485 não transmite (teste com o notebook funciona e o gateway não) | **N2** (suspeita de hardware ou do driver da porta) |
| Precisa alterar o programa do CLP | Automação do cliente ou equipe de automação da Engemase (serviço à parte, com autorização do cliente) |
| Segundo mestre que não pode sair do barramento | **N2** (decisão de arquitetura com o cliente) |
| Comunicação instável sem causa na fiação (erros de CRC, timeouts esporádicos) | **N2** com fotos da instalação e medidas |
| Contagem diferente da IHM depois de voltar | Runbook "Contagem divergente do CLP" (a escrever) ou **N2** |

## 7. Ao fechar o chamado

Registre: gateway (`EGW-NNNNN`), máquina e dispositivo, período sem comunicação (início e fim, com fuso), causa, correção e quem fez. Se mudou o CLP, a fiação ou a config, atualize o cadastro da máquina e as fotos do painel.
