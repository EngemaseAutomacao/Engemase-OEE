CREATE TABLE "gateway_health_sample" (
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"sync_count" integer DEFAULT 1 NOT NULL,
	"agent_version" text,
	"config_version" integer,
	"config_state" text,
	"cpu_pct_max" real,
	"mem_mb_max" real,
	"disk_free_mb_min" real,
	"buffer_pending_max" integer,
	"buffer_oldest_s_max" integer,
	"quarantined_max" integer,
	"clock_offset_ms_max_abs" integer,
	"temp_c_max" real,
	"devices_total" smallint,
	"devices_connected_min" smallint,
	"buses_degraded_max" smallint,
	CONSTRAINT "gateway_health_sample_pk" PRIMARY KEY("gateway_id","bucket_start"),
	CONSTRAINT "gateway_health_sample_count_chk" CHECK ("gateway_health_sample"."sync_count" >= 1),
	CONSTRAINT "gateway_health_sample_window_chk" CHECK ("gateway_health_sample"."last_at" >= "gateway_health_sample"."first_at")
);
--> statement-breakpoint
CREATE TABLE "api_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"tat" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_rate_limit_key_chk" CHECK (length("api_rate_limit"."key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "cron_run" (
	"job" text NOT NULL,
	"run_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "cron_run_pk" PRIMARY KEY("job","run_key"),
	CONSTRAINT "cron_run_job_chk" CHECK ("cron_run"."job" ~ '^[a-z][a-z0-9-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "gateway" ADD COLUMN "uplink" jsonb;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "gateway_health_sample" ADD CONSTRAINT "gateway_health_sample_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_health_sample" ADD CONSTRAINT "gateway_health_sample_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_health_sample_bucket_idx" ON "gateway_health_sample" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "api_rate_limit_expires_idx" ON "api_rate_limit" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cron_run_started_idx" ON "cron_run" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rule_system_key_uq" ON "alert_rule" USING btree ("organization_id","system_key") WHERE "alert_rule"."system_key" IS NOT NULL;