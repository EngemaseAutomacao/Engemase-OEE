/**
 * Terminais pareados (TV Andon e tablet do operador; docs/15 seção 1 e riscos 11 e 12; L19).
 *
 * Cadastro (`config.write`, equipe Engemase, D12): o terminal nasce sem token, com um CÓDIGO DE PAREAMENTO
 * de uso único que vale 10 minutos (`account_token`, finalidade `terminal_pairing`, só o hash no banco).
 * Gerar outro código invalida o anterior; revogar invalida o aparelho e os códigos na hora.
 *
 * Pareamento (sem sessão de pessoa): o aparelho digita o código em /terminal/parear e recebe um TOKEN DE
 * APARELHO (`tm_...`, 256 bits; só o hash no banco) com prazo absoluto de 12 meses, que fica num cookie
 * próprio do caminho /terminal (nunca convive com o cookie de login de uma pessoa). Limite de tentativas
 * por IP; código errado, usado ou vencido dão a mesma resposta.
 *
 * Contexto do aparelho (`terminalContext`): o token vira um `TenantContext` de acesso `terminal`, com o
 * escopo = as máquinas do terminal (TV: as das linhas escolhidas; tablet: as máquinas escolhidas) e as
 * permissões mínimas (TV: `data.read`; tablet: `data.read` + `floor.act`). Cliente suspenso ou encerrado,
 * terminal revogado ou vencido: sem acesso.
 */
import { createHmac, randomBytes, randomInt } from "node:crypto"
import { isIPv6 } from "node:net"
import {
  accountToken,
  auditLog,
  clientAccount,
  line,
  machine,
  organization,
  resolveByTokenHash,
  sha256Hex,
  terminal,
  unit,
  withAppRole,
  withTenant,
} from "@engemase/db"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { Permission } from "@/lib/server/access/permissions"
import { type GatewayDb, type GatewayTx, queryRows, rowsExecutor } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "@/lib/server/config/products"

/** Validade do código de pareamento. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000
/** Prazo absoluto do token do aparelho (docs/15, risco 11). */
export const DEVICE_TOKEN_TTL_MS = 365 * 86_400_000
/** Tentativas de pareamento por IP (IPv6: por bloco /64): 10 por hora (rajada de 10). */
const PAIR_LIMIT = { intervalMs: 360_000, burst: 10 }
/**
 * Tentativas de pareamento no sistema todo: 1.000 por hora (rajada de 300). Pareamento legítimo é raro; isto
 * segura uma varredura distribuída (muitos IPs): no máximo ~1.000 palpites/h contra 100 milhões de códigos.
 * Estourou: ninguém pareia por alguns minutos e o log avisa.
 */
const PAIR_GLOBAL_LIMIT = { intervalMs: 3_600, burst: 300 }
/** Estados do cliente em que os terminais funcionam (fail-closed: estado desconhecido não entra). */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["active", "onboarding"])
/** `last_seen_at` só é regravado depois deste intervalo (não escreve a cada tela aberta). */
const LAST_SEEN_EVERY_MS = 5 * 60_000

const DEVICE_TOKEN_RE = /^tm_[A-Za-z0-9_-]{43}$/

/** Tela ↔ banco: "andon_tv"/"operator_tablet" na tela; "tv"/"tablet" no banco. */
export type ScreenKind = "andon_tv" | "operator_tablet"
export const toDbKind = (k: ScreenKind): "tv" | "tablet" => (k === "andon_tv" ? "tv" : "tablet")
export const toScreenKind = (k: string): ScreenKind => (k === "tv" ? "andon_tv" : "operator_tablet")

/** Só os dígitos do código (o aparelho digita num teclado numérico; espaço e hífen são ignorados). */
export function normalizePairingCode(code: string): string {
  return code.replace(/\D/g, "")
}

/**
 * Código novo de 8 dígitos no formato "1234 5678" (aleatório criptográfico). Numérico para o teclado da TV
 * e do tablet; com uso único, 10 minutos de validade e o limite por IP, adivinhar não compensa.
 */
export function generatePairingCode(): string {
  let raw = ""
  for (let i = 0; i < 8; i++) raw += String(randomInt(10))
  return `${raw.slice(0, 4)} ${raw.slice(4)}`
}

/**
 * Hash do código como guardado em `account_token` (só os dígitos). Com segredo do servidor (HMAC), quem ler
 * um backup ou uma cópia do banco não consegue reverter os códigos (8 dígitos se testam em segundos). Sem
 * segredo (desenvolvimento e testes), um SHA-256 com domínio próprio.
 */
export function hashPairingCode(code: string): string {
  const digits = normalizePairingCode(code)
  const secret = (process.env.TERMINAL_PAIRING_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "").trim()
  return secret === "" ? sha256Hex(`terminal-pairing:${digits}`) : createHmac("sha256", secret).update(`terminal-pairing:${digits}`).digest("hex")
}

/** Chave do limite por IP: IPv6 agrupado pelo bloco /64 (um atacante tem o bloco inteiro). */
export function pairingIpKey(ip: string | null): string {
  if (ip === null) return "terminal-pair:ip:desconhecido"
  if (!isIPv6(ip)) return `terminal-pair:ip:${ip}`
  const [head = "", tail = ""] = ip.toLowerCase().split("::")
  const left = head === "" ? [] : head.split(":")
  const right = tail === "" ? [] : tail.split(":")
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left
  return `terminal-pair:ip6:${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`
}

/** Token de aparelho novo (`tm_` + 32 bytes em base64url). */
export function generateDeviceToken(): string {
  return `tm_${randomBytes(32).toString("base64url")}`
}

export function hashDeviceToken(token: string): string {
  return sha256Hex(token)
}

// ---------------------------------------------------------------------------------------------
// Cadastro (equipe Engemase)
// ---------------------------------------------------------------------------------------------

export const TerminalInput = z.object({
  name: z.string().trim().min(3, "Dê um nome que identifique o aparelho no chão de fábrica.").max(80, "Nome muito longo."),
  kind: z.enum(["andon_tv", "operator_tablet"], "Tipo de terminal inválido."),
  unitId: z.uuid("Unidade inválida."),
  lineIds: z.array(z.uuid()).max(50).default([]),
  machineIds: z.array(z.uuid()).max(200).default([]),
})

const EditInput = z.object({
  id: z.uuid(),
  name: TerminalInput.shape.name,
  lineIds: TerminalInput.shape.lineIds,
  machineIds: TerminalInput.shape.machineIds,
})

const NAO_ENCONTRADO = { ok: false, mensagem: "Terminal não encontrado. Atualize a página." } as const

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | { ok: false; mensagem: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is { ok: false; mensagem: string } => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false

/** O escopo do terminal fecha com o tipo e a unidade (linhas ou máquinas da unidade, não excluídas)? */
async function escopoValido(tx: GatewayTx, kind: "tv" | "tablet", unitId: string, lineIds: readonly string[], machineIds: readonly string[]): Promise<string | null> {
  if (kind === "tv") {
    if (lineIds.length === 0 || machineIds.length > 0) return "Escolha ao menos uma linha para a TV mostrar."
    const ok = await tx.select({ id: line.id }).from(line).where(and(inArray(line.id, [...lineIds]), eq(line.unitId, unitId), isNull(line.deletedAt)))
    return ok.length === new Set(lineIds).size ? null : "Linha não encontrada nesta unidade. Atualize a página."
  }
  if (machineIds.length === 0 || lineIds.length > 0) return "Escolha ao menos uma máquina para o tablet."
  const ok = await tx.select({ id: machine.id }).from(machine).where(and(inArray(machine.id, [...machineIds]), eq(machine.unitId, unitId), isNull(machine.deletedAt)))
  return ok.length === new Set(machineIds).size ? null : "Máquina não encontrada nesta unidade. Atualize a página."
}

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityId: string, unitId: string | null, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "terminal", entityId, unitId, after })
}

/** Invalida os códigos ainda não usados do terminal e cria um novo. Devolve o código em claro (só agora). */
async function novoCodigo(tx: GatewayTx, organizationId: string, terminalId: string, createdBy: string | null, now: Date): Promise<{ code: string; expiresAt: Date }> {
  await tx
    .update(accountToken)
    .set({ usedAt: now })
    .where(and(eq(accountToken.terminalId, terminalId), eq(accountToken.purpose, "terminal_pairing"), isNull(accountToken.usedAt)))
  // O hash é único entre TODOS os clientes, para sempre (códigos antigos ficam guardados), e a RLS não deixa
  // ver os dos outros: tenta gravar num savepoint e, se colidir, sorteia outro código.
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS)
  for (let attempt = 0; ; attempt++) {
    const code = generatePairingCode()
    try {
      await tx.transaction((sp) =>
        sp.insert(accountToken).values({ organizationId, purpose: "terminal_pairing", tokenHash: hashPairingCode(code), terminalId, expiresAt, createdBy, createdAt: now }),
      )
      return { code, expiresAt }
    } catch (error) {
      const unique = (error as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (error as { code?: unknown })?.code
      if (unique !== "23505" || attempt >= 4) throw error
    }
  }
}

/** Cadastra o terminal e devolve o primeiro código de pareamento. */
export async function criarTerminal(db: GatewayDb, ctx: TenantContext, input: unknown, now = new Date()): Promise<ConfigResult<{ id: string; code: string; expiresAt: Date }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(TerminalInput, input)
  if (invalida(v)) return v
  const kind = toDbKind(v.kind)
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string; code: string; expiresAt: Date }>> => {
    const [u] = await tx.select({ id: unit.id }).from(unit).where(and(eq(unit.id, v.unitId), isNull(unit.deletedAt))).limit(1)
    if (u === undefined) return { ok: false, mensagem: "Unidade não encontrada. Atualize a página." }
    const problema = await escopoValido(tx, kind, u.id, v.lineIds, v.machineIds)
    if (problema !== null) return { ok: false, mensagem: problema }
    const [row] = await tx
      .insert(terminal)
      .values({ organizationId: ctx.organizationId, unitId: u.id, name: v.name, kind, lineIds: [...new Set(v.lineIds)], machineIds: [...new Set(v.machineIds)] })
      .returning({ id: terminal.id })
    if (row === undefined) throw new Error("terminal não gravado")
    const { code, expiresAt } = await novoCodigo(tx, ctx.organizationId, row.id, ctx.user.id, now)
    await auditar(tx, ctx, "terminal.created", row.id, u.id, { name: v.name, kind, line_ids: v.lineIds, machine_ids: v.machineIds })
    return { ok: true, dados: { id: row.id, code, expiresAt } }
  })
}

/** Muda nome e escopo (tipo e unidade não mudam: para isso, cadastre outro terminal). */
export async function editarTerminal(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(EditInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [t] = await tx
      .select({ id: terminal.id, kind: terminal.kind, unitId: terminal.unitId })
      .from(terminal)
      .where(and(eq(terminal.id, v.id), isNull(terminal.revokedAt)))
      .for("update")
      .limit(1)
    if (t === undefined) return NAO_ENCONTRADO
    const problema = await escopoValido(tx, t.kind, t.unitId, v.lineIds, v.machineIds)
    if (problema !== null) return { ok: false, mensagem: problema }
    await tx
      .update(terminal)
      .set({ name: v.name, lineIds: [...new Set(v.lineIds)], machineIds: [...new Set(v.machineIds)], updatedAt: new Date() })
      .where(eq(terminal.id, t.id))
    await auditar(tx, ctx, "terminal.updated", t.id, t.unitId, { name: v.name, line_ids: v.lineIds, machine_ids: v.machineIds })
    return { ok: true, dados: { id: t.id } }
  })
}

/** Gera outro código de pareamento (o anterior deixa de valer). Vale também para trocar o aparelho. */
export async function gerarCodigoTerminal(db: GatewayDb, ctx: TenantContext, id: unknown, now = new Date()): Promise<ConfigResult<{ code: string; expiresAt: Date }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ code: string; expiresAt: Date }>> => {
    const [t] = await tx.select({ id: terminal.id, unitId: terminal.unitId }).from(terminal).where(and(eq(terminal.id, id), isNull(terminal.revokedAt))).for("update").limit(1)
    if (t === undefined) return NAO_ENCONTRADO
    const r = await novoCodigo(tx, ctx.organizationId, t.id, ctx.user.id, now)
    await auditar(tx, ctx, "terminal.pairing_code", t.id, t.unitId, { expires_at: r.expiresAt.toISOString() })
    return { ok: true, dados: r }
  })
}

/** Revoga o terminal: o token do aparelho e os códigos deixam de valer agora. */
export async function revogarTerminal(db: GatewayDb, ctx: TenantContext, id: unknown, now = new Date()): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [t] = await tx
      .update(terminal)
      .set({ revokedAt: now, revokedBy: ctx.user.id, updatedAt: now })
      .where(and(eq(terminal.id, id), isNull(terminal.revokedAt)))
      .returning({ id: terminal.id, unitId: terminal.unitId, name: terminal.name })
    if (t === undefined) return NAO_ENCONTRADO
    await tx
      .update(accountToken)
      .set({ usedAt: now })
      .where(and(eq(accountToken.terminalId, t.id), eq(accountToken.purpose, "terminal_pairing"), isNull(accountToken.usedAt)))
    await auditar(tx, ctx, "terminal.revoked", t.id, t.unitId, { name: t.name })
    return { ok: true, dados: { id: t.id } }
  })
}

// ---------------------------------------------------------------------------------------------
// Pareamento (aparelho, sem sessão de pessoa)
// ---------------------------------------------------------------------------------------------

export type PairResult =
  | { readonly ok: true; readonly token: string; readonly expiresAt: Date; readonly terminalId: string }
  | { readonly ok: false; readonly code: "invalid" | "rate_limited"; readonly mensagem: string }

const CODIGO_INVALIDO = {
  ok: false,
  code: "invalid",
  mensagem: "Código inválido ou vencido. Confira os números ou peça um código novo em Configurações › Terminais (vale 10 minutos).",
} as const

/** Troca o código de pareamento por um token de aparelho (uso único). */
export async function parearAparelho(db: GatewayDb, rawCode: unknown, opts: { readonly now?: Date; readonly ip: string | null }): Promise<PairResult> {
  const now = opts.now ?? new Date()
  // Limite por IP antes de olhar o código (força bruta).
  const take = (key: string, l: { intervalMs: number; burst: number }) =>
    withAppRole(db, (tx) =>
      queryRows<{ allowed: boolean }>(
        tx,
        sql`SELECT allowed FROM app.rate_limit_take(${key}, ${l.intervalMs}::integer, ${l.burst}::integer, ${now.toISOString()}::timestamptz)`,
      ),
    ).then((rows) => rows[0]?.allowed === true)
  const muitas = { ok: false, code: "rate_limited", mensagem: "Muitas tentativas. Espere alguns minutos e tente de novo." } as const
  if (!(await take(pairingIpKey(opts.ip), PAIR_LIMIT))) return muitas
  if (!(await take("terminal-pair:global", PAIR_GLOBAL_LIMIT))) {
    console.error("[terminal] limite geral de tentativas de pareamento atingido: possível varredura de códigos")
    return muitas
  }
  if (typeof rawCode !== "string" || rawCode.length > 20 || normalizePairingCode(rawCode).length !== 8) return CODIGO_INVALIDO
  const codeHash = hashPairingCode(rawCode)
  const ref = await withAppRole(db, (tx) => resolveByTokenHash(rowsExecutor(tx), "accountToken", codeHash))
  if (ref === null) return CODIGO_INVALIDO

  const token = generateDeviceToken()
  const expiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_MS)
  return withTenant(db, ref.organizationId, async (tx): Promise<PairResult> => {
    const [pairing] = await tx
      .select({ id: accountToken.id, terminalId: accountToken.terminalId, createdBy: accountToken.createdBy })
      .from(accountToken)
      .where(and(eq(accountToken.id, ref.id), eq(accountToken.purpose, "terminal_pairing"), isNull(accountToken.usedAt), sql`${accountToken.expiresAt} > ${now.toISOString()}::timestamptz`))
      .for("update")
      .limit(1)
    if (pairing === undefined || pairing.terminalId === null) return CODIGO_INVALIDO
    // Cliente suspenso, encerrado ou sem conta: não gasta o código nem grava pareamento.
    const [acct] = await tx.select({ status: clientAccount.status }).from(clientAccount).limit(1)
    if (acct === undefined || !OPEN_STATUSES.has(acct.status)) return CODIGO_INVALIDO
    const [t] = await tx
      .select({ id: terminal.id, unitId: terminal.unitId, name: terminal.name })
      .from(terminal)
      .where(and(eq(terminal.id, pairing.terminalId), isNull(terminal.revokedAt)))
      .for("update")
      .limit(1)
    if (t === undefined) return CODIGO_INVALIDO
    await tx.update(accountToken).set({ usedAt: now }).where(eq(accountToken.id, pairing.id))
    await tx
      .update(terminal)
      .set({ tokenHash: hashDeviceToken(token), pairedAt: now, pairedBy: pairing.createdBy, expiresAt, lastSeenAt: now, updatedAt: now })
      .where(eq(terminal.id, t.id))
    await tx.insert(auditLog).values({
      organizationId: ref.organizationId,
      actorType: "terminal",
      actorId: t.id,
      actorLabel: `Terminal ${t.name}`,
      action: "terminal.paired",
      entityType: "terminal",
      entityId: t.id,
      unitId: t.unitId,
      after: { expires_at: expiresAt.toISOString(), ip: opts.ip },
      at: now,
    })
    return { ok: true, token, expiresAt, terminalId: t.id }
  })
}

// ---------------------------------------------------------------------------------------------
// Contexto do aparelho pareado
// ---------------------------------------------------------------------------------------------

export interface TerminalSession {
  readonly ctx: TenantContext
  readonly terminal: {
    readonly id: string
    readonly name: string
    readonly kind: "tv" | "tablet"
    readonly unitId: string
    readonly lineIds: readonly string[]
    /** Máquinas que o terminal mostra (TV: das linhas; tablet: as escolhidas), sem as excluídas. */
    readonly machineIds: readonly string[]
  }
}

const TV_PERMISSIONS: ReadonlySet<Permission> = new Set(["data.read"])
const TABLET_PERMISSIONS: ReadonlySet<Permission> = new Set(["data.read", "floor.act"])

/** Token do aparelho → contexto de acesso do terminal, ou `null` (sem token, revogado, vencido, suspenso, sem máquinas). */
export async function terminalContext(db: GatewayDb, deviceToken: string | undefined | null, now = new Date()): Promise<TerminalSession | null> {
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_RE.test(deviceToken)) return null
  const ref = await withAppRole(db, (tx) => resolveByTokenHash(rowsExecutor(tx), "terminalToken", hashDeviceToken(deviceToken)))
  if (ref === null) return null
  return withTenant(db, ref.organizationId, async (tx): Promise<TerminalSession | null> => {
    const [t] = await tx
      .select({ id: terminal.id, name: terminal.name, kind: terminal.kind, unitId: terminal.unitId, lineIds: terminal.lineIds, machineIds: terminal.machineIds, lastSeenAt: terminal.lastSeenAt })
      .from(terminal)
      .where(and(eq(terminal.id, ref.id), isNull(terminal.revokedAt)))
      .limit(1)
    if (t === undefined) return null
    const [org] = await tx
      .select({ id: organization.id, slug: organization.slug, status: clientAccount.status })
      .from(organization)
      .innerJoin(clientAccount, eq(clientAccount.organizationId, organization.id))
      .limit(1)
    if (org === undefined || !OPEN_STATUSES.has(org.status)) return null
    const machines = await tx
      .select({ id: machine.id })
      .from(machine)
      .where(
        and(
          eq(machine.unitId, t.unitId),
          isNull(machine.deletedAt),
          t.kind === "tv" ? (t.lineIds.length > 0 ? inArray(machine.lineId, t.lineIds) : sql`false`) : t.machineIds.length > 0 ? inArray(machine.id, t.machineIds) : sql`false`,
        ),
      )
    if (machines.length === 0) return null
    if (t.lastSeenAt === null || now.getTime() - t.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
      await tx.update(terminal).set({ lastSeenAt: now }).where(eq(terminal.id, t.id))
    }
    const machineIds = machines.map((m) => m.id)
    return {
      ctx: {
        organizationId: org.id,
        slug: org.slug,
        clientStatus: org.status as TenantContext["clientStatus"],
        user: { id: t.id, name: t.name, email: "" },
        sessionId: t.id,
        access: { kind: "terminal", terminalId: t.id, terminalKind: t.kind },
        scope: { kind: "machines", machineIds },
        permissions: t.kind === "tv" ? TV_PERMISSIONS : TABLET_PERMISSIONS,
      },
      terminal: { id: t.id, name: t.name, kind: t.kind, unitId: t.unitId, lineIds: t.lineIds, machineIds },
    }
  })
}
