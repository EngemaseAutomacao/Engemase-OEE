"use client"

import { useState } from "react"
import { CalendarClockIcon, PencilIcon, PlusIcon, ShieldCheckIcon, ShieldOffIcon, Trash2Icon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { MODE_META, WEEKDAYS, minutesLabel, windowLabel } from "./remote-labels"
import { useRemote } from "./remote-provider"
import type { PolicyMode, PolicyVM } from "./remote-types"

const MODE_ICON: Record<PolicyMode, { icon: LucideIcon; tone: IconTone }> = {
  disabled: { icon: ShieldOffIcon, tone: "slate" },
  approval_required: { icon: ShieldCheckIcon, tone: "teal" },
  preapproved_window: { icon: CalendarClockIcon, tone: "blue" },
}
const MODES: PolicyMode[] = ["approval_required", "preapproved_window", "disabled"]
const MAX_OPTIONS = [30, 60, 120, 240, 480]
const IDLE_OPTIONS = [10, 15, 20, 30]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  )
}

function PolicyForm({ initial, onCancel, onSave }: { initial: PolicyVM; onCancel: () => void; onSave: (p: PolicyVM) => void }) {
  const { contacts, sessions } = useRemote()
  const [p, setP] = useState<PolicyVM>(initial)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof PolicyVM>(k: K, v: PolicyVM[K]) => setP((prev) => ({ ...prev, [k]: v }))

  const pending = sessions.filter((s) => s.status === "requested").length
  const windowErrors = p.mode === "preapproved_window" && (p.windows.length === 0 || p.windows.some((w) => !w.start || !w.end || w.start >= w.end))
  const contactMissing = p.requireOnsiteContact && !p.onsiteContactId

  return (
    <>
      <div className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Modo</legend>
          <div className="grid gap-2" role="radiogroup" aria-label="Modo da política">
            {MODES.map((m) => {
              const meta = MODE_META[m]
              const ic = MODE_ICON[m]
              const active = p.mode === m
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("mode", m)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    active && "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5",
                  )}
                >
                  <IconCircle icon={ic.icon} tone={ic.tone} soft size="sm" />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">
                      {meta.label}
                      {m === "approval_required" && <span className="ml-2 rounded-full bg-[#0e9384]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#0e9384]">Recomendado</span>}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{meta.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {p.mode === "disabled" && pending > 0 && (
            <p className="text-xs text-amber-700 dark:text-state-stopped">
              {pending} {pending === 1 ? "pedido pendente será recusado" : "pedidos pendentes serão recusados"} automaticamente ao salvar.
            </p>
          )}
        </fieldset>

        {p.mode === "preapproved_window" && (
          <div className="grid gap-2">
            <span className="text-sm font-medium">Janelas pré-aprovadas</span>
            {p.windows.map((w, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <Select
                  value={String(w.day)}
                  onValueChange={(v) => set("windows", p.windows.map((x, j) => (j === i ? { ...x, day: Number(v) } : x)))}
                >
                  <SelectTrigger className="col-span-3 w-full sm:col-span-1" aria-label="Dia da semana">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d, k) => (
                      <SelectItem key={d} value={String(k)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  value={w.start}
                  aria-label="Início"
                  className="w-full sm:w-[6.5rem]"
                  onChange={(e) => set("windows", p.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                />
                <Input
                  type="time"
                  value={w.end}
                  aria-label="Fim"
                  className="w-full sm:w-[6.5rem]"
                  onChange={(e) => set("windows", p.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remover janela"
                  onClick={() => set("windows", p.windows.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => set("windows", [...p.windows, { day: 6, start: "08:00", end: "12:00" }])}
            >
              <PlusIcon />
              Adicionar janela
            </Button>
            {tried && windowErrors && <p className="text-xs text-destructive">Defina ao menos uma janela, com início antes do fim.</p>}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pol-max">Duração máxima por sessão</Label>
            <Select value={String(p.maxDurationMin)} onValueChange={(v) => set("maxDurationMin", Number(v))}>
              <SelectTrigger id="pol-max" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {minutesLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">O gateway também tem um teto local de 8 h.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pol-idle">Encerrar por inatividade</Label>
            <Select value={String(p.idleTimeoutMin)} onValueChange={(v) => set("idleTimeoutMin", Number(v))}>
              <SelectTrigger id="pol-idle" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IDLE_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} min sem uso
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Contado no próprio gateway.</p>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border p-3">
          <Switch checked={p.allowPlcForward} onCheckedChange={(v) => set("allowPlcForward", v)} className="mt-0.5" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Permitir acesso a CLP</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Encaminhamento de um único IP:porta de um dispositivo cadastrado (ex.: 502 Modbus), com aprovação própria e prazo curto. O gateway nunca roteia para a rede
              das máquinas.
            </span>
          </span>
        </label>

        <div className="grid gap-3 rounded-xl border p-3">
          <label className="flex items-start gap-3">
            <Switch checked={p.requireOnsiteContact} onCheckedChange={(v) => set("requireOnsiteContact", v)} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">Exigir contato na planta</span>
              <span className="text-xs leading-relaxed text-muted-foreground">Alguém da fábrica disponível enquanto a Engemase estiver conectada.</span>
            </span>
          </label>
          {p.requireOnsiteContact && (
            <div className="grid gap-1.5 pl-11">
              <Label htmlFor="pol-contact" className="text-xs">
                Contato padrão
              </Label>
              <Select value={p.onsiteContactId ?? undefined} onValueChange={(v) => set("onsiteContactId", v)}>
                <SelectTrigger id="pol-contact" className="w-full" aria-invalid={tried && contactMissing}>
                  <SelectValue placeholder="Escolha uma pessoa" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-xs text-muted-foreground">· {c.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Sugerido em cada aprovação; dá para trocar na hora.</p>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            setTried(true)
            if (windowErrors || contactMissing) return
            onSave({ ...p, windows: p.mode === "preapproved_window" ? p.windows : initial.windows })
          }}
        >
          Salvar política
        </Button>
      </DialogFooter>
    </>
  )
}

/** Política de acesso remoto do cliente, com edição em diálogo. */
export function PolicyCard({ className }: { className?: string }) {
  const { policy, approvers, contacts, clientName, savePolicy } = useRemote()
  const [open, setOpen] = useState(false)
  const meta = MODE_META[policy.mode]
  const ic = MODE_ICON[policy.mode]
  const contact = contacts.find((c) => c.id === policy.onsiteContactId)

  return (
    <SectionCard
      title="Política de acesso remoto"
      description={`Vale para todos os gateways de ${clientName}`}
      action={
        <Button variant="ghost" size="xs" className="shrink-0 font-semibold text-primary" onClick={() => setOpen(true)}>
          <PencilIcon />
          Editar
        </Button>
      }
      className={className}
    >
      <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3">
        <IconCircle icon={ic.icon} tone={ic.tone} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{meta.label}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      <dl className="mt-3 divide-y">
        <Row label="Quem aprova">
          Admin do cliente
          <span className="block text-xs font-normal text-muted-foreground">{approvers.length ? approvers.join(", ") : "nenhum admin ativo"}</span>
        </Row>
        <Row label="Duração máxima">{minutesLabel(policy.maxDurationMin)}</Row>
        <Row label="Inatividade">{policy.idleTimeoutMin} min sem uso</Row>
        <Row label="Acesso a CLP">
          {policy.allowPlcForward ? (
            <span className="text-state-running">Permitido, caso a caso</span>
          ) : (
            <span className="text-muted-foreground">Bloqueado</span>
          )}
        </Row>
        <Row label="Contato na planta">
          {policy.requireOnsiteContact ? (
            <>
              Obrigatório
              {contact && <span className="block text-xs font-normal text-muted-foreground">Padrão: {contact.name}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Não exigido</span>
          )}
        </Row>
        {policy.mode === "preapproved_window" && (
          <Row label="Janelas">
            {policy.windows.length ? policy.windows.map((w) => <span key={windowLabel(w)} className="block">{windowLabel(w)}</span>) : "—"}
          </Row>
        )}
      </dl>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Política de acesso remoto</DialogTitle>
            <DialogDescription>Define se e como a Engemase pode acessar seus gateways para manutenção. Alterações valem para os próximos pedidos.</DialogDescription>
          </DialogHeader>
          {open && (
            <PolicyForm
              initial={policy}
              onCancel={() => setOpen(false)}
              onSave={(p) => {
                savePolicy(p)
                setOpen(false)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
