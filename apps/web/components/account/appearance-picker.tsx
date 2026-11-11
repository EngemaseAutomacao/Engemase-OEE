"use client"

import { useSyncExternalStore } from "react"
import type { LucideIcon } from "lucide-react"
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"

type ThemeValue = "light" | "dark" | "system"

const OPTIONS: { value: ThemeValue; label: string; text: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", text: "Fundo claro, ideal para escritório e ambientes iluminados", icon: SunIcon },
  { value: "dark", label: "Escuro", text: "Menos brilho em salas de controle e no turno da noite", icon: MoonIcon },
  { value: "system", label: "Automático", text: "Segue o tema do sistema operacional (padrão)", icon: MonitorIcon },
]

const PALETTE = {
  light: { bg: "#f3f6f9", side: "#2c4e73", card: "#ffffff", line: "#e3e8ef", text: "#cbd5e1", accent: "#257bb4" },
  dark: { bg: "#0d1723", side: "#172b42", card: "#15222f", line: "#223244", text: "#334155", accent: "#4a9fd6" },
}

/** Miniatura da interface (cores fixas, independentes do tema atual). */
function Mini({ mode }: { mode: "light" | "dark" }) {
  const p = PALETTE[mode]
  return (
    <div className="flex h-full w-full" style={{ background: p.bg }}>
      <div className="flex w-[18%] flex-col gap-1 p-1.5" style={{ background: p.side }}>
        <span className="h-1.5 w-3/4 rounded-full bg-white/70" />
        <span className="mt-1 h-1 w-full rounded-full bg-white/25" />
        <span className="h-1 w-full rounded-full bg-white/25" />
        <span className="h-1 w-2/3 rounded-full bg-white/25" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-1.5 w-1/3 rounded-full" style={{ background: p.text }} />
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1 rounded-md p-1" style={{ background: p.card, boxShadow: `0 0 0 1px ${p.line}` }}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: i === 1 ? "#0e9384" : i === 2 ? "#e96549" : p.accent }} />
              <span className="h-1 flex-1 rounded-full" style={{ background: p.text }} />
            </div>
          ))}
        </div>
        <div className="flex flex-1 gap-1.5">
          <div className="flex flex-[2] items-end gap-0.5 rounded-md p-1.5" style={{ background: p.card, boxShadow: `0 0 0 1px ${p.line}` }}>
            {[40, 65, 50, 80, 60, 90, 70].map((h, i) => (
              <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 5 ? p.accent : p.line }} />
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center rounded-md" style={{ background: p.card, boxShadow: `0 0 0 1px ${p.line}` }}>
            <span className="size-5 rounded-full border-[3px]" style={{ borderColor: `#0e9384 ${p.line} ${p.line} #0e9384` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const subscribe = () => () => {}

/** Aparência: Claro, Escuro ou Automático em cartões grandes (next-themes). */
export function AppearancePicker() {
  const { theme, setTheme } = useTheme()
  // Só marca a opção ativa depois de montar no cliente (evita diferença de hidratação).
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const current = mounted ? ((theme as ThemeValue | undefined) ?? "system") : undefined

  function choose(o: (typeof OPTIONS)[number]) {
    if (o.value === current) return
    setTheme(o.value)
    toast.success(`Tema: ${o.label}`, { description: "Salvo neste navegador e no seu perfil." })
  }

  return (
    <SectionCard title="Aparência" description="Vale para você em todos os clientes. TV Andon e tablets do operador têm tema próprio.">
      <div role="radiogroup" aria-label="Tema da interface" className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = current === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(o)}
              className={cn(
                "group flex flex-col overflow-hidden rounded-2xl border text-left transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40 hover:shadow-sm",
              )}
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden border-b">
                {o.value === "system" ? (
                  <>
                    <div className="absolute inset-0">
                      <Mini mode="light" />
                    </div>
                    <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                      <Mini mode="dark" />
                    </div>
                  </>
                ) : (
                  <Mini mode={o.value} />
                )}
                {active && (
                  <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <CheckIcon className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="flex items-start gap-2.5 p-3">
                <o.icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="leading-tight">
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.text}</span>
                </span>
              </div>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">As cores da marca de cada cliente (quando configuradas) continuam valendo nos dois temas.</p>
    </SectionCard>
  )
}
