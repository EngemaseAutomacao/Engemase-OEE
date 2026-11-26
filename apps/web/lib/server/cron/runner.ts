/**
 * Tarefas agendadas (Vercel Cron, L17 do docs/17): autenticação pelo `CRON_SECRET`, reserva da janela
 * (uma execução por janela, `app.cron_claim`) e laço por cliente (`withTenant`, sob RLS).
 *
 * A Vercel chama `GET /api/cron/<job>` com `Authorization: Bearer <CRON_SECRET>`. Sem a variável a
 * rota responde 503 (nunca roda sem segredo); com o segredo errado, 401.
 *
 * Cada job:
 * - tem uma janela (`windowKey`): o minuto, os 5 ou 15 minutos, o dia. A mesma janela não roda duas
 *   vezes (chamada repetida da Vercel ou manual responde `skipped`), e uma execução que caiu no meio
 *   libera a janela depois de `lockS` segundos;
 * - é idempotente: rodar de novo não duplica nada;
 * - para de pegar clientes novos perto do limite de tempo da função (`budgetMs`) e diz `incompleto`;
 *   a próxima janela começa do primeiro cliente de novo.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { withTenant } from "@engemase/db"
import { sql } from "drizzle-orm"
import type { MaintenanceDbRunner } from "../db"
import { type GatewayDb, type GatewayTx, queryRows } from "../gateway/types"

/** Duração máxima das funções de cron (s); o laço por cliente para antes, em `budgetMs`. */
export const CRON_MAX_DURATION_S = 60

export interface CronContext {
  readonly db: GatewayDb
  readonly now: Date
  /** Roda `fn` em cada cliente (transação própria por cliente). Falha num cliente não para os outros. */
  forEachOrganization<T>(fn: (tx: GatewayTx, organizationId: string) => Promise<T>): Promise<OrganizationRun<T>>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch: typeof fetch
  readonly log: (message: string, error?: unknown) => void
  /**
   * Conexão do dono das tabelas (`DATABASE_MAINTENANCE_URL`), para DDL como as partições. `null` quando
   * não configurada: quem precisa registra e pula.
   */
  readonly maintenance: MaintenanceDbRunner | null
  /** Milissegundos que ainda restam do tempo do job (`budgetMs`). */
  remainingMs(): number
}

export interface OrganizationRun<T> {
  readonly results: readonly { readonly organizationId: string; readonly value: T }[]
  readonly failures: number
  /** O tempo acabou antes de passar por todos os clientes. */
  readonly incomplete: boolean
}

export interface CronJob {
  /** Nome do job (rota /api/cron/<nome>). */
  readonly name: string
  /** Expressão cron do vercel.json (UTC). */
  readonly schedule: string
  /** Janela da execução. */
  windowKey(now: Date): string
  /** Por quanto tempo uma execução segura a janela (s). */
  readonly lockS: number
  /**
   * Executa. O que devolve vai para `cron_run.result` e para a resposta. `failures > 0` responde 500
   * (aparece nos logs da Vercel), mas a janela fica fechada; para tentar de novo, lance um erro.
   */
  run(ctx: CronContext): Promise<Record<string, unknown> & { readonly failures?: number }>
}

export interface CronDeps {
  readonly db: GatewayDb | null
  readonly secret: string | undefined
  readonly now?: () => Date
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof fetch
  readonly logError?: (message: string, error: unknown) => void
  /** Tempo do laço por cliente (padrão: 45 s, com folga para o limite de 60 s da função). */
  readonly budgetMs?: number
  /** Conexão de manutenção (dono das tabelas); padrão: nenhuma. */
  readonly maintenance?: MaintenanceDbRunner | null
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

/** Confere `Authorization: Bearer <segredo>` em tempo constante. */
export function cronAuthorized(authorization: string | null, secret: string): boolean {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization ?? "")
  const token = match?.[1]
  if (token === undefined) return false
  return timingSafeEqual(digest(token), digest(secret))
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
}

async function organizationIds(db: GatewayDb): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(db, sql`SELECT id FROM app.cron_organizations()`)
  return rows.map((r) => r.id)
}

/** Executa o job com as conferências e o registro da janela. */
export async function runCronJob(request: Request, job: CronJob, deps: CronDeps): Promise<Response> {
  const secret = deps.secret?.trim()
  if (secret === undefined || secret === "") {
    return json({ error: "CRON_SECRET não configurado; a tarefa não roda sem o segredo." }, 503)
  }
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return json({ error: "Não autorizado." }, 401)
  }
  const db = deps.db
  if (db === null) return json({ error: "Banco de dados não configurado." }, 503)

  const now = deps.now?.() ?? new Date()
  const windowKey = job.windowKey(now)
  const logError = deps.logError ?? ((message: string, error: unknown) => console.error(message, error))
  const [claim] = await queryRows<{ ok: boolean }>(
    db,
    sql`SELECT app.cron_claim(${job.name}, ${windowKey}, ${now.toISOString()}::timestamptz, ${job.lockS}::integer) AS ok`,
  )
  if (claim?.ok !== true) {
    return json({ job: job.name, window: windowKey, skipped: "janela já executada ou em andamento" })
  }

  const started = Date.now()
  /** Relógio do job (injetável nos testes) avançado pelo tempo real decorrido. */
  const elapsedNow = () => new Date(now.getTime() + (Date.now() - started)).toISOString()
  const budgetMs = deps.budgetMs ?? 45_000
  const ctx: CronContext = {
    db,
    now,
    env: deps.env ?? process.env,
    fetch: deps.fetch ?? fetch,
    log: (message, error) => logError(`[cron] ${job.name}: ${message}`, error),
    maintenance: deps.maintenance ?? null,
    remainingMs: () => budgetMs - (Date.now() - started),
    async forEachOrganization(fn) {
      const results: { organizationId: string; value: Awaited<ReturnType<typeof fn>> }[] = []
      let failures = 0
      let incomplete = false
      for (const organizationId of await organizationIds(db)) {
        if (Date.now() - started > budgetMs) {
          incomplete = true
          break
        }
        try {
          results.push({ organizationId, value: await withTenant(db, organizationId, (tx) => fn(tx, organizationId)) })
        } catch (error) {
          failures++
          logError(`[cron] ${job.name}: falhou no cliente ${organizationId}`, error)
        }
      }
      return { results, failures, incomplete }
    },
  }

  try {
    const result = await job.run(ctx)
    const body = { job: job.name, window: windowKey, duration_ms: Date.now() - started, ...result }
    await db.execute(
      sql`SELECT app.cron_finish(${job.name}, ${windowKey}, ${elapsedNow()}::timestamptz, true, ${JSON.stringify(body)}::jsonb)`,
    )
    return json(body, (result.failures ?? 0) > 0 ? 500 : 200)
  } catch (error) {
    logError(`[cron] ${job.name} falhou (janela ${windowKey})`, error)
    const message = error instanceof Error ? error.message.slice(0, 500) : "erro desconhecido"
    await db
      .execute(
        sql`SELECT app.cron_finish(${job.name}, ${windowKey}, ${elapsedNow()}::timestamptz, false, ${JSON.stringify({ error: message })}::jsonb)`,
      )
      .catch((finishError: unknown) => logError(`[cron] ${job.name}: não liberou a janela`, finishError))
    return json({ job: job.name, window: windowKey, error: "Falha na tarefa; a janela foi liberada para nova tentativa." }, 500)
  }
}
