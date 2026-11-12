-- 0002 — gerada pelo drizzle-kit (`pnpm db:generate`), com UMA edição manual: o UNIQUE (id, organization_id)
-- de quality_entry vem antes da FK composta do estorno, que depende dele (o drizzle-kit gera na ordem inversa).
--   - fault_code (machine_state_event, machine_live, fault_code_map): integer → bigint, CHECK 0..4294967295
--     (uint32 do contrato gateway ↔ nuvem);
--   - production_minute.good (contador de boas, opcional) e machine_live.speed (papel speed.actual);
--   - quality_entry: estorno só de lançamento do MESMO cliente (FK composta), com quantidade negativa;
--   - índice parcial em gateway.previous_token_hash (busca do token anterior durante a rotação).
ALTER TABLE "fault_code_map" ALTER COLUMN "fault_code" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "machine_live" ALTER COLUMN "fault_code" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "machine_state_event" ALTER COLUMN "fault_code" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "machine_live" ADD COLUMN "speed" double precision;--> statement-breakpoint
ALTER TABLE "production_minute" ADD COLUMN "good" integer;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_id_org_uq" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_reverses_fk" FOREIGN KEY ("reverses_id","organization_id") REFERENCES "public"."quality_entry"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_previous_token_hash_idx" ON "gateway" USING btree ("previous_token_hash") WHERE "gateway"."previous_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quality_entry_reverses_idx" ON "quality_entry" USING btree ("reverses_id") WHERE "quality_entry"."reverses_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD CONSTRAINT "fault_code_map_fault_code_chk" CHECK ("fault_code_map"."fault_code" BETWEEN 0 AND 4294967295);--> statement-breakpoint
ALTER TABLE "machine_live" ADD CONSTRAINT "machine_live_fault_code_chk" CHECK ("machine_live"."fault_code" BETWEEN 0 AND 4294967295);--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_fault_code_chk" CHECK ("machine_state_event"."fault_code" BETWEEN 0 AND 4294967295);--> statement-breakpoint
ALTER TABLE "production_minute" ADD CONSTRAINT "production_minute_good_chk" CHECK ("production_minute"."good" IS NULL OR "production_minute"."good" >= 0);--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_reversal_chk" CHECK ("quality_entry"."reverses_id" IS NULL OR ("quality_entry"."quantity" < 0 AND "quality_entry"."reverses_id" <> "quality_entry"."id"));