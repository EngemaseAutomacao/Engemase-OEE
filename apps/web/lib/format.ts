/**
 * Formatação pt-BR. Sempre no fuso da planta (padrão America/Sao_Paulo).
 * Funções puras: seguras em componentes de servidor (não usam o relógio do sistema).
 */
import { DEFAULT_TZ, MOCK_NOW } from "@/lib/mock"

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 0.784 → "78,4%" */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

/** 3528 → "3.528" */
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return nf0.format(value)
}

export function dec(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return nf1.format(value)
}

/** segundos → "2h 05min", "14 min", "45 s" */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const totalMin = Math.floor(s / 60)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return `${h}h ${String(m).padStart(2, "0")}min`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Duração entre um ISO e "agora" do protótipo. */
export function since(isoStart: string, nowIso: string = MOCK_NOW): string {
  return duration((Date.parse(nowIso) - Date.parse(isoStart)) / 1000)
}

/** "há 5 min", "há 2h 10min" */
export function ago(iso: string | null | undefined, nowIso: string = MOCK_NOW): string {
  if (!iso) return "nunca"
  const s = (Date.parse(nowIso) - Date.parse(iso)) / 1000
  if (s < 30) return "agora"
  return `há ${duration(s)}`
}

/** "10:42" */
export function time(iso: string, tz = DEFAULT_TZ): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
}

/** "11/11/2026" */
export function date(iso: string, tz = DEFAULT_TZ): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: tz })
}

/** "11/11 10:42" */
export function dateTime(iso: string, tz = DEFAULT_TZ): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  })
}

/** "2026-11-10" → "10/11" */
export function shortDate(ymd: string): string {
  const [, mo, d] = ymd.split("-")
  return `${d}/${mo}`
}

/** Iniciais para avatar: "Ana Ribeiro" → "AR" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}
