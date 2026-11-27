/** Quem aparece na auditoria do cliente quando uma pessoa age pelo `TenantContext` (D5: Engemase identificada). */
import type { AuditActorType } from "@engemase/db"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import type { TenantContext } from "@/lib/server/access/context"

export interface AuditActor {
  readonly actorType: AuditActorType
  readonly actorId: string
  readonly actorLabel: string
  readonly accessGrantId: string | null
}

export function auditActor(ctx: TenantContext): AuditActor {
  if (ctx.access.kind === "terminal") {
    return { actorType: "terminal", actorId: ctx.access.terminalId, actorLabel: `Terminal ${ctx.user.name}`, accessGrantId: null }
  }
  if (ctx.access.kind === "engemase") {
    return {
      actorType: "engemase",
      actorId: ctx.user.id,
      actorLabel: `${ctx.user.name} (${PLATFORM_ROLE_LABEL[ctx.access.role].toLowerCase()} Engemase)`,
      accessGrantId: ctx.access.supportGrantId ?? ctx.access.assignmentId,
    }
  }
  return { actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.name, accessGrantId: null }
}

/** Nome de quem fez, para os e-mails ("Carlos Mendes (Engemase)" / "Ana Souza"). */
export function actorDisplayName(ctx: TenantContext): string {
  return ctx.access.kind === "engemase" ? `${ctx.user.name} (Engemase)` : ctx.user.name
}
