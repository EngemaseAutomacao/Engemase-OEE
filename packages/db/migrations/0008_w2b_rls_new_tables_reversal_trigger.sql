-- =============================================================================================
-- 0008 — migração MANUAL (W2b): RLS e GRANTs das tabelas novas da 0007 e gatilho do estorno de refugo.
--
--   1. `unit_holiday`, `reject_reason` e `unit_operator` são tabelas de cliente: RLS ENABLE + FORCE com a
--      política restritiva de cliente (`app.enable_tenant_rls`), e GRANTs de cadastro para o app_user
--      (quem pode gravar dentro do cliente — a Engemase, D12 — é regra da aplicação);
--   2. gatilho `quality_entry_reversal_trg` (L3 do docs/17): o estorno tem a quantidade OPOSTA à do
--      lançamento original, é da MESMA máquina e não estorna outro estorno. São regras entre linhas, que
--      CHECK não alcança. O gatilho roda com o papel de quem grava (sem SECURITY DEFINER): o app_user
--      enxerga o original porque ele é do mesmo cliente (a FK composta já garante isso).
-- Só acréscimos; o código anterior não grava `quality_entry`.
-- =============================================================================================
SELECT app.enable_tenant_rls('public.unit_holiday');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.reject_reason');
--> statement-breakpoint
SELECT app.enable_tenant_rls('public.unit_operator');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_holiday, public.reject_reason, public.unit_operator TO app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.quality_entry_check_reversal() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_original public.quality_entry%ROWTYPE;
BEGIN
  -- Sem estorno, ou estorno com quantidade >= 0 (o CHECK quality_entry_reversal_chk recusa): nada a conferir.
  IF NEW.reverses_id IS NULL OR NEW.quantity >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_original FROM public.quality_entry
    WHERE id = NEW.reverses_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    -- Original inexistente (ou de outro cliente): a FK composta quality_entry_reverses_fk recusa logo depois.
    -- Quem consegue gravar aqui enxerga o original: o app_user só grava no próprio cliente, e o dono sem
    -- BYPASSRLS nem grava (RLS forçada, sem política para ele).
    RETURN NEW;
  END IF;
  IF v_original.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'quality_entry: não se estorna um estorno (%)', NEW.reverses_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.machine_id <> v_original.machine_id THEN
    RAISE EXCEPTION 'quality_entry: o estorno precisa ser da mesma máquina do lançamento original'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.quantity <> -v_original.quantity THEN
    RAISE EXCEPTION 'quality_entry: o estorno precisa ter a quantidade oposta à do original (esperado %, recebido %)',
      -v_original.quantity, NEW.quantity
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.quality_entry_check_reversal() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS quality_entry_reversal_trg ON public.quality_entry;
--> statement-breakpoint
CREATE TRIGGER quality_entry_reversal_trg
  BEFORE INSERT OR UPDATE OF reverses_id, quantity, machine_id ON public.quality_entry
  FOR EACH ROW EXECUTE FUNCTION app.quality_entry_check_reversal();
