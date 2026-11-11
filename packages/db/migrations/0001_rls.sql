-- =============================================================================================
-- 0001_rls — migração MANUAL (não gerada pelo drizzle-kit): isolamento por cliente no banco.
--
-- Ver docs/06 ("Multi-tenancy"), docs/15 (seção 4) e o README de packages/db.
--
-- O que esta migração cria:
--   1. schema `app` com as funções de contexto (`app.current_org_id()`, `app.set_tenant(uuid)`);
--   2. papéis NOLOGIN e sem BYPASSRLS:
--        app_user      papel da aplicação (tabelas de cliente com RLS forçada);
--        auth_service  papel do Better Auth (só as tabelas de identidade);
--        app_lookup    dono das funções de busca por hash de token (SECURITY DEFINER);
--   3. RLS ENABLE + FORCE em TODAS as tabelas de cliente (as que têm `organization_id`), com
--        tenant_isolation  RESTRICTIVE, FOR ALL, TO app_user:
--                          organization_id = current_setting('app.org_id', true)::uuid
--        tenant_access     PERMISSIVE,  FOR ALL, TO app_user: true
--      (sem `app.org_id` definido na transação: zero linhas e nenhuma escrita — "fail-closed");
--   4. GRANTs mínimos por tabela (auditoria só inserção, client_account só leitura...);
--   5. funções de busca por hash (gateway, ativação, terminal, tokens próprios).
--
-- Regras para migrações futuras:
--   - toda tabela nova com `organization_id` precisa de `SELECT app.enable_tenant_rls('public.x');`
--     e dos GRANTs (o teste de catálogo falha se faltar a RLS);
--   - o dono das tabelas fica sujeito à RLS (FORCE) e não tem política: sem BYPASSRLS ele não lê
--     dados de cliente. Migrações de dados (backfill) rodam com um papel com BYPASSRLS.
-- =============================================================================================

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
COMMENT ON SCHEMA app IS 'Funções de contexto de cliente (RLS) e de busca por hash de token. Gerenciado por migrações manuais.';
--> statement-breakpoint
-- Papéis: criados só se não existirem (papéis são do cluster, não do banco).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_user', 'auth_service', 'app_lookup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', r);
    END IF;
  END LOOP;
  -- Papel pré-existente com poderes demais quebraria o isolamento sem ninguém perceber: falha alto.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('app_user', 'auth_service', 'app_lookup') AND (rolbypassrls OR rolsuper)
  ) THEN
    RAISE EXCEPTION 'Os papéis app_user, auth_service e app_lookup não podem ter BYPASSRLS nem SUPERUSER.';
  END IF;
END
$$;
--> statement-breakpoint
-- O dono das migrações precisa poder transferir as funções de busca para app_lookup.
-- (Em superusuário não muda nada; num papel com CREATEROLE dá a ele a opção SET sobre app_lookup.)
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND NOT pg_catalog.pg_has_role(current_user, 'app_lookup', 'SET') THEN
    EXECUTE format('GRANT app_lookup TO %I', current_user);
  END IF;
END
$$;
--> statement-breakpoint
-- Cliente da transação atual (NULL se não definido). Usada pelas políticas de RLS.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
-- Define o cliente da transação atual (set_config local: vale só até o COMMIT/ROLLBACK).
-- Recusa trocar de cliente no meio da transação.
CREATE OR REPLACE FUNCTION app.set_tenant(p_organization_id uuid) RETURNS uuid
  LANGUAGE plpgsql VOLATILE
  AS $$
DECLARE
  v_current text := nullif(pg_catalog.current_setting('app.org_id', true), '');
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'app.set_tenant: organization_id não pode ser nulo' USING ERRCODE = '22004';
  END IF;
  IF v_current IS NOT NULL AND v_current <> p_organization_id::text THEN
    RAISE EXCEPTION 'app.set_tenant: esta transação já pertence a outro cliente' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('app.org_id', p_organization_id::text, true);
  RETURN p_organization_id;
END
$$;
--> statement-breakpoint
-- Liga a RLS de cliente numa tabela (ENABLE + FORCE + políticas). Uso em migrações:
--   SELECT app.enable_tenant_rls('public.minha_tabela');
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(p_table regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_access ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS RESTRICTIVE FOR ALL TO app_user '
    'USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id())',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY tenant_access ON %s AS PERMISSIVE FOR ALL TO app_user USING (true) WITH CHECK (true)',
    p_table
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.set_tenant(uuid) TO app_user;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user, auth_service, app_lookup;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- RLS nas tabelas de cliente (todas as que têm organization_id; lista em ordem alfabética)
-- ---------------------------------------------------------------------------------------------
SELECT app.enable_tenant_rls('public.account_token');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.alert_event');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.alert_rule');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.area');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.audit_log');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.client_account');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.device');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.downtime_reason');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.fault_code_map');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway_command');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway_config_version');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway_device_status');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway_enrollment');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.gateway_machine');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.line');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.machine');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.machine_live');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.machine_state_event');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.member');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.member_access');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.member_unit');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.notification');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.notification_delivery');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.notification_preference');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.oee_shift');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.planned_downtime');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.platform_assignment');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.platform_assignment_unit');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.product');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.product_machine');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.production_minute');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.production_run');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.push_subscription');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.quality_entry');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.remote_access_event');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.remote_access_forward');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.remote_access_policy');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.remote_access_session');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.serial_bus');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.shift');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.support_access_grant');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.tag');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.tag_sample');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.terminal');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.unit');
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- GRANTs do papel da aplicação (a RLS decide QUAIS linhas; os GRANTs decidem O QUE pode ser feito)
-- ---------------------------------------------------------------------------------------------
-- Cadastros, configuração, acesso, alertas e acesso remoto: leitura e escrita.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.member, public.member_access, public.member_unit,
  public.platform_assignment, public.platform_assignment_unit, public.support_access_grant,
  public.terminal, public.account_token,
  public.unit, public.area, public.line, public.machine,
  public.gateway, public.gateway_enrollment, public.serial_bus, public.device, public.tag,
  public.gateway_machine, public.gateway_command, public.gateway_device_status,
  public.product, public.product_machine, public.shift, public.planned_downtime,
  public.downtime_reason, public.fault_code_map, public.machine_live,
  public.alert_rule, public.alert_event, public.notification, public.notification_delivery,
  public.push_subscription, public.notification_preference,
  public.remote_access_policy, public.remote_access_session, public.remote_access_forward
TO app_user;
--> statement-breakpoint
-- Dados de produção: nunca apagados por usuário (docs/06). Retenção/partições rodam como dono.
GRANT SELECT, INSERT, UPDATE ON
  public.machine_state_event, public.production_minute, public.production_run, public.oee_shift
TO app_user;
--> statement-breakpoint
-- Imutáveis: estorno de qualidade é um novo lançamento; versão de config é snapshot imutável.
GRANT SELECT, INSERT ON public.quality_entry, public.tag_sample, public.gateway_config_version TO app_user;
--> statement-breakpoint
-- Só inserção (auditoria, docs/15 e docs/12).
GRANT SELECT, INSERT ON public.audit_log, public.remote_access_event TO app_user;
--> statement-breakpoint
-- Só a plataforma grava client_account (docs/15, item 16).
GRANT SELECT ON public.client_account TO app_user;
--> statement-breakpoint
-- Identidade: o app resolve o slug do cliente e lê os nomes dos membros do cliente atual.
GRANT SELECT ON public.organization, public."user" TO app_user;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- "user": o app_user só enxerga quem é membro do cliente atual (member já está sob RLS)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public."user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_member_of_tenant ON public."user" AS PERMISSIVE FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM public.member m WHERE m.user_id = "user".id));
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- auth_service (Better Auth): só as tabelas de identidade, sem tocar em dados de produção.
-- Better Auth precisa enxergar `member` e `user` de todos os clientes (listar os clientes de uma
-- pessoa, por exemplo). Não pode apagar organização (encerramento de cliente é runbook).
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."user", public.session, public.account, public.verification, public.member
TO auth_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.organization TO auth_service;
--> statement-breakpoint
CREATE POLICY auth_service_all ON public.member AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_service_all ON public."user" AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Buscas por hash de token, antes de saber o cliente (autenticação do gateway, ativação,
-- terminal e tokens próprios). As funções rodam como app_lookup (SECURITY DEFINER), que só tem
-- SELECT nas colunas necessárias, e devolvem apenas (id, organization_id) do registro que confere.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT (id, organization_id, status, token_hash, previous_token_hash, previous_token_expires_at, deleted_at)
  ON public.gateway TO app_lookup;
--> statement-breakpoint
GRANT SELECT (id, organization_id, gateway_id, code_hash, expires_at, used_at)
  ON public.gateway_enrollment TO app_lookup;
--> statement-breakpoint
GRANT SELECT (id, organization_id, token_hash, expires_at, revoked_at)
  ON public.terminal TO app_lookup;
--> statement-breakpoint
GRANT SELECT (id, organization_id, token_hash, expires_at, used_at)
  ON public.account_token TO app_lookup;
--> statement-breakpoint
CREATE POLICY lookup_by_token_hash ON public.gateway AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
CREATE POLICY lookup_by_token_hash ON public.gateway_enrollment AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
CREATE POLICY lookup_by_token_hash ON public.terminal AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
CREATE POLICY lookup_by_token_hash ON public.account_token AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
-- Token do gateway (Authorization: Bearer gw_live_...): aceita o token anterior durante a rotação.
CREATE OR REPLACE FUNCTION app.resolve_gateway_token(p_token_hash text)
  RETURNS TABLE (id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT g.id, g.organization_id
    FROM public.gateway g
    WHERE g.status = 'active'
      AND g.deleted_at IS NULL
      AND (
        g.token_hash = p_token_hash
        OR (g.previous_token_hash = p_token_hash AND g.previous_token_expires_at > pg_catalog.now())
      )
  $$;
--> statement-breakpoint
-- Código de ativação (POST /enroll): devolve o registro de gateway_enrollment ainda válido.
CREATE OR REPLACE FUNCTION app.resolve_gateway_enrollment(p_code_hash text)
  RETURNS TABLE (id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT e.id, e.organization_id
    FROM public.gateway_enrollment e
    JOIN public.gateway g ON g.id = e.gateway_id AND g.organization_id = e.organization_id
    WHERE e.code_hash = p_code_hash
      AND e.used_at IS NULL
      AND e.expires_at > pg_catalog.now()
      AND g.status <> 'revoked'
      AND g.deleted_at IS NULL
  $$;
--> statement-breakpoint
-- Token de dispositivo do terminal (TV/tablet) pareado, não revogado e dentro do prazo.
CREATE OR REPLACE FUNCTION app.resolve_terminal_token(p_token_hash text)
  RETURNS TABLE (id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.id, t.organization_id
    FROM public.terminal t
    WHERE t.token_hash = p_token_hash
      AND t.revoked_at IS NULL
      AND t.expires_at > pg_catalog.now()
  $$;
--> statement-breakpoint
-- Token próprio de uso único (definir senha, verificar e-mail, pareamento) ainda não usado.
CREATE OR REPLACE FUNCTION app.resolve_account_token(p_token_hash text)
  RETURNS TABLE (id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT a.id, a.organization_id
    FROM public.account_token a
    WHERE a.token_hash = p_token_hash
      AND a.used_at IS NULL
      AND a.expires_at > pg_catalog.now()
  $$;
--> statement-breakpoint
-- Para receber a posse das funções, app_lookup precisa (momentaneamente) de CREATE no schema app.
GRANT USAGE, CREATE ON SCHEMA app TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_gateway_token(text) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_gateway_enrollment(text) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_terminal_token(text) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.resolve_account_token(text) OWNER TO app_lookup;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_lookup;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_gateway_token(text), app.resolve_gateway_enrollment(text), app.resolve_terminal_token(text), app.resolve_account_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_gateway_token(text), app.resolve_gateway_enrollment(text), app.resolve_terminal_token(text), app.resolve_account_token(text) TO app_user;
