-- 0006 — gerada pelo drizzle-kit (`pnpm db:generate`), sem parte manual. D1 (12/11/2026): a cobrança é
-- POR MÁQUINA, então `client_account.limits` precisa ter a chave `machines` (máquinas contratadas,
-- inteiro >= 0; `0` = nenhuma máquina pode ser cadastrada). Sai o padrão `{}`: quem cria o cliente
-- informa as máquinas contratadas. As outras chaves continuam opcionais (ausente = sem limite).
-- Um cliente que já exista sem `machines` faz o ADD CONSTRAINT falhar e a migração parar (de propósito:
-- o número contratado vem do contrato e não dá para inventar; grave-o à mão, como no README, "Ajustar
-- dados de tabela de cliente numa migração", e rode de novo). A checagem
-- do CHECK lê todas as linhas, mesmo com a RLS forçada e um dono sem BYPASSRLS.
ALTER TABLE "client_account" DROP CONSTRAINT "client_account_limits_chk";--> statement-breakpoint
ALTER TABLE "client_account" ALTER COLUMN "limits" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "client_account" ADD CONSTRAINT "client_account_limits_chk" CHECK (jsonb_typeof("client_account"."limits") = 'object' AND "client_account"."limits" ? 'machines' AND NOT jsonb_path_exists("client_account"."limits", 'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())', '{}', true));