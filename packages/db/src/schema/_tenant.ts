/**
 * Coluna `organization_id` das tabelas de cliente.
 *
 * Toda tabela que tem esta coluna é "tabela de cliente": recebe RLS forçada (migração manual
 * 0001_rls.sql) e o teste de catálogo (test/catalog.test.ts) falha se alguma ficar sem.
 * Ligações entre tabelas de cliente usam chave estrangeira COMPOSTA `(x_id, organization_id)`,
 * para que seja impossível, no banco, ligar um registro do cliente A a um do cliente B.
 */
import { uuid } from "drizzle-orm/pg-core"
import { organization } from "./auth"

/** `organization_id uuid NOT NULL REFERENCES organization(id)` (sem cascata: exclusão de cliente é runbook). */
export function organizationId() {
  return uuid("organization_id")
    .notNull()
    .references(() => organization.id)
}
