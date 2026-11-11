/**
 * Utilitários dos testes: banco PGlite (Postgres 18 em WASM, sem servidor) com as migrações
 * aplicadas pelo migrator oficial do Drizzle, e execução como um papel/cliente específico.
 *
 * O PGlite conecta como `postgres` (superusuário, que ignora a RLS). Para testar a RLS de verdade,
 * cada teste troca de papel dentro da transação com `SET LOCAL ROLE app_user` (suportado pelo PGlite).
 */
import { fileURLToPath } from "node:url"
import { PGlite, type Transaction } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as schema from "../src/schema/index"
import type { DbRole } from "../src/tenancy"

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url))

export type TestDb = ReturnType<typeof drizzle<typeof schema, PGlite>>

export interface TestDatabase {
  readonly client: PGlite
  readonly db: TestDb
}

/** Cria um banco vazio em memória e aplica todas as migrações. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db }
}

/**
 * Executa `fn` numa transação com o papel indicado e, se houver, o cliente definido por
 * `app.set_tenant`. A transação é desfeita no fim (os testes não deixam rastro).
 */
export async function asRole<T>(
  client: PGlite,
  role: DbRole,
  organizationId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return client.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`)
    if (organizationId !== null) await tx.query("SELECT app.set_tenant($1::uuid)", [organizationId])
    const result = await fn(tx)
    // Desfaz tudo: cada chamada começa do mesmo estado do seed.
    await tx.rollback()
    return result
  })
}

/** Atalho: papel da aplicação dentro do cliente `organizationId` (ou sem cliente, se `null`). */
export function asTenant<T>(
  client: PGlite,
  organizationId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return asRole(client, "app_user", organizationId, fn)
}

/** `SELECT count(*)` tipado. */
export async function count(tx: Transaction | PGlite, query: string, params: unknown[] = []): Promise<number> {
  const result = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${query}) AS q`, params)
  return result.rows[0]?.n ?? 0
}

/** Identificador SQL entre aspas (para nomes de tabela vindos do catálogo). */
export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** Mensagens de um erro e das suas causas (o Drizzle embrulha o erro do Postgres em `cause`). */
export function errorMessages(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error
  while (current instanceof Error) {
    messages.push(current.message)
    current = current.cause
  }
  return messages.join(" | ")
}

/** Espera que a promessa falhe com um erro (ou causa) cuja mensagem bate com `pattern`. */
export async function expectDbError(promise: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  const outcome = await Promise.resolve(promise).then(
    () => ({ failed: false as const }),
    (error: unknown) => ({ failed: true as const, error }),
  )
  if (!outcome.failed) throw new Error(`esperava falha com ${String(pattern)}, mas a operação passou`)
  const messages = errorMessages(outcome.error)
  if (!pattern.test(messages)) throw new Error(`esperava ${String(pattern)}, recebeu: ${messages}`)
}
