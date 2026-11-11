import Link from "next/link"
import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { num } from "@/lib/format"
import { Button } from "@/components/ui/button"

/** Atalho em destaque para o console da plataforma (só para a equipe Engemase). */
export function ConsoleShortcut({
  roleLabel,
  stats,
}: {
  roleLabel: string
  stats: { label: string; value: number; alert?: boolean }[]
}) {
  return (
    <section
      aria-labelledby="console-titulo"
      className="relative overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_100%_0%,color-mix(in_oklch,var(--sidebar-primary)_35%,transparent),transparent)]"
      />
      <div className="relative flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:gap-8 lg:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="console-titulo" className="text-lg font-semibold text-white">
                Console Engemase
              </h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">{roleLabel}</span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-sidebar-foreground/75">
              Cadastre clientes, defina planos e limites, ative gateways e acompanhe a saúde de todas as plantas em um só lugar.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:flex lg:gap-6">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="text-xs whitespace-nowrap text-sidebar-foreground/65">{s.label}</dt>
              <dd className={cn("text-xl font-semibold tabular-nums text-white", s.alert && s.value > 0 && "text-red-300")}>
                {num(s.value)}
              </dd>
            </div>
          ))}
        </dl>

        <Button asChild size="lg" className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 lg:shrink-0">
          <Link href="/admin">
            Abrir console
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </section>
  )
}
