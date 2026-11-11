/** Erro de entrada inválida (configuração ou dados incoerentes). A mensagem é em português. */
export class OeeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OeeInputError";
  }
}
