/**
 * Utilitários PUROS dos relatórios (formatação, cores por faixa e categoria).
 * Seguros em componentes de servidor e de cliente: não acessam o relógio.
 */
import type { ReasonCategory } from "@/lib/mock/types"
import { dec, num, shortDate } from "@/lib/format"
import { STATE_META } from "@/lib/states"

export type PeriodDays = 7 | 14

/** Minutos → horas-máquina: "7,5 h" ou "1.680 h" (acima de 100 h, sem decimal). */
export function hours(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "—"
  const h = min / 60
  return Math.abs(h) >= 100 ? `${num(h)} h` : `${dec(h)} h`
}

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]

/** "2026-11-03" → "ter 03/11" (determinístico, sem fuso). */
export function dayLabel(ymd: string): string {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return `${WEEKDAY[wd]} ${shortDate(ymd)}`
}

/** Soma dias a uma data "YYYY-MM-DD" (determinístico). */
export function addDays(ymd: string, delta: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

/** Intervalo legível de um período que termina em `endYmd`: "28/10 a 10/11/2026". */
export function rangeLabel(startYmd: string, endYmd: string): string {
  const [y] = endYmd.split("-")
  return `${shortDate(startYmd)} a ${shortDate(endYmd)}/${y}`
}

/** Pílula colorida por faixa de OEE (fundo suave + texto), usada nas tabelas. */
export const TONE_PILL = {
  good: "bg-state-running/12 text-state-running",
  warn: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  bad: "bg-state-fault/12 text-state-fault",
  none: "bg-muted text-muted-foreground",
} as const

/** Categorias de motivo de parada: rótulos e cores (mesmas cores dos estados correspondentes). */
export const CATEGORY_META: Record<
  ReasonCategory,
  { label: string; plural: string; hex: string; dot: string; soft: string; text: string }
> = {
  unplanned: {
    label: "Não planejada",
    plural: "Não planejadas",
    hex: STATE_META.STOPPED.hex,
    dot: STATE_META.STOPPED.dot,
    soft: STATE_META.STOPPED.soft,
    text: STATE_META.STOPPED.text,
  },
  setup: {
    label: "Setup",
    plural: "Setup / troca",
    hex: STATE_META.SETUP.hex,
    dot: STATE_META.SETUP.dot,
    soft: STATE_META.SETUP.soft,
    text: STATE_META.SETUP.text,
  },
  planned: {
    label: "Planejada",
    plural: "Planejadas",
    hex: STATE_META.PLANNED_STOP.hex,
    dot: STATE_META.PLANNED_STOP.dot,
    soft: STATE_META.PLANNED_STOP.soft,
    text: STATE_META.PLANNED_STOP.text,
  },
}

export const CATEGORY_ORDER: ReasonCategory[] = ["unplanned", "setup", "planned"]

/** Paradas que o operador não classificou (motivo pendente). */
export const UNCLASSIFIED_ID = "sem-motivo"
export const UNCLASSIFIED_NAME = "Sem motivo informado"
export const UNCLASSIFIED_HEX = "#a1a1aa"

/** Linha de tooltip HTML dos gráficos (rótulo à esquerda, valor à direita). */
export function tooltipRow(marker: string, name: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${marker}${name}</span><b style="font-variant-numeric:tabular-nums">${value}</b></div>`
}

export function tooltipHead(text: string): string {
  return `<div style="margin-bottom:4px;font-weight:600">${text}</div>`
}

/** Bolinha colorida para tooltips (equivalente ao `marker` do ECharts). */
export function tooltipDot(color: string): string {
  return `<span style="display:inline-block;margin-right:6px;width:8px;height:8px;border-radius:2px;background:${color}"></span>`
}
