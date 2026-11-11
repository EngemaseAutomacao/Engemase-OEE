/**
 * Colunas e utilitários comuns do schema.
 *
 * Convenções (docs/06, "Convenções"):
 * - ids UUIDv7 gerados pelo banco (`uuidv7()` é nativo no Postgres 18; Neon e PGlite 0.5 já são 18);
 * - tempo sempre `timestamptz` (UTC); o fuso fica na unidade;
 * - nomes de tabela e coluna em snake_case, explícitos (não dependemos da opção `casing` do Drizzle);
 * - "enums" como `text` + CHECK (evoluem com expand → migrate → contract, sem `ALTER TYPE`).
 */
import { type SQL, sql } from "drizzle-orm"
import { type AnyPgColumn, timestamp, uuid } from "drizzle-orm/pg-core"

/** `timestamptz` com retorno em `Date`. */
export function tstz(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" })
}

/** Chave primária UUIDv7 gerada pelo banco. */
export function pk() {
  return uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`)
}

export function createdAt() {
  return tstz("created_at").notNull().defaultNow()
}

/** Atualizado pelo Drizzle a cada `update()` (consultas SQL puras devem atualizar por conta própria). */
export function updatedAt() {
  return tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
}

/** Exclusão lógica em cadastros (docs/06). */
export function deletedAt() {
  return tstz("deleted_at")
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** `coluna IN ('a', 'b', ...)` para CHECKs de "enum" em texto. */
export function oneOf(column: AnyPgColumn | SQL, values: readonly string[]): SQL {
  if (values.length === 0) throw new Error("oneOf: lista de valores vazia")
  return sql`${column} IN (${sql.raw(values.map(quoteLiteral).join(", "))})`
}

/** Hash SHA-256 em hexadecimal minúsculo (tokens e códigos guardados só como hash). */
export function isSha256Hex(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[0-9a-f]{64}$'`
}
