# RB-04 — Relógio fora de sincronia

| | |
|---|---|
| **Severidade típica** | Aviso; alta se passar de 2 min ou se o gateway ficar offline por causa do relógio |
| **Alerta** | "Relógio > 2 s" (operacional, só equipe Engemase, [docs/13](../../13-notificacoes-e-alertas.md#catálogo-inicial-de-alertas-presets-por-cliente)) |
| **Quem atende** | N1 (suporte Engemase); TI do cliente para o NTP; N2 se houver dados com horário errado |
| **Perde dados?** | Depende do tamanho e do sentido do erro (seção 2) |

## 1. Sintoma

O relógio do gateway está diferente do relógio da plataforma. As durações (debounce, segundos por estado) usam o relógio monotônico e não são afetadas, mas o **horário** dos eventos e as **fronteiras dos minutos** usam o relógio de parede do gateway ([docs/03](../../03-gateway.md#relógio)).

## 2. Como aparece na plataforma e nos alertas

- **Detalhe do gateway**, aba **Saúde**: `clock_offset_ms` (diferença `server_time − relógio do gateway`, filtrada; **positivo = gateway atrasado**, negativo = adiantado) e `ntp_synced` **(Fase 1)**.
- **Alerta operacional** quando a diferença passa de **2 s**.
- **Eventos** `clock_jump` (salto do relógio, com o tamanho) **(Fase 1)**.

| Tamanho do erro | Efeito |
|---|---|
| Até 2 s | Nenhum efeito prático |
| De 2 s a 2 min | Eventos e minutos com horário deslocado; linha do tempo levemente fora; minutos podem cair no turno vizinho perto da troca de turno |
| **Gateway adiantado mais de 2 min** | A API **recusa** os itens com horário no futuro (tolerância de 2 min): eles vão para a **quarentena** e a fila para de andar ([RB-03](03-dados-atrasados-buffer.md)) |
| **Gateway atrasado muitas horas ou dias** (bateria do RTC e NTP sem acesso) | Dados aceitos com o horário errado, atribuídos a outro turno ou dia. Não há correção automática |
| **Erro de dias ou anos** | O certificado da plataforma parece "ainda não válido" ou "expirado": **o TLS falha e o gateway fica offline** ([RB-01](01-gateway-offline.md)). A coleta continua no buffer com o horário errado |

## 3. Causas prováveis

1. **NTP bloqueado:** UDP 123 fechado no firewall do cliente e sem servidor NTP interno informado.
2. **Servidor NTP interno errado** ou fora do ar (inclusive o informado pelo DHCP).
3. **Bateria do RTC fraca** + queda de energia: o gateway volta com a hora antiga e fica assim até o NTP acertar (**CONFIRMAR NA BANCADA** o RTC e a bateria do R1000).
4. Serviço de relógio (`chrony`) parado ou mal configurado.
5. Alguém mudou a hora à mão.

## 4. Diagnóstico

### 4.1 Pela plataforma (sempre primeiro)

1. Valor e sinal de `clock_offset_ms`; desde quando. Um salto logo depois de um `agent_start` com reinício sujo sugere queda de energia + RTC.
2. **Outros gateways da mesma planta** com o mesmo problema → NTP bloqueado na planta (TI do cliente).
3. **Itens em quarentena** (`quarantined` > 0) junto com o gateway adiantado → os itens foram recusados por horário no futuro.
4. Compare o horário dos últimos eventos de estado com o horário em que a plataforma os recebeu.

### 4.2 Remoto

1. **TI do cliente:** existe servidor NTP interno? O gateway (porta IT) pode falar UDP 123 com ele ou com `pool.ntp.br`? O DHCP entrega um servidor NTP (opção 42)? Ver a [ficha técnica §4](../ficha-tecnica-ti-cliente.md#4-tráfego-de-saída-necessário-porta-it).
2. **F2:** sessão de VPN aprovada para rodar os comandos da seção 4.3.

### 4.3 No local

```bash
timedatectl                       # hora local e UTC, hora do RTC, "System clock synchronized" e "NTP service"
sudo oee-gateway diag             # verificação de relógio/NTP: (Fase 1)
sudo oee-gateway status           # (Fase 1) relógio, diferença para o servidor
sudo oee-gateway net show         # (Fase 1) servidores NTP configurados
```

O `chronyc` só aceita comandos do root (o chrony da imagem não abre porta de comando) e a imagem não tem root: em campo, use o `timedatectl`, a página local e o `diag` **(Fase 1)**.

Na página local **(Fase 1)**: tela **Status** (relógio) e **Diagnóstico** (NTP).

## 5. Correção

| Causa | O que fazer |
|---|---|
| NTP bloqueado | TI libera UDP 123 para o servidor NTP interno (preferido) ou para `pool.ntp.br` |
| Servidor NTP errado | Ajustar o NTP no gateway, no local: `sudo oee-gateway net set` **(Fase 1)**, com confirmação e volta automática; ou corrigir a opção do DHCP |
| NTP impossível na planta | Ajuste pelo horário do servidor (`server_time` do `/sync`, que vem por TLS), feito pelo ajudante privilegiado **(Fase 1)**. Enquanto isso não existir, não há como acertar a hora em campo (a imagem não tem root): liberar o NTP é o único caminho |
| Relógio tão errado que o TLS falha | Liberar o NTP (o chrony corrige saltos grandes nas primeiras medições). Sem NTP: acertar pela página local ou pelo ajudante **(Fase 1)**; até lá, trocar a unidade. Sem hora certa o gateway não volta a falar com a nuvem, mas continua coletando no buffer |
| Bateria do RTC | Trocar a bateria ou o gateway (**CONFIRMAR NA BANCADA** se a bateria é substituível em campo) |

**Depois de corrigir:** a diferença cai para menos de 2 s, o alerta fecha e, se havia itens recusados por horário no futuro, eles **continuam na quarentena** (seção 6).

**Não fazer:** mudar a hora várias vezes para "testar" com o agente coletando (cada salto vira um `clock_jump` e bagunça a linha do tempo); desligar a validação de certificado; abrir exceção de firewall de entrada.

## 6. Quando escalar

| Situação | Para quem |
|---|---|
| Itens em quarentena por horário no futuro | **N2** (reentrega ou registro da perda) |
| Dados aceitos com horário errado (horas ou dias) | **N2** + aviso ao cliente: turnos e relatórios do período estão errados; a correção é manual |
| Relógio volta a errar depois de cada queda de energia | **N2** (RTC ou bateria) e logística de troca |
| Vários gateways de plantas diferentes com erro de relógio | **N2/N3** (suspeita da plataforma ou do `server_time`) |

## 7. Ao fechar o chamado

Registre: gateway (`EGW-NNNNN`), maior diferença observada e o sentido (adiantado ou atrasado), período afetado, se houve quarentena ou dados com horário errado, causa e correção. Se o NTP da planta mudou, atualize a ficha técnica do cliente.
