/**
 * Better Auth (W5; docs/15, seção 5): motor de identidade — senha, sessão e 2FA. A AUTORIZAÇÃO é
 * nossa (`lib/server/access`): papel e escopo vêm de `member_access`, nunca do Better Auth.
 *
 * O que está ligado e por quê:
 * - e-mail e senha, SEM cadastro aberto (`disableSignUp`): contas nascem pelas nossas Server Actions
 *   (fluxo "definir senha", docs/15 seção 5 — ainda não feito);
 * - senha >= 12, sem regra de composição; senha nova conferida contra vazamentos (`password.ts`);
 * - bloqueio por conta: 5 senhas erradas em 15 min → 15 min (`throttle.ts`), checado ANTES de
 *   conferir a senha;
 * - sessão de 12 h renovada com o uso, "manter conectado" até 30 dias, equipe Engemase sempre 12 h
 *   (`session-policy.ts`; a renovação é feita por `session.ts`, o refresh do Better Auth fica desligado);
 * - 2FA por TOTP com 10 códigos de recuperação cifrados (plugin two-factor), 5 erros = 15 min;
 *   "confiar neste dispositivo" desligado (o 2FA é pedido em todo login, D14);
 * - pessoa bloqueada (`user.banned`) não abre sessão;
 * - ids `uuid` (como o `organization_id` das tabelas de cliente); validação do schema na partida.
 *
 * Fábrica sem Next.js (`createAuth`): os testes montam o mesmo Better Auth sobre o PGlite.
 */
import { account, PLATFORM_ROLES, session, twoFactor as twoFactorTable, user, verification } from "@engemase/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api"
import { nextCookies } from "better-auth/next-js"
import { twoFactor } from "better-auth/plugins/two-factor"
import { AUTH_COOKIE_PREFIX } from "./env"
import { isPasswordPwned, newPasswordError, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password"
import { initialExpiry, rememberAllowed, SESSION_REMEMBER_MS } from "./session-policy"
import { clearLoginFailures, lockedUntil, recordLoginFailure, type ThrottleDb, throttleKey } from "./throttle"

/** Códigos de erro nossos (o `code` do APIError; mensagens em português). */
export const AUTH_ERROR = {
  accountLocked: "ACCOUNT_LOCKED",
  passwordRejected: "PASSWORD_REJECTED",
  trustDeviceDisabled: "TRUST_DEVICE_DISABLED",
} as const

export interface LockNotice {
  /** Hash da conta (nunca o e-mail em log). */
  readonly key: string
  readonly email: string
  readonly until: Date
}

export interface CreateAuthOptions {
  readonly db: ThrottleDb
  readonly secret: string
  readonly baseURL: string
  /** Relógio do bloqueio por tentativas (os testes avançam o tempo). */
  readonly now?: () => Date
  /** Consulta de vazamento (padrão: Pwned Passwords com tempo-limite; `null` = não sei → aceita). */
  readonly pwned?: (password: string) => Promise<boolean | null>
  /** Conta bloqueada agora (L20: avisar por e-mail; sem serviço de e-mail ainda, registra no log). */
  readonly onLock?: (notice: LockNotice) => void | Promise<void>
}

const NEW_PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
}

const TWO_FACTOR_VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp"])

function bodyString(body: unknown, field: string): string | null {
  if (typeof body !== "object" || body === null) return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === "string" ? value : null
}

function defaultOnLock(notice: LockNotice): void {
  console.warn(`[auth] conta bloqueada por 15 min após 5 senhas erradas (conta ${notice.key.slice(0, 12)}…)`)
}

export function createAuth(options: CreateAuthOptions) {
  const now = options.now ?? (() => new Date())
  const pwned = options.pwned ?? ((password: string) => isPasswordPwned(password))
  const onLock = options.onLock ?? defaultOnLock
  const secure = options.baseURL.startsWith("https://")

  return betterAuth({
    appName: "Engemase OEE",
    baseURL: options.baseURL,
    secret: options.secret,
    // Só o endereço canônico (docs/15, item 2): sem curinga e sem domínios de clientes.
    trustedOrigins: [options.baseURL],
    telemetry: { enabled: false },
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: { user, session, account, verification, twoFactor: twoFactorTable },
    }),
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
      database: { generateId: "uuid" },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      // Teto do cookie e do Better Auth; a regra real (12 h / 30 dias) é de session-policy.ts.
      expiresIn: SESSION_REMEMBER_MS / 1000,
      disableSessionRefresh: true,
      additionalFields: {
        rememberMe: { type: "boolean", required: false, defaultValue: false, input: false },
        lastActiveAt: { type: "date", required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false },
        banned: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    rateLimit: { enabled: true },
    plugins: [
      twoFactor({
        issuer: "Engemase OEE",
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
      // Deixa as Server Actions gravarem os cookies (tem de ser o último plugin).
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (data, ctx) => {
            const internal = ctx?.context.internalAdapter
            const owner = internal ? await internal.findUserById(String(data.userId)) : null
            const ownerRecord = owner as (Record<string, unknown> & { role?: unknown; banned?: unknown }) | null
            // Pessoa bloqueada não abre sessão (o Better Auth responde erro no login).
            if (ownerRecord?.banned === true) return false
            const staff = typeof ownerRecord?.role === "string" && (PLATFORM_ROLES as readonly string[]).includes(ownerRecord.role)
            const createdAt = new Date()
            // Troca de sessão com a pessoa já logada (ex.: ao ativar o 2FA o Better Auth cria uma sessão
            // nova e apaga a antiga): herda a escolha, o início e o vencimento da sessão anterior, para
            // a troca não transformar uma sessão de 12 h em 30 dias nem estender os 30 dias.
            const previous =
              ctx && ctx.path !== "/sign-in/email"
                ? ((ctx.context.session ?? (await getSessionFromCtx(ctx).catch(() => null)))?.session as
                    | (Record<string, unknown> & { rememberMe?: unknown; createdAt?: unknown; expiresAt?: unknown })
                    | undefined)
                : undefined
            if (previous !== undefined && previous !== null) {
              const rememberMe = previous.rememberMe === true && rememberAllowed(staff)
              const previousCreated = new Date(String(previous.createdAt))
              const previousExpiry = new Date(String(previous.expiresAt))
              return {
                data: {
                  ...data,
                  rememberMe,
                  lastActiveAt: createdAt,
                  createdAt: Number.isNaN(previousCreated.getTime()) ? createdAt : previousCreated,
                  expiresAt:
                    rememberMe && !Number.isNaN(previousExpiry.getTime()) ? previousExpiry : initialExpiry(false, createdAt),
                },
              }
            }
            // Login: o Better Auth cria a sessão com 30 dias ("lembrar") ou 1 dia ("não lembrar",
            // inclusive depois do 2FA, pelo cookie dont_remember). Daí sai a escolha da pessoa.
            const requestedRemember = new Date(data.expiresAt).getTime() - Date.now() > 2 * 24 * 60 * 60 * 1000
            const rememberMe = requestedRemember && rememberAllowed(staff)
            return {
              data: { ...data, rememberMe, lastActiveAt: createdAt, expiresAt: initialExpiry(rememberMe, createdAt) },
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          const email = bodyString(ctx.body, "email")
          if (email !== null) {
            const until = await lockedUntil(options.db, throttleKey(email), now())
            if (until !== null) {
              throw new APIError("TOO_MANY_REQUESTS", {
                code: AUTH_ERROR.accountLocked,
                message: "Muitas tentativas com senha errada. Espere 15 minutos e tente de novo.",
              })
            }
          }
          return
        }
        const passwordField = NEW_PASSWORD_FIELDS[ctx.path]
        if (passwordField !== undefined) {
          const password = bodyString(ctx.body, passwordField)
          if (password !== null) {
            const error = await newPasswordError(password, pwned)
            if (error !== null) throw new APIError("BAD_REQUEST", { code: AUTH_ERROR.passwordRejected, message: error })
          }
          return
        }
        if (TWO_FACTOR_VERIFY_PATHS.has(ctx.path) && (ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice) {
          throw new APIError("BAD_REQUEST", {
            code: AUTH_ERROR.trustDeviceDisabled,
            message: "O código de verificação é pedido em todo login.",
          })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return
        const email = bodyString(ctx.body, "email")
        if (email === null) return
        const key = throttleKey(email)
        const returned = ctx.context.returned
        if (isAPIError(returned)) {
          // Só senha/e-mail errados contam (bloqueio e entrada inválida não).
          if (returned.statusCode !== 401) return
          const state = await recordLoginFailure(options.db, key, now())
          if (state.justLocked && state.lockedUntil !== null) {
            try {
              await onLock({ key, email, until: state.lockedUntil })
            } catch (error) {
              console.error("[auth] falha ao avisar o bloqueio da conta", error)
            }
          }
          return
        }
        await clearLoginFailures(options.db, key)
      }),
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
