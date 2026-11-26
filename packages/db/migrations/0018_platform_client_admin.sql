-- =============================================================================================
-- 0018 (MANUAL): console Engemase cria e altera clientes (W8)
--
-- `client_account` é gravada só pela plataforma (docs/15, item 16): o `app_user` tem apenas SELECT e
-- o `auth_service` não a enxerga. Para o assistente "Novo cliente" do console funcionar sem conexão
-- de dono, duas funções de operação fechada (SECURITY DEFINER, donas app_lookup, search_path fixo,
-- EXECUTE só para app_user), no mesmo padrão das buscas e dos crons:
--
--   app.platform_create_client(slug, nome, metadados, plano, limites) → id
--       cria organization + client_account (sempre "onboarding"); slug repetido ou fora do formato e
--       limites inválidos são recusados pelas restrições das tabelas;
--   app.platform_update_client(id, nome, metadados, estado, plano, limites) → boolean
--       altera nome/metadados (organization) e estado/plano/limites (client_account); NULL = mantém.
--       Suspender grava suspended_at; encerrar grava closed_at; voltar a ativo limpa suspended_at.
--
-- Quem pode chamar (super admin da Engemase) é regra da aplicação, conferida na Server Action antes
-- de chamar (mesmo limite das demais funções: protege contra bug do app, não contra SQL arbitrário).
-- O app_lookup ganha só as colunas e políticas necessárias; nenhum DELETE.
-- =============================================================================================

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND NOT pg_catalog.pg_has_role(current_user, 'app_lookup', 'SET') THEN
    EXECUTE format('GRANT app_lookup TO %I', current_user);
  END IF;
END
$$;
--> statement-breakpoint
GRANT INSERT (name, slug, metadata), UPDATE (name, metadata) ON public.organization TO app_lookup;
--> statement-breakpoint
CREATE POLICY platform_client_write ON public.organization AS PERMISSIVE FOR INSERT TO app_lookup WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_client_update ON public.organization AS PERMISSIVE FOR UPDATE TO app_lookup USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT (organization_id, status, plan, limits, suspended_at, closed_at), INSERT (organization_id, status, plan, limits),
  UPDATE (status, plan, limits, suspended_at, closed_at, updated_at) ON public.client_account TO app_lookup;
--> statement-breakpoint
CREATE POLICY platform_client_write ON public.client_account AS PERMISSIVE FOR ALL TO app_lookup USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_create_client(p_slug text, p_name text, p_metadata text, p_plan text, p_limits jsonb)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'nome do cliente vazio' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization (name, slug, metadata) VALUES (btrim(p_name), p_slug, p_metadata) RETURNING id INTO v_id;
  INSERT INTO public.client_account (organization_id, status, plan, limits) VALUES (v_id, 'onboarding', p_plan, p_limits);
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_update_client(
  p_id uuid, p_name text, p_metadata text, p_status text, p_plan text, p_limits jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_status text;
BEGIN
  SELECT a.status INTO v_status FROM public.client_account a WHERE a.organization_id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- Sem ler as colunas antigas: o app_lookup só lê id e slug de organization.
  IF NULLIF(btrim(p_name), '') IS NOT NULL THEN
    UPDATE public.organization SET name = btrim(p_name) WHERE id = p_id;
  END IF;
  IF p_metadata IS NOT NULL THEN
    UPDATE public.organization SET metadata = p_metadata WHERE id = p_id;
  END IF;
  UPDATE public.client_account a
    SET status = COALESCE(p_status, a.status),
        plan = COALESCE(p_plan, a.plan),
        limits = COALESCE(p_limits, a.limits),
        suspended_at = CASE
          WHEN p_status = 'suspended' AND v_status <> 'suspended' THEN now()
          WHEN p_status IN ('active', 'onboarding') THEN NULL
          ELSE a.suspended_at END,
        closed_at = CASE WHEN p_status = 'closed' AND v_status <> 'closed' THEN now() ELSE a.closed_at END,
        updated_at = now()
    WHERE a.organization_id = p_id;
  RETURN true;
END
$$;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA app TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.platform_create_client(text, text, text, text, jsonb) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.platform_update_client(uuid, text, text, text, text, jsonb) OWNER TO app_lookup;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_lookup;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_create_client(text, text, text, text, jsonb), app.platform_update_client(uuid, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_create_client(text, text, text, text, jsonb), app.platform_update_client(uuid, text, text, text, text, jsonb) TO app_user;
--> statement-breakpoint
COMMENT ON FUNCTION app.platform_create_client(text, text, text, text, jsonb) IS 'Console Engemase: cria organization + client_account (onboarding). Só o super admin chama (regra da aplicação).';
--> statement-breakpoint
COMMENT ON FUNCTION app.platform_update_client(uuid, text, text, text, text, jsonb) IS 'Console Engemase: altera nome/metadados, estado, plano e limites do cliente (NULL = mantém).';
