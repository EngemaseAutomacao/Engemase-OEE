-- =============================================================================================
-- 0013 — migração MANUAL (W2b): particionamento das séries temporais e rotina de manutenção das partições.
--
-- Ver docs/06 ("Volume, particionamento e retenção") e o README de packages/db.
--
--   1. `production_minute` passa a ser particionada por MÊS e `tag_sample` por SEMANA (RANGE na coluna de
--      tempo, que já está na chave primária). Sem pg_partman: o PGlite (testes) não tem a extensão, e a
--      rotina abaixo é pequena e 100% Postgres padrão (Neon, RDS, local).
--   2. A conversão NÃO copia nem apaga dados: a tabela antiga é renomeada para `<tabela>_legacy` e vira a
--      primeira partição (de MINVALUE até o início do próximo período depois do dado mais novo). O nome,
--      as colunas, a chave, os CHECKs, as FKs, a RLS e os GRANTs da tabela que o app usa ficam iguais: o
--      código anterior continua funcionando (inclusive `ON CONFLICT` na chave primária).
--   3. `app.partitioned_table` guarda a configuração (período, quantas partições criar adiante, retenção) e
--      `app.maintain_partitions(now, dry_run)` cria as partições que faltam e apaga as que passaram da
--      retenção. Uma tarefa agendada DIÁRIA chama a função (L17 do docs/17; em TS: `maintainPartitions()`).
--      Retenção: `production_minute` 2 anos (D6); `tag_sample` 90 dias (docs/06: 30–90 dias).
--   4. Toda partição tem RLS ENABLE + FORCE com a política de cliente (o teste de catálogo confere), mas o
--      app_user NÃO tem GRANT nelas: o acesso é sempre pela tabela-mãe, cuja RLS vale para todas.
--
-- Quem roda a manutenção: o papel DONO das tabelas (o mesmo das migrações), porque criar e apagar partição é
-- DDL. A função não é SECURITY DEFINER e o EXECUTE não é dado a ninguém (nem ao app_user).
--
-- Fora daqui, de propósito: `machine_state_event` e `audit_log` (docs/06 sugere partição mensal/anual) têm
-- chave primária só no `id` vindo da borda, usada pelo `/sync` em `ON CONFLICT (id)`. Particionar exigiria a
-- coluna de tempo na chave, o que mudaria esse contrato. `machine_state_event` tem retenção indefinida (sem
-- ganho com partição) e a auditoria guarda 5 anos (D6): a limpeza dela fica para quando houver dados de 5 anos.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS app.partitioned_table (
  parent_table text PRIMARY KEY,
  period text NOT NULL CHECK (period IN ('week', 'month')),
  premake integer NOT NULL CHECK (premake BETWEEN 1 AND 24),
  retention interval CHECK (retention IS NULL OR retention >= interval '7 days'),
  CONSTRAINT partitioned_table_name_chk CHECK (parent_table ~ '^[a-z_][a-z0-9_]*$')
);
--> statement-breakpoint
COMMENT ON TABLE app.partitioned_table IS
  'Tabelas particionadas por tempo (schema public) e regras da manutenção diária (app.maintain_partitions): período, partições criadas adiante e retenção (NULL = sem limpeza).';
--> statement-breakpoint
REVOKE ALL ON app.partitioned_table FROM PUBLIC;
--> statement-breakpoint
-- Limites de cada partição de uma tabela (MINVALUE/MAXVALUE viram -infinity/infinity; DEFAULT fica de fora).
-- TimeZone fixo em UTC: o texto do limite (pg_get_expr) sai sempre com +00.
CREATE OR REPLACE FUNCTION app.partition_bounds(p_parent regclass)
  RETURNS TABLE (partition_name text, range_from timestamptz, range_to timestamptz)
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, pg_temp
  SET "TimeZone" = 'UTC'
  AS $$
DECLARE
  r record;
  m text[];
BEGIN
  FOR r IN
    SELECT c.relname::text AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = p_parent
    ORDER BY 1
  LOOP
    m := regexp_match(r.bound, '^FOR VALUES FROM \((.+)\) TO \((.+)\)$');
    CONTINUE WHEN m IS NULL;
    partition_name := r.name;
    range_from := CASE WHEN m[1] = 'MINVALUE' THEN '-infinity'::timestamptz ELSE btrim(m[1], '''')::timestamptz END;
    range_to := CASE WHEN m[2] = 'MAXVALUE' THEN 'infinity'::timestamptz ELSE btrim(m[2], '''')::timestamptz END;
    RETURN NEXT;
  END LOOP;
END
$$;
--> statement-breakpoint
-- Manutenção diária: para cada tabela de app.partitioned_table, cria as partições do período atual e das
-- `premake` seguintes (pulando as que já existem ou colidem com uma existente, como a `_legacy`) e apaga as
-- partições inteiramente mais velhas que a retenção (limite superior <= p_now - retention).
-- Idempotente: rodar duas vezes no mesmo dia não faz nada na segunda. `p_dry_run` só lista o que faria.
-- Devolve uma linha por ação ('created' ou 'dropped').
CREATE OR REPLACE FUNCTION app.maintain_partitions(p_now timestamptz DEFAULT now(), p_dry_run boolean DEFAULT false)
  RETURNS TABLE (parent_table text, partition_name text, action text, range_from timestamptz, range_to timestamptz)
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
  SET "TimeZone" = 'UTC'
  AS $$
DECLARE
  cfg record;
  b record;
  v_parent regclass;
  v_step interval;
  v_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_name text;
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) THEN
    RAISE EXCEPTION 'app.maintain_partitions: p_now precisa ser um instante finito' USING ERRCODE = '22023';
  END IF;
  FOR cfg IN SELECT * FROM app.partitioned_table c ORDER BY c.parent_table LOOP
    v_parent := format('public.%I', cfg.parent_table)::regclass;
    v_step := ('1 ' || cfg.period)::interval;
    v_start := date_trunc(cfg.period, p_now);
    FOR i IN 0 .. cfg.premake LOOP
      v_from := v_start + v_step * i;
      v_to := v_from + v_step;
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM app.partition_bounds(v_parent) pb WHERE pb.range_from < v_to AND pb.range_to > v_from
      );
      v_name := cfg.parent_table || '_p'
        || to_char(v_from, CASE cfg.period WHEN 'month' THEN 'YYYY_MM' ELSE 'YYYY_MM_DD' END);
      IF NOT p_dry_run THEN
        EXECUTE format('CREATE TABLE public.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)', v_name, v_parent, v_from, v_to);
        PERFORM app.enable_tenant_rls(format('public.%I', v_name)::regclass);
      END IF;
      parent_table := cfg.parent_table;
      partition_name := v_name;
      action := 'created';
      range_from := v_from;
      range_to := v_to;
      RETURN NEXT;
    END LOOP;
    CONTINUE WHEN cfg.retention IS NULL;
    FOR b IN
      SELECT pb.* FROM app.partition_bounds(v_parent) pb
      WHERE pb.range_to <= p_now - cfg.retention
      ORDER BY pb.range_to
    LOOP
      IF NOT p_dry_run THEN
        EXECUTE format('DROP TABLE public.%I', b.partition_name);
      END IF;
      parent_table := cfg.parent_table;
      partition_name := b.partition_name;
      action := 'dropped';
      range_from := b.range_from;
      range_to := b.range_to;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.partition_bounds(regclass), app.maintain_partitions(timestamptz, boolean) FROM PUBLIC;
--> statement-breakpoint
-- Auxiliar SÓ desta migração (apagada no fim): troca uma tabela comum por uma particionada com o mesmo nome,
-- com a tabela antiga como primeira partição. Colunas, padrões e CHECKs vêm com LIKE; chave primária e FKs são
-- recriadas com os MESMOS nomes (os do drizzle-kit) e, no ATTACH, o Postgres reaproveita as da tabela antiga.
CREATE FUNCTION app.tmp_convert_to_partitioned(p_table text, p_column text, p_period text) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_legacy text := p_table || '_legacy';
  v_pk record;
  v_fk record;
  v_max timestamptz;
  v_cutoff timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = format('public.%I', p_table)::regclass AND NOT i.indisprimary
  ) THEN
    RAISE EXCEPTION '%: há índices além da chave primária; inclua-os na conversão para partições', p_table;
  END IF;
  SELECT k.conname, pg_get_constraintdef(k.oid) AS def INTO STRICT v_pk
    FROM pg_constraint k WHERE k.conrelid = format('public.%I', p_table)::regclass AND k.contype = 'p';

  -- Dado mais novo: com a RLS FORÇADA, o dono sem BYPASSRLS não enxergaria nenhuma linha (padrão da 0005).
  EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('SELECT max(%I) FROM public.%I', p_column, p_table) INTO v_max;
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', p_table);
  -- Fim da partição antiga: início do período seguinte ao do dado mais novo (ou de agora), em UTC.
  v_cutoff := (date_trunc(p_period, greatest(now(), coalesce(v_max, now())) AT TIME ZONE 'UTC')
    + ('1 ' || p_period)::interval) AT TIME ZONE 'UTC';

  EXECUTE format('ALTER TABLE public.%I RENAME TO %I', p_table, v_legacy);
  EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', v_legacy, v_pk.conname, v_legacy || '_pk');
  EXECUTE format(
    'CREATE TABLE public.%I (LIKE public.%I INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMMENTS) '
    'PARTITION BY RANGE (%I)',
    p_table, v_legacy, p_column
  );
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', p_table, v_pk.conname, v_pk.def);
  FOR v_fk IN
    SELECT k.conname, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k
    WHERE k.conrelid = format('public.%I', v_legacy)::regclass AND k.contype = 'f'
    ORDER BY k.conname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', p_table, v_fk.conname, v_fk.def);
  END LOOP;
  PERFORM app.enable_tenant_rls(format('public.%I', p_table)::regclass);
  EXECUTE format(
    'ALTER TABLE public.%I ATTACH PARTITION public.%I FOR VALUES FROM (MINVALUE) TO (%L)',
    p_table, v_legacy, v_cutoff
  );
  -- A partição antiga já tem RLS forçada (0001); o acesso do app passa a ser só pela tabela-mãe.
  EXECUTE format('REVOKE ALL ON public.%I FROM app_user', v_legacy);
END
$$;
--> statement-breakpoint
SELECT app.tmp_convert_to_partitioned('production_minute', 'bucket_start', 'month');
--> statement-breakpoint
SELECT app.tmp_convert_to_partitioned('tag_sample', 'at', 'week');
--> statement-breakpoint
DROP FUNCTION app.tmp_convert_to_partitioned(text, text, text);
--> statement-breakpoint
-- Mesmos GRANTs da 0001 (séries de produção não são apagadas pelo app; amostras são imutáveis).
GRANT SELECT, INSERT, UPDATE ON public.production_minute TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.tag_sample TO app_user;
--> statement-breakpoint
INSERT INTO app.partitioned_table (parent_table, period, premake, retention) VALUES
  ('production_minute', 'month', 3, interval '2 years'),
  ('tag_sample', 'week', 8, interval '90 days')
ON CONFLICT (parent_table) DO NOTHING;
--> statement-breakpoint
-- Cria já as partições do período atual e dos próximos (o banco fica pronto mesmo antes da primeira tarefa diária).
SELECT count(*) FROM app.maintain_partitions();
