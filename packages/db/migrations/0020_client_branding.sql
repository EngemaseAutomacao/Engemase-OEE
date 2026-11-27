-- =============================================================================================
-- 0020: identidade visual do cliente (docs/14, F2)
--
-- `client_branding`: uma linha por cliente (sem linha = padrão Engemase), com os tokens de cor
-- calculados no servidor. Tabela de cliente: RLS forçada pelo `organization_id` e GRANTs de cadastro
-- para o app_user (quem pode alterar, só a equipe Engemase, é regra da aplicação, D12).
-- =============================================================================================
CREATE TABLE "client_branding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"short_name" text NOT NULL,
	"preset" text,
	"brand_color" text NOT NULL,
	"sidebar_mode" text DEFAULT 'neutral' NOT NULL,
	"tokens" jsonb NOT NULL,
	"adjusted" boolean DEFAULT false NOT NULL,
	"algorithm_version" smallint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_branding_color_chk" CHECK ("client_branding"."brand_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "client_branding_sidebar_chk" CHECK ("client_branding"."sidebar_mode" IN ('neutral', 'brand-dark', 'light')),
	CONSTRAINT "client_branding_names_chk" CHECK (char_length("client_branding"."display_name") BETWEEN 1 AND 40 AND char_length("client_branding"."short_name") BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "client_branding" ADD CONSTRAINT "client_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT app.enable_tenant_rls('public.client_branding');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_branding TO app_user;
