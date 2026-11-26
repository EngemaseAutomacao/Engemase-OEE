/**
 * Erros "esperados" das gravações de produção (turnos, lançamento de refugo): a tela mostra a mensagem
 * em português. A rota traduz o código para o status HTTP com `PRODUCTION_ERROR_STATUS`.
 */
export type ProductionRuleErrorCode =
  /** Entrada fora do formato (campo a campo na mensagem). */
  | "invalid_input"
  /** Unidade, turno, máquina, motivo, operador ou lançamento inexistente (ou de outro cliente: a RLS esconde). */
  | "not_found"
  /** Turno se sobrepõe a outro da mesma unidade (L2). */
  | "shift_overlap"
  /** Mudar o horário de um turno que já tem turnos consolidados (L2: mudança vale dali para a frente). */
  | "shift_already_consolidated"
  /** Lançamento atrasado depois do fim do turno seguinte, sem ser supervisor (L3). */
  | "late_entry_deadline"
  /** Lançamento já estornado (só um estorno por lançamento) ou estorno de estorno. */
  | "already_reversed"

export class ProductionRuleError extends Error {
  override readonly name = "ProductionRuleError"
  readonly code: ProductionRuleErrorCode

  constructor(code: ProductionRuleErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export const PRODUCTION_ERROR_STATUS: Readonly<Record<ProductionRuleErrorCode, number>> = {
  invalid_input: 400,
  not_found: 404,
  shift_overlap: 409,
  shift_already_consolidated: 409,
  late_entry_deadline: 403,
  already_reversed: 409,
}

/** Quem fez a gravação (vai para a auditoria). `clientRole` decide o prazo do lançamento atrasado (L3). */
export interface ProductionActor {
  readonly type: "user" | "engemase" | "terminal"
  readonly id: string | null
  readonly label?: string | null
  /** Papel no cliente (null = equipe Engemase ou terminal). */
  readonly clientRole: "client_admin" | "engineer" | "supervisor" | "operator" | "viewer" | null
}
