/**
 * Rótulos, tons e regras do console de clientes (área "console-clientes").
 * Funções puras: podem ser usadas em componentes de servidor e de cliente.
 */
import type { ClientManagement, ClientPlan, ClientStatus } from "@/lib/mock/types"

/** No protótipo, "encerrar" vira um estado local de tela (não existe nos dados simulados). */
export type AdminClientStatus = ClientStatus | "closed"

export type SoftTone = "blue" | "navy" | "teal" | "orange" | "green" | "amber" | "red" | "violet" | "slate"

export const STATUS_LABEL: Record<AdminClientStatus, string> = {
  onboarding: "Implantação",
  active: "Ativo",
  suspended: "Suspenso",
  closed: "Encerrado",
}

export const STATUS_TONE: Record<AdminClientStatus, SoftTone> = {
  onboarding: "blue",
  active: "green",
  suspended: "amber",
  closed: "slate",
}

export const STATUS_EFFECT: Record<AdminClientStatus, string> = {
  onboarding: "Cliente criado, sem uso produtivo. A Engemase configura; o admin do cliente já pode entrar.",
  active: "Uso normal da plataforma por todos os usuários do cliente.",
  suspended: "Usuários do cliente não acessam (mensagem clara no login). Os gateways continuam enviando dados e a Engemase acessa com registro.",
  closed: "Exportação completa entregue, carência, revogação de gateways e terminais, exclusão definitiva e termo de eliminação.",
}

export const LIFECYCLE_ORDER: AdminClientStatus[] = ["onboarding", "active", "suspended", "closed"]

export const PLAN_TONE: Record<ClientPlan, SoftTone> = { starter: "slate", pro: "blue", enterprise: "navy" }

export const MANAGEMENT_LABEL: Record<ClientManagement, string> = {
  engemase: "Gerenciado pela Engemase",
  self: "Autogestão",
}

export const MANAGEMENT_SHORT: Record<ClientManagement, string> = {
  engemase: "Engemase",
  self: "Autogestão",
}

export const MANAGEMENT_HINT: Record<ClientManagement, string> = {
  engemase: "Gateways, conexões, tags e publicação de configuração ficam só leitura para o cliente; a Engemase configura como serviço.",
  self: "O cliente configura gateways, CLPs e tags com os próprios engenheiros.",
}

export interface PlanLimits {
  machines: number
  gateways: number
  users: number
  retentionMonths: number
}

/** Limites sugeridos por plano (editáveis pelo super admin na criação). */
export const PLAN_DEFAULTS: Record<ClientPlan, PlanLimits & { summary: string }> = {
  starter: { machines: 10, gateways: 2, users: 15, retentionMonths: 12, summary: "Uma planta pequena, até 10 máquinas" },
  pro: { machines: 20, gateways: 4, users: 30, retentionMonths: 24, summary: "Várias linhas, relatórios e alertas completos" },
  enterprise: { machines: 60, gateways: 12, users: 100, retentionMonths: 36, summary: "Várias plantas, retenção estendida e suporte prioritário" },
}

/** Domínio canônico da plataforma (docs/08, D28). */
export const PLATFORM_HOST = "oee.engemase.com.br"

/** Identificadores reservados (docs/15 §6): nunca viram slug de cliente. */
export const RESERVED_SLUGS = [
  "admin",
  "api",
  "ajuda",
  "app",
  "auth",
  "conta",
  "config",
  "definir-senha",
  "engemase",
  "gateway",
  "gw",
  "login",
  "logout",
  "novo",
  "status",
  "suporte",
  "terminal",
  "www",
]

/** "Plastiform Embalagens" → "plastiform-embalagens" (sem acentos, até 40 caracteres). */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
}

export const onlyDigits = (s: string) => s.replace(/\D/g, "")

/** Máscara progressiva de CNPJ: 00.000.000/0000-00 */
export function maskCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14)
  let out = d.slice(0, 2)
  if (d.length > 2) out += `.${d.slice(2, 5)}`
  if (d.length > 5) out += `.${d.slice(5, 8)}`
  if (d.length > 8) out += `/${d.slice(8, 12)}`
  if (d.length > 12) out += `-${d.slice(12, 14)}`
  return out
}

/** Valida os dígitos verificadores do CNPJ. */
export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB",
  "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const

export const TIMEZONES: { value: string; label: string; hint: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (UTC−3)", hint: "Sul, Sudeste, Nordeste, GO, DF, PA, AP, TO" },
  { value: "America/Campo_Grande", label: "Campo Grande (UTC−4)", hint: "Mato Grosso do Sul" },
  { value: "America/Cuiaba", label: "Cuiabá (UTC−4)", hint: "Mato Grosso" },
  { value: "America/Manaus", label: "Manaus (UTC−4)", hint: "Amazonas" },
  { value: "America/Boa_Vista", label: "Boa Vista (UTC−4)", hint: "Roraima" },
  { value: "America/Porto_Velho", label: "Porto Velho (UTC−4)", hint: "Rondônia" },
  { value: "America/Rio_Branco", label: "Rio Branco (UTC−5)", hint: "Acre" },
  { value: "America/Noronha", label: "Fernando de Noronha (UTC−2)", hint: "Ilhas oceânicas" },
]

export const timezoneLabel = (tz: string) => TIMEZONES.find((t) => t.value === tz)?.label ?? tz

/** Fuso sugerido a partir da UF da unidade. */
export function timezoneForUf(uf: string): string {
  const map: Record<string, string> = {
    MS: "America/Campo_Grande",
    MT: "America/Cuiaba",
    AM: "America/Manaus",
    RR: "America/Boa_Vista",
    RO: "America/Porto_Velho",
    AC: "America/Rio_Branco",
  }
  return map[uf] ?? "America/Sao_Paulo"
}

export interface ShiftTemplate {
  id: string
  name: string
  days: string
  shifts: { name: string; start: string; end: string }[]
}

/** Modelos de turno oferecidos na criação da primeira unidade (editáveis depois em Turnos). */
export const SHIFT_TEMPLATES: ShiftTemplate[] = [
  {
    id: "tres-turnos",
    name: "3 turnos de 8 h",
    days: "Segunda a sábado",
    shifts: [
      { name: "1º turno", start: "06:00", end: "14:00" },
      { name: "2º turno", start: "14:00", end: "22:00" },
      { name: "3º turno", start: "22:00", end: "06:00" },
    ],
  },
  {
    id: "dois-turnos",
    name: "2 turnos",
    days: "Segunda a sexta",
    shifts: [
      { name: "Manhã", start: "05:00", end: "13:30" },
      { name: "Tarde", start: "13:30", end: "22:00" },
    ],
  },
  {
    id: "doze-36",
    name: "Escala 12 × 36",
    days: "Todos os dias, equipes alternadas",
    shifts: [
      { name: "Dia", start: "07:00", end: "19:00" },
      { name: "Noite", start: "19:00", end: "07:00" },
    ],
  },
  {
    id: "comercial",
    name: "Turno único",
    days: "Segunda a sexta",
    shifts: [{ name: "Turno único", start: "07:00", end: "17:00" }],
  },
  { id: "depois", name: "Configurar depois", days: "A unidade fica sem turnos até alguém cadastrá-los", shifts: [] },
]

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
