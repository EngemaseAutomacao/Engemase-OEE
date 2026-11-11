CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "member_org_user_uq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"impersonated_by" uuid,
	CONSTRAINT "session_token_uq" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_uq" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "area_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "area_id_unit_org_uq" UNIQUE("id","unit_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"area_id" uuid,
	"name" text NOT NULL,
	"oee_target" numeric(5, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "line_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "line_id_unit_org_uq" UNIQUE("id","unit_id","organization_id"),
	CONSTRAINT "line_oee_target_chk" CHECK ("line"."oee_target" IS NULL OR ("line"."oee_target" > 0 AND "line"."oee_target" <= 1))
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"ideal_cycle_s" numeric(12, 4),
	"micro_stop_threshold_s" integer DEFAULT 60 NOT NULL,
	"state_rules" jsonb NOT NULL,
	"max_rate_per_s" numeric(12, 4),
	"oee_target" numeric(5, 4),
	"template_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "machine_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "machine_id_unit_org_uq" UNIQUE("id","unit_id","organization_id"),
	CONSTRAINT "machine_state_mode_chk" CHECK (("machine"."state_rules" ->> 'mode') IN ('signals', 'state_code', 'count_derived')),
	CONSTRAINT "machine_ideal_cycle_chk" CHECK ("machine"."ideal_cycle_s" IS NULL OR "machine"."ideal_cycle_s" > 0),
	CONSTRAINT "machine_micro_stop_chk" CHECK ("machine"."micro_stop_threshold_s" >= 0),
	CONSTRAINT "machine_max_rate_chk" CHECK ("machine"."max_rate_per_s" IS NULL OR "machine"."max_rate_per_s" > 0),
	CONSTRAINT "machine_oee_target_chk" CHECK ("machine"."oee_target" IS NULL OR ("machine"."oee_target" > 0 AND "machine"."oee_target" <= 1))
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unit_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "unit_timezone_chk" CHECK ("unit"."timezone" <> '')
);
--> statement-breakpoint
CREATE TABLE "account_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid,
	"terminal_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_token_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "account_token_purpose_chk" CHECK ("account_token"."purpose" IN ('set_password', 'verify_email', 'terminal_pairing')),
	CONSTRAINT "account_token_hash_chk" CHECK ("account_token"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_token_target_chk" CHECK (("account_token"."purpose" = 'terminal_pairing' AND "account_token"."terminal_id" IS NOT NULL)
        OR ("account_token"."purpose" <> 'terminal_pairing' AND "account_token"."user_id" IS NOT NULL)),
	CONSTRAINT "account_token_expiry_chk" CHECK ("account_token"."expires_at" > "account_token"."created_at")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"unit_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"access_grant_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_chk" CHECK ("audit_log"."actor_type" IN ('user', 'engemase', 'terminal', 'gateway', 'system'))
);
--> statement-breakpoint
CREATE TABLE "client_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"plan" text,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"managed_by_engemase" boolean DEFAULT false NOT NULL,
	"slug_history" text[] DEFAULT '{}'::text[] NOT NULL,
	"suspended_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_account_org_uq" UNIQUE("organization_id"),
	CONSTRAINT "client_account_status_chk" CHECK ("client_account"."status" IN ('onboarding', 'active', 'suspended', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "member_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_access_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "member_access_member_uq" UNIQUE("member_id"),
	CONSTRAINT "member_access_role_chk" CHECK ("member_access"."role" IN ('client_admin', 'engineer', 'supervisor', 'operator', 'viewer')),
	CONSTRAINT "member_access_scope_chk" CHECK ("member_access"."scope" IN ('all', 'units')),
	CONSTRAINT "member_access_admin_scope_chk" CHECK ("member_access"."role" <> 'client_admin' OR "member_access"."scope" = 'all')
);
--> statement-breakpoint
CREATE TABLE "member_unit" (
	"organization_id" uuid NOT NULL,
	"member_access_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_unit_pk" PRIMARY KEY("member_access_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "platform_assignment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_assignment_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "platform_assignment_validity_chk" CHECK ("platform_assignment"."valid_until" > "platform_assignment"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "platform_assignment_unit" (
	"organization_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "platform_assignment_unit_pk" PRIMARY KEY("assignment_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "support_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"ticket" text,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_grant_status_chk" CHECK ("support_access_grant"."status" IN ('requested', 'active', 'denied', 'ended', 'expired')),
	CONSTRAINT "support_access_grant_window_chk" CHECK ("support_access_grant"."ends_at" > "support_access_grant"."starts_at" AND "support_access_grant"."ends_at" <= "support_access_grant"."starts_at" + interval '4 hours')
);
--> statement-breakpoint
CREATE TABLE "terminal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"line_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"machine_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"token_hash" text,
	"paired_by" uuid,
	"paired_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminal_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "terminal_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "terminal_kind_chk" CHECK ("terminal"."kind" IN ('tv', 'tablet')),
	CONSTRAINT "terminal_token_hash_chk" CHECK ("terminal"."token_hash" IS NULL OR "terminal"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "terminal_paired_chk" CHECK ("terminal"."token_hash" IS NULL OR ("terminal"."paired_at" IS NOT NULL AND "terminal"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"serial_bus_id" uuid,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"params" jsonb NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "device_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "device_id_gateway_org_uq" UNIQUE("id","gateway_id","organization_id"),
	CONSTRAINT "device_protocol_chk" CHECK ("device"."protocol" IN ('modbus-tcp', 'modbus-rtu', 'modbus-rtu-over-tcp')),
	CONSTRAINT "device_serial_bus_chk" CHECK (("device"."protocol" = 'modbus-rtu') = ("device"."serial_bus_id" IS NOT NULL)),
	CONSTRAINT "device_params_bus_chk" CHECK ("device"."protocol" <> 'modbus-rtu' OR ("device"."params" ->> 'bus') = "device"."serial_bus_id"::text),
	CONSTRAINT "device_blocks_chk" CHECK (jsonb_typeof("device"."blocks") = 'array')
);
--> statement-breakpoint
CREATE TABLE "gateway" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending_enrollment' NOT NULL,
	"token_hash" text,
	"previous_token_hash" text,
	"previous_token_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"hostname" text,
	"agent_version" text,
	"config_version_latest" integer DEFAULT 0 NOT NULL,
	"config_version_applied" integer,
	"hw_info" jsonb,
	"health" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "gateway_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "gateway_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "gateway_id_unit_org_uq" UNIQUE("id","unit_id","organization_id"),
	CONSTRAINT "gateway_status_chk" CHECK ("gateway"."status" IN ('pending_enrollment', 'active', 'revoked')),
	CONSTRAINT "gateway_token_hash_chk" CHECK ("gateway"."token_hash" IS NULL OR "gateway"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gateway_previous_token_chk" CHECK ("gateway"."previous_token_hash" IS NULL OR ("gateway"."previous_token_hash" ~ '^[0-9a-f]{64}$' AND "gateway"."previous_token_expires_at" IS NOT NULL)),
	CONSTRAINT "gateway_active_token_chk" CHECK ("gateway"."status" <> 'active' OR "gateway"."token_hash" IS NOT NULL),
	CONSTRAINT "gateway_revoked_chk" CHECK (("gateway"."status" = 'revoked') = ("gateway"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "gateway_command" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gateway_command_status_chk" CHECK ("gateway_command"."status" IN ('pending', 'sent', 'ok', 'error', 'expired', 'rejected', 'cancelled')),
	CONSTRAINT "gateway_command_type_chk" CHECK ("gateway_command"."type" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
	CONSTRAINT "gateway_command_expiry_chk" CHECK ("gateway_command"."expires_at" > "gateway_command"."created_at")
);
--> statement-breakpoint
CREATE TABLE "gateway_config_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_config_version_uq" UNIQUE("gateway_id","version"),
	CONSTRAINT "gateway_config_version_version_chk" CHECK ("gateway_config_version"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "gateway_device_status" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"errors_1m" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_device_status_status_chk" CHECK ("gateway_device_status"."status" IN ('connected', 'degraded', 'disconnected', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "gateway_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_enrollment_code_hash_uq" UNIQUE("code_hash"),
	CONSTRAINT "gateway_enrollment_code_hash_chk" CHECK ("gateway_enrollment"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gateway_enrollment_expiry_chk" CHECK ("gateway_enrollment"."expires_at" > "gateway_enrollment"."created_at")
);
--> statement-breakpoint
CREATE TABLE "gateway_machine" (
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_machine_pk" PRIMARY KEY("gateway_id","machine_id"),
	CONSTRAINT "gateway_machine_gateway_machine_org_uq" UNIQUE("gateway_id","machine_id","organization_id"),
	CONSTRAINT "gateway_machine_machine_uq" UNIQUE("machine_id")
);
--> statement-breakpoint
CREATE TABLE "serial_bus" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"name" text,
	"port" text NOT NULL,
	"baud" integer NOT NULL,
	"parity" text NOT NULL,
	"data_bits" smallint DEFAULT 8 NOT NULL,
	"stop_bits" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_bus_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "serial_bus_id_gateway_org_uq" UNIQUE("id","gateway_id","organization_id"),
	CONSTRAINT "serial_bus_gateway_port_uq" UNIQUE("gateway_id","port"),
	CONSTRAINT "serial_bus_baud_chk" CHECK ("serial_bus"."baud" IN (1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200)),
	CONSTRAINT "serial_bus_parity_chk" CHECK ("serial_bus"."parity" IN ('N', 'E', 'O')),
	CONSTRAINT "serial_bus_data_bits_chk" CHECK ("serial_bus"."data_bits" = 8),
	CONSTRAINT "serial_bus_stop_bits_chk" CHECK ("serial_bus"."stop_bits" IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"machine_id" uuid,
	"name" text,
	"address" jsonb NOT NULL,
	"data_type" text NOT NULL,
	"word_order" text,
	"scale" jsonb,
	"poll_ms" integer,
	"role" text NOT NULL,
	"sampling" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tag_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "tag_role_chk" CHECK ("tag"."role" IN ('state.running', 'state.fault', 'state.code', 'fault.code', 'count.total', 'count.good', 'count.reject', 'product.code', 'speed.actual', 'plc.heartbeat', 'custom')),
	CONSTRAINT "tag_data_type_chk" CHECK ("tag"."data_type" IN ('bool', 'int16', 'uint16', 'int32', 'uint32', 'float32')),
	CONSTRAINT "tag_word_order_chk" CHECK ("tag"."word_order" IS NULL OR "tag"."word_order" IN ('ABCD', 'CDAB', 'BADC', 'DCBA')),
	CONSTRAINT "tag_machine_required_chk" CHECK ("tag"."role" = 'custom' OR "tag"."machine_id" IS NOT NULL),
	CONSTRAINT "tag_poll_ms_chk" CHECK ("tag"."poll_ms" IS NULL OR "tag"."poll_ms" BETWEEN 100 AND 3600000)
);
--> statement-breakpoint
CREATE TABLE "downtime_reason" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text,
	"system_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "downtime_reason_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "downtime_reason_category_chk" CHECK ("downtime_reason"."category" IN ('unplanned', 'planned', 'setup')),
	CONSTRAINT "downtime_reason_color_chk" CHECK ("downtime_reason"."color" IS NULL OR "downtime_reason"."color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "downtime_reason_parent_chk" CHECK ("downtime_reason"."parent_id" IS NULL OR "downtime_reason"."parent_id" <> "downtime_reason"."id")
);
--> statement-breakpoint
CREATE TABLE "fault_code_map" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid,
	"template_id" uuid,
	"fault_code" integer NOT NULL,
	"reason_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fault_code_map_machine_code_uq" UNIQUE("machine_id","fault_code"),
	CONSTRAINT "fault_code_map_template_code_uq" UNIQUE("template_id","fault_code"),
	CONSTRAINT "fault_code_map_target_chk" CHECK (("fault_code_map"."machine_id" IS NULL) <> ("fault_code_map"."template_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "planned_downtime" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"line_id" uuid,
	"machine_id" uuid,
	"reason_id" uuid,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recurrence" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "planned_downtime_interval_chk" CHECK ("planned_downtime"."ends_at" > "planned_downtime"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_id_org_uq" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "product_machine" (
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"ideal_cycle_s" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_machine_pk" PRIMARY KEY("product_id","machine_id"),
	CONSTRAINT "product_machine_ideal_cycle_chk" CHECK ("product_machine"."ideal_cycle_s" > 0)
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"days_of_week" smallint[] NOT NULL,
	"breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shift_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "shift_days_chk" CHECK (cardinality("shift"."days_of_week") > 0 AND "shift"."days_of_week" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
	CONSTRAINT "shift_validity_chk" CHECK ("shift"."valid_from" IS NULL OR "shift"."valid_to" IS NULL OR "shift"."valid_from" <= "shift"."valid_to"),
	CONSTRAINT "shift_breaks_chk" CHECK (jsonb_typeof("shift"."breaks") = 'array')
);
--> statement-breakpoint
CREATE TABLE "machine_live" (
	"machine_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"state" text NOT NULL,
	"state_since" timestamp with time zone NOT NULL,
	"fault_code" integer,
	"counter_total" bigint,
	"product_code" text,
	"at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_live_state_chk" CHECK ("machine_live"."state" IN ('RUNNING', 'STOPPED', 'FAULT', 'SETUP', 'NO_COMM'))
);
--> statement-breakpoint
CREATE TABLE "machine_state_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"fault_code" integer,
	"reason_id" uuid,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"source" text DEFAULT 'edge' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_state_event_state_chk" CHECK ("machine_state_event"."state" IN ('RUNNING', 'STOPPED', 'FAULT', 'SETUP', 'NO_COMM')),
	CONSTRAINT "machine_state_event_source_chk" CHECK ("machine_state_event"."source" IN ('edge', 'manual', 'system')),
	CONSTRAINT "machine_state_event_interval_chk" CHECK ("machine_state_event"."ended_at" IS NULL OR "machine_state_event"."ended_at" >= "machine_state_event"."started_at")
);
--> statement-breakpoint
CREATE TABLE "oee_shift" (
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"shift_id" uuid NOT NULL,
	"planned_s" double precision DEFAULT 0 NOT NULL,
	"run_s" double precision DEFAULT 0 NOT NULL,
	"downtime_s" double precision DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"good" integer DEFAULT 0 NOT NULL,
	"reject" integer DEFAULT 0 NOT NULL,
	"ideal_time_s" double precision,
	"availability" double precision,
	"performance" double precision,
	"quality" double precision,
	"oee" double precision,
	"dirty" boolean DEFAULT true NOT NULL,
	"dirty_since" timestamp with time zone,
	"calculated_at" timestamp with time zone,
	CONSTRAINT "oee_shift_pk" PRIMARY KEY("machine_id","shift_date","shift_id"),
	CONSTRAINT "oee_shift_nonnegative_chk" CHECK ("oee_shift"."planned_s" >= 0 AND "oee_shift"."run_s" >= 0 AND "oee_shift"."downtime_s" >= 0),
	CONSTRAINT "oee_shift_counts_chk" CHECK ("oee_shift"."total" >= 0 AND "oee_shift"."reject" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_minute" (
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"run_s" integer NOT NULL,
	"stop_s" integer NOT NULL,
	"fault_s" integer NOT NULL,
	"setup_s" integer DEFAULT 0 NOT NULL,
	"no_comm_s" integer NOT NULL,
	"total" integer NOT NULL,
	"reject" integer NOT NULL,
	"product_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_minute_pk" PRIMARY KEY("machine_id","bucket_start"),
	CONSTRAINT "production_minute_seconds_chk" CHECK ("production_minute"."run_s" >= 0 AND "production_minute"."stop_s" >= 0 AND "production_minute"."fault_s" >= 0 AND "production_minute"."setup_s" >= 0 AND "production_minute"."no_comm_s" >= 0
        AND "production_minute"."run_s" + "production_minute"."stop_s" + "production_minute"."fault_s" + "production_minute"."setup_s" + "production_minute"."no_comm_s" = 60),
	CONSTRAINT "production_minute_counts_chk" CHECK ("production_minute"."total" >= 0 AND "production_minute"."reject" >= 0),
	CONSTRAINT "production_minute_bucket_chk" CHECK (date_trunc('minute', "production_minute"."bucket_start") = "production_minute"."bucket_start")
);
--> statement-breakpoint
CREATE TABLE "production_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"product_id" uuid,
	"product_code" text,
	"order_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_source_chk" CHECK ("production_run"."source" IN ('plc', 'operator', 'system')),
	CONSTRAINT "production_run_interval_chk" CHECK ("production_run"."ended_at" IS NULL OR "production_run"."ended_at" >= "production_run"."started_at")
);
--> statement-breakpoint
CREATE TABLE "quality_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"quantity" integer NOT NULL,
	"product_code" text,
	"reason" text,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_entry_quantity_chk" CHECK ("quality_entry"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "tag_sample" (
	"organization_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"value" double precision,
	"value_text" text,
	CONSTRAINT "tag_sample_pk" PRIMARY KEY("tag_id","at"),
	CONSTRAINT "tag_sample_value_chk" CHECK ("tag_sample"."value" IS NOT NULL OR "tag_sample"."value_text" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "alert_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"machine_id" uuid,
	"gateway_id" uuid,
	"dedup_key" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"severity" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "alert_event_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "alert_event_state_chk" CHECK ("alert_event"."state" IN ('open', 'notified', 'acknowledged', 'resolved', 'auto_resolved')),
	CONSTRAINT "alert_event_severity_chk" CHECK ("alert_event"."severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "alert_event_resolved_chk" CHECK (("alert_event"."state" IN ('resolved', 'auto_resolved')) = ("alert_event"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "alert_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"unit_id" uuid,
	"line_id" uuid,
	"machine_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" text NOT NULL,
	"recipients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escalation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "alert_rule_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "alert_rule_type_chk" CHECK ("alert_rule"."type" IN ('machine_stopped', 'machine_fault', 'gateway_offline', 'no_data', 'oee_below_target', 'unclassified_stops', 'remote_access', 'engemase_ops')),
	CONSTRAINT "alert_rule_severity_chk" CHECK ("alert_rule"."severity" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_event_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "notification_link_chk" CHECK ("notification"."link" IS NULL OR "notification"."link" LIKE '/%')
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"push_subscription_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_chk" CHECK ("notification_delivery"."channel" IN ('push', 'email', 'whatsapp', 'telegram', 'sms')),
	CONSTRAINT "notification_delivery_status_chk" CHECK ("notification_delivery"."status" IN ('pending', 'sent', 'failed', 'dead')),
	CONSTRAINT "notification_delivery_push_chk" CHECK ("notification_delivery"."channel" <> 'push' OR "notification_delivery"."push_subscription_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"quiet_hours" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_org_user_uq" UNIQUE("organization_id","user_id"),
	CONSTRAINT "notification_preference_channels_chk" CHECK ("notification_preference"."channels" <@ ARRAY['push', 'email', 'whatsapp', 'telegram', 'sms']::text[]),
	CONSTRAINT "notification_preference_alert_types_chk" CHECK ("notification_preference"."alert_types" <@ ARRAY['machine_stopped', 'machine_fault', 'gateway_offline', 'no_data', 'oee_below_target', 'unclassified_stops', 'remote_access', 'engemase_ops']::text[])
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"terminal_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscription_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "push_subscription_org_endpoint_uq" UNIQUE("organization_id","endpoint"),
	CONSTRAINT "push_subscription_owner_chk" CHECK (("push_subscription"."user_id" IS NULL) <> ("push_subscription"."terminal_id" IS NULL)),
	CONSTRAINT "push_subscription_endpoint_chk" CHECK ("push_subscription"."endpoint" LIKE 'https://%')
);
--> statement-breakpoint
CREATE TABLE "remote_access_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"forward_id" uuid,
	"type" text NOT NULL,
	"actor_type" text,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remote_access_forward" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"target_host" text NOT NULL,
	"target_port" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"site_contact" text,
	"requested_by" uuid NOT NULL,
	"requested_duration_min" integer NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"opens_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_connections" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_access_forward_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "remote_access_forward_status_chk" CHECK ("remote_access_forward"."status" IN ('requested', 'approved', 'open', 'closed', 'denied', 'expired', 'failed')),
	CONSTRAINT "remote_access_forward_port_chk" CHECK ("remote_access_forward"."target_port" BETWEEN 1 AND 65535),
	CONSTRAINT "remote_access_forward_duration_chk" CHECK ("remote_access_forward"."requested_duration_min" BETWEEN 1 AND 480),
	CONSTRAINT "remote_access_forward_connections_chk" CHECK ("remote_access_forward"."max_connections" BETWEEN 1 AND 16),
	CONSTRAINT "remote_access_forward_self_approval_chk" CHECK ("remote_access_forward"."decided_by" IS NULL OR "remote_access_forward"."decided_by" <> "remote_access_forward"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "remote_access_policy" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"gateway_id" uuid,
	"mode" text DEFAULT 'approval' NOT NULL,
	"approver_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_duration_min" integer DEFAULT 240 NOT NULL,
	"idle_timeout_min" integer DEFAULT 15 NOT NULL,
	"allow_ot_forward" boolean DEFAULT false NOT NULL,
	"require_site_contact" boolean DEFAULT true NOT NULL,
	"require_physical_key" boolean DEFAULT false NOT NULL,
	"windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_access_policy_scope_uq" UNIQUE NULLS NOT DISTINCT("organization_id","unit_id","gateway_id"),
	CONSTRAINT "remote_access_policy_mode_chk" CHECK ("remote_access_policy"."mode" IN ('disabled', 'approval', 'preapproved_window', 'emergency')),
	CONSTRAINT "remote_access_policy_limits_chk" CHECK ("remote_access_policy"."max_duration_min" BETWEEN 1 AND 480 AND "remote_access_policy"."idle_timeout_min" BETWEEN 1 AND "remote_access_policy"."max_duration_min")
);
--> statement-breakpoint
CREATE TABLE "remote_access_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"ticket" text,
	"requested_duration_min" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"approved_duration_min" integer,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"vpn_node_id" text,
	"vpn_ip" "inet",
	"ssh_cert_serial" text,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	"bytes_in" bigint,
	"bytes_out" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_access_session_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "remote_access_session_id_gateway_org_uq" UNIQUE("id","gateway_id","organization_id"),
	CONSTRAINT "remote_access_session_status_chk" CHECK ("remote_access_session"."status" IN ('requested', 'approved', 'activating', 'active', 'stopping', 'ended', 'denied', 'cancelled', 'expired_unapproved', 'failed', 'revoked')),
	CONSTRAINT "remote_access_session_duration_chk" CHECK ("remote_access_session"."requested_duration_min" BETWEEN 1 AND 480),
	CONSTRAINT "remote_access_session_self_approval_chk" CHECK ("remote_access_session"."decided_by" IS NULL OR "remote_access_session"."decided_by" <> "remote_access_session"."requested_by")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line" ADD CONSTRAINT "line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line" ADD CONSTRAINT "line_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line" ADD CONSTRAINT "line_area_fk" FOREIGN KEY ("area_id","unit_id","organization_id") REFERENCES "public"."area"("id","unit_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_line_fk" FOREIGN KEY ("line_id","unit_id","organization_id") REFERENCES "public"."line"("id","unit_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_terminal_fk" FOREIGN KEY ("terminal_id","organization_id") REFERENCES "public"."terminal"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_account" ADD CONSTRAINT "client_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_member_fk" FOREIGN KEY ("member_id","organization_id") REFERENCES "public"."member"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit" ADD CONSTRAINT "member_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit" ADD CONSTRAINT "member_unit_member_access_fk" FOREIGN KEY ("member_access_id","organization_id") REFERENCES "public"."member_access"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit" ADD CONSTRAINT "member_unit_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment" ADD CONSTRAINT "platform_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment" ADD CONSTRAINT "platform_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment_unit" ADD CONSTRAINT "platform_assignment_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment_unit" ADD CONSTRAINT "platform_assignment_unit_assignment_fk" FOREIGN KEY ("assignment_id","organization_id") REFERENCES "public"."platform_assignment"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment_unit" ADD CONSTRAINT "platform_assignment_unit_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal" ADD CONSTRAINT "terminal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal" ADD CONSTRAINT "terminal_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_serial_bus_fk" FOREIGN KEY ("serial_bus_id","gateway_id","organization_id") REFERENCES "public"."serial_bus"("id","gateway_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway" ADD CONSTRAINT "gateway_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway" ADD CONSTRAINT "gateway_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_command" ADD CONSTRAINT "gateway_command_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_command" ADD CONSTRAINT "gateway_command_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_config_version" ADD CONSTRAINT "gateway_config_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_config_version" ADD CONSTRAINT "gateway_config_version_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_device_status" ADD CONSTRAINT "gateway_device_status_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_device_status" ADD CONSTRAINT "gateway_device_status_device_fk" FOREIGN KEY ("device_id","gateway_id","organization_id") REFERENCES "public"."device"("id","gateway_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_enrollment" ADD CONSTRAINT "gateway_enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_enrollment" ADD CONSTRAINT "gateway_enrollment_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_machine" ADD CONSTRAINT "gateway_machine_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_machine" ADD CONSTRAINT "gateway_machine_gateway_fk" FOREIGN KEY ("gateway_id","unit_id","organization_id") REFERENCES "public"."gateway"("id","unit_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_machine" ADD CONSTRAINT "gateway_machine_machine_fk" FOREIGN KEY ("machine_id","unit_id","organization_id") REFERENCES "public"."machine"("id","unit_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_bus" ADD CONSTRAINT "serial_bus_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_bus" ADD CONSTRAINT "serial_bus_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_device_fk" FOREIGN KEY ("device_id","gateway_id","organization_id") REFERENCES "public"."device"("id","gateway_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_gateway_machine_fk" FOREIGN KEY ("gateway_id","machine_id","organization_id") REFERENCES "public"."gateway_machine"("gateway_id","machine_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_reason" ADD CONSTRAINT "downtime_reason_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_reason" ADD CONSTRAINT "downtime_reason_parent_fk" FOREIGN KEY ("parent_id","organization_id") REFERENCES "public"."downtime_reason"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD CONSTRAINT "fault_code_map_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD CONSTRAINT "fault_code_map_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_code_map" ADD CONSTRAINT "fault_code_map_reason_fk" FOREIGN KEY ("reason_id","organization_id") REFERENCES "public"."downtime_reason"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_downtime" ADD CONSTRAINT "planned_downtime_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_downtime" ADD CONSTRAINT "planned_downtime_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_downtime" ADD CONSTRAINT "planned_downtime_line_fk" FOREIGN KEY ("line_id","unit_id","organization_id") REFERENCES "public"."line"("id","unit_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_downtime" ADD CONSTRAINT "planned_downtime_machine_fk" FOREIGN KEY ("machine_id","unit_id","organization_id") REFERENCES "public"."machine"("id","unit_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_downtime" ADD CONSTRAINT "planned_downtime_reason_fk" FOREIGN KEY ("reason_id","organization_id") REFERENCES "public"."downtime_reason"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_machine" ADD CONSTRAINT "product_machine_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_machine" ADD CONSTRAINT "product_machine_product_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."product"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_machine" ADD CONSTRAINT "product_machine_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_live" ADD CONSTRAINT "machine_live_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_live" ADD CONSTRAINT "machine_live_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_reason_fk" FOREIGN KEY ("reason_id","organization_id") REFERENCES "public"."downtime_reason"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oee_shift" ADD CONSTRAINT "oee_shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oee_shift" ADD CONSTRAINT "oee_shift_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oee_shift" ADD CONSTRAINT "oee_shift_shift_fk" FOREIGN KEY ("shift_id","organization_id") REFERENCES "public"."shift"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_minute" ADD CONSTRAINT "production_minute_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_minute" ADD CONSTRAINT "production_minute_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run" ADD CONSTRAINT "production_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run" ADD CONSTRAINT "production_run_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run" ADD CONSTRAINT "production_run_product_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."product"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_entry" ADD CONSTRAINT "quality_entry_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sample" ADD CONSTRAINT "tag_sample_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sample" ADD CONSTRAINT "tag_sample_tag_fk" FOREIGN KEY ("tag_id","organization_id") REFERENCES "public"."tag"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_rule_fk" FOREIGN KEY ("rule_id","organization_id") REFERENCES "public"."alert_rule"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_line_fk" FOREIGN KEY ("line_id","organization_id") REFERENCES "public"."line"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_alert_event_fk" FOREIGN KEY ("alert_event_id","organization_id") REFERENCES "public"."alert_event"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_fk" FOREIGN KEY ("notification_id","organization_id") REFERENCES "public"."notification"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_push_subscription_fk" FOREIGN KEY ("push_subscription_id","organization_id") REFERENCES "public"."push_subscription"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_terminal_fk" FOREIGN KEY ("terminal_id","organization_id") REFERENCES "public"."terminal"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_event" ADD CONSTRAINT "remote_access_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_event" ADD CONSTRAINT "remote_access_event_session_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."remote_access_session"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_event" ADD CONSTRAINT "remote_access_event_forward_fk" FOREIGN KEY ("forward_id","organization_id") REFERENCES "public"."remote_access_forward"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_forward" ADD CONSTRAINT "remote_access_forward_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_forward" ADD CONSTRAINT "remote_access_forward_session_fk" FOREIGN KEY ("session_id","gateway_id","organization_id") REFERENCES "public"."remote_access_session"("id","gateway_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_forward" ADD CONSTRAINT "remote_access_forward_device_fk" FOREIGN KEY ("device_id","gateway_id","organization_id") REFERENCES "public"."device"("id","gateway_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_policy" ADD CONSTRAINT "remote_access_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_policy" ADD CONSTRAINT "remote_access_policy_unit_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."unit"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_policy" ADD CONSTRAINT "remote_access_policy_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_session" ADD CONSTRAINT "remote_access_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_session" ADD CONSTRAINT "remote_access_session_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_access_session" ADD CONSTRAINT "remote_access_session_gateway_fk" FOREIGN KEY ("gateway_id","organization_id") REFERENCES "public"."gateway"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_org_code_uq" ON "machine" USING btree ("organization_id","code") WHERE "machine"."deleted_at" IS NULL AND "machine"."code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_org_name_uq" ON "unit" USING btree ("organization_id",lower("name")) WHERE "unit"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("organization_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "platform_assignment_user_idx" ON "platform_assignment" USING btree ("user_id","valid_until");--> statement-breakpoint
CREATE INDEX "support_access_grant_user_idx" ON "support_access_grant" USING btree ("user_id","ends_at");--> statement-breakpoint
CREATE INDEX "support_access_grant_org_idx" ON "support_access_grant" USING btree ("organization_id","ends_at");--> statement-breakpoint
CREATE INDEX "gateway_command_pending_idx" ON "gateway_command" USING btree ("gateway_id","created_at") WHERE "gateway_command"."status" IN ('pending', 'sent');--> statement-breakpoint
CREATE INDEX "tag_machine_idx" ON "tag" USING btree ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "downtime_reason_system_key_uq" ON "downtime_reason" USING btree ("organization_id","system_key") WHERE "downtime_reason"."system_key" IS NOT NULL AND "downtime_reason"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "planned_downtime_unit_time_idx" ON "planned_downtime" USING btree ("unit_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_org_code_uq" ON "product" USING btree ("organization_id","code") WHERE "product"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "product_machine_machine_idx" ON "product_machine" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "machine_state_event_machine_time_idx" ON "machine_state_event" USING btree ("machine_id","started_at");--> statement-breakpoint
CREATE INDEX "machine_state_event_open_idx" ON "machine_state_event" USING btree ("machine_id") WHERE "machine_state_event"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "oee_shift_dirty_idx" ON "oee_shift" USING btree ("organization_id","shift_date") WHERE "oee_shift"."dirty";--> statement-breakpoint
CREATE INDEX "oee_shift_org_date_idx" ON "oee_shift" USING btree ("organization_id","shift_date");--> statement-breakpoint
CREATE INDEX "production_run_machine_time_idx" ON "production_run" USING btree ("machine_id","started_at");--> statement-breakpoint
CREATE INDEX "quality_entry_machine_time_idx" ON "quality_entry" USING btree ("machine_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_event_open_dedup_uq" ON "alert_event" USING btree ("rule_id","dedup_key") WHERE "alert_event"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "alert_event_org_opened_idx" ON "alert_event" USING btree ("organization_id","opened_at");--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id","created_at") WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_delivery_pending_idx" ON "notification_delivery" USING btree ("next_attempt_at") WHERE "notification_delivery"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "remote_access_event_session_at_idx" ON "remote_access_event" USING btree ("session_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "remote_access_session_live_uq" ON "remote_access_session" USING btree ("gateway_id","requested_by") WHERE "remote_access_session"."status" IN ('requested', 'approved', 'activating', 'active', 'stopping');--> statement-breakpoint
CREATE INDEX "remote_access_session_org_created_idx" ON "remote_access_session" USING btree ("organization_id","created_at");