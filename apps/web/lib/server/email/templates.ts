/**
 * Textos dos e-mails da conta (português simples). Cada função devolve assunto, texto e HTML; todo dado
 * variável passa por `escapeHtml` no HTML. Os links "definir/redefinir senha" levam o token no fragmento
 * (`#t=...`), fora de logs e do Referer (docs/15, item 9).
 */
import type { EmailMessage } from "./index"

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)
}

function hours(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h === 1 ? "1 hora" : `${h} horas`
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} minutos`
}

function layout(paragraphs: readonly string[], link?: { readonly href: string; readonly label: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join("")
  const button =
    link === undefined
      ? ""
      : `<p style="margin:20px 0"><a href="${escapeHtml(link.href)}" style="background:#257bb4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a></p>` +
        `<p style="margin:0 0 12px;font-size:12px;color:#555">Se o botão não abrir, copie este endereço no navegador:<br>${escapeHtml(link.href)}</p>`
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#13263b;max-width:560px">${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#555">Engemase OEE · mensagem automática, não responda.</p></div>`
}

function message(
  to: string,
  subject: string,
  paragraphs: readonly string[],
  link?: { readonly href: string; readonly label: string },
): EmailMessage {
  const text = [...paragraphs, ...(link === undefined ? [] : ["", `${link.label}: ${link.href}`]), "", "Engemase OEE · mensagem automática, não responda."].join(
    "\n",
  )
  return { to, subject, text, html: layout(paragraphs, link) }
}

/** Convite / primeiro acesso: link "definir senha". */
export function setPasswordEmail(input: {
  readonly to: string
  readonly name: string
  readonly clientName: string
  readonly invitedBy: string
  readonly url: string
  readonly ttlMs: number
}): EmailMessage {
  return message(
    input.to,
    `Seu acesso à plataforma Engemase OEE (${input.clientName})`,
    [
      `Olá, ${input.name}.`,
      `${input.invitedBy} liberou o seu acesso à plataforma Engemase OEE da empresa ${input.clientName}.`,
      `Para entrar, crie a sua senha pelo link abaixo. Ele vale por ${hours(input.ttlMs)} e só pode ser usado uma vez.`,
      "Se você não esperava este convite, ignore este e-mail.",
    ],
    { href: input.url, label: "Criar minha senha" },
  )
}

/** Pessoa que já tem senha ganhou acesso a mais um cliente. */
export function accessGrantedEmail(input: {
  readonly to: string
  readonly name: string
  readonly clientName: string
  readonly invitedBy: string
  readonly loginUrl: string
}): EmailMessage {
  return message(
    input.to,
    `Novo acesso na plataforma Engemase OEE (${input.clientName})`,
    [
      `Olá, ${input.name}.`,
      `${input.invitedBy} liberou o seu acesso à empresa ${input.clientName} na plataforma Engemase OEE.`,
      "Entre com o mesmo e-mail e a senha que você já usa. Depois do login, escolha a empresa.",
    ],
    { href: input.loginUrl, label: "Entrar na plataforma" },
  )
}

/** "Esqueci minha senha": link de redefinição. */
export function resetPasswordEmail(input: { readonly to: string; readonly name: string; readonly url: string; readonly ttlMs: number }): EmailMessage {
  return message(
    input.to,
    "Redefinição de senha da plataforma Engemase OEE",
    [
      `Olá, ${input.name}.`,
      `Recebemos um pedido para criar uma nova senha para a sua conta. O link abaixo vale por ${minutes(input.ttlMs)} e só pode ser usado uma vez.`,
      "Se não foi você, ignore este e-mail: a sua senha atual continua valendo.",
    ],
    { href: input.url, label: "Criar nova senha" },
  )
}

/** Conta bloqueada por senhas erradas (L20). */
export function accountLockedEmail(input: {
  readonly to: string
  readonly name: string
  readonly until: Date
  readonly resetUrl: string
}): EmailMessage {
  const until = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(input.until)
  return message(
    input.to,
    "Sua conta na plataforma Engemase OEE foi bloqueada por 15 minutos",
    [
      `Olá, ${input.name}.`,
      `Houve 5 tentativas de entrar na sua conta com a senha errada. Por segurança, o login fica bloqueado até ${until} (horário de Brasília).`,
      "Se foi você, espere e tente de novo, ou crie uma nova senha pelo link abaixo.",
      "Se não foi você, crie uma nova senha e avise o administrador da sua empresa ou o suporte Engemase.",
    ],
    { href: input.resetUrl, label: "Esqueci minha senha" },
  )
}

/** Verificação em duas etapas reiniciada por outra pessoa. */
export function twoFactorResetEmail(input: { readonly to: string; readonly name: string; readonly resetBy: string; readonly loginUrl: string }): EmailMessage {
  return message(
    input.to,
    "A verificação em duas etapas da sua conta foi reiniciada",
    [
      `Olá, ${input.name}.`,
      `${input.resetBy} reiniciou a verificação em duas etapas da sua conta na plataforma Engemase OEE. Todas as suas sessões foram encerradas.`,
      "No próximo login, cadastre de novo o aplicativo autenticador e guarde os novos códigos de recuperação.",
      "Se você não pediu isso, avise o administrador da sua empresa ou o suporte Engemase.",
    ],
    { href: input.loginUrl, label: "Entrar na plataforma" },
  )
}
