"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArchiveXIcon, ChevronLeftIcon, CopyIcon, MoreHorizontalIcon, PauseCircleIcon, PencilIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ClientStatusBadge, ManagementBadge, PlanBadge } from "./bits"
import { useClientDetail } from "./client-detail-context"
import { ClientEditSheet } from "./client-edit-sheet"
import { EnterClientButton } from "./enter-client"
import { ACTION_META, ACTION_RESULT, LifecycleDialog, actionsFor, lifecycleToast, type LifecycleAction } from "./lifecycle-dialogs"
import { PLATFORM_HOST } from "./labels"

/** Cabeçalho do detalhe do cliente: identidade, badges e ações (entrar, editar, ciclo de vida). */
export function ClientDetailHeader({
  slug,
  cnpj,
  city,
  state,
  createdAt,
  brandColor,
}: {
  slug: string
  cnpj: string
  city: string
  state: string
  createdAt: string
  brandColor: string
}) {
  const { status, info } = useClientDetail()
  const [editOpen, setEditOpen] = useState(false)
  const [editKey, setEditKey] = useState(0)
  const openEdit = () => {
    setEditKey((k) => k + 1)
    setEditOpen(true)
  }
  const { run, dialog } = useLifecycle(info.name, slug)
  const actions = actionsFor(status)
  const primary = actions.find((a) => a !== "close")
  const PrimaryIcon = primary ? ACTION_META[primary].icon : null
  const initials = info.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()

  const copyUrl = () => {
    void navigator.clipboard?.writeText(`https://${PLATFORM_HOST}/${slug}`)
    toast.success("Endereço copiado", { description: `https://${PLATFORM_HOST}/${slug}` })
  }

  return (
    <div className="flex flex-col gap-3">
      <Link href="/admin/clientes" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline">
        <ChevronLeftIcon className="size-3.5" />
        Clientes
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-sm" style={{ background: brandColor }} aria-hidden>
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{info.name}</h1>
              <ClientStatusBadge status={status} />
              <PlanBadge plan={info.plan} />
              <ManagementBadge management={info.management} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span className="truncate">{info.legalName}</span>
              <span aria-hidden>·</span>
              <span className="font-mono text-xs">{cnpj}</span>
              <span aria-hidden>·</span>
              <span>
                {city}/{state}
              </span>
              <span aria-hidden>·</span>
              <span>cliente desde {createdAt}</span>
            </p>
            <button type="button" onClick={copyUrl} className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline">
              <span className="truncate font-mono">
                {PLATFORM_HOST}/{slug}
              </span>
              <CopyIcon className="size-3 shrink-0" aria-hidden />
              <span className="sr-only">Copiar endereço</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          {status !== "closed" && <EnterClientButton client={{ name: info.name, slug }} />}
          <Button variant="outline" onClick={openEdit} disabled={status === "closed"}>
            <PencilIcon />
            Editar
          </Button>
          {primary && (
            <Button variant="outline" onClick={() => run(primary)} className={cn(primary === "suspend" && "text-amber-700 dark:text-state-stopped")}>
              {PrimaryIcon && <PrimaryIcon />}
              {ACTION_META[primary].label}
            </Button>
          )}
          {actions.includes("close") && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Mais ações">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={copyUrl}>
                  <CopyIcon />
                  Copiar endereço
                </DropdownMenuItem>
                {actions
                  .filter((a) => a !== primary && a !== "close")
                  .map((a) => {
                    const Icon = ACTION_META[a].icon
                    return (
                      <DropdownMenuItem key={a} onSelect={() => run(a)}>
                        <Icon />
                        {ACTION_META[a].label}
                      </DropdownMenuItem>
                    )
                  })}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => run("close")}>
                  <ArchiveXIcon />
                  Encerrar cliente
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {status === "suspended" && (
        <div className="flex items-start gap-3 rounded-2xl border border-state-stopped/40 bg-state-stopped/10 px-4 py-3 text-sm">
          <PauseCircleIcon className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-state-stopped" aria-hidden />
          <p>
            <strong className="font-semibold">Cliente suspenso.</strong> Os usuários do cliente não acessam a plataforma, mas os gateways continuam enviando dados e nada se perde. A
            Engemase continua acessando, com registro.
          </p>
        </div>
      )}
      {status === "closed" && (
        <div className="flex items-start gap-3 rounded-2xl border bg-muted/60 px-4 py-3 text-sm">
          <ArchiveXIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <strong className="font-semibold">Encerramento em andamento.</strong> Exportação completa em preparação; 30 dias para o cliente baixar e mais 30 de carência antes da
            exclusão definitiva. O identificador “{slug}” não será reaproveitado.
          </p>
        </div>
      )}

      <ClientEditSheet open={editOpen} formKey={editKey} onOpenChange={setEditOpen} slug={slug} cnpj={cnpj} />
      {dialog}
    </div>
  )
}

/** Ações de ciclo de vida com diálogo de confirmação, compartilhadas pelo cabeçalho e pela aba Ciclo de vida. */
export function useLifecycle(name: string, slug: string) {
  const { setStatus, addEvent } = useClientDetail()
  const [state, setState] = useState<{ action: LifecycleAction | null; nonce: number; open: boolean }>({ action: null, nonce: 0, open: false })

  const run = (action: LifecycleAction) => setState((s) => ({ action, nonce: s.nonce + 1, open: true }))

  const confirm = (action: LifecycleAction, reason: string | null) => {
    setStatus(ACTION_RESULT[action])
    const t = lifecycleToast(action, name)
    addEvent({ title: t.title, subtitle: `Ana Ribeiro${reason ? ` · motivo: ${reason}` : ""}`, at: "agora" })
    toast.success(t.title, { description: t.description })
    setState((s) => ({ ...s, open: false }))
  }

  const dialog = (
    <LifecycleDialog
      open={state.open}
      action={state.action}
      nonce={state.nonce}
      client={{ name, slug }}
      onOpenChange={(open) => setState((s) => ({ ...s, open }))}
      onConfirm={confirm}
    />
  )
  return { run, dialog }
}
