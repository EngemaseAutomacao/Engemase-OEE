/**
 * Manutenção das partições das séries temporais (migração 0013; docs/06, "Volume, particionamento e
 * retenção"; L17 do docs/17).
 *
 * `production_minute` é particionada por mês (retenção de 2 anos, D6) e `tag_sample` por semana (90 dias).
 * Uma tarefa agendada DIÁRIA chama `maintainPartitions(db)`, que cria as partições dos próximos períodos e
 * apaga as que passaram da retenção. É idempotente: rodar de novo no mesmo dia não faz nada.
 *
 * Quem chama precisa conectar com o papel DONO das tabelas (o mesmo das migrações): criar e apagar partição
 * é DDL. Nunca como `app_user` (que não tem EXECUTE) nem dentro de `withTenant`.
 */
import { type SQL, sql } from "drizzle-orm"

/** Tabelas particionadas e as regras gravadas em `app.partitioned_table` pela 0013 (para consulta/documentação). */
export const PARTITIONED_TABLES = {
  production_minute: { period: "month", premake: 3, retention: "2 years" },
  tag_sample: { period: "week", premake: 8, retention: "90 days" },
} as const

export type PartitionedTableName = keyof typeof PARTITIONED_TABLES

export interface PartitionAction {
  readonly parentTable: string
  readonly partitionName: string
  readonly action: "created" | "dropped"
  /** `null` = sem limite (MINVALUE/MAXVALUE, só na partição `_legacy`). */
  readonly rangeFrom: Date | null
  readonly rangeTo: Date | null
}

export interface MaintainPartitionsOptions {
  /** Instante de referência (padrão: `now()` do banco). Útil em testes e para recuperar dias perdidos. */
  readonly now?: Date
  /** Só lista o que faria, sem criar nem apagar nada. */
  readonly dryRun?: boolean
}

/** O mínimo que precisamos de um banco ou transação do Drizzle (`execute` devolve `{ rows }`). */
export interface PartitionExecutor {
  execute(query: SQL): PromiseLike<unknown>
}

interface RawRow {
  readonly parent_table: string
  readonly partition_name: string
  readonly action: string
  /** Milissegundos desde a época (UTC); nulo quando o limite é infinito. */
  readonly range_from_ms: unknown
  readonly range_to_ms: unknown
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const ms = Number(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

function rowsOf(result: unknown): readonly RawRow[] {
  if (Array.isArray(result)) return result as RawRow[]
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows
    if (Array.isArray(rows)) return rows as RawRow[]
  }
  throw new Error("maintainPartitions: resultado inesperado do driver (esperava { rows })")
}

/** SQL da manutenção (para quem preferir executar por conta própria). */
export function maintainPartitionsSql(options: MaintainPartitionsOptions = {}): SQL {
  const now = options.now === undefined ? sql`now()` : sql`${options.now.toISOString()}::timestamptz`
  const dryRun = options.dryRun === true
  // Limites em milissegundos (independe do fuso da sessão e do parser de datas do driver).
  return sql`SELECT parent_table, partition_name, action,
      CASE WHEN isfinite(range_from) THEN (extract(epoch FROM range_from) * 1000)::float8 END AS range_from_ms,
      CASE WHEN isfinite(range_to) THEN (extract(epoch FROM range_to) * 1000)::float8 END AS range_to_ms
    FROM app.maintain_partitions(${now}, ${dryRun})`
}

/**
 * Cria as partições que faltam e apaga as que passaram da retenção. Devolve as ações feitas (ou que seriam
 * feitas, com `dryRun`), para o log da tarefa agendada.
 */
export async function maintainPartitions(
  db: PartitionExecutor,
  options: MaintainPartitionsOptions = {},
): Promise<PartitionAction[]> {
  const result = await db.execute(maintainPartitionsSql(options))
  return rowsOf(result).map((row) => {
    if (row.action !== "created" && row.action !== "dropped") {
      throw new Error(`maintainPartitions: ação desconhecida "${row.action}"`)
    }
    return {
      parentTable: row.parent_table,
      partitionName: row.partition_name,
      action: row.action,
      rangeFrom: toDate(row.range_from_ms),
      rangeTo: toDate(row.range_to_ms),
    }
  })
}
