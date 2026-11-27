-- =============================================================================================
-- 0021: tema de cada terminal (docs/14): escuro, claro ou automático. TVs já existentes ficam
-- escuras (o padrão da TV Andon); tablets, automático. Só acrescenta: o código antigo segue funcionando.
-- =============================================================================================
ALTER TABLE "terminal" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "terminal" ADD CONSTRAINT "terminal_theme_chk" CHECK ("terminal"."theme" IN ('dark', 'light', 'system'));--> statement-breakpoint
UPDATE "terminal" SET "theme" = 'dark' WHERE "kind" = 'tv';
