/**
 * Tabelas de plataforma, sem `organization_id`: limitador de taxa da API dos gateways e registro das
 * tarefas agendadas (cron).
 *
 * O `app_user` NÃO tem nenhum privilégio nelas: o acesso é só pelas funções SECURITY DEFINER do
 * schema `app` (donas `app_lookup`, migração 0011), que fazem uma operação fechada cada:
 * - `app.rate_limit_take(chave, intervalo_ms, rajada, agora)`: GCRA (balde furado) numa linha por chave;
 * - `app.rate_limit_purge(antes)`: limpeza das chaves vencidas;
 * - `app.cron_claim(job, chave, agora, prazo_s)` / `app.cron_finish(job, chave, agora, resultado)`;
 * - `app.cron_purge(antes)`;
 * - `app.cron_organizations()`: ids dos clientes, para o cron rodar um `withTenant` por cliente.
 */
import { sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { tstz } from "./_columns"

/**
 * Limitador de taxa (L21 do docs/17), guardado no Postgres para valer entre instâncias serverless.
 * GCRA: `tat` é o "theoretical arrival time" da chave; a requisição passa se `tat` não estiver mais
 * que a tolerância (rajada) à frente de agora.
 */
export const apiRateLimit = pgTable(
  "api_rate_limit",
  {
    /** Ex.: "sync:gw:<uuid>", "enroll:ip:<ip>", "enroll:code:<sha256>". */
    key: text("key").primaryKey(),
    tat: tstz("tat").notNull(),
    /** Depois disto a linha não limita mais nada e pode ser apagada (limpeza diária). */
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    index("api_rate_limit_expires_idx").on(t.expiresAt),
    check("api_rate_limit_key_chk", sql`length(${t.key}) BETWEEN 1 AND 200`),
  ],
)

/**
 * Execuções das tarefas agendadas (L17): uma linha por (job, chave da janela). Garante que a mesma
 * janela não rode duas vezes ao mesmo tempo (nem duas vezes, no caso do resumo diário) e guarda o
 * resultado para acompanhamento.
 */
export const cronRun = pgTable(
  "cron_run",
  {
    job: text("job").notNull(),
    /** Janela da execução (ex.: "2026-11-24T13:05" para o job de 1 min, "2026-11-24" para o diário). */
    runKey: text("run_key").notNull(),
    startedAt: tstz("started_at").notNull(),
    /** Até quando a execução em andamento "segura" a janela (depois disso outra pode assumir). */
    lockedUntil: tstz("locked_until").notNull(),
    finishedAt: tstz("finished_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ name: "cron_run_pk", columns: [t.job, t.runKey] }),
    index("cron_run_started_idx").on(t.startedAt),
    check("cron_run_job_chk", sql`${t.job} ~ '^[a-z][a-z0-9-]{0,39}$'`),
  ],
)
