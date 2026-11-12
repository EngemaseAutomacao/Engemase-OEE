-- 0004 — gerada pelo drizzle-kit (`pnpm db:generate`), mais dois COMMENT ON FUNCTION manuais no fim.
--   - organization.slug no formato do contrato (`org` da resposta do /enroll, ORG_SLUG_PATTERN em
--     src/schema/enums.ts): antes qualquer texto passava e o /enroll podia ativar o gateway e responder
--     um `org` que o agente recusa;
--   - comentários de app.set_tenant / app.current_org_id com o LIMITE da RLS por cliente: app.org_id é
--     um parâmetro de sessão comum, que qualquer papel altera com set_config/SET LOCAL. O "recusa trocar
--     de cliente" de app.set_tenant só vale para quem chama app.set_tenant; a RLS protege contra bug do
--     app (WHERE ou withTenant esquecidos), não contra SQL arbitrário rodando como app_user (injeção de
--     SQL). Ver o README de packages/db ("Isolamento por cliente") e test/rls.test.ts.
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_chk" CHECK ("organization"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$');
--> statement-breakpoint
COMMENT ON FUNCTION app.set_tenant(uuid) IS 'Define o cliente da transação (app.org_id, local) e recusa trocar de cliente se chamada de novo na mesma transação. LIMITE: app.org_id é um parâmetro de sessão comum; qualquer papel o altera com set_config/SET LOCAL sem passar por aqui. A RLS protege contra bug do app (WHERE ou withTenant esquecidos), não contra SQL arbitrário rodando como app_user (injeção de SQL).';
--> statement-breakpoint
COMMENT ON FUNCTION app.current_org_id() IS 'Cliente da transação (app.org_id; NULL se não definido), usado pelas políticas de RLS. Não é à prova de SQL arbitrário do app_user: ver o comentário de app.set_tenant.';
