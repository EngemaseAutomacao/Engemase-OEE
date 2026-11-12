import Link from "next/link"
import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { BrandWatermark } from "@/components/shell/brand"

/** Atalho em destaque para o console da plataforma (só para a equipe Engemase). */
export function ConsoleShortcut({ roleLabel }: { roleLabel: string }) {
  return (
    <section
      aria-labelledby="console-titulo"
      className="relative isolate overflow-hidden rounded-2xl bg-[#2c4e73] text-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:bg-[#172b42] dark:ring-1 dark:ring-white/10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_140%_at_100%_0%,rgba(37,123,180,0.55),transparent),radial-gradient(40%_120%_at_0%_100%,rgba(233,101,73,0.22),transparent)]"
      />
      <BrandWatermark className="absolute -right-10 -bottom-16 -z-10 w-[300px] opacity-25 dark:opacity-15" />
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:gap-6 md:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <IconCircle icon={ShieldCheckIcon} tone="blue" size="lg" className="ring-4 ring-white/10" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="console-titulo" className="text-lg font-bold">
                Console Engemase
              </h2>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{roleLabel}</span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-white/75">
              Cadastre clientes, defina planos e limites, ative gateways, conceda acesso remoto e acompanhe a saúde de todas as plantas em um só lugar.
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="bg-white text-[#2c4e73] hover:bg-white/90 md:shrink-0">
          <Link href="/admin">
            Abrir console
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </section>
  )
}
