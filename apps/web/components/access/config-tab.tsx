"use client"

import { CheckCircle2Icon, CloudUploadIcon, HardDriveDownloadIcon, HistoryIcon, MinusIcon, PencilIcon, PlusIcon, RefreshCwIcon, Undo2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { useCanEdit } from "@/components/config/engemase-managed"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { ConfigChange } from "./gateway-data"
import type { ConfigVersionVM } from "./gateway-detail-data"
import { Chip } from "./status-chip"

const CHANGE_STYLE: Record<ConfigChange["kind"], { icon: typeof PlusIcon; className: string; label: string }> = {
  add: { icon: PlusIcon, className: "bg-state-running/12 text-state-running", label: "Inclusão" },
  change: { icon: PencilIcon, className: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped", label: "Alteração" },
  remove: { icon: MinusIcon, className: "bg-state-fault/12 text-state-fault", label: "Remoção" },
}

function RevertButton({ v, next, onRevert }: { v: number; next: number; onRevert: (v: number) => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <Undo2Icon />
          Reverter para v{v}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverter para a v{v}?</AlertDialogTitle>
          <AlertDialogDescription>
            Será publicada a v{next} com o mesmo conteúdo da v{v}. Nenhuma versão é apagada: o histórico continua completo. O gateway aplica a nova versão no
            próximo sincronismo e a alteração fica registrada na auditoria.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => onRevert(v)}>Publicar v{next}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Aba "Configuração": versão publicada × aplicada, histórico com diff resumido e reverter. */
export function ConfigTab({
  versions,
  published,
  applied,
  offline,
  reloading,
  onReload,
  onRevert,
}: {
  versions: ConfigVersionVM[]
  published: number
  applied: number | null
  offline: boolean
  reloading: boolean
  onReload: () => void
  onRevert: (v: number) => void
}) {
  const synced = applied !== null && applied >= published
  const current = versions.find((v) => v.version === published)
  const canEdit = useCanEdit()

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <SectionCard title="Versões" description="Plataforma × gateway" className="xl:col-span-4">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CloudUploadIcon className="size-3.5" />
                Publicada
              </div>
              <div className="text-2xl font-bold tabular-nums">v{published}</div>
              <div className="truncate text-[11px] text-muted-foreground">{current ? `${current.author} · ${current.publishedAgo}` : "—"}</div>
            </div>
            <div className={cn("rounded-xl p-3", synced ? "bg-state-running/10" : "bg-state-stopped/12")}>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <HardDriveDownloadIcon className="size-3.5" />
                Aplicada no gateway
              </div>
              <div className={cn("text-2xl font-bold tabular-nums", !synced && "text-amber-700 dark:text-state-stopped")}>
                {applied !== null ? `v${applied}` : "—"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {synced ? "Em uso agora" : offline ? "Último valor reportado" : "Aguardando aplicação"}
              </div>
            </div>
          </div>

          {synced ? (
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-state-running" />
              <span>
                Sincronizada. O gateway está rodando exatamente a configuração publicada.
                {offline && <span className="text-muted-foreground"> (conforme o último contato)</span>}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              A v{published} foi publicada e o gateway ainda usa a {applied !== null ? `v${applied}` : "configuração inicial"}.{" "}
              {offline ? "Ele aplica quando voltar a sincronizar." : "Normalmente ele aplica no próximo sincronismo; se demorar, force a recarga."}
            </p>
          )}

          {canEdit && (
            <Button variant={synced ? "outline" : "default"} onClick={onReload} disabled={reloading} className="w-full">
              {reloading ? <Spinner /> : <RefreshCwIcon />}
              {reloading ? "Recarregando…" : "Forçar recarga da configuração"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Cada publicação gera uma versão imutável. O gateway baixa a versão nova no sincronismo, valida e confirma a aplicação; se a validação falhar, ele
            continua na versão anterior.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Histórico de versões" description="Diff resumido de cada publicação" className="xl:col-span-8">
        <ol className="flex flex-col gap-3">
          {versions.map((v) => {
            const isPublished = v.version === published
            const isApplied = v.version === applied
            return (
              <li key={v.version} className="flex gap-3">
                <IconCircle icon={v.revertOf ? Undo2Icon : HistoryIcon} tone={isPublished ? "blue" : "slate"} soft size="sm" />
                <div className="min-w-0 flex-1 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">v{v.version}</span>
                      {isPublished && <Chip className="bg-primary/10 text-primary">Publicada</Chip>}
                      {isApplied && <Chip className="bg-state-running/12 text-state-running">Em uso no gateway</Chip>}
                      {isPublished && !isApplied && <Chip className="bg-state-stopped/15 text-amber-700 dark:text-state-stopped">Pendente no gateway</Chip>}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {v.author} · {v.publishedLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{v.revertOf ? `Reversão para a v${v.revertOf}` : v.summary}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {v.changes.map((c) => {
                      const st = CHANGE_STYLE[c.kind]
                      const Icon = st.icon
                      return (
                        <li key={c.text} className="flex items-start gap-2 text-xs">
                          <span className={cn("mt-px flex size-4 shrink-0 items-center justify-center rounded", st.className)} aria-label={st.label}>
                            <Icon className="size-3" />
                          </span>
                          <span className="min-w-0">{c.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {canEdit && !isPublished && (
                    <div className="mt-2 flex justify-end border-t pt-2">
                      <RevertButton v={v.version} next={published + 1} onRevert={onRevert} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </SectionCard>
    </div>
  )
}
