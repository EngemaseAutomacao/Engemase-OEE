-- =============================================================================================
-- 0011_gateway_api_w6_rls — migração MANUAL (não gerada pelo drizzle-kit), par da 0010.
--
-- Ver o README de packages/db e a 0001_rls.sql (papéis, funções de contexto e convenções).
-- Só acrescenta (tabelas novas, GRANTs e funções novas): o código anterior continua funcionando.
--
-- O que esta migração faz:
--   1. RLS de cliente em `gateway_health_sample` (histórico de saúde do gateway) e GRANTs do app
--      (DELETE incluído: a retenção de 30 dias roda como app_user, cliente a cliente);
--   2. tabelas de plataforma `api_rate_limit` e `cron_run` (sem organization_id): o app_user NÃO
--      tem privilégio nelas; só o app_lookup, dono das funções abaixo;
--   3. funções SECURITY DEFINER (padrão da 0001/0003: donas app_lookup, search_path fixo, EXECUTE só
--      para app_user), cada uma com uma operação fechada:
--        app.rate_limit_take(chave, intervalo_ms, rajada, agora)  limitador GCRA (L21 do docs/17)
--        app.rate_limit_purge(antes)                             apaga chaves vencidas
--        app.cron_claim(job, janela, agora, prazo_s)             reserva a janela de um cron
--        app.cron_finish(job, janela, agora, ok, resultado)      fecha (ok) ou libera (erro) a janela
--        app.cron_purge(antes)                                   apaga o histórico antigo dos crons
--        app.cron_organizations()                                ids dos clientes (o cron roda um
--                                                                withTenant por cliente)
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
-- 1. Histórico de saúde do gateway (tabela de cliente)
-- ---------------------------------------------------------------------------------------------
SELECT app.enable_tenant_rls('public.gateway_health_sample');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gateway_health_sample TO app_user;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- 2. Tabelas de plataforma: só pelas funções
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON public.api_rate_limit, public.cron_run FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limit, public.cron_run TO app_lookup;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- 3. Funções
-- ---------------------------------------------------------------------------------------------
-- Limitador de taxa GCRA ("balde furado" com rajada): uma requisição a cada `p_interval_ms`, com até
-- `p_burst` seguidas. Uma linha por chave, travada durante a conta (serializa instâncias paralelas).
-- Devolve allowed = false e, nesse caso, em quantos ms a próxima requisição passa.
CREATE OR REPLACE FUNCTION app.rate_limit_take(p_key text, p_interval_ms integer, p_burst integer, p_now timestamptz)
  RETURNS TABLE (allowed boolean, retry_after_ms bigint)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_interval interval;
  v_tolerance interval;
  v_tat timestamptz;
  v_new_tat timestamptz;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'app.rate_limit_take: chave inválida' USING ERRCODE = '22023';
  END IF;
  IF p_interval_ms IS NULL OR p_interval_ms < 1 OR p_burst IS NULL OR p_burst < 1 OR p_now IS NULL THEN
    RAISE EXCEPTION 'app.rate_limit_take: intervalo, rajada e instante são obrigatórios e positivos' USING ERRCODE = '22023';
  END IF;
  v_interval := make_interval(secs => p_interval_ms / 1000.0);
  v_tolerance := v_interval * (p_burst - 1);

  INSERT INTO public.api_rate_limit AS r (key, tat, expires_at)
  VALUES (p_key, p_now + v_interval, p_now + v_interval)
  ON CONFLICT (key) DO NOTHING;
  IF FOUND THEN
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;

  SELECT r.tat INTO v_tat FROM public.api_rate_limit r WHERE r.key = p_key FOR UPDATE;
  v_new_tat := greatest(v_tat, p_now) + v_interval;
  IF v_new_tat - p_now > v_tolerance + v_interval THEN
    RETURN QUERY SELECT false,
      greatest(1, ceil(extract(epoch FROM (v_new_tat - v_tolerance - v_interval - p_now)) * 1000))::bigint;
    RETURN;
  END IF;
  UPDATE public.api_rate_limit SET tat = v_new_tat, expires_at = v_new_tat WHERE key = p_key;
  RETURN QUERY SELECT true, 0::bigint;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.rate_limit_purge(p_before timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (DELETE FROM public.api_rate_limit WHERE expires_at < p_before RETURNING 1)
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
-- Reserva a janela `p_run_key` do job: true se esta execução pode rodar (janela nova, ou uma execução
-- anterior que não terminou e cujo prazo `locked_until` já passou). Janela terminada nunca roda de novo.
CREATE OR REPLACE FUNCTION app.cron_claim(p_job text, p_run_key text, p_now timestamptz, p_lock_s integer)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH claimed AS (
      INSERT INTO public.cron_run AS c (job, run_key, started_at, locked_until)
      VALUES (p_job, p_run_key, p_now, p_now + make_interval(secs => greatest(p_lock_s, 1)))
      ON CONFLICT (job, run_key) DO UPDATE
        SET started_at = excluded.started_at, locked_until = excluded.locked_until, result = NULL
        WHERE c.finished_at IS NULL AND c.locked_until <= p_now
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM claimed)
  $$;
--> statement-breakpoint
-- Fecha a janela (p_ok = true: não roda mais) ou a libera para outra tentativa (p_ok = false).
CREATE OR REPLACE FUNCTION app.cron_finish(p_job text, p_run_key text, p_now timestamptz, p_ok boolean, p_result jsonb)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.cron_run
    SET finished_at = CASE WHEN p_ok THEN p_now END, locked_until = p_now, result = p_result
    WHERE job = p_job AND run_key = p_run_key
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cron_purge(p_before timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (DELETE FROM public.cron_run WHERE started_at < p_before RETURNING 1)
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
-- Ids de todos os clientes (só o id; app_lookup lê só id e slug de organization). Não abre dados:
-- o cron roda cada cliente com withTenant, sob RLS.
CREATE OR REPLACE FUNCTION app.cron_organizations()
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT o.id FROM public.organization o ORDER BY o.id
  $$;
--> statement-breakpoint
COMMENT ON FUNCTION app.rate_limit_take(text, integer, integer, timestamptz) IS 'Limitador de taxa GCRA por chave (L21 do docs/17): allowed e, se recusada, em quantos ms a próxima passa.';
--> statement-breakpoint
COMMENT ON FUNCTION app.cron_claim(text, text, timestamptz, integer) IS 'Reserva a janela de um job agendado (true = pode rodar). Janela terminada não roda de novo.';
--> statement-breakpoint
COMMENT ON FUNCTION app.cron_organizations() IS 'Ids de todos os clientes, para os jobs agendados rodarem um withTenant por cliente.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.rate_limit_take(text, integer, integer, timestamptz), app.rate_limit_purge(timestamptz),
  app.cron_claim(text, text, timestamptz, integer), app.cron_finish(text, text, timestamptz, boolean, jsonb),
  app.cron_purge(timestamptz), app.cron_organizations()
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.rate_limit_take(text, integer, integer, timestamptz), app.rate_limit_purge(timestamptz),
  app.cron_claim(text, text, timestamptz, integer), app.cron_finish(text, text, timestamptz, boolean, jsonb),
  app.cron_purge(timestamptz), app.cron_organizations()
TO app_user;
--> statement-breakpoint
-- Para receber a posse das funções, app_lookup precisa (momentaneamente) de CREATE no schema app.
GRANT USAGE, CREATE ON SCHEMA app TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.rate_limit_take(text, integer, integer, timestamptz) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.rate_limit_purge(timestamptz) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.cron_claim(text, text, timestamptz, integer) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.cron_finish(text, text, timestamptz, boolean, jsonb) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.cron_purge(timestamptz) OWNER TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.cron_organizations() OWNER TO app_lookup;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_lookup;
