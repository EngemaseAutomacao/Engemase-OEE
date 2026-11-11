import Link from "next/link"
import { ArrowRightIcon, LifeBuoyIcon } from "lucide-react"

/** Cartão de ajuda no rodapé do menu lateral (some quando o menu está recolhido). */
export function HelpCard({ href }: { href: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#2b8cc4] via-[#257bb4] to-[#1d5a86] p-4 text-white shadow-lg ring-1 ring-white/10 group-data-[collapsible=icon]:hidden">
      <LifeBuoyIcon className="absolute -right-3 -bottom-3 size-20 opacity-10" aria-hidden />
      <div className="text-sm font-semibold">Precisa de ajuda?</div>
      <p className="mt-1 text-xs leading-relaxed text-white/80">Guias de OEE e Modbus, perguntas frequentes e suporte da Engemase.</p>
      <Link
        href={href}
        className="mt-3 flex h-9 items-center justify-between rounded-lg bg-white px-3 text-xs font-semibold text-[#1d5a86] shadow-sm transition hover:bg-white/90"
      >
        Central de ajuda
        <ArrowRightIcon className="size-4" />
      </Link>
    </div>
  )
}
