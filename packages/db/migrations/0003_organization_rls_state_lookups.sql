-- =============================================================================================
-- 0003_organization_rls_state_lookups — migração MANUAL (não gerada pelo drizzle-kit).
--
-- Ver o README de packages/db e a 0001_rls.sql (papéis, funções de contexto e convenções).
--
-- O que esta migração faz:
--   1. RLS ENABLE + FORCE em `organization` (antes qualquer contexto do app_user, ou nenhum, lia
--      id, nome, slug, logo e metadata de TODOS os clientes):
--        organization_of_tenant  PERMISSIVE, FOR SELECT, TO app_user:  id = app.current_org_id()
--        auth_service_all        PERMISSIVE, FOR ALL,    TO auth_service (Better Auth, como member/"user")
--        lookup_by_slug          PERMISSIVE, FOR SELECT, TO app_lookup (só as colunas id e slug)
--   2. app.resolve_org_slug(slug): resolve o slug da URL ANTES de saber o cliente (devolve só o id);
--   3. buscas por hash que devolvem o ESTADO da credencial, para a API responder o erro certo do
--      contrato (docs/04, "Erros e retentativas"):
--        app.resolve_gateway_enrollment_state(hash)  valid | used | expired | gateway_revoked
--        app.resolve_gateway_token_state(hash)       active | previous | rotated | pending_enrollment | revoked
--      As funções antigas (app.resolve_gateway_enrollment / app.resolve_gateway_token, que só devolvem
--      credencial válida) continuam: são equivalentes a filtrar `state IN ('valid')` / `('active', 'previous')`.
--
-- Todas as funções novas seguem o padrão da 0001: SECURITY DEFINER, donas `app_lookup` (que só tem
-- SELECT nas colunas necessárias), `search_path` fixo e EXECUTE só para `app_user`.
-- =============================================================================================

-- O dono das migrações precisa poder transferir as funções para app_lookup (idem 0001; idempotente).
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND NOT pg_catalog.pg_has_role(current_user, 'app_lookup', 'SET') THEN
    EXECUTE format('GRANT app_lookup TO %I', current_user);
  END IF;
END
$$;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- 1. organization sob RLS
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.organization FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- O app só enxerga o cliente da transação (o GRANT SELECT da 0001 continua; sem app.org_id: nada).
CREATE POLICY organization_of_tenant ON public.organization AS PERMISSIVE FOR SELECT TO app_user
  USING (id = app.current_org_id());
--> statement-breakpoint
-- Better Auth lista e cria clientes (GRANT SELECT, INSERT, UPDATE da 0001; sem DELETE).
CREATE POLICY auth_service_all ON public.organization AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT (id, slug) ON public.organization TO app_lookup;
--> statement-breakpoint
CREATE POLICY lookup_by_slug ON public.organization AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- 2. Slug da URL → cliente, antes de definir o cliente da transação
-- ---------------------------------------------------------------------------------------------
-- Devolve 0 ou 1 linha com o id do cliente. Não autoriza nada: em seguida o app define o cliente
-- (withTenant) e confere se a pessoa é membro com acesso (docs/15, seção 4).
CREATE OR REPLACE FUNCTION app.resolve_org_slug(p_slug text)
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT o.id
    FROM public.organization o
    WHERE o.slug = p_slug
  $$;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- 3. Estado da credencial (código de ativação e token do gateway)
-- ---------------------------------------------------------------------------------------------
-- Código de ativação (POST /enroll). Devolve 0 linhas se o hash não confere (→ 400
-- activation_code_invalid) ou 1 linha com o estado, na ordem de precedência:
--   gateway_revoked  gateway revogado ou excluído         → 400 activation_code_invalid
--   used             código já usado                      → 410 activation_code_used
--   expired          código vencido (24 h)                → 410 activation_code_expired
--   valid            pode ativar (o mesmo que app.resolve_gateway_enrollment devolve)
-- id/organization_id/gateway_id vêm em todos os estados (quem tem o código já sabe de qual cliente
-- ele é); servem para auditoria e NUNCA podem voltar na resposta ao gateway.
CREATE OR REPLACE FUNCTION app.resolve_gateway_enrollment_state(p_code_hash text)
  RETURNS TABLE (id uuid, organization_id uuid, gateway_id uuid, state text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      e.id,
      e.organization_id,
      e.gateway_id,
      CASE
        WHEN g.status = 'revoked' OR g.deleted_at IS NOT NULL THEN 'gateway_revoked'
        WHEN e.used_at IS NOT NULL THEN 'used'
        WHEN e.expires_at <= pg_catalog.now() THEN 'expired'
        ELSE 'valid'
      END
    FROM public.gateway_enrollment e
    JOIN public.gateway g ON g.id = e.gateway_id AND g.organization_id = e.organization_id
    WHERE e.code_hash = p_code_hash
  $$;
--> statement-breakpoint
-- Token do gateway (Authorization: Bearer gw_live_...). Confere o token atual e o anterior
-- (rotação). Devolve 0 linhas se o hash não confere com nenhum (→ 401 unauthorized) ou 1 linha:
--   revoked             gateway revogado ou excluído (token atual ou anterior) → 401 token_revoked
--   pending_enrollment  gateway aguardando nova ativação                       → 401 unauthorized
--   active              token atual de gateway ativo                           → autenticado
--   previous            token anterior, dentro da janela da rotação            → autenticado
--   rotated             token anterior, janela da rotação encerrada            → 401 unauthorized
-- `active` + `previous` = o que app.resolve_gateway_token devolve. Para o `token_revoked` funcionar,
-- a revogação deve manter o token_hash (o hash sozinho não autentica nada).
CREATE OR REPLACE FUNCTION app.resolve_gateway_token_state(p_token_hash text)
  RETURNS TABLE (id uuid, organization_id uuid, state text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      g.id,
      g.organization_id,
      CASE
        WHEN g.status = 'revoked' OR g.deleted_at IS NOT NULL THEN 'revoked'
        WHEN g.status <> 'active' THEN 'pending_enrollment'
        WHEN g.token_hash = p_token_hash THEN 'active'
        WHEN g.previous_token_expires_at > pg_catalog.now() THEN 'previous'
        ELSE 'rotated'
      END
    FROM public.gateway g
    WHERE g.token_hash = p_token_hash OR g.previous_token_hash = p_token_hash
    -- token_hash é único; se (por acaso) o hash conferir também com o anterior de outro gateway,
    -- vale o token atual.
    ORDER BY CASE WHEN g.token_hash = p_token_hash THEN 0 ELSE 1 END
    LIMIT 1
  $$;
--> statement-breakpoint
COMMENT ON FUNCTION app.resolve_org_slug(text) IS 'Slug → id do cliente, antes de definir app.org_id. Não autoriza: o app confere o vínculo depois.';
--> statement-breakpoint
COMMENT ON FUNCTION app.resolve_gateway_enrollment_state(text) IS 'Estado do código de ativação pelo hash: valid | used | expired | gateway_revoked (0 linhas = código inválido).';
--> statement-breakpoint
COMMENT ON FUNCTION app.resolve_gateway_token_state(text) IS 'Estado do token do gateway pelo hash: active | previous | rotated | pending_enrollment | revoked (0 linhas = token desconhecido).';
--> statement-breakpoint
-- Permissões (como os COMMENTs acima) ANTES da troca de dono, enquanto o dono ainda é quem migra;
-- o ALTER OWNER leva a ACL junto. EXECUTE só para o app_user.
REVOKE ALL ON FUNCTION app.resolve_org_slug(text), app.resolve_gateway_enrollment_state(text), app.resolve_gateway_token_state(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_org_slug(text), app.resolve_gateway_enrollment_state(text), app.resolve_gateway_token_state(text) TO app_user;
--> statement-breakpoint
-- Para receber a posse das funções, app_lookup precisa (momentaneamente) de CREATE no schema app.
GRANT USAGE, CREATE ON SCHEMA app TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_org_slug(text) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_gateway_enrollment_state(text) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_gateway_token_state(text) OWNER TO app_lookup;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_lookup;
