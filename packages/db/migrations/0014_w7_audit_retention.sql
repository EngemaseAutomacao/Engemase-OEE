-- =============================================================================================
-- 0014 — migração MANUAL (W7): retenção da auditoria (`audit_log`) pela limpeza diária.
--
-- Ver docs/06 ("Volume, particionamento e retenção"), D6 (auditoria guardada por 5 anos) e o README de
-- packages/db. Só acrescenta (função nova, GRANT e políticas novas para o app_lookup): o código anterior
-- continua funcionando igual.
--
-- `app.audit_log_purge(antes, limite)` apaga em lotes os registros de auditoria (de todos os clientes e os
-- de plataforma) com `at < antes`. Segue o padrão das funções da 0010: SECURITY DEFINER, dona `app_lookup`,
-- search_path fixo, EXECUTE só para o app_user (a limpeza diária roda com a conexão normal da aplicação).
--
-- Proteção contra apagar auditoria recente (bug ou SQL indevido rodando como app_user): a função RECUSA
-- `antes` mais novo que `now() - 365 dias`, medido pelo relógio do banco (não pelo de quem chama). O prazo
-- de verdade (padrão 5 anos, D6) é configurado na aplicação (AUDITORIA_RETENCAO_DIAS, mínimo 365).
--
-- Com a RLS FORÇADA em audit_log, o dono da função (app_lookup) só enxerga linhas por política própria:
-- `audit_retention_read` (SELECT) e `audit_retention_delete` (DELETE), ambas só para o app_lookup, que é
-- NOLOGIN e só age pelas funções fechadas do schema app. O app_user continua sem UPDATE/DELETE na auditoria.
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
GRANT SELECT, DELETE ON public.audit_log TO app_lookup;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_retention_read ON public.audit_log;
--> statement-breakpoint
CREATE POLICY audit_retention_read ON public.audit_log AS PERMISSIVE FOR SELECT TO app_lookup USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS audit_retention_delete ON public.audit_log;
--> statement-breakpoint
CREATE POLICY audit_retention_delete ON public.audit_log AS PERMISSIVE FOR DELETE TO app_lookup USING (true);
--> statement-breakpoint
-- Apaga até `p_limit` registros com `at < p_before` (os mais velhos primeiro) e devolve quantos apagou.
-- A limpeza chama de novo enquanto vier o lote cheio (e houver tempo). Idempotente.
CREATE OR REPLACE FUNCTION app.audit_log_purge(p_before timestamptz, p_limit integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_before IS NULL OR NOT isfinite(p_before) THEN
    RAISE EXCEPTION 'app.audit_log_purge: informe um instante finito' USING ERRCODE = '22023';
  END IF;
  IF p_before > now() - interval '365 days' THEN
    RAISE EXCEPTION 'app.audit_log_purge: a auditoria fica guardada por pelo menos 365 dias' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'app.audit_log_purge: lote deve ter de 1 a 50000 registros' USING ERRCODE = '22023';
  END IF;
  WITH old AS (
    SELECT a.id FROM public.audit_log a WHERE a.at < p_before ORDER BY a.at LIMIT p_limit
  ), gone AS (
    DELETE FROM public.audit_log a USING old WHERE a.id = old.id RETURNING 1
  )
  SELECT count(*)::integer INTO v_deleted FROM gone;
  RETURN v_deleted;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION app.audit_log_purge(timestamptz, integer) IS
  'Retenção da auditoria (D6): apaga em lote os registros com at < antes. Recusa prazo menor que 365 dias (relógio do banco).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.audit_log_purge(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.audit_log_purge(timestamptz, integer) TO app_user;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA app TO app_lookup;
--> statement-breakpoint
ALTER FUNCTION app.audit_log_purge(timestamptz, integer) OWNER TO app_lookup;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_lookup;
