/**
 * `/api/auth/*` fechado por padrão (docs/15, seção 5 e item 10): só as rotas desta lista respondem
 * pela internet; todo o resto do Better Auth (criar conta, organizações, admin, troca de e-mail...)
 * responde 404. O login, o 2FA e a saída das telas passam pelas nossas Server Actions, que chamam
 * `auth.api.*` no servidor; esta lista fica para um cliente que use o Better Auth direto.
 *
 * O teste `test/auth/routes.test.ts` falha se o Better Auth ganhar uma rota que não está classificada
 * aqui (em ALLOWED ou em CLOSED) — rota nova exige decisão.
 */

export const AUTH_BASE_PATH = "/api/auth"

/** Rotas abertas: caminho → métodos. */
export const ALLOWED_AUTH_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/get-session": ["GET"],
  "/sign-out": ["POST"],
  "/sign-in/email": ["POST"],
  "/two-factor/verify-totp": ["POST"],
  "/two-factor/verify-backup-code": ["POST"],
}

/**
 * Rotas do Better Auth (com os plugins em uso) que ficam FECHADAS, com o motivo. Senha nova e 2FA
 * (ativar, desativar, códigos) passam só por Server Actions com sessão e senha conferidas.
 */
export const CLOSED_AUTH_ROUTES: Readonly<Record<string, string>> = {
  "/sign-up/email": "contas nascem pelo fluxo 'definir senha' (docs/15, seção 5)",
  "/sign-in/social": "SSO só na F3 (L20)",
  "/callback/:id": "SSO só na F3",
  "/link-social": "SSO só na F3",
  "/unlink-account": "SSO só na F3",
  "/list-accounts": "não usado",
  "/account-info": "não usado",
  "/get-access-token": "não usado",
  "/refresh-token": "não usado",
  "/delete-user": "exclusão é runbook (LGPD)",
  "/delete-user/callback": "exclusão é runbook (LGPD)",
  "/update-user": "perfil muda por Server Action",
  "/change-email": "e-mail muda por Server Action",
  "/change-password": "Server Action (senha atual + política + vazamento)",
  "/set-password": "fluxo 'definir senha' próprio",
  "/verify-password": "não usado",
  "/request-password-reset": "fluxo próprio com token no fragmento da URL (docs/15, item 9); e-mail ainda não configurado",
  "/reset-password": "idem",
  "/reset-password/:token": "token iria na query (vazaria em log); docs/15, item 9",
  "/send-verification-email": "verificação de e-mail pelo token próprio",
  "/verify-email": "verificação de e-mail pelo token próprio",
  "/list-sessions": "Server Action",
  "/revoke-session": "Server Action",
  "/revoke-sessions": "Server Action",
  "/revoke-other-sessions": "Server Action",
  "/update-session": "não usado",
  "/ok": "não usado",
  "/error": "não usado",
  "/two-factor/enable": "Server Action (senha conferida)",
  "/two-factor/disable": "Server Action (senha conferida)",
  "/two-factor/get-totp-uri": "Server Action",
  "/two-factor/generate-backup-codes": "Server Action",
  "/two-factor/view-backup-codes": "só no servidor",
  "/two-factor/send-otp": "OTP por e-mail/SMS não é usado (só TOTP)",
  "/two-factor/verify-otp": "OTP por e-mail/SMS não é usado",
}

/** A rota (caminho depois de /api/auth) pode ser chamada pela internet com este método? */
export function isAuthRouteAllowed(method: string, path: string): boolean {
  const methods = ALLOWED_AUTH_ROUTES[path]
  return methods !== undefined && methods.includes(method.toUpperCase())
}
