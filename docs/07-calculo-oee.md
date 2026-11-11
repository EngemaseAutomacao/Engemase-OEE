# 07 — Cálculo de OEE

## Definições

```
Tempo do turno (calendário)
 └─ menos paradas planejadas (refeição, manutenção programada, sem programação)
     = TEMPO PLANEJADO DE PRODUÇÃO
        └─ menos paradas não planejadas (falhas, falta de material, setup não planejado...)
            = TEMPO DE OPERAÇÃO (run time)
```

| Indicador | Fórmula | Perda que mede |
|---|---|---|
| **Disponibilidade (A)** | Tempo de operação ÷ Tempo planejado | Paradas |
| **Performance (P)** | (Tempo de ciclo ideal × Contagem total) ÷ Tempo de operação | Velocidade reduzida e micro-paradas |
| **Qualidade (Q)** | Peças boas ÷ Contagem total | Refugo e retrabalho |
| **OEE** | A × P × Q = (Peças boas × Ciclo ideal) ÷ Tempo planejado | Todas |

### Exemplo

Turno de 8 h (480 min) com 30 min de refeição planejada → **tempo planejado = 450 min**.
Houve 45 min de paradas não planejadas → **tempo de operação = 405 min**.
Ciclo ideal de 6 s; 3.600 peças produzidas, das quais 72 refugadas (3.528 boas).

| | Cálculo | Resultado |
|---|---|---|
| A | 405 ÷ 450 | **90,0%** |
| P | (3.600 × 6 s = 360 min) ÷ 405 min | **88,9%** |
| Q | 3.528 ÷ 3.600 | **98,0%** |
| **OEE** | 0,900 × 0,889 × 0,980 | **78,4%** |
| Conferência | (3.528 × 6 s = 352,8 min) ÷ 450 min | 78,4% ✓ |

Esse exemplo vira um dos casos de teste "golden" do pacote `@engemase/oee-core`.

## Modelo de estados

| Estado | Origem | Efeito no OEE |
|---|---|---|
| `RUNNING` | CLP (sinal, código ou contagem) | Tempo de operação |
| `STOPPED` | CLP (não está rodando, sem falha) | Parada não planejada. Pede motivo ao operador |
| `FAULT` | CLP (bit ou código de falha) | Parada não planejada. Motivo automático pelo código de falha (F2) |
| `NO_COMM` | Gateway (sem leitura há > N s) | Configurável. **Padrão: parada não planejada**, com motivo "Sem comunicação" e selo de "dados incompletos" |
| Parada planejada | Calendário ou motivo de categoria "planejada" | **Excluída** do tempo planejado |
| Setup / troca | Motivo de categoria "setup" | Configurável por organização: perda de disponibilidade (padrão) ou planejada |

> O **estado bruto** vem da borda (o que o CLP diz). A **classificação** (motivo, planejada ou não) é feita na nuvem e pode mudar depois, quando o operador apontar o motivo. Por isso a nuvem guarda os eventos brutos e calcula o OEE a partir deles.

### Micro-paradas

Paradas menores que `micro_stop_threshold_s` (por máquina, ex.: 60 s) **contam como tempo de operação**. Elas reduzem a **performance**, não a disponibilidade, como no modelo clássico das "seis grandes perdas", e não pedem motivo ao operador.

O OEE final não muda com essa regra (continua sendo boas × ciclo ideal ÷ tempo planejado). Muda só a distribuição da perda entre A e P. Isso evita poluir a tela do operador com centenas de paradas de poucos segundos.

### Produção durante parada planejada

Se a máquina **rodou** durante um intervalo de parada planejada (ex.: trabalhou no horário de almoço), esse tempo **volta a contar como tempo planejado**. Sem essa regra, a performance passaria de 100%. A regra é configurável.

## Divisão de responsabilidades: borda × nuvem

| Etapa | Onde | Por quê |
|---|---|---|
| Ler sinais e determinar o estado bruto | **Borda** | Precisa de leitura rápida (100 ms a 1 s), o que não dá para fazer pela internet |
| Delta de contadores (overflow, reset) | **Borda** | Precisa do valor anterior. Funciona offline |
| Agregado por minuto (segundos por estado, contagens, produto) | **Borda** | Compacta o volume em ~100× |
| Eventos de mudança de estado (precisão de ms) | **Borda** | Base da linha do tempo e da disponibilidade |
| Calendário de turnos e paradas planejadas | **Nuvem** | Configuração de negócio, que muda pela web |
| Classificação de motivos e micro-paradas | **Nuvem** | O operador classifica depois do fato |
| Ciclo ideal por produto | **Nuvem** | Cadastro de negócio |
| A, P, Q e OEE de qualquer janela | **Nuvem** (`@engemase/oee-core`) | Recalculável a qualquer momento |

## Algoritmo (janela [t0, t1) de uma máquina)

1. **Janelas de turno:** interseção de [t0, t1) com os turnos da unidade (no fuso da unidade, convertido para UTC). Turnos que atravessam a meia-noite pertencem à data de início.
2. **Tempo planejado:** as janelas de turno menos os intervalos de parada planejada (calendário) e menos os eventos de parada com motivo de categoria "planejada". Aplica a regra de "produção durante parada planejada".
3. **Tempo de operação:** soma dos intervalos `RUNNING` dentro do tempo planejado, mais as paradas menores que o limite de micro-parada.
4. **Contagens:** soma de `total` e `reject` de `production_minute` na janela, menos ajustes manuais de `quality_entry`. Peças boas = total − refugo.
5. **Tempo ideal:** Σ por produto (contagem do produto × ciclo ideal do produto naquela máquina), usando o `product_code` de cada minuto.
6. **Indicadores:** A = operação ÷ planejado; P = ideal ÷ operação; Q = boas ÷ total; OEE = A × P × Q.
7. **Divisões por zero:** sem tempo planejado, o OEE é `null` ("sem produção planejada"), nunca 0%. Sem contagem, Q é `null`.

Os **tempos** vêm dos eventos (precisão de segundos e motivos aplicados). As **contagens** vêm dos minutos. Os segundos por estado dentro de `production_minute` servem para gráficos rápidos e para conferência cruzada.

Agregações acima de máquina (linha, unidade):

- **OEE da linha/unidade = Σ (boas × ciclo ideal) ÷ Σ tempo planejado.** A média simples dos OEEs das máquinas distorce o resultado e não deve ser usada.
- Para linhas em série, também se mostra o OEE da **máquina gargalo**, configurável.

## Casos especiais

| Situação | Tratamento |
|---|---|
| Contador zerado no CLP | A borda detecta o reset (`delta = valor atual`) e registra o evento `counter_reset` |
| Overflow do contador | A borda calcula o delta pelo tamanho do tipo (uint16/uint32) |
| Gateway reiniciado | O último valor do contador fica persistido no SQLite, então não se perde nem se duplica |
| CLP desligado | `NO_COMM`. Ao voltar, o delta do contador inclui o que foi produzido no intervalo, se o CLP estava ligado e só a rede caiu |
| Troca de produto no meio do turno | O minuto leva o `product_code`, e o tempo ideal é calculado por produto |
| Performance > 100% | Guarda o valor real. A interface marca acima de 105% com o alerta "verificar ciclo ideal". Opção de exibir limitado a 100% |
| Refugo lançado depois | Entra em `quality_entry` e marca o turno como sujo para recálculo |
| Operador reclassifica uma parada | Atualiza `reason_id` e marca o turno como sujo |
| Máquina sem sinal de "rodando" | Modo `count_derived` (ver [03](03-gateway.md#determinação-do-estado)) |
| Fuso e horário de verão | Cálculo sempre com timezone IANA da unidade. O Brasil não tem horário de verão hoje, mas o código não presume isso |

### Dados atrasados

Quando o gateway fica offline e depois reenvia o backlog:

1. A ingestão grava os eventos e minutos com os timestamps originais.
2. Todo `oee_shift` (e `oee_hour`) que cobre esses timestamps é marcado `dirty = true`.
3. O cron `recompute-dirty` recalcula os turnos sujos, e os relatórios passam a refletir os dados completos.
4. Enquanto o gateway está offline, as telas mostram o selo **"dados atrasados"** em vez de mostrar a máquina como parada.

## Pacote `@engemase/oee-core`

- Funções **puras** em TypeScript, sem acesso a banco: recebem intervalos, contagens e calendário e devolvem os indicadores.
- Usado pela API ao vivo, pelos cron jobs e pelos relatórios: **uma única implementação**.
- Testes com casos golden (como o exemplo acima) e testes de propriedade (ex.: OEE ≤ A, P, Q quando cada um ≤ 1; somar janelas adjacentes dá o mesmo resultado que calcular a janela inteira).

## Métricas complementares (F2+)

- **MTBF / MTTR** por máquina e por motivo.
- **Pareto** de paradas (tempo e ocorrências).
- **TEEP** = OEE × (tempo planejado ÷ tempo de calendário), para medir o uso da capacidade total.
- **Seis grandes perdas** em cascata (gráfico waterfall do tempo de calendário até o tempo efetivo).
