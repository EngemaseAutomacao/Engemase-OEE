# @engemase/oee-core

Cálculo de OEE **puro** em TypeScript (sem banco, sem rede, sem relógio do sistema), conforme
[docs/07 — Cálculo de OEE](../../docs/07-calculo-oee.md). É a implementação única usada pela API
ao vivo, pelos cron jobs (`close-shifts`, `recompute-dirty`) e pelos relatórios.

## Como testar

```bash
pnpm --filter @engemase/oee-core test        # Vitest (casos golden + propriedades com fast-check)
pnpm --filter @engemase/oee-core typecheck   # tsc --noEmit (strict)
```

Os testes rodam com o processo em `TZ=Pacific/Chatham` (ver `vitest.config.ts`) para garantir que
nada dependa do fuso da máquina.

## Uso

O pacote é consumido direto do código-fonte (`exports` → `src/index.ts`); no Next.js, inclua-o em
`transpilePackages`.

```ts
import { aggregateOee, calculateMachineOee, generateShiftWindows } from "@engemase/oee-core";

const shifts = generateShiftWindows({
  timeZone: "America/Sao_Paulo",
  from: "2026-11-11",
  to: "2026-11-11",
  shifts: [
    { id: "t1", start: "06:00", end: "14:00", daysOfWeek: [1, 2, 3, 4, 5], breaks: [{ start: "10:00", end: "10:30" }] },
    { id: "t3", start: "22:00", end: "06:00", daysOfWeek: [1, 2, 3, 4, 5] }, // atravessa a meia-noite
  ],
});

const shift = shifts[0]!;
const result = calculateMachineOee({
  window: { start: shift.start, end: shift.end }, // turno corrente: end = agora (passado pelo chamador)
  schedule: shifts,
  plannedDowntimes: [], // paradas planejadas do calendário, em UTC
  stateEvents, // machine_state_event: { start, end | null, state, reasonCategory? }
  minutes, // production_minute: { start, total, reject, productCode }
  qualityAdjustments, // quality_entry: { at, quantity, productCode? }
  idealCycles: { byProduct: { "PRD-001": 6 }, defaultS: 6 },
  options: { microStopThresholdS: 60 },
});
result.indicators; // { availability, performance, quality, qualityByCount, oee } — 0..1 ou null
result.totals; // totais aditivos → gravar em oee_shift / somar em agregados

const line = aggregateOee([machineA.totals, machineB.totals]); // Σ(boas × ciclo) ÷ Σ planejado
```

Instantes são `number` em ms UTC; durações no resultado são em segundos; datas locais `YYYY-MM-DD`
e horas `HH:MM`; dias da semana ISO (1 = segunda … 7 = domingo). Entradas incoerentes lançam
`OeeInputError` com mensagem em português; situações suspeitas viram `warnings`.

## Módulos

| Arquivo | Conteúdo |
|---|---|
| `src/intervals.ts` | Álgebra de intervalos `[start, end)`: normalizar, recortar, interseção, união, diferença |
| `src/timezone.ts` | Fuso IANA da planta ↔ UTC com `Intl` (horário de verão: regra "compatible") |
| `src/shifts.ts` | `generateShiftWindows` (turnos com pausas, vigência, turno noturno) e `findShiftWindowAt` |
| `src/states.ts` | `resolveStateTimeline`: classifica e recorta os eventos de estado na janela (micro-paradas, motivos) |
| `src/counts.ts` | `summarizeCounts`: contagens dos minutos + ajustes de qualidade, tempo ideal por produto |
| `src/indicators.ts` | `computeIndicators` (A, P, Q, OEE) e `performanceStatus` (> 100%, alerta de 105%) |
| `src/machine-oee.ts` | `calculateMachineOee`: algoritmo completo de uma máquina numa janela |
| `src/aggregate.ts` | `aggregateOee` / `sumTotals`: linha, planta ou várias janelas |

## Regras e decisões

- **Tempo planejado** = (turnos ∩ janela) − pausas − paradas planejadas do calendário − paradas com
  motivo de categoria "planejada" (+ setup e `NO_COMM` quando a política for `planned`).
- **Produção durante parada planejada** (padrão `count_as_planned`): o tempo em que a máquina operou
  fora do programado (pausa, parada do calendário **ou fora de turno**, que é "sem programação") volta
  a contar como planejado. Com `ignore`, esse tempo fica de fora, mas as peças continuam contando e a
  performance pode passar de 100% (é sinalizada).
- **Micro-paradas**: um episódio contíguo de `STOPPED`/`FAULT` não planejado menor que
  `microStopThresholdS` conta como operação. A duração considerada é a do **episódio inteiro**, não a
  parte dentro da janela; episódio em aberto nunca é micro-parada. Para isso, passe os eventos com
  folga de pelo menos o limite antes e depois da janela.
- **Classificação**: o motivo apontado prevalece sobre o estado bruto. `SETUP` (ou motivo "setup") é
  perda de disponibilidade por padrão; `NO_COMM` e trechos sem nenhum evento são parada não
  planejada por padrão e ligam `incompleteData` ("dados incompletos").
- **Eventos**: sobrepostos → o mais recente corta o anterior; `end = null` → dura até o próximo evento.
- **Contagens**: minuto pertence à janela pelo seu início; ajuste de qualidade pelo `at`. Ajuste
  positivo move peças de boas para refugo (o total não muda); ajuste sem produto herda o produto do
  minuto que o contém.
- **Qualidade ponderada pelo ciclo**: `quality = Σ(boas × ciclo) ÷ Σ(total × ciclo)`. Com um único
  ciclo é exatamente boas ÷ total (o caso do docs/07); com produtos de ciclos diferentes, garante
  `OEE = A × P × Q = Σ(boas × ciclo) ÷ planejado` também em linha/planta. `qualityByCount` (boas ÷ total)
  também é devolvida.
- **Nulos**: sem tempo planejado → A e OEE `null` (nunca 0%); sem operação → P `null`; sem contagem
  → Q `null`; produto produzido sem ciclo ideal (nem ciclo padrão) → P e OEE `null` + aviso.
- **Agregação**: sempre por soma dos totais (`aggregateOee`), nunca média dos OEEs. Os totais são
  aditivos: somar janelas adjacentes dá o mesmo resultado que a janela inteira (testado por propriedade).
- **Performance > 100%**: o valor real é mantido; `performanceStatus` indica `above100`,
  `reviewIdealCycle` (acima de 105%, configurável) e o valor `capped` em 100%.
- **Fuso**: horário local inexistente (relógio adianta) é empurrado para depois; ambíguo (relógio
  volta) usa a primeira ocorrência. Turno que atravessa a meia-noite pertence à data de início.
- **Paradas planejadas recorrentes** (ex.: preventiva toda sexta 14:00–16:00) podem ser geradas com o
  mesmo `generateShiftWindows` e passadas em `plannedDowntimes`.
