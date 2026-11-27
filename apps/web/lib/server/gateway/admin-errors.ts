/**
 * Erros das operações da web sobre os gateways (publicar config, gerar código de ativação, fila de
 * comandos). São "esperados": a tela mostra a mensagem (em português) e, quando houver, os
 * problemas campo a campo. Não são erros do contrato com o agente (esses são `GatewayApiError`).
 */
import type { ErrorIssue } from "@engemase/contracts"

export type GatewayAdminErrorCode =
  /** Gateway inexistente ou de outro cliente (a RLS esconde). */
  | "gateway_not_found"
  /** Gateway revogado ou excluído. */
  | "gateway_revoked"
  /** Gateway ainda não ativado (comandos não seriam entregues). */
  | "gateway_not_active"
  /** Cadastro não forma uma config válida pelo contrato. */
  | "invalid_config"
  /** Comando fora do contrato v1 (tipo ou payload). */
  | "invalid_command"
  /** O comando cita dispositivo ou barramento que não é do gateway. */
  | "unknown_reference"
  /** Muitos comandos em aberto no gateway. */
  | "too_many_open_commands"
  /** Comando inexistente. */
  | "command_not_found"
  /** Comando já terminou (não dá para cancelar). */
  | "command_finished"

export class GatewayAdminError extends Error {
  override readonly name = "GatewayAdminError"
  readonly code: GatewayAdminErrorCode
  readonly issues: readonly ErrorIssue[]

  constructor(code: GatewayAdminErrorCode, message: string, issues: readonly ErrorIssue[] = []) {
    super(message)
    this.code = code
    this.issues = issues
  }
}

/** Quem fez a operação (vai para a auditoria). */
export interface GatewayAdminActor {
  readonly type: "user" | "engemase" | "terminal" | "system"
  readonly id?: string | null
  readonly label?: string | null
}

export const SYSTEM_ACTOR: GatewayAdminActor = { type: "system" }
