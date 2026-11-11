/**
 * Modelo do assistente "Novo cliente" (docs/15 §7): estado, valores iniciais e validação por passo.
 */
import type { ClientPlan } from "@/lib/mock/types"
import { PLAN_DEFAULTS, RESERVED_SLUGS, isEmail, isValidCnpj, onlyDigits, type PlanLimits } from "./labels"

export interface WizardData {
  // 1. Empresa
  legalName: string
  tradeName: string
  cnpj: string
  city: string
  uf: string
  slug: string
  slugEdited: boolean
  plan: ClientPlan
  limits: PlanLimits
  managed: boolean
  // 2. Primeira unidade
  unitName: string
  unitCity: string
  unitUf: string
  timezone: string
  timezoneEdited: boolean
  shiftTemplate: string
  // 3. Primeiro admin
  adminName: string
  adminEmail: string
  adminPhone: string
  sendEmail: boolean
}

export type WizardErrors = Partial<Record<keyof WizardData | "limits.machines" | "limits.gateways" | "limits.users" | "limits.retentionMonths", string>>

/** Dados já existentes na plataforma, usados para validar duplicidade. */
export interface WizardContext {
  usedSlugs: string[]
  usedCnpjs: string[]
  knownEmails: { email: string; name: string; clients: string[] }[]
  engemaseDomain: string
}

export const INITIAL_DATA: WizardData = {
  legalName: "",
  tradeName: "",
  cnpj: "",
  city: "",
  uf: "",
  slug: "",
  slugEdited: false,
  plan: "pro",
  limits: { machines: PLAN_DEFAULTS.pro.machines, gateways: PLAN_DEFAULTS.pro.gateways, users: PLAN_DEFAULTS.pro.users, retentionMonths: PLAN_DEFAULTS.pro.retentionMonths },
  managed: true,
  unitName: "",
  unitCity: "",
  unitUf: "",
  timezone: "America/Sao_Paulo",
  timezoneEdited: false,
  shiftTemplate: "tres-turnos",
  adminName: "",
  adminEmail: "",
  adminPhone: "",
  sendEmail: true,
}

export const STEPS = [
  { key: "empresa", title: "Empresa", hint: "Dados, identificador e plano" },
  { key: "unidade", title: "Primeira unidade", hint: "Planta, fuso e turnos" },
  { key: "admin", title: "Primeiro admin", hint: "Quem recebe o acesso" },
  { key: "revisao", title: "Revisão", hint: "Conferir e criar" },
] as const

export type SlugCheck = { ok: true; message: string } | { ok: false; message: string }

export function checkSlug(slug: string, ctx: WizardContext): SlugCheck {
  if (!slug) return { ok: false, message: "Informe o identificador." }
  if (slug.length < 3) return { ok: false, message: "Use pelo menos 3 caracteres." }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { ok: false, message: "Só letras minúsculas sem acento, números e hífen (sem hífen no início ou no fim)." }
  if (RESERVED_SLUGS.includes(slug)) return { ok: false, message: `“${slug}” é um nome reservado da plataforma.` }
  if (ctx.usedSlugs.includes(slug)) return { ok: false, message: "Já usado por outro cliente. Identificadores nunca são reaproveitados." }
  return { ok: true, message: "Disponível" }
}

export function validateCompany(d: WizardData, ctx: WizardContext): WizardErrors {
  const e: WizardErrors = {}
  if (d.legalName.trim().length < 3) e.legalName = "Informe a razão social."
  if (d.tradeName.trim().length < 2) e.tradeName = "Informe o nome fantasia (aparece nas telas)."
  const cnpj = onlyDigits(d.cnpj)
  if (cnpj.length === 0) e.cnpj = "Informe o CNPJ."
  else if (cnpj.length !== 14) e.cnpj = "O CNPJ tem 14 dígitos."
  else if (!isValidCnpj(cnpj)) e.cnpj = "CNPJ inválido: os dígitos verificadores não conferem."
  else if (ctx.usedCnpjs.includes(cnpj)) e.cnpj = "Já existe um cliente com este CNPJ. Uma nova planta entra como unidade dele."
  if (!d.city.trim()) e.city = "Informe a cidade."
  if (!d.uf) e.uf = "Selecione a UF."
  const slug = checkSlug(d.slug, ctx)
  if (!slug.ok) e.slug = slug.message
  if (!(d.limits.machines >= 1)) e["limits.machines"] = "Mínimo 1."
  if (!(d.limits.gateways >= 1)) e["limits.gateways"] = "Mínimo 1."
  if (!(d.limits.users >= 1)) e["limits.users"] = "Mínimo 1."
  if (!(d.limits.retentionMonths >= 6)) e["limits.retentionMonths"] = "Mínimo 6 meses."
  return e
}

export function validateUnit(d: WizardData): WizardErrors {
  const e: WizardErrors = {}
  if (d.unitName.trim().length < 2) e.unitName = "Informe o nome da unidade."
  if (!d.unitCity.trim()) e.unitCity = "Informe a cidade da unidade."
  if (!d.unitUf) e.unitUf = "Selecione a UF."
  if (!d.timezone) e.timezone = "Selecione o fuso."
  return e
}

export function validateAdmin(d: WizardData, ctx: WizardContext): WizardErrors {
  const e: WizardErrors = {}
  if (d.adminName.trim().split(/\s+/).length < 2) e.adminName = "Informe nome e sobrenome."
  const email = d.adminEmail.trim().toLowerCase()
  if (!email) e.adminEmail = "Informe o e-mail."
  else if (!isEmail(email)) e.adminEmail = "E-mail inválido."
  else if (email.endsWith(`@${ctx.engemaseDomain}`)) e.adminEmail = "Use o e-mail de alguém do cliente: a equipe Engemase não vira membro dos clientes."
  return e
}

export function validateStep(step: number, d: WizardData, ctx: WizardContext): WizardErrors {
  if (step === 0) return validateCompany(d, ctx)
  if (step === 1) return validateUnit(d)
  if (step === 2) return validateAdmin(d, ctx)
  return {}
}
