import Link from "next/link"
import { ArrowRightIcon, LifeBuoyIcon } from "lucide-react"

/**
 * Cartão de ajuda no rodapé do menu lateral (some quando o menu está recolhido).
 * Fundo azul-escuro com a grade técnica da apresentação: o texto branco/80 fica com 5,3:1 ou mais.
 */
export function HelpCard({ href }: { href: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-brand-blue-dark via-(--ui-ink-mid) to-(--ui-ink) p-4 text-white shadow-lg ring-1 ring-white/10 group-data-[collapsible=icon]:hidden">
      <div className="ui-grade pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -top-14 -right-14 size-28 rounded-full bg-brand-blue/25 blur-2xl" aria-hidden />
      <LifeBuoyIcon className="pointer-events-none absolute -right-3 -bottom-3 size-20 text-white opacity-[0.07]" aria-hidden />
      <div className="relative">
        <div className="text-sm font-semibold">Precisa de ajuda?</div>
        <p className="mt-1 text-xs leading-relaxed text-white/80">Guias de OEE e Modbus, perguntas frequentes e suporte da Engemase.</p>
        <Link
          href={href}
          className="group/link mt-3 flex h-9 items-center justify-between rounded-lg bg-white px-3 text-xs font-semibold text-[#1d5a86] shadow-sm transition-[background-color,box-shadow] duration-200 hover:bg-white/90 hover:shadow-md focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-(--ui-ink-mid) focus-visible:outline-none"
        >
          Central de ajuda
          <ArrowRightIcon className="size-4 transition-transform duration-200 ease-(--ui-ease) group-hover/link:translate-x-0.5" />
        </Link>
      </div>
    </div>
  )
}
