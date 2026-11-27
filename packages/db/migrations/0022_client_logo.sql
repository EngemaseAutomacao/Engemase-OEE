-- =============================================================================================
-- 0022: logotipos do cliente (docs/14). Os arquivos ficam no Vercel Blob privado; aqui, só o caminho,
-- o tipo, o tamanho e o hash. Tabela de cliente: RLS forçada e GRANTs de cadastro para o app_user.
-- =============================================================================================
CREATE TABLE "client_logo" (
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_logo_pk" PRIMARY KEY("organization_id","kind"),
	CONSTRAINT "client_logo_kind_chk" CHECK ("client_logo"."kind" IN ('light', 'dark', 'symbol')),
	CONSTRAINT "client_logo_type_chk" CHECK ("client_logo"."content_type" IN ('image/png', 'image/webp', 'image/svg+xml')),
	CONSTRAINT "client_logo_size_chk" CHECK ("client_logo"."size_bytes" BETWEEN 1 AND 1048576),
	CONSTRAINT "client_logo_sha_chk" CHECK ("client_logo"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "client_logo" ADD CONSTRAINT "client_logo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT app.enable_tenant_rls('public.client_logo');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_logo TO app_user;
