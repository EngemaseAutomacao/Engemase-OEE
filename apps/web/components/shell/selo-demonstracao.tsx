import { FlaskConicalIcon } from "lucide-react"

import { modoDemonstracao } from "@/lib/server/db-url"

/**
 * Faixa do ambiente de demonstração (`ENGEMASE_DEMONSTRACAO=1`): deixa claro, em qualquer tela, que os
 * dados são simulados. Fica no topo, no fluxo da página (não cobre nada e sai ao rolar). No sistema real
 * não aparece.
 */
export function SeloDemonstracao() {
  if (!modoDemonstracao()) return null
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-1.5 border-b border-amber-500/30 bg-amber-50 px-4 py-1 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Ambiente de demonstração</strong> · dados simulados, nada aqui é de cliente real
      </span>
    </div>
  )
}
