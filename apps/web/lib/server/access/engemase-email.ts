/**
 * E-mails da equipe Engemase (docs/15, seção 3; docs/12): ninguém da Engemase entra como usuário de um
 * cliente, e em especial nunca como admin dele. É o admin do cliente quem aprova o acesso remoto que a
 * Engemase pede; se ele fosse da Engemase, ela aprovaria o próprio acesso à rede da fábrica.
 *
 * Vale para quem já tem conta com papel de plataforma (conferido em cada caminho) E para qualquer e-mail
 * dos domínios da Engemase, mesmo sem conta ainda. Domínios em `ENGEMASE_EMAIL_DOMAINS` (lista separada
 * por vírgula; padrão `engemase.com.br`); subdomínios contam.
 */
const PADRAO = ["engemase.com.br"]

export function dominiosDaEngemase(env: string | undefined = process.env.ENGEMASE_EMAIL_DOMAINS): string[] {
  const lista = (env ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
  return lista.length > 0 ? lista : PADRAO
}

/** O e-mail é de um domínio da Engemase (ou de um subdomínio dele)? */
export function ehEmailDaEngemase(email: string, dominios: readonly string[] = dominiosDaEngemase()): boolean {
  const dominio = email.trim().toLowerCase().split("@").at(-1) ?? ""
  if (dominio === "" || !email.includes("@")) return false
  return dominios.some((d) => dominio === d || dominio.endsWith(`.${d}`))
}
