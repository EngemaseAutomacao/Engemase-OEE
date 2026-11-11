"use client"

import { useState } from "react"
import { ArchiveXIcon, CircleCheckBigIcon, PauseCircleIcon, PlayCircleIcon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PLATFORM_HOST, type AdminClientStatus } from "./labels"

export type LifecycleAction = "activate" | "suspend" | "reactivate" | "close"

/** Estado resultante de cada ação. */
export const ACTION_RESULT: Record<LifecycleAction, AdminClientStatus> = {
  activate: "active",
  suspend: "suspended",
  reactivate: "active",
  close: "closed",
}

/** Ações disponíveis a partir de cada estado. */
export function actionsFor(status: AdminClientStatus): LifecycleAction[] {
  if (status === "onboarding") return ["activate", "suspend", "close"]
  if (status === "active") return ["suspend", "close"]
  if (status === "suspended") return ["reactivate", "close"]
  return []
}

export const ACTION_META: Record<LifecycleAction, { label: string; icon: LucideIcon }> = {
  activate: { label: "Concluir implantação", icon: CircleCheckBigIcon },
  suspend: { label: "Suspender", icon: PauseCircleIcon },
  reactivate: { label: "Reativar", icon: PlayCircleIcon },
  close: { label: "Encerrar", icon: ArchiveXIcon },
}

const REASONS: Record<"suspend" | "close", string[]> = {
  suspend: ["Inadimplência", "Pedido do cliente", "Contrato em renegociação", "Uso indevido / segurança", "Outro motivo"],
  close: ["Fim de contrato", "Pedido do cliente", "Inadimplência prolongada", "Cliente de teste / piloto", "Outro motivo"],
}

function Effects({ items, tone }: { items: string[]; tone: "amber" | "red" | "green" | "blue" }) {
  const box = {
    amber: "bg-state-stopped/10 text-amber-900 dark:text-amber-100",
    red: "bg-state-fault/8 text-foreground",
    green: "bg-state-running/10 text-foreground",
    blue: "bg-primary/8 text-foreground",
  }[tone]
  const dot = { amber: "bg-state-stopped", red: "bg-state-fault", green: "bg-state-running", blue: "bg-primary" }[tone]
  return (
    <ul className={cn("grid gap-1.5 rounded-xl p-3 text-[13px] leading-snug", box)}>
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Diálogo de confirmação das mudanças de ciclo de vida (docs/15 §6).
 * `onConfirm` recebe o motivo escolhido (quando houver); o protótipo só muda o estado local.
 */
export function LifecycleDialog({
  open,
  action,
  client,
  nonce = 0,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  /** Mantido pelo pai mesmo depois de fechar, para o texto não sumir durante a animação. */
  action: LifecycleAction | null
  client: { name: string; slug: string }
  /** Muda a cada abertura para zerar o formulário. */
  nonce?: number
  onOpenChange: (open: boolean) => void
  onConfirm: (action: LifecycleAction, reason: string | null) => void
}) {
  return (
    <AlertDialog open={open && action !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        {action && <DialogBody key={`${action}-${client.slug}-${nonce}`} action={action} client={client} onConfirm={onConfirm} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DialogBody({
  action,
  client,
  onConfirm,
}: {
  action: LifecycleAction
  client: { name: string; slug: string }
  onConfirm: (action: LifecycleAction, reason: string | null) => void
}) {
  const [reason, setReason] = useState("")
  const [notify, setNotify] = useState(true)
  const [typed, setTyped] = useState("")

  const needsReason = action === "suspend" || action === "close"
  const canConfirm = (!needsReason || reason !== "") && (action !== "close" || typed.trim() === client.slug)

  return (
    <>
      <AlertDialogHeader>
        {action === "activate" && (
          <>
            <AlertDialogTitle>Concluir a implantação de {client.name}?</AlertDialogTitle>
            <AlertDialogDescription>O cliente passa para o estado Ativo e entra no uso produtivo normal.</AlertDialogDescription>
          </>
        )}
        {action === "suspend" && (
          <>
            <AlertDialogTitle>Suspender {client.name}?</AlertDialogTitle>
            <AlertDialogDescription>A suspensão bloqueia o acesso das pessoas, mas não interrompe a coleta.</AlertDialogDescription>
          </>
        )}
        {action === "reactivate" && (
          <>
            <AlertDialogTitle>Reativar {client.name}?</AlertDialogTitle>
            <AlertDialogDescription>Os usuários do cliente voltam a entrar imediatamente.</AlertDialogDescription>
          </>
        )}
        {action === "close" && (
          <>
            <AlertDialogTitle>Encerrar {client.name}?</AlertDialogTitle>
            <AlertDialogDescription>Inicia o processo de encerramento (runbook manual no MVP). Esta ação não pode ser desfeita pela tela.</AlertDialogDescription>
          </>
        )}
      </AlertDialogHeader>

      {action === "activate" && (
        <Effects
          tone="green"
          items={[
            "Os indicadores do cliente passam a contar no painel da plataforma como uso produtivo.",
            "O admin do cliente continua com acesso; a equipe dele pode ser adicionada normalmente.",
            "Confira antes se o gateway está online e se as máquinas já têm tags configuradas.",
          ]}
        />
      )}
      {action === "suspend" && (
        <Effects
          tone="amber"
          items={[
            "Usuários do cliente não conseguem entrar e veem uma mensagem clara no login.",
            "Os gateways continuam enviando dados normalmente: nada se perde durante a suspensão.",
            "Nenhum token de gateway ou de terminal é revogado.",
            "A Engemase continua acessando, sempre com registro na auditoria.",
          ]}
        />
      )}
      {action === "reactivate" && (
        <Effects
          tone="blue"
          items={[
            "Os dados enviados pelos gateways durante a suspensão já estão disponíveis nos relatórios.",
            "Usuários, papéis e escopos voltam exatamente como estavam.",
          ]}
        />
      )}
      {action === "close" && (
        <Effects
          tone="red"
          items={[
            "Exportação completa dos dados (CSV/Parquet) entregue ao cliente: 30 dias para baixar.",
            "Mais 30 dias de carência; depois, exclusão definitiva e termo de eliminação.",
            "Gateways e terminais pareados são revogados; a coleta para.",
            `O identificador “${client.slug}” nunca será reaproveitado por outro cliente.`,
          ]}
        />
      )}

      {needsReason && (
        <div className="grid gap-1.5">
          <Label htmlFor="lc-reason">Motivo (fica na auditoria)</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="lc-reason" className="w-full">
              <SelectValue placeholder="Selecione o motivo" />
            </SelectTrigger>
            <SelectContent>
              {REASONS[action].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(action === "suspend" || action === "reactivate") && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" />
          <span>
            Avisar os admins do cliente por e-mail
            <span className="block text-xs text-muted-foreground">Aviso transacional de {action === "suspend" ? "suspensão" : "reativação"}.</span>
          </span>
        </label>
      )}

      {action === "close" && (
        <div className="grid gap-1.5">
          <Label htmlFor="lc-confirm">
            Para confirmar, digite <span className="font-mono font-semibold">{client.slug}</span>
          </Label>
          <Input id="lc-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={client.slug} />
          <p className="text-xs text-muted-foreground">
            {PLATFORM_HOST}/{client.slug}
          </p>
        </div>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          variant={action === "close" ? "destructive" : "default"}
          disabled={!canConfirm}
          onClick={() => onConfirm(action, needsReason ? reason : null)}
        >
          {ACTION_META[action].label}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}

/** Mensagem do toast após cada ação. */
export function lifecycleToast(action: LifecycleAction, name: string): { title: string; description: string } {
  switch (action) {
    case "activate":
      return { title: `${name} agora está ativo`, description: "Implantação concluída e registrada na auditoria." }
    case "suspend":
      return { title: `${name} suspenso`, description: "Usuários sem acesso; os gateways continuam enviando dados." }
    case "reactivate":
      return { title: `${name} reativado`, description: "Os usuários do cliente já podem entrar novamente." }
    case "close":
      return { title: `Encerramento de ${name} iniciado`, description: "Exportação completa em preparação; carência de 30 + 30 dias." }
  }
}
