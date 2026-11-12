"use client"

import { createContext, useContext } from "react"
import Link from "next/link"
import { LifeBuoyIcon, LockIcon, ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Quem edita a configuração do cliente (decisões D12 e D13): SÓ a equipe Engemase (super admin ou
 * engenheiro de campo). O cliente vê as mesmas telas, sem as ações de edição.
 * As páginas de /[cliente]/config resolvem a permissão no servidor (`getConfigAccess`) e passam aqui.
 * Fail-closed: sem o provedor, nada é editável.
 */
const CanEditContext = createContext(false)

export function ConfigAccessProvider({ canEdit, children }: { canEdit: boolean; children: React.ReactNode }) {
  return <CanEditContext.Provider value={canEdit}>{children}</CanEditContext.Provider>
}

/** `true` quando o usuário atual pode editar a configuração (equipe Engemase). */
export const useCanEdit = () => useContext(CanEditContext)

/** Mostra o conteúdo (botões e menus de edição) só para a equipe Engemase. */
export function EditOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{useCanEdit() ? children : fallback}</>
}

/** Selo ao lado das ações de edição: deixa claro que são exclusivas da equipe Engemase. */
export function EngemaseOnlyChip({ className }: { className?: string }) {
  if (!useCanEdit()) return null
  return (
    <span
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium whitespace-nowrap text-muted-foreground shadow-xs", className)}
      title="Só a equipe Engemase edita esta configuração. O cliente vê, sem editar."
    >
      <ShieldCheckIcon className="size-4 shrink-0 text-[#0e9384]" aria-hidden />
      Edição só da equipe Engemase
    </span>
  )
}

/**
 * Faixa "Configurado pela Engemase" no topo das telas de configuração do cliente.
 * `subject`: o que a tela configura, no plural (ex.: "Unidades, áreas e linhas").
 * `padded`: para páginas cujo conteúdo já traz o próprio espaçamento (a faixa ganha o mesmo recuo).
 */
export function EngemaseManagedNote({ subject, clientSlug, padded = false, className }: { subject: string; clientSlug: string; padded?: boolean; className?: string }) {
  const canEdit = useCanEdit()
  const note = (
    <div
      role="note"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-[#0e9384]/30 bg-[#0e9384]/6 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0e9384]/14 text-[#0e9384]">
          {canEdit ? <ShieldCheckIcon className="size-4" aria-hidden /> : <LockIcon className="size-3.5" aria-hidden />}
        </span>
        <p className="min-w-0 leading-snug">
          <span className="font-semibold">Configurado pela Engemase.</span>{" "}
          <span className="text-muted-foreground">
            {canEdit
              ? `${subject}: só a equipe Engemase edita. Você está como equipe Engemase; cada alteração fica na auditoria visível ao cliente.`
              : `${subject} são configurados pela equipe Engemase. Aqui você consulta; para pedir uma mudança, abra um chamado.`}
          </span>
        </p>
      </div>
      {!canEdit && (
        <Link
          href={`/${clientSlug}/ajuda`}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 sm:self-auto"
        >
          <LifeBuoyIcon className="size-3.5" aria-hidden />
          Abrir chamado
        </Link>
      )}
    </div>
  )
  return padded ? <div className="px-4 pt-4 md:px-6 md:pt-6">{note}</div> : note
}
