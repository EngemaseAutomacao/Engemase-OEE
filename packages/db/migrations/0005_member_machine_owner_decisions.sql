-- 0005 — gerada pelo drizzle-kit (`pnpm db:generate`), mais uma parte MANUAL no fim (RLS e GRANTs da tabela
-- nova e ajuste das linhas existentes). Decisões do dono do produto de 12/11/2026 (docs/15):
--   - D11 escopo de pessoas POR MÁQUINA: `member_access.scope` aceita 'machines' e a tabela nova `member_machine`
--     (vínculo × máquina, FKs compostas com o cliente, como `member_unit`). Fail-closed: escopo 'machines' sem
--     nenhuma máquina listada = nenhum acesso. O admin do cliente continua sempre com 'all';
--   - D12/D13 todo cliente é gerenciado pela Engemase: `client_account.managed_by_engemase` passa a ter padrão
--     true, e as linhas que já existiam são ligadas (parte manual);
--   - D5 acesso da Engemase sempre liberado com registro: a concessão de suporte não tem mais aprovação do
--     cliente. Saem os estados 'requested' e 'denied' e as colunas approved_by/approved_at; o padrão do estado
--     passa a 'active'. Nenhum banco real usou o fluxo de aprovação: se existir concessão 'requested' ou
--     'denied', o ADD CONSTRAINT do estado falha e a migração para (de propósito: tratar à mão);
--   - D1 cobrança por máquina: `client_account.limits` precisa ser um objeto com valores inteiros >= 0
--     (`limits.machines` = máquinas contratadas). Linha fora disso também para a migração.
-- Sem app em produção ainda, as remoções (estados e colunas) não precisam do expand → migrate → contract.
CREATE TABLE "member_machine" (
	"organization_id" uuid NOT NULL,
	"member_access_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_machine_pk" PRIMARY KEY("member_access_id","machine_id")
);
--> statement-breakpoint
ALTER TABLE "member_access" DROP CONSTRAINT "member_access_scope_chk";--> statement-breakpoint
ALTER TABLE "support_access_grant" DROP CONSTRAINT "support_access_grant_status_chk";--> statement-breakpoint
ALTER TABLE "client_account" ALTER COLUMN "managed_by_engemase" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "support_access_grant" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "member_machine" ADD CONSTRAINT "member_machine_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_machine" ADD CONSTRAINT "member_machine_member_access_fk" FOREIGN KEY ("member_access_id","organization_id") REFERENCES "public"."member_access"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_machine" ADD CONSTRAINT "member_machine_machine_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machine"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grant" DROP COLUMN "approved_by";--> statement-breakpoint
ALTER TABLE "support_access_grant" DROP COLUMN "approved_at";--> statement-breakpoint
ALTER TABLE "client_account" ADD CONSTRAINT "client_account_limits_chk" CHECK (jsonb_typeof("client_account"."limits") = 'object' AND NOT jsonb_path_exists("client_account"."limits", 'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())', '{}', true));--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_scope_chk" CHECK ("member_access"."scope" IN ('all', 'units', 'machines'));--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_status_chk" CHECK ("support_access_grant"."status" IN ('active', 'ended', 'expired'));
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- MANUAL: member_machine é tabela de cliente (RLS forçada e GRANTs iguais aos de member_unit)
-- ---------------------------------------------------------------------------------------------
SELECT app.enable_tenant_rls('public.member_machine');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_machine TO app_user;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- MANUAL (D13): os clientes que já existiam passam a ser gerenciados pela Engemase.
-- client_account tem RLS FORÇADA e o dono das tabelas não tem política: sem BYPASSRLS, o UPDATE
-- enxergaria zero linhas e não faria nada, sem erro. Por isso o FORCE sai e volta DENTRO da
-- transação da migração (o migrator do Drizzle aplica tudo numa transação só, e o ALTER TABLE
-- trava a tabela até o COMMIT: ninguém enxerga a tabela sem FORCE).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.client_account NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE public.client_account SET managed_by_engemase = true WHERE NOT managed_by_engemase;
--> statement-breakpoint
ALTER TABLE public.client_account FORCE ROW LEVEL SECURITY;
