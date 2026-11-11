"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  KeyRoundIcon,
  MailIcon,
  MonitorSmartphoneIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  UserCheckIcon,
  UserPlusIcon,
  UserXIcon,
  UsersIcon,
  MailQuestionIcon,
  CrownIcon,
} from "lucide-react"
import { toast } from "sonner"

import type { ClientRole, UserStatus } from "@/lib/mock/types"
import { CLIENT_ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Ring } from "@/components/dashboard/ring"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { ConfirmAction, InitialsAvatar, SettingsTitle, SoftBadge, plural, type SoftTone } from "@/components/settings/bits"
import type { ClientUserRow, SettingsUnit } from "@/components/settings/types"
import { ROLE_ORDER, UserDialog, type UserFormValue } from "@/components/settings/user-dialog"

const ROLE_TONE: Record<ClientRole, SoftTone> = {
  client_admin: "navy",
  engineer: "teal",
  supervisor: "blue",
  operator: "orange",
  viewer: "slate",
}

const STATUS_TONE: Record<UserStatus, SoftTone> = { active: "green", invited: "amber", disabled: "slate" }

export function UsersManager({
  clientName,
  clientSlug,
  seatLimit,
  units,
  initialUsers,
}: {
  clientName: string
  clientSlug: string
  seatLimit: number
  units: SettingsUnit[]
  initialUsers: ClientUserRow[]
}) {
  const [users, setUsers] = useState(initialUsers)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<ClientRole | "all">("all")
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all")
  const [dialog, setDialog] = useState<{ editing: ClientUserRow | null } | null>(null)
  const [deactivating, setDeactivating] = useState<ClientUserRow | null>(null)

  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])
  const admins = users.filter((u) => u.role === "client_admin" && u.status !== "disabled")
  const isLastAdmin = (u: ClientUserRow) => u.role === "client_admin" && u.status !== "disabled" && admins.length <= 1

  const seatsUsed = users.filter((u) => u.status !== "disabled").length
  const active = users.filter((u) => u.status === "active")
  const invited = users.filter((u) => u.status === "invited")
  const withTwoFactor = active.filter((u) => u.twoFactor).length
  const sharedAccounts = users.filter((u) => !u.email && u.status !== "disabled")

  const q = query.trim().toLowerCase()
  const visible = users
    .filter((u) => roleFilter === "all" || u.role === roleFilter)
    .filter((u) => statusFilter === "all" || u.status === statusFilter)
    .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email ?? u.username ?? "").toLowerCase().includes(q))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, "pt-BR"))

  const submit = (v: UserFormValue) => {
    const editing = dialog?.editing
    if (editing) {
      setUsers((list) => list.map((u) => (u.id === editing.id ? { ...u, role: v.role, unitScope: v.unitScope } : u)))
      const scope = v.unitScope === "all" ? "todas as unidades" : v.unitScope.map((id) => unitName.get(id)).join(", ")
      toast.success(`Acesso de ${editing.name} atualizado`, { description: `${CLIENT_ROLE_LABEL[v.role]} · ${scope}. Registrado na auditoria.` })
    } else {
      const row: ClientUserRow = {
        id: `usr_new_${users.length + 1}`,
        name: v.name,
        email: v.email,
        username: null,
        role: v.role,
        unitScope: v.unitScope,
        status: "invited",
        twoFactor: false,
        lastLogin: "nunca",
        lastLoginAt: null,
        otherClients: 0,
      }
      setUsers((list) => [...list, row])
      toast.success(`E-mail de acesso enviado para ${v.email}`, {
        description: `${v.name} entra como ${CLIENT_ROLE_LABEL[v.role]} assim que definir a senha. O link vale por 72 h.`,
      })
    }
    setDialog(null)
  }

  const setStatus = (u: ClientUserRow, status: UserStatus) => {
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, status } : x)))
    if (status === "disabled") {
      toast.success(`${u.name} desativado`, { description: "Sessões encerradas agora. O histórico e os apontamentos continuam na auditoria." })
    } else {
      toast.success(`${u.name} reativado`, { description: "A pessoa volta a entrar com a senha que já tinha." })
    }
  }

  const resend = (u: ClientUserRow) =>
    toast.success(`Novo e-mail de acesso enviado para ${u.email}`, { description: "O link anterior deixou de valer. O novo vale por 72 h." })
  const resetPassword = (u: ClientUserRow) =>
    toast.success(`Link de redefinição enviado para ${u.email}`, { description: "A senha atual continua valendo até a pessoa definir uma nova." })

  return (
    <>
      <SettingsTitle
        title="Usuários"
        description={`Quem acessa ${clientName}, com qual papel e em quais unidades. Terminais (TV e tablets) ficam em uma tela própria.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${clientSlug}/config/terminais`}>
                <MonitorSmartphoneIcon />
                Terminais
              </Link>
            </Button>
            <Button onClick={() => setDialog({ editing: null })}>
              <UserPlusIcon />
              Adicionar usuário
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={UsersIcon}
          tone="blue"
          label="Usuários com acesso"
          value={
            <>
              {seatsUsed}
              <span className="text-base font-semibold text-muted-foreground"> / {seatLimit}</span>
            </>
          }
          hint="Limite do plano (ativos + convites)"
          aside={<Ring value={seatsUsed / seatLimit} size={52} stroke={6} color="#257bb4" />}
        />
        <StatCard icon={MailQuestionIcon} tone="orange" label="Convites pendentes" value={invited.length} hint={invited.length ? "Aguardando definir a senha" : "Nenhum pendente"} />
        <StatCard
          icon={ShieldCheckIcon}
          tone="teal"
          label="Ativos com 2FA"
          value={
            <>
              {withTwoFactor}
              <span className="text-base font-semibold text-muted-foreground"> / {active.length}</span>
            </>
          }
          hint="Opcional para o cliente; obrigatório na Engemase"
          aside={<Ring value={active.length ? withTwoFactor / active.length : 0} size={52} stroke={6} color="#0e9384" />}
        />
        <StatCard icon={CrownIcon} tone="navy" label="Admins do cliente" value={admins.length} hint={admins.length <= 1 ? "Recomendado: ao menos 2" : "Gerenciam usuários e políticas"} />
      </div>

      {sharedAccounts.length > 0 && (
        <Alert className="border-[#e96549]/30 bg-[#e96549]/5">
          <MonitorSmartphoneIcon className="text-[#cf5539]!" />
          <AlertTitle>{plural(sharedAccounts.length, "conta parece ser de dispositivo ou compartilhada", "contas parecem ser de dispositivo ou compartilhadas")}</AlertTitle>
          <AlertDescription>
            <p>
              {sharedAccounts.map((u) => u.name).join(" e ")} {sharedAccounts.length === 1 ? "não tem" : "não têm"} e-mail. TV e tablet devem ser{" "}
              <Link href={`/${clientSlug}/config/terminais`} className="font-semibold text-primary hover:underline">
                terminais pareados
              </Link>
              , e operadores do chão se identificam no próprio terminal, sem conta de login.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard
        title="Pessoas com acesso"
        description={`${plural(visible.length, "pessoa", "pessoas")} ${visible.length !== users.length ? `de ${users.length}` : ""}`}
        bodyClassName="px-0 pb-2"
        action={
          <div className="hidden items-center gap-2 lg:flex">
            <Filters query={query} setQuery={setQuery} roleFilter={roleFilter} setRoleFilter={setRoleFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
          </div>
        }
      >
        <div className="flex flex-col gap-2 px-5 pb-3 lg:hidden">
          <Filters query={query} setQuery={setQuery} roleFilter={roleFilter} setRoleFilter={setRoleFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
        </div>
        {visible.length === 0 ? (
          <Empty className="mx-5 mb-3 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>Ninguém encontrado</EmptyTitle>
              <EmptyDescription>Ajuste a busca ou os filtros de papel e situação.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="py-2.5 pr-3 pl-5 font-medium">Pessoa</th>
                  <th className="px-3 py-2.5 font-medium">Papel</th>
                  <th className="px-3 py-2.5 font-medium">Unidades</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">2FA</th>
                  <th className="px-3 py-2.5 font-medium">Último acesso</th>
                  <th className="py-2.5 pr-5 pl-3 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((u) => {
                  const lastAdmin = isLastAdmin(u)
                  return (
                    <tr key={u.id} className={cn("transition-colors hover:bg-muted/30", u.status === "disabled" && "opacity-60")}>
                      <td className="py-3 pr-3 pl-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <InitialsAvatar name={u.name} tone={ROLE_TONE[u.role]} />
                          <div className="min-w-0 leading-tight">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{u.name}</span>
                              {lastAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <CrownIcon className="size-3.5 shrink-0 text-[#cf5539]" aria-label="Último admin" />
                                  </TooltipTrigger>
                                  <TooltipContent>Último admin do cliente: não pode ser desativado nem rebaixado.</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{u.email ?? `usuário ${u.username}`}</div>
                            {u.otherClients > 0 && <div className="text-[11px] text-muted-foreground">Também acessa {plural(u.otherClients, "outro cliente", "outros clientes")}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <SoftBadge tone={ROLE_TONE[u.role]}>{CLIENT_ROLE_LABEL[u.role]}</SoftBadge>
                      </td>
                      <td className="px-3 py-3">
                        {u.unitScope === "all" ? (
                          <span className="text-xs font-medium">Todas</span>
                        ) : (
                          <div className="flex max-w-[220px] flex-wrap gap-1">
                            {u.unitScope.map((id) => (
                              <span key={id} className="rounded-md border bg-card px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                                {unitName.get(id) ?? id}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <SoftBadge tone={STATUS_TONE[u.status]}>{USER_STATUS_LABEL[u.status]}</SoftBadge>
                          {!u.email && u.status !== "disabled" && <SoftBadge tone="orange">Sem e-mail</SoftBadge>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {u.twoFactor ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-state-running">
                            <ShieldCheckIcon className="size-4" /> Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <ShieldOffIcon className="size-4" /> Não
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {u.status === "invited" ? "Aguardando senha" : u.lastLogin}
                      </td>
                      <td className="py-3 pr-5 pl-3 text-right">
                        <UserMenu
                          user={u}
                          lastAdmin={lastAdmin}
                          onEdit={() => setDialog({ editing: u })}
                          onResend={() => resend(u)}
                          onReset={() => resetPassword(u)}
                          onDeactivate={() => setDeactivating(u)}
                          onReactivate={() => setStatus(u, "active")}
                          terminalsHref={`/${clientSlug}/config/terminais`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <UserDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        editing={dialog?.editing ?? null}
        units={units}
        existingEmails={users.map((u) => (u.email ?? "").toLowerCase()).filter(Boolean)}
        isLastAdmin={dialog?.editing ? isLastAdmin(dialog.editing) : false}
        seatsLeft={seatLimit - seatsUsed}
        clientName={clientName}
        onSubmit={submit}
      />

      <ConfirmAction
        open={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Desativar ${deactivating?.name ?? ""}?`}
        description={
          <div className="grid gap-2">
            <p>A pessoa perde o acesso agora e as sessões abertas são encerradas. Nada é apagado: apontamentos, classificações e o histórico na auditoria continuam.</p>
            <p>Você pode reativar depois, sem novo convite.</p>
          </div>
        }
        confirmLabel="Desativar acesso"
        onConfirm={() => {
          if (deactivating) setStatus(deactivating, "disabled")
          setDeactivating(null)
        }}
      />
    </>
  )
}

function Filters({
  query,
  setQuery,
  roleFilter,
  setRoleFilter,
  statusFilter,
  setStatusFilter,
}: {
  query: string
  setQuery: (v: string) => void
  roleFilter: ClientRole | "all"
  setRoleFilter: (v: ClientRole | "all") => void
  statusFilter: UserStatus | "all"
  setStatusFilter: (v: UserStatus | "all") => void
}) {
  return (
    <>
      <div className="relative w-full lg:w-52">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou e-mail" className="h-8 pl-8 text-sm" aria-label="Buscar usuário" />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:flex">
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as ClientRole | "all")}>
          <SelectTrigger size="sm" className="w-full lg:w-40" aria-label="Filtrar por papel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os papéis</SelectItem>
            {ROLE_ORDER.map((r) => (
              <SelectItem key={r} value={r}>
                {CLIENT_ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UserStatus | "all")}>
          <SelectTrigger size="sm" className="w-full lg:w-40" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {(["active", "invited", "disabled"] as UserStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {USER_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

function UserMenu({
  user,
  lastAdmin,
  onEdit,
  onResend,
  onReset,
  onDeactivate,
  onReactivate,
  terminalsHref,
}: {
  user: ClientUserRow
  lastAdmin: boolean
  onEdit: () => void
  onResend: () => void
  onReset: () => void
  onDeactivate: () => void
  onReactivate: () => void
  terminalsHref: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Ações para ${user.name}`}
          className="ml-auto flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{user.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onEdit} disabled={user.status === "disabled"}>
          <PencilIcon />
          Alterar papel e unidades
        </DropdownMenuItem>
        {user.status === "invited" && user.email && (
          <DropdownMenuItem onSelect={onResend}>
            <MailIcon />
            Reenviar e-mail de acesso
          </DropdownMenuItem>
        )}
        {user.status === "active" && user.email && (
          <DropdownMenuItem onSelect={onReset}>
            <KeyRoundIcon />
            Enviar redefinição de senha
          </DropdownMenuItem>
        )}
        {!user.email && (
          <DropdownMenuItem asChild>
            <Link href={terminalsHref}>
              <MonitorSmartphoneIcon />
              Substituir por terminal pareado
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {user.status === "disabled" ? (
          <DropdownMenuItem onSelect={onReactivate}>
            <UserCheckIcon />
            Reativar acesso
          </DropdownMenuItem>
        ) : lastAdmin ? (
          <DropdownMenuItem disabled className="items-start">
            <UserXIcon className="mt-0.5" />
            <span className="grid gap-0.5">
              <span>Desativar acesso</span>
              <span className="text-[11px] leading-snug">Último admin: promova outra pessoa antes.</span>
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={onDeactivate}>
            <UserXIcon />
            Desativar acesso
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
