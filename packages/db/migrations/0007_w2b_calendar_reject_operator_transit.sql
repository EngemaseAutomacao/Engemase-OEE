-- 0007 — gerada pelo drizzle-kit (`pnpm db:generate`). Épico W2b, regras das lacunas do docs/17 (§4):
--   - L2 feriados por unidade: tabela `unit_holiday` (um por dia e unidade);
--   - L3 refugo manual e estorno com motivos: tabela `reject_reason`; em `quality_entry`, o motivo cadastrado
--     (`reject_reason_id`), o motivo do estorno (`reversal_reason`, obrigatório só no estorno), no máximo um
--     estorno por lançamento (índice único parcial) e lançamento comum sempre positivo;
--   - L19 operadores por unidade com matrícula opcional: tabela `unit_operator` e `operator_id` /
--     `classified_operator_id` em `quality_entry`, `production_run` e `machine_state_event`;
--   - L23 gateway "Em trânsito" por até 30 dias: colunas `in_transit_since`, `in_transit_until` e `installed_at`.
-- Só acréscimos: tabelas novas, colunas que aceitam nulo, índices e CHECKs/FKs que olham as colunas novas (o
-- código anterior continua gravando igual). `quality_entry_sign_chk` e `quality_entry_reversal_reason_chk` também
-- valem para linhas antigas, mas nenhum código grava `quality_entry` ainda. RLS e GRANTs das tabelas novas: 0008.
CREATE TABLE "reject_reason" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reject_reason_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "reject_reason_name_chk" CHECK (btrim("reject_reason"."name") <> ''),
	CONSTRAINT "reject_reason_code_chk" CHECK ("reject_reason"."code" IS NULL OR btrim("reject_reason"."code") <> '')
);
--> statement-breakpoint
CREATE TABLE "unit_holiday" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unit_holiday_name_chk" CHECK (btrim("unit_holiday"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "unit_operator" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"employee_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unit_operator_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "unit_operator_name_chk" CHECK (btrim("unit_operator"."name") <> ''),
	CONSTRAINT "unit_operator_code_chk" CHECK ("unit_operator"."employee_code" IS NULL OR btrim("unit_operator"."employee_code") <> '')
);
--> statement-breakpoint
ALTER TABLE "gateway" ADD COLUMN "in_transit_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateway" ADD COLUMN "in_transit_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateway" ADD COLUMN "installed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD COLUMN "classified_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "production_run" ADD COLUMN "operator_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD COLUMN "reject_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD COLUMN "operator_id" uuid;--> statement-breakpoint
ALTER TABLE "reject_reason" ADD CONSTRAINT "reject_reason_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holiday" ADD CONSTRAINT "unit_holiday_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holiday" ADD CONSTRAINT "unit_holiday_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_operator" ADD CONSTRAINT "unit_operator_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_operator" ADD CONSTRAINT "unit_operator_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reject_reason_org_name_uq" ON "reject_reason" USING btree ("organization_id",lower("name")) WHERE "reject_reason"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reject_reason_org_code_uq" ON "reject_reason" USING btree ("organization_id","code") WHERE "reject_reason"."code" IS NOT NULL AND "reject_reason"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_holiday_unit_date_uq" ON "unit_holiday" USING btree ("unit_id","holiday_date") WHERE "unit_holiday"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "unit_operator_unit_idx" ON "unit_operator" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_operator_unit_code_uq" ON "unit_operator" USING btree ("unit_id","employee_code") WHERE "unit_operator"."employee_code" IS NOT NULL AND "unit_operator"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_operator_fk" FOREIGN KEY ("classified_operator_id","organization_id") REFERENCES "public"."unit_operator"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run" ADD CONSTRAINT "production_run_operator_fk" FOREIGN KEY ("operator_id","organization_id") REFERENCES "public"."unit_operator"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_reject_reason_fk" FOREIGN KEY ("reject_reason_id","organization_id") REFERENCES "public"."reject_reason"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_operator_fk" FOREIGN KEY ("operator_id","organization_id") REFERENCES "public"."unit_operator"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_entry_one_reversal_uq" ON "quality_entry" USING btree ("reverses_id") WHERE "quality_entry"."reverses_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway" ADD CONSTRAINT "gateway_in_transit_chk" CHECK (("gateway"."in_transit_since" IS NULL) = ("gateway"."in_transit_until" IS NULL) AND ("gateway"."in_transit_until" IS NULL
        OR ("gateway"."in_transit_until" > "gateway"."in_transit_since"
          AND "gateway"."in_transit_until" <= "gateway"."in_transit_since" + make_interval(days => 30))));--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_sign_chk" CHECK (("quality_entry"."reverses_id" IS NULL) = ("quality_entry"."quantity" > 0));--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_reversal_reason_chk" CHECK (("quality_entry"."reverses_id" IS NULL AND "quality_entry"."reversal_reason" IS NULL) OR ("quality_entry"."reverses_id" IS NOT NULL AND coalesce(btrim("quality_entry"."reversal_reason"), '') <> ''));