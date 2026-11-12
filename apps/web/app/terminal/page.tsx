import type { Metadata } from "next"
import Link from "next/link"
import { MonitorIcon, TabletIcon, LinkIcon } from "lucide-react"

import { getClientById, getTerminal, terminalParams } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { BrandLogo, BrandWatermark } from "@/components/shell/brand"

export const metadata: Metadata = { title: "Terminal" }

/**
 * Entrada do terminal. Na versão real, o servidor lê o token do aparelho e abre direto a tela pareada
 * (Andon da linha ou tela do operador). Sem token → manda para /terminal/parear.
 * Protótipo: não há token; mostramos o estado "não pareado" e atalhos para simular aparelhos já pareados.
 */
export default function Page() {
  const demo = terminalParams()
    .map(({ terminalId }) => getTerminal(terminalId)!)
    .filter((t) => t.status !== "pending")
    .map((t) => ({ ...t, clientName: getClientById(t.clientId)?.name ?? "" }))

  return (
    <main className="dark relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#13263b] px-4 py-10 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_0%_0%,rgba(37,123,180,0.35),transparent),radial-gradient(55%_45%_at_100%_100%,rgba(233,101,73,0.18),transparent)]"
      />
      <BrandWatermark className="absolute -right-24 -bottom-20 -z-10 w-[560px] opacity-[0.10]" />

      <div className="w-full max-w-xl text-center">
        <BrandLogo variant="selo" width={88} priority className="mx-auto rounded-full shadow-lg ring-4 ring-white/10" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">Este aparelho não está pareado</h1>
        <p className="mt-2 text-muted-foreground">
          Peça a um administrador para gerar um código em <strong className="text-white">Configurações → Terminais</strong> e digite-o aqui.
          O aparelho passa a abrir direto na tela da linha ou da máquina.
        </p>
        <Button asChild size="lg" className="mt-6 h-12 px-6 text-base">
          <Link href="/terminal/parear">
            <LinkIcon />
            Parear este aparelho
          </Link>
        </Button>
      </div>

      <section className="mt-12 w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-white">Protótipo: simular um aparelho já pareado</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Na versão real, cada aparelho guarda o próprio token e esta lista não existe.</p>
        <ul className="mt-4 grid gap-2">
          {demo.map((t) => {
            const Icon = t.kind === "andon_tv" ? MonitorIcon : TabletIcon
            return (
              <li key={t.id}>
                <Link
                  href={`/terminal/${t.id}`}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm transition-colors hover:bg-white/10"
                >
                  <Icon className="size-5 text-[#7fb4dc]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-white">{t.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{t.clientName}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
