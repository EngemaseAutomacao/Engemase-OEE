"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  FingerprintIcon,
  MailIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserCogIcon,
  UserXIcon,
  UsersIcon,
} from "lucide-react"

import type { PlatformRole } from "@/lib/mock/types"
import type { Resultado } from "@/lib/data/admin/acesso"
import {
  desativarMembroAction,
  reativarMembroAction,
  reenviarConviteAction,
  reiniciar2faMembroAction,
  trocarPapelAction,
} from "@/app/(admin)/admin/equipe-actions"
import { Input } from "@/components/ui/input"
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
  const { members, assignments, grants, patchMember, banco, meRole, agora } = useTeam()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [inviteLink, setInviteLink] = useState<{ name: string; link: string; expiraEm: string; emailEnviado: boolean } | null>(null)
  // Com banco, só o super admin gerencia a equipe (o servidor confere de novo).
  const canManage = !banco || meRole === "super_admin"

  /** Com banco: grava pela Server Action e recarrega; sem banco: só a tela. */
  function run<T>(action: () => Promise<Resultado<T>>, onOk: (dados: T) => void, demo: () => void) {
    if (!banco) return demo()
    startTransition(async () => {
      const r = await action()
      if (!r.ok) {
        toast.error(r.mensagem)
        return
      }
      onOk(r.dados)
      router.refresh()
    })
  }
  const { now } = useOpsClock(30_000, agora)
  const [roleFor, setRoleFor] = useState<MemberRow | null>(null)
  const [newRole, setNewRole] = useState<PlatformRole>("technician")
  const [disableFor, setDisableFor] = useState<MemberRow | null>(null)

  const activeSupers = members.filter((m) => m.role === "super_admin" && m.status !== "disabled").length
  const isLastSuper = (m: MemberRow) => m.role === "super_admin" && m.status !== "disabled" && activeSupers <= 1

  const accessLabel = (m: MemberRow): { text: string; tone: Tone } => {
    if (m.role === "super_admin") return { text: "Todos os clientes · auditado", tone: "blue" }
    // Técnico: concessões de suporte ativas (abertas por ele) e atribuições vigentes (do super admin).
    const live = grants.filter((g) => g.userId === m.id && g.endedAt === null && Date.parse(g.endsAt) > now)
    const valid = assignments.filter((a) => a.userId === m.id && Date.parse(a.validUntil) > now)
    if (live.length > 0) return { text: `Suporte ativo: ${live.map((g) => g.clientName).join(", ")}`, tone: "teal" }
    if (valid.length > 0) {
      return { text: `${valid.length} cliente${valid.length === 1 ? "" : "s"} atribuído${valid.length === 1 ? "" : "s"}`, tone: "orange" }
    }
    return { text: "Sem atribuição ou concessão vigente", tone: "slate" }
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
    const who = roleFor
    const done = () =>
      toast.success(`${who.name} agora é ${ROLE_META[newRole].label}`, {
        description: "Alteração registrada na auditoria da plataforma. As sessões abertas dessa pessoa foram encerradas.",
      })
    run(
      () => trocarPapelAction({ userId: who.id, role: newRole }),
      done,
      () => {
        patchMember(who.id, { role: newRole })
        done()
      },
    )
    setRoleFor(null)
  }

  const confirmDisable = () => {
    if (!disableFor) return
    const who = disableFor
    const done = () =>
      toast.success(`Acesso de ${who.name} desativado`, {
        description: "Sessões encerradas; sem acesso a nenhum cliente enquanto estiver desativado. O histórico na auditoria é mantido.",
      })
    run(
      () => desativarMembroAction({ userId: who.id }),
      done,
      () => {
        patchMember(who.id, { status: "disabled" })
        done()
      },
    )
    setDisableFor(null)
  }

  return (
    <SectionCard title="Membros" description="Toda a equipe entra com e-mail e senha; a verificação em duas etapas é opcional" bodyClassName="px-0 pb-2">
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
          <table className="w-full min-w-[960px] text-sm xl:min-w-0">
            <thead className="border-b">
              <tr>
                <th className={TH}>Membro</th>
                <th className={TH}>Papel</th>
                <th className={TH}>2FA</th>
                <th className={TH}>Acesso aos clientes</th>
                <th className={TH}>Último acesso</th>
                <th className={cn(TH, "xl:max-2xl:hidden")}>Status</th>
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
                      <div className="flex flex-col gap-1">
                        <SoftBadge tone={meta.tone} icon={meta.icon}>
                          {meta.label}
                        </SoftBadge>
                        {/* De 1280 a 1535 px a coluna "Status" some para a tabela caber: o status vem aqui. */}
                        <SoftBadge tone={STATUS_TONE[m.status]} dot className="hidden xl:max-2xl:inline-flex">
                          {USER_STATUS_LABEL[m.status]}
                        </SoftBadge>
                      </div>
                    </td>
                    <td className={TD}>
                      {m.twoFactor ? (
                        <SoftBadge tone="green" icon={ShieldCheckIcon}>
                          Ativo
                        </SoftBadge>
                      ) : (
                        <SoftBadge tone="slate" icon={FingerprintIcon} title="Opcional: a pessoa ativa em &quot;Segurança da conta&quot;, quando quiser">
                          Não ativado
                        </SoftBadge>
                      )}
                    </td>
                    <td className={TD}>
                      <SoftBadge tone={access.tone} className="xl:max-2xl:max-w-44 xl:max-2xl:rounded-lg xl:max-2xl:whitespace-normal">
                        {access.text}
                      </SoftBadge>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <div className="leading-tight">{m.lastLoginAt ? m.lastLoginAgo : "Nunca entrou"}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{m.lastLoginLabel}</div>
                    </td>
                    <td className={cn(TD, "xl:max-2xl:hidden")}>
                      <SoftBadge tone={STATUS_TONE[m.status]} dot>
                        {USER_STATUS_LABEL[m.status]}
                      </SoftBadge>
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger className={squareClass("slate")} aria-label={`Ações para ${m.name}`} disabled={pending}>
                          <MoreHorizontalIcon aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel className="truncate">{m.name}</DropdownMenuLabel>
                          <DropdownMenuItem disabled={lockedRole || m.status === "disabled"} onSelect={() => openRole(m)}>
                            <UserCogIcon />
                            {m.isMe ? "Alterar papel (não no próprio)" : isLastSuper(m) ? "Alterar papel (último super admin)" : "Alterar papel"}
                          </DropdownMenuItem>
                          {m.status === "invited" && (
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  () => reenviarConviteAction({ userId: m.id }),
                                  (d) => setInviteLink({ name: m.name, ...d }),
                                  () => toast.success("Convite reenviado", { description: `${m.email} recebeu um novo link para definir a senha.` }),
                                )
                              }
                            >
                              <MailIcon />
                              Reenviar convite
                            </DropdownMenuItem>
                          )}
                          {m.status === "active" && m.twoFactor && !m.isMe && (
                            <DropdownMenuItem
                              onSelect={() => {
                                const done = () =>
                                  toast.success(`2FA de ${m.name} redefinido`, {
                                    description: "Sessões encerradas. A pessoa entra só com a senha e pode cadastrar o novo celular em \"Segurança da conta\".",
                                  })
                                run(
                                  () => reiniciar2faMembroAction({ userId: m.id }),
                                  done,
                                  () => {
                                    patchMember(m.id, { twoFactor: false })
                                    done()
                                  },
                                )
                              }}
                            >
                              <RotateCcwIcon />
                              Redefinir 2FA (troca de celular)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {m.status === "disabled" ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  () => reativarMembroAction({ userId: m.id }),
                                  () => toast.success(`Acesso de ${m.name} reativado`),
                                  () => {
                                    patchMember(m.id, { status: "active" })
                                    toast.success(`Acesso de ${m.name} reativado`)
                                  },
                                )
                              }
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
                      )}
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
              A pessoa sai de todas as sessões na hora e não entra em nenhum cliente enquanto estiver desativada. O histórico na auditoria continua disponível. Dá para
              reativar depois.
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

      <Dialog open={inviteLink !== null} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo link para {inviteLink?.name}</DialogTitle>
            <DialogDescription>
              {inviteLink?.emailEnviado ? "Também foi enviado por e-mail. " : "Nenhum e-mail foi enviado (provedor não configurado). "}
              Entregue por um canal seguro: serve uma vez só
              {inviteLink ? ` e vale até ${new Date(inviteLink.expiraEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}. O link
              anterior deixou de valer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteLink?.link ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Link para definir a senha" />
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink?.link ?? "")
                  toast.success("Link copiado")
                } catch {
                  toast.error("Não deu para copiar. Selecione o link e copie manualmente.")
                }
              }}
            >
              Copiar
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setInviteLink(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
