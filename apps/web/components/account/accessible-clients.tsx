import Link from "next/link"
import { ArrowUpRightIcon, Building2Icon, ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

import type { AccessibleClientVM } from "./account-data"
import { plural } from "./labels"

const STATUS_BADGE: Record<AccessibleClientVM["status"], string> = {
  active: "bg-state-running/12 text-state-running",
  onboarding: "bg-primary/10 text-primary",
  suspended: "bg-state-fault/12 text-state-fault",
}

const AVATAR = ["bg-[#257bb4]", "bg-[#2c4e73]", "bg-[#0e9384]", "bg-[#e96549]"]

/** Clientes que o usuário pode acessar, com o tipo de acesso e o escopo. */
export function AccessibleClients({ clients, isPlatform }: { clients: AccessibleClientVM[]; isPlatform: boolean }) {
  return (
    <SectionCard
      title="Clientes a que tenho acesso"
      description={plural(clients.length, "cliente", "clientes")}
      href={isPlatform ? "/admin/clientes" : undefined}
      linkLabel="Console Engemase"
    >
      {isPlatform && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl bg-[#2c4e73]/8 p-3 text-xs text-[#2c4e73] dark:bg-white/5 dark:text-[#9cc3e6]">
          <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
          <p>
            Como equipe Engemase, você não é membro dos clientes: o acesso vem do seu papel na plataforma. Cada entrada aparece com faixa na tela e fica na auditoria
            visível ao cliente.
          </p>
        </div>
      )}
      {clients.length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle className="text-base">Nenhum cliente liberado</EmptyTitle>
            <EmptyDescription>Peça ao administrador da sua empresa para liberar seu acesso.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">
                  Cliente
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Situação
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Porte
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Seu acesso
                </th>
                <th scope="col" className="pb-2">
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients.map((c, i) => (
                <tr key={c.id}>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white", AVATAR[i % AVATAR.length])}>
                        {c.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")}
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.place} · plano {c.plan}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", STATUS_BADGE[c.status])}>{c.statusLabel}</span>
                    {c.gatewaysProblem > 0 && (
                      <span className="mt-1 block text-[11px] whitespace-nowrap text-state-fault">{plural(c.gatewaysProblem, "gateway com problema", "gateways com problema")}</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {plural(c.units, "unidade", "unidades")}
                    <br />
                    {plural(c.machines, "máquina", "máquinas")}
                  </td>
                  <td className="py-3 pr-3 leading-tight">
                    <span className="block text-sm">{c.access}</span>
                    <span className="block text-xs text-muted-foreground">{c.scope}</span>
                  </td>
                  <td className="py-3 text-right">
                    <Link
                      href={`/${c.slug}`}
                      aria-label={`Abrir ${c.name}`}
                      title="Abrir"
                      className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20"
                    >
                      <ArrowUpRightIcon className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
