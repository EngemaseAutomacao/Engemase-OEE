"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  CalendarClockIcon,
  ClipboardCheckIcon,
  CornerDownRightIcon,
  FolderTreeIcon,
  ListTreeIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  TabletSmartphoneIcon,
  Trash2Icon,
  TrendingUpIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { duration, num, pct } from "@/lib/format"
import type { ReasonCategory } from "@/lib/mock/types"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { REASON_CATEGORIES, REASON_CATEGORY_META, REASON_PALETTE, plural } from "@/components/config/labels"
import { FaultMap, type FaultMapRow } from "@/components/config/fault-map"
import { ColorPopover, ReasonDialog, type ReasonEdit, type ReasonNode } from "@/components/config/reason-dialogs"
import { ConfirmDialog, IconAction, PageTitle } from "@/components/config/ui-bits"
import { EngemaseOnlyChip, useCanEdit } from "@/components/config/engemase-managed"

/** Ícone do grupo na prévia do operador (mesma convenção da tela do operador). */
const GROUP_ICON: Record<string, LucideIcon> = {
  Mecânica: WrenchIcon,
  Elétrica: ZapIcon,
  Processo: SlidersHorizontalIcon,
  Logística: PackageIcon,
  Setup: RefreshCwIcon,
  "Paradas planejadas": CalendarClockIcon,
}

const usage = (minutes: number) => (minutes > 0 ? duration(minutes * 60) : "sem uso")

export function ReasonsManager({
  initialReasons,
  initialFaultMap,
  machineTypes,
}: {
  initialReasons: ReasonNode[]
  initialFaultMap: FaultMapRow[]
  machineTypes: string[]
}) {
  const [nodes, setNodes] = useState(initialReasons)
  const [faultMap, setFaultMap] = useState(initialFaultMap)
  const [edit, setEdit] = useState<ReasonEdit | null>(null)
  const [removing, setRemoving] = useState<ReasonNode | null>(null)
  const [previewGroup, setPreviewGroup] = useState<string | null>(null)
  const canEdit = useCanEdit()

  const groups = nodes.filter((n) => !n.parentId)
  const childrenOf = (id: string) => nodes.filter((n) => n.parentId === id)
  const leaves = nodes.filter((n) => n.parentId)
  const activeLeaves = leaves.filter((n) => n.active)
  const totalOcc = leaves.reduce((s, n) => s + n.occurrences, 0)
  const totalMin = leaves.reduce((s, n) => s + n.minutes, 0)
  const top = [...leaves].sort((a, b) => b.minutes - a.minutes)[0]
  const mapped = faultMap.filter((r) => r.reasonId && nodes.find((n) => n.id === r.reasonId)?.active).length

  const usedIn = (n: ReasonNode) => (n.parentId ? n.occurrences : childrenOf(n.id).reduce((s, c) => s + c.occurrences, 0))

  const siblings =
    edit === null ? [] : edit.mode === "group" ? groups.map((g) => g.name) : childrenOf(edit.parent.id).map((c) => c.name)

  const save = (data: { name: string; category: ReasonCategory; color: string }) => {
    if (!edit) return
    if (edit.mode === "group") {
      if (edit.node) {
        const id = edit.node.id
        setNodes((list) =>
          list.map((n) => (n.id === id ? { ...n, ...data } : n.parentId === id ? { ...n, category: data.category, color: data.color } : n)),
        )
        toast.success("Grupo atualizado", { description: `${data.name} · ${REASON_CATEGORY_META[data.category].label}` })
      } else {
        const id = `rsn_new_${nodes.length + 1}`
        setNodes((list) => [...list, { id, parentId: null, ...data, active: true, minutes: 0, occurrences: 0 }])
        toast.success("Grupo criado", { description: "Adicione os motivos do 2º nível para ele aparecer na tela do operador." })
      }
    } else {
      const parent = edit.parent
      if (edit.node) {
        const id = edit.node.id
        setNodes((list) => list.map((n) => (n.id === id ? { ...n, name: data.name } : n)))
        toast.success("Motivo renomeado", { description: `O histórico passa a exibir “${data.name}”.` })
      } else {
        const id = `rsn_new_${nodes.length + 1}`
        setNodes((list) => [
          ...list,
          { id, parentId: parent.id, name: data.name, category: parent.category, color: parent.color, active: true, minutes: 0, occurrences: 0 },
        ])
        toast.success("Motivo adicionado", { description: `${parent.name} › ${data.name}` })
      }
    }
    setEdit(null)
  }

  const setActive = (n: ReasonNode, active: boolean) => {
    setNodes((list) => list.map((x) => (x.id === n.id || (!n.parentId && x.parentId === n.id) ? { ...x, active } : x)))
    toast.success(active ? `“${n.name}” visível para o operador` : `“${n.name}” oculto do operador`, {
      description: active ? undefined : "O histórico e os relatórios continuam com o motivo.",
    })
  }

  const confirmRemove = () => {
    const n = removing
    if (!n) return
    if (usedIn(n) > 0) {
      setActive(n, false)
    } else {
      setNodes((list) => list.filter((x) => x.id !== n.id && x.parentId !== n.id))
      setFaultMap((rows) => rows.map((r) => (r.reasonId === n.id || childrenOf(n.id).some((c) => c.id === r.reasonId) ? { ...r, reasonId: null } : r)))
      toast.success(`“${n.name}” excluído`)
    }
    setRemoving(null)
  }

  // Prévia do operador: só grupos ativos com motivos ativos
  const previewGroups = REASON_CATEGORIES.flatMap((c) => groups.filter((g) => g.category === c && g.active && childrenOf(g.id).some((x) => x.active)))
  const selected = previewGroups.find((g) => g.id === previewGroup) ?? previewGroups[0]

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Motivos de parada"
        description="Árvore de dois níveis usada na tela do operador, no Pareto e no mapa de falhas. A categoria define o efeito no OEE."
        actions={
          canEdit && (
            <>
              <EngemaseOnlyChip />
              <Button onClick={() => setEdit({ mode: "group", node: null })}>
                <PlusIcon />
                Novo grupo
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ListTreeIcon} tone="blue" label="Motivos ativos" value={activeLeaves.length} hint={`em ${plural(groups.filter((g) => g.active).length, "grupo", "grupos")}`} />
        <StatCard icon={ClipboardCheckIcon} tone="navy" label="Paradas classificadas" value={num(totalOcc)} hint={`${duration(totalMin * 60)} nos últimos 7 dias`} />
        <StatCard
          icon={TrendingUpIcon}
          tone="orange"
          label="Maior tempo parado"
          value={<span className="text-base">{top?.name ?? "—"}</span>}
          hint={top ? `${usage(top.minutes)} · ${pct(totalMin ? top.minutes / totalMin : 0, 0)} do total` : undefined}
        />
        <StatCard
          icon={ZapIcon}
          tone="teal"
          label="Falhas mapeadas"
          value={
            <>
              {mapped}
              <span className="text-base font-semibold text-muted-foreground"> / {faultMap.length}</span>
            </>
          }
          hint="com motivo automático"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard
          title="Árvore de motivos"
          description="Grupo (1º nível) › motivo (2º nível). Uso dos últimos 7 dias ao lado."
          className="xl:col-span-8"
          action={
            canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEdit({ mode: "group", node: null })}>
                <PlusIcon />
                Grupo
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-6">
            {REASON_CATEGORIES.map((c) => {
              const meta = REASON_CATEGORY_META[c]
              const catGroups = groups.filter((g) => g.category === c)
              return (
                <section key={c} className="flex flex-col gap-2.5">
                  <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.chip)}>
                      <span className={cn("size-1.5 rounded-full", meta.dot)} />
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">{meta.effect}</span>
                  </header>

                  {canEdit && catGroups.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setEdit({ mode: "group", node: null })}
                      className="rounded-xl border-2 border-dashed px-4 py-4 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                    >
                      Nenhum grupo nesta categoria · criar grupo
                    </button>
                  )}

                  {catGroups.map((g) => {
                    const kids = childrenOf(g.id)
                    const gMin = kids.reduce((s, k) => s + k.minutes, 0)
                    return (
                      <div key={g.id} className={cn("overflow-hidden rounded-xl border border-l-4", !g.active && "opacity-60")} style={{ borderLeftColor: g.color }}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted/30 px-3 py-2.5">
                          <ColorPopover
                            readOnly={!canEdit}
                            color={g.color}
                            label={g.name}
                            onChange={(color) => {
                              setNodes((list) => list.map((n) => (n.id === g.id || n.parentId === g.id ? { ...n, color } : n)))
                              toast.success("Cor atualizada", { description: `${g.name} no Pareto e na tela do operador.` })
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold">{g.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {plural(kids.length, "motivo", "motivos")} · {usage(gMin)}
                            </span>
                          </div>
                          {!g.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">oculto</span>}
                          {canEdit && (
                            <div className="flex gap-1">
                              <IconAction icon={PlusIcon} label={`Adicionar motivo em ${g.name}`} tone="teal" onClick={() => setEdit({ mode: "child", parent: g, node: null })} />
                              <IconAction icon={PencilIcon} label={`Editar grupo ${g.name}`} onClick={() => setEdit({ mode: "group", node: g })} />
                              <IconAction icon={Trash2Icon} label={`Excluir grupo ${g.name}`} tone="red" onClick={() => setRemoving(g)} />
                            </div>
                          )}
                        </div>
                        <ul className="divide-y border-t">
                          {kids.map((k) => (
                            <li key={k.id} className="flex items-center gap-2.5 py-2 pr-3 pl-4">
                              <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                              <span className="min-w-0 flex-1 leading-tight">
                                <span className={cn("block truncate text-sm", !k.active && "text-muted-foreground line-through decoration-muted-foreground/40")}>{k.name}</span>
                                <span className="block text-[11px] text-muted-foreground tabular-nums">
                                  {k.occurrences > 0 ? `${plural(k.occurrences, "parada", "paradas")} · ${usage(k.minutes)}` : "sem uso nos últimos 7 dias"}
                                </span>
                              </span>
                              {k.minutes > 0 && (
                                <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                                  <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (k.minutes / (top?.minutes || 1)) * 100)}%`, background: g.color }} />
                                </span>
                              )}
                              <Switch checked={k.active} onCheckedChange={(v) => setActive(k, v)} aria-label={`Mostrar “${k.name}” ao operador`} disabled={!canEdit || !g.active} />
                              {canEdit && (
                                <>
                                  <IconAction icon={PencilIcon} label={`Renomear ${k.name}`} onClick={() => setEdit({ mode: "child", parent: g, node: k })} />
                                  <IconAction icon={Trash2Icon} label={`Excluir ${k.name}`} tone="red" onClick={() => setRemoving(k)} />
                                </>
                              )}
                            </li>
                          ))}
                          {kids.length === 0 && <li className="px-4 py-3 text-xs text-muted-foreground">Sem motivos: o grupo não aparece para o operador.</li>}
                        </ul>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <SectionCard title="Como o operador vê" description="Prévia da tela de classificar parada (tablet)">
            {previewGroups.length === 0 ? (
              <p className="rounded-xl bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">Nenhum motivo ativo.</p>
            ) : (
              <div className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-3">
                <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <TabletSmartphoneIcon className="size-3.5" />
                  Por que a máquina parou?
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {previewGroups.map((g) => {
                    const Icon = GROUP_ICON[g.name] ?? FolderTreeIcon
                    const on = selected?.id === g.id
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPreviewGroup(g.id)}
                        className={cn("flex min-h-14 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-white transition", on ? "ring-2 ring-foreground/30 ring-offset-2 ring-offset-muted" : "opacity-85 hover:opacity-100")}
                        style={{ background: g.color }}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="line-clamp-2">{g.name}</span>
                      </button>
                    )
                  })}
                </div>
                {selected && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] text-muted-foreground">{selected.name} ›</div>
                    {childrenOf(selected.id)
                      .filter((k) => k.active)
                      .map((k) => (
                        <div key={k.id} className="rounded-lg border-l-4 bg-card px-3 py-2 text-xs font-medium shadow-xs" style={{ borderLeftColor: selected.color }}>
                          {k.name}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Boas práticas" description="Para um Pareto que ajuda a decidir">
            <ul className="grid gap-2 text-xs text-muted-foreground">
              {[
                "No máximo 2 níveis e até 8 motivos por grupo: o operador decide em 2 toques.",
                "Evite “Outros”: ele vira o 1º do Pareto e não diz nada.",
                "Motivos usados não são excluídos, só ocultados: o histórico continua íntegro.",
                "Paradas abaixo do limite de micro-parada não pedem motivo (contam como performance).",
              ].map((t, i) => (
                <li key={t} className="flex gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: REASON_PALETTE[i % REASON_PALETTE.length] }}>
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      <FaultMap rows={faultMap} onChange={setFaultMap} reasons={nodes} machineTypes={machineTypes} />

      <ReasonDialog edit={edit} onOpenChange={(o) => !o && setEdit(null)} siblings={siblings} onSave={save} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? (usedIn(removing) > 0 ? `Ocultar “${removing.name}”?` : `Excluir “${removing.name}”?`) : ""}
        confirmLabel={removing && usedIn(removing) > 0 ? "Ocultar do operador" : "Excluir"}
        description={
          removing && usedIn(removing) > 0
            ? `Foi usado em ${plural(usedIn(removing), "parada", "paradas")} nos últimos 7 dias. Para manter o histórico, ele não é excluído: some da tela do operador e continua nos relatórios.`
            : removing && !removing.parentId
              ? `O grupo e ${plural(childrenOf(removing.id).length, "motivo", "motivos")} serão excluídos. Códigos de falha ligados a eles voltam a perguntar ao operador.`
              : "O motivo será excluído. Códigos de falha ligados a ele voltam a perguntar ao operador."
        }
        onConfirm={confirmRemove}
      />
    </div>
  )
}
