-- =============================================================================================
-- 0019: mapa de códigos de falha do CLP no sistema real
--
-- - `fault_text`: texto do alarme (como no CLP/IHM), mostrado ao operador e na TV.
-- - `reason_id` passa a aceitar nulo: código conhecido sem motivo automático ("perguntar ao operador").
-- - Alvo: uma máquina, um modelo (F2) ou, com os dois nulos, todas as máquinas do cliente (um código
--   por cliente nesse caso, índice único parcial). Só acrescenta/afrouxa: o código antigo continua
--   funcionando durante o deploy.
-- =============================================================================================
ALTER TABLE "fault_code_map" DROP CONSTRAINT "fault_code_map_target_chk";--> statement-breakpoint
ALTER TABLE "fault_code_map" ALTER COLUMN "reason_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD COLUMN "fault_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fault_code_map_client_code_uq" ON "fault_code_map" USING btree ("organization_id","fault_code") WHERE "fault_code_map"."machine_id" IS NULL AND "fault_code_map"."template_id" IS NULL;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD CONSTRAINT "fault_code_map_target_chk" CHECK (NOT ("fault_code_map"."machine_id" IS NOT NULL AND "fault_code_map"."template_id" IS NOT NULL));