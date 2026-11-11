"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  FingerprintIcon,
  MailIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserCogIcon,
  UserXIcon,
  UsersIcon,
} from "lucide-react"

import type { PlatformRole } from "@/lib/mock/types"
import { USER_STATUS_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PersonAvatar, SoftBadge, TD, TH, squareClass, type Tone } from "./bits"
import { ROLE_META, useTeam } from "./team-context"
import type { MemberRow } from "./team-data"
import { useOpsClock } from "./use-ops-clock"

const STATUS_TONE: Record<MemberRow["status"], Tone> = { active: "green", invited: "amber", disabled: "slate" }

/** Tabela de membros da equipe Engemase com ações por linha. */
export function TeamMembers() {
  const { members, assignments, grants, patchMember } = useTeam()
  const { now } = useOpsClock(30_000)
  const [roleFor, setRoleFor] = useState<MemberRow | null>(null)
  const [newRole, setNewRole] = useState<PlatformRole>("support")
  const [disableFor, setDisableFor] = useState<MemberRow | null>(null)

  const activeSupers = members.filter((m) => m.role === "super_admin" && m.status !== "disabled").length
  const isLastSuper = (m: MemberRow) => m.role === "super_admin" && m.status !== "disabled" && activeSupers <= 1

  const accessLabel = (m: MemberRow): { text: string; tone: Tone } => {
    if (m.role === "super_admin") return { text: "Todos os clientes · auditado", tone: "blue" }
    if (m.role === "support") {
      const live = grants.filter((g) => g.userId === m.id && g.endedAt === null && Date.parse(g.endsAt) > now)
      return live.length > 0 ? { text: `Concessão ativa: ${live.map((g) => g.clientName).join(", ")}`, tone: "teal" } : { text: "Sem concessão ativa", tone: "slate" }
    }
    const valid = assignments.filter((a) => a.userId === m.id && Date.parse(a.validUntil) > now)
    return valid.length > 0 ? { text: `${valid.length} cliente${valid.length === 1 ? "" : "s"} atribuído${valid.length === 1 ? "" : "s"}`, tone: "orange" } : { text: "Sem atribuição vigente", tone: "slate" }
  }

  const openRole = (m: MemberRow) => {
    setNewRole(m.role)
    setRoleFor(m)
  }
  const saveRole = () => {
    if (!roleFor) return
    if (newRole === roleFor.role) {
      setRoleFor(null)
      return
    }
    patchMember(roleFor.id, { role: newRole })
    toast.success(`${roleFor.name} agora é ${ROLE_META[newRole].label}`, {
      description: "Alteração registrada na auditoria da plataforma. As sessões abertas dessa pessoa foram encerradas.",
    })
    setRoleFor(null)
  }

  const confirmDisable = () => {
    if (!disableFor) return
    patchMember(disableFor.id, { status: "disabled" })
    toast.success(`Acesso de ${disableFor.name} desativado`, {
      description: "Sessões encerradas, concessões e atribuições suspensas. O histórico na auditoria é mantido.",
    })
    setDisableFor(null)
  }

  return (
    <SectionCard title="Membros" description="Toda a equipe entra com e-mail, senha e 2FA obrigatório" bodyClassName="px-0 pb-2">
      {members.length === 0 ? (
        <div className="px-5 pb-3">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum membro cadastrado</EmptyTitle>
              <EmptyDescription>Adicione a equipe da Engemase para administrar a plataforma.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b">
              <tr>
                <th className={TH}>Membro</th>
                <th className={TH}>Papel</th>
                <th className={TH}>2FA</th>
                <th className={TH}>Acesso aos clientes</th>
                <th className={TH}>Último acesso</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => {
                const meta = ROLE_META[m.role]
                const access = accessLabel(m)
                const lockedRole = m.isMe || isLastSuper(m)
                return (
                  <tr key={m.id} className={cn("transition-colors hover:bg-muted/40", m.status === "disabled" && "opacity-60")}>
                    <td className={TD}>
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={m.name} tone={meta.tone} />
                        <div className="min-w-0 leading-tight">
                          <div className="truncate font-medium">
                            {m.name}
                            {m.isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={TD}>
                      <SoftBadge tone={meta.tone} icon={meta.icon}>
                        {meta.label}
                      </SoftBadge>
                    </td>
                    <td className={TD}>
                      {m.twoFactor ? (
                        <SoftBadge tone="green" icon={ShieldCheckIcon}>
                          Ativo
                        </SoftBadge>
                      ) : m.status === "invited" ? (
                        <SoftBadge tone="slate" icon={FingerprintIcon}>
                          No primeiro acesso
                        </SoftBadge>
                      ) : (
                        <SoftBadge tone="red" icon={ShieldAlertIcon} title="2FA é obrigatório para a equipe Engemase">
                          Pendente · obrigatório
                        </SoftBadge>
                      )}
                    </td>
                    <td className={TD}>
                      <SoftBadge tone={access.tone}>{access.text}</SoftBadge>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <div className="leading-tight">{m.lastLoginAt ? m.lastLoginAgo : "Nunca entrou"}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{m.lastLoginLabel}</div>
                    </td>
                    <td className={TD}>
                      <SoftBadge tone={STATUS_TONE[m.status]} dot>
                        {USER_STATUS_LABEL[m.status]}
                      </SoftBadge>
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className={squareClass("slate")} aria-label={`Ações para ${m.name}`}>
                          <MoreHorizontalIcon aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel className="truncate">{m.name}</DropdownMenuLabel>
                          <DropdownMenuItem disabled={lockedRole || m.status === "disabled"} onSelect={() => openRole(m)}>
                            <UserCogIcon />
                            {m.isMe ? "Alterar papel (não no próprio)" : isLastSuper(m) ? "Alterar papel (último super admin)" : "Alterar papel"}
                          </DropdownMenuItem>
                          {m.status === "invited" && (
                            <DropdownMenuItem onSelect={() => toast.success("Convite reenviado", { description: `${m.email} recebeu um novo link para definir senha e cadastrar o 2FA.` })}>
                              <MailIcon />
                              Reenviar convite
                            </DropdownMenuItem>
                          )}
                          {m.status === "active" && !m.twoFactor && (
                            <DropdownMenuItem
                              onSelect={() =>
                                toast.success("Link de cadastro do 2FA enviado", {
                                  description: `${m.name.split(" ")[0]} só volta a entrar depois de cadastrar o 2FA pelo link enviado para ${m.email}.`,
                                })
                              }
                            >
                              <FingerprintIcon />
                              Enviar link para cadastrar 2FA
                            </DropdownMenuItem>
                          )}
                          {m.status === "active" && m.twoFactor && !m.isMe && (
                            <DropdownMenuItem
                              onSelect={() => {
                                patchMember(m.id, { twoFactor: false })
                                toast.success(`2FA de ${m.name} redefinido`, { description: "Um link para cadastrar o novo dispositivo foi enviado por e-mail." })
                              }}
                            >
                              <RotateCcwIcon />
                              Redefinir 2FA (troca de celular)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {m.status === "disabled" ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                patchMember(m.id, { status: "active" })
                                toast.success(`Acesso de ${m.name} reativado`)
                              }}
                            >
                              <UserCheckIcon />
                              Reativar acesso
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem variant="destructive" disabled={m.isMe || isLastSuper(m)} onSelect={() => setDisableFor(m)}>
                              <UserXIcon />
                              Desativar acesso
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={roleFor !== null} onOpenChange={(o) => !o && setRoleFor(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar papel</DialogTitle>
            <DialogDescription>
              {roleFor?.name} · a mudança vale no próximo acesso, encerra as sessões abertas e fica na auditoria da plataforma.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={newRole} onValueChange={(v) => setNewRole(v as PlatformRole)} className="grid gap-2">
            {(Object.keys(ROLE_META) as PlatformRole[]).map((r) => (
              <label
                key={r}
                htmlFor={`role-${r}`}
                className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", newRole === r ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
              >
                <RadioGroupItem id={`role-${r}`} value={r} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{ROLE_META[r].label}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_META[r].summary}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleFor(null)}>
              Cancelar
            </Button>
            <Button onClick={saveRole}>Salvar papel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disableFor !== null} onOpenChange={(o) => !o && setDisableFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar o acesso de {disableFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa sai de todas as sessões na hora e perde concessões de suporte e atribuições vigentes. O histórico na auditoria continua disponível. Dá para reativar
              depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDisable}>
              Desativar acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}
