/**
 * Tipos compartilhados do cálculo de OEE.
 *
 * Convenções:
 * - Instantes são números em **milissegundos UTC** (epoch), como `Date.getTime()`.
 * - Intervalos são semiabertos: `[start, end)`.
 * - Durações nos resultados são em **segundos** (podem ter fração, precisão de ms).
 * - Datas locais da planta são strings `YYYY-MM-DD`; horas locais são `HH:MM`.
 */

/** Instante em milissegundos UTC desde a época Unix. */
export type Instant = number;

/** Intervalo semiaberto `[start, end)` em milissegundos UTC. */
export interface Interval {
  readonly start: Instant;
  readonly end: Instant;
}

/** Estado bruto da máquina, como vem da borda (docs/07, "Modelo de estados"). */
export type MachineState = "RUNNING" | "STOPPED" | "FAULT" | "SETUP" | "NO_COMM";

/** Categoria do motivo de parada (`downtime_reason.categoria`). */
export type ReasonCategory = "unplanned" | "planned" | "setup";

/**
 * Evento de estado da máquina (`machine_state_event`).
 *
 * `end = null` significa evento em aberto: ele dura até o início do próximo evento
 * (ou indefinidamente, limitado pela janela de cálculo).
 */
export interface StateEvent {
  readonly start: Instant;
  readonly end: Instant | null;
  readonly state: MachineState;
  /** Categoria do motivo apontado (se houver). Ignorada para `RUNNING`. */
  readonly reasonCategory?: ReasonCategory | null;
}

/** Agregado por minuto vindo da borda (`production_minute`). */
export interface ProductionMinute {
  /** Início do balde (`bucket_start`). O minuto pertence à janela que contém este instante. */
  readonly start: Instant;
  readonly total: number;
  readonly reject: number;
  readonly productCode: string | null;
}

/**
 * Lançamento manual de qualidade (`quality_entry`).
 *
 * `quantity > 0` move peças de boas para refugo (refugo lançado depois);
 * `quantity < 0` estorna um lançamento anterior. O total produzido não muda.
 */
export interface QualityAdjustment {
  readonly at: Instant;
  readonly quantity: number;
  /** Produto do lançamento. Se ausente, usa o produto do minuto que contém `at`. */
  readonly productCode?: string | null;
}

/** Tabela de ciclo ideal (segundos por peça) da máquina (`product_machine` + `machine.ideal_cycle_s`). */
export interface IdealCycleTable {
  /** Ciclo ideal por código de produto, em segundos por peça. */
  readonly byProduct: Readonly<Record<string, number>>;
  /** Ciclo padrão da máquina, usado para produtos sem cadastro e minutos sem produto. */
  readonly defaultS?: number | null;
}

/** Janela de produção programada (ex.: um turno), com pausas planejadas dentro dela. */
export interface ScheduledWindow extends Interval {
  readonly breaks?: readonly Interval[];
}

/** Política para o estado `SETUP` e paradas com motivo de categoria "setup". */
export type SetupPolicy = "availability_loss" | "planned";

/** Política para `NO_COMM` e para trechos sem nenhum evento de estado. */
export type NoCommPolicy = "unplanned" | "planned";

/** Regra de "produção durante parada planejada" (docs/07). */
export type ProductionDuringPlannedStopPolicy = "count_as_planned" | "ignore";

/** Opções de cálculo (configuráveis por máquina/organização). */
export interface OeeOptions {
  /** Paradas menores que este limite (s) contam como operação. `0` desliga a regra. */
  readonly microStopThresholdS: number;
  /** Setup como perda de disponibilidade (padrão) ou como parada planejada. */
  readonly setupPolicy: SetupPolicy;
  /** `NO_COMM` como parada não planejada (padrão) ou planejada. */
  readonly noCommPolicy: NoCommPolicy;
  /** Se a máquina rodou em tempo não programado, esse tempo volta a contar como planejado. */
  readonly productionDuringPlannedStop: ProductionDuringPlannedStopPolicy;
  /** Acima deste valor de performance a interface pede para verificar o ciclo ideal. */
  readonly performanceAlertThreshold: number;
}

/** Códigos de aviso devolvidos junto com o cálculo. */
export type OeeWarningCode =
  | "PERFORMANCE_ABOVE_100"
  | "MISSING_IDEAL_CYCLE"
  | "REJECT_EXCEEDS_TOTAL"
  | "COUNT_WITHOUT_RUN_TIME"
  | "INCOMPLETE_STATE_DATA";

export interface OeeWarning {
  readonly code: OeeWarningCode;
  /** Mensagem em português, pronta para exibir. */
  readonly message: string;
  /** Códigos de produto envolvidos (quando fizer sentido). */
  readonly productCodes?: readonly (string | null)[];
}

/**
 * Totais aditivos de uma janela. Somar os totais de janelas adjacentes (ou de máquinas)
 * e recalcular os indicadores dá o mesmo resultado que calcular o conjunto inteiro.
 */
export interface OeeTotals {
  /** Tempo planejado de produção (s). */
  readonly plannedS: number;
  /** Tempo de operação (s), incluindo micro-paradas. */
  readonly runS: number;
  /** Contagem total. */
  readonly total: number;
  /** Refugo (minutos + ajustes manuais). */
  readonly reject: number;
  /** Peças boas = total − refugo. */
  readonly good: number;
  /** Σ (contagem × ciclo ideal) em segundos. `null` se faltar ciclo ideal de algum produto produzido. */
  readonly idealTimeS: number | null;
  /** Σ (boas × ciclo ideal) em segundos ("tempo totalmente produtivo"). `null` se faltar ciclo. */
  readonly goodIdealTimeS: number | null;
}

/** Indicadores de 0 a 1 (performance pode passar de 1). `null` quando não se aplicam. */
export interface OeeIndicators {
  /** Disponibilidade = operação ÷ planejado. */
  readonly availability: number | null;
  /** Performance = tempo ideal ÷ operação. */
  readonly performance: number | null;
  /**
   * Qualidade = Σ(boas × ciclo) ÷ Σ(total × ciclo). Com um único ciclo é exatamente boas ÷ total.
   * Se faltar ciclo ideal, cai para boas ÷ total.
   */
  readonly quality: number | null;
  /** Qualidade por contagem pura: boas ÷ total. */
  readonly qualityByCount: number | null;
  /** OEE = Σ(boas × ciclo) ÷ planejado = A × P × Q. */
  readonly oee: number | null;
}

/** Situação da performance para a interface (docs/07, "Performance > 100%"). */
export interface PerformanceStatus {
  /** Performance real acima de 100%. */
  readonly above100: boolean;
  /** Acima do limite de alerta (padrão 105%): "verificar ciclo ideal". */
  readonly reviewIdealCycle: boolean;
  /** Valor limitado a 100%, para quem optar por exibir assim. */
  readonly capped: number | null;
}
