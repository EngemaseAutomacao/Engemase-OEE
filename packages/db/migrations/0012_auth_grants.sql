-- =============================================================================================
-- 0008_auth_grants — migração MANUAL (não gerada pelo drizzle-kit): permissões das tabelas novas
-- do login (W5, docs/17; L20 e D14).
--
-- A 0007 (drizzle-kit) criou `two_factor` (plugin two-factor do Better Auth), `auth_login_throttle`
-- (bloqueio depois de 5 senhas erradas) e as colunas `session.remember_me`/`session.last_active_at`.
--
-- Mesmo padrão de `session`, `account` e `verification` (0001): só o papel do Better Auth
-- (`auth_service`) lê e grava; o `app_user` não tem NENHUM privilégio (o teste de catálogo confere).
-- As colunas novas de `session` entram no GRANT de tabela que o `auth_service` já tem.
--
-- Só acrescenta: tabelas novas e GRANTs. Nada muda para o código anterior.
-- =============================================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.two_factor, public.auth_login_throttle TO auth_service;
--> statement-breakpoint
REVOKE ALL ON public.two_factor, public.auth_login_throttle FROM app_user, app_lookup;
