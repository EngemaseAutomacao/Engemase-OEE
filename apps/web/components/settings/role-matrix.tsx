import { CheckIcon, LockIcon, MinusIcon } from "lucide-react"

import type { ClientRole } from "@/lib/mock/types"
import { CLIENT_ROLE_LABEL } from "@/lib/roles"
import { SectionCard } from "@/components/dashboard/section-card"

type Cell = "yes" | "no" | "engemase"

const COLS: ClientRole[] = ["client_admin", "engineer", "supervisor", "operator", "viewer"]
const SHORT: Record<ClientRole, string> = { client_admin: "Admin", engineer: "Eng.", supervisor: "Superv.", operator: "Oper.", viewer: "Visual." }

/** Resumo de docs/05 (RBAC) e docs/15 (papéis e escopo), com as decisões D11, D12 e D13. */
const ROWS: { label: string; cells: Cell[] }[] = [
  { label: "Dashboards e relatórios (no seu escopo)", cells: ["yes", "yes", "yes", "yes", "yes"] },
  { label: "Classificar paradas, lançar refugo e trocar produto", cells: ["yes", "yes", "yes", "yes", "no"] },
  { label: "Saúde dos gateways, conexões com os CLPs e tags (leitura)", cells: ["yes", "yes", "no", "no", "no"] },
  { label: "Usuários do cliente: convidar, papéis, escopos e desativar", cells: ["yes", "no", "no", "no", "no"] },
  { label: "Aprovar sessões de acesso remoto aos gateways", cells: ["yes", "no", "no", "no", "no"] },
  {
    label: "Configuração: unidades, linhas, máquinas, gateways, tags, terminais, turnos, produtos, motivos e aparência",
    cells: ["engemase", "engemase", "engemase", "engemase", "engemase"],
  },
]

function Mark({ cell }: { cell: Cell }) {
  if (cell === "yes")
    return (
      <span className="mx-auto flex size-6 items-center justify-center rounded-full bg-state-running/12 text-state-running" aria-label="Sim">
        <CheckIcon className="size-3.5" />
      </span>
    )
  if (cell === "engemase")
    return (
      <span
        className="mx-auto flex size-6 items-center justify-center rounded-full bg-[#2c4e73]/10 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]"
        aria-label="Só a equipe Engemase (o cliente vê, sem editar)"
        title="Só a equipe Engemase: o cliente vê, sem editar"
      >
        <LockIcon className="size-3" />
      </span>
    )
  return (
    <span className="mx-auto flex size-6 items-center justify-center text-muted-foreground/60" aria-label="Não">
      <MinusIcon className="size-3.5" />
    </span>
  )
}

export function RoleMatrix({ className }: { className?: string }) {
  return (
    <SectionCard title="Quem vê o quê" description="Resumo das permissões de cada papel do cliente" className={className}>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-2 text-left font-medium">Ação</th>
              {COLS.map((r) => (
                <th key={r} className="w-14 px-1 py-2 text-center font-medium" title={CLIENT_ROLE_LABEL[r]}>
                  <abbr title={CLIENT_ROLE_LABEL[r]} className="no-underline">
                    {SHORT[r]}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td className="py-2 pr-2 leading-snug">{row.label}</td>
                {row.cells.map((c, i) => (
                  <td key={COLS[i]} className="px-1 py-2 text-center">
                    <Mark cell={c} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-2 leading-snug text-muted-foreground">Escopo</td>
              <td className="px-1 py-2 text-center text-[11px] font-medium">Cliente inteiro</td>
              <td colSpan={4} className="px-1 py-2 text-center text-[11px] text-muted-foreground">
                Todo o cliente, unidades ou máquinas
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="mt-3 grid gap-1 text-[11px] leading-snug text-muted-foreground">
        <li className="flex items-start gap-1">
          <LockIcon className="mt-0.5 size-3 shrink-0" /> Configurado pela Engemase: a equipe Engemase (super admin e engenheiro de campo) faz toda a configuração. O cliente
          vê, sem editar; pedidos de mudança vão por chamado.
        </li>
        <li>Escopo por máquina: só as máquinas listadas. Nenhuma máquina listada = nenhum acesso.</li>
        <li>Totais, relatórios, auditoria e exportações respeitam o escopo: quem vê só algumas unidades ou máquinas nunca vê números que incluam outras.</li>
        <li>TV Andon e tablets não são pessoas: são terminais pareados e só mostram as linhas ou máquinas escolhidas no pareamento.</li>
      </ul>
    </SectionCard>
  )
}
