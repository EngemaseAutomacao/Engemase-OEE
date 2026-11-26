-- 0015 — gerada pelo drizzle-kit (`pnpm db:generate`). W7: índice em `audit_log.at` para a retenção da auditoria
-- (`app.audit_log_purge`, 0014) achar os registros mais velhos de todos os clientes sem varrer a tabela.
-- Só acréscimo (índice novo): o código anterior não muda.
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");
