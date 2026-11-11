"use client"

import { BarChart3Icon, CogIcon, FactoryIcon, LayoutDashboardIcon, MoonIcon, SunIcon } from "lucide-react"

import type { MachineState } from "@/lib/mock/types"
import { STATE_META } from "@/lib/states"
import type { ModeTokens } from "@/components/settings/brand-color"
import type { PreviewMachine } from "@/components/settings/types"

/** Superfícies do tema (copiadas de app/globals.css) para a prévia não depender do tema atual da tela. */
const SURFACE = {
  light: { bg: "#f3f6f9", card: "#ffffff", fg: "#13253a", muted: "#edf2f7", mutedFg: "#5a6b7e", border: "#dbe4ee" },
  dark: { bg: "#0d1723", card: "#132131", fg: "#e7eef6", muted: "#1c2f45", mutedFg: "#93a5b9", border: "rgb(255 255 255 / 9%)" },
} as const

/** Cores de estado travadas (iguais em todos os clientes); no escuro, as versões claras do tema. */
const STATE_COLOR: Record<"light" | "dark", Partial<Record<MachineState, string>>> = {
  light: { RUNNING: STATE_META.RUNNING.hex, STOPPED: STATE_META.STOPPED.hex, FAULT: STATE_META.FAULT.hex, SETUP: STATE_META.SETUP.hex },
  dark: {
    RUNNING: "oklch(0.723 0.219 149.579)",
    STOPPED: "oklch(0.828 0.189 84.429)",
    FAULT: "oklch(0.637 0.237 25.331)",
    SETUP: "oklch(0.702 0.183 293.541)",
  },
}

const NAV = [
  { icon: LayoutDashboardIcon, label: "Visão geral" },
  { icon: FactoryIcon, label: "Máquinas" },
  { icon: BarChart3Icon, label: "Relatórios" },
  { icon: CogIcon, label: "Configurações" },
]

export interface PreviewLogo {
  url: string
  name: string
}

export function BrandPreview({
  theme,
  tokens,
  displayName,
  machine,
  logo,
  symbol,
}: {
  theme: "light" | "dark"
  tokens: ModeTokens
  displayName: string
  machine: PreviewMachine
  /** Logotipo horizontal adequado ao fundo do menu. */
  logo?: PreviewLogo
  symbol?: PreviewLogo
}) {
  const s = SURFACE[theme]
  const st = STATE_COLOR[theme]
  const short = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")

  const segments: { state: MachineState; w: number }[] = [
    { state: "RUNNING", w: 38 },
    { state: "STOPPED", w: 8 },
    { state: "RUNNING", w: 22 },
    { state: "FAULT", w: 6 },
    { state: "SETUP", w: 10 },
    { state: "RUNNING", w: 16 },
  ]

  return (
    <figure className="grid gap-2">
      <figcaption className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {theme === "light" ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
        Tema {theme === "light" ? "claro" : "escuro"}
      </figcaption>
      <div className="grid grid-cols-[104px_1fr] overflow-hidden rounded-xl border shadow-xs sm:grid-cols-[124px_1fr]" style={{ background: s.bg, color: s.fg, borderColor: s.border }} aria-hidden>
        {/* menu */}
        <div className="flex min-w-0 flex-col gap-1 p-2" style={{ background: tokens.sidebar, color: tokens.sidebarFg }}>
          <div className="mb-2 flex min-w-0 items-center gap-1.5 px-1 py-1">
            {logo ? (
              <span className="h-6 w-full bg-contain bg-left bg-no-repeat" style={{ backgroundImage: `url(${logo.url})` }} />
            ) : (
              <>
                {symbol ? (
                  <span className="size-6 shrink-0 rounded-md bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${symbol.url})` }} />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold" style={{ background: tokens.primary, color: tokens.onPrimary }}>
                    {short || "OEE"}
                  </span>
                )}
                <span className="truncate text-[10px] leading-tight font-semibold">{displayName || "Nome exibido"}</span>
              </>
            )}
          </div>
          {NAV.map((n, i) => (
            <span
              key={n.label}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px]"
              style={i === 0 ? { background: tokens.sidebarActiveBg, color: tokens.sidebarActiveFg, fontWeight: 600 } : { opacity: 0.85 }}
            >
              <n.icon className="size-3 shrink-0" />
              <span className="truncate">{n.label}</span>
            </span>
          ))}
        </div>

        {/* conteúdo */}
        <div className="flex min-w-0 flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-bold">Visão geral</span>
            <span className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold" style={{ background: tokens.primary, color: tokens.onPrimary }}>
              Classificar parada
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="font-semibold underline-offset-2" style={{ color: tokens.primary, textDecoration: "underline" }}>
              Ver relatório
            </span>
            <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ background: `color-mix(in oklab, ${tokens.primary} 14%, transparent)`, color: tokens.primary }}>
              1º turno
            </span>
            <span className="rounded-md border px-1.5 py-0.5" style={{ borderColor: s.border, background: s.card }}>
              Filtros
            </span>
          </div>

          <div className="rounded-lg p-2" style={{ background: s.card }}>
            <div className="mb-1 flex justify-between text-[10px]">
              <span style={{ color: s.mutedFg }}>Meta de OEE do mês</span>
              <span className="font-bold tabular-nums">82%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: s.muted }}>
              <div className="h-full rounded-full" style={{ width: "82%", background: tokens.primary }} />
            </div>
          </div>

          <div className="rounded-lg p-2" style={{ background: s.card, boxShadow: `inset 3px 0 0 ${st.RUNNING}` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[11px] font-semibold">{machine.name}</div>
                <div className="truncate text-[9px]" style={{ color: s.mutedFg }}>
                  {machine.line}
                </div>
              </div>
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: `color-mix(in oklab, ${st.RUNNING} 15%, transparent)`, color: st.RUNNING }}
              >
                <span className="size-1.5 rounded-full" style={{ background: st.RUNNING }} />
                Produzindo
              </span>
            </div>
            <div className="mt-1.5 flex items-end justify-between">
              <span className="text-base leading-none font-bold tabular-nums">78,4%</span>
              <span className="text-[9px]" style={{ color: s.mutedFg }}>
                OEE do turno
              </span>
            </div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-sm">
              {segments.map((g, i) => (
                <span key={i} style={{ width: `${g.w}%`, background: st[g.state] }} />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]" style={{ color: s.mutedFg }}>
              {(["RUNNING", "STOPPED", "FAULT", "SETUP"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: st[k] }} />
                  {STATE_META[k].short}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}
