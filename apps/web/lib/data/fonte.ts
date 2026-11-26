import { appDatabaseUrl } from "@/lib/server/db-url"

/**
 * Fonte dos dados das telas: banco quando o app tem um endereço seguro (ver `lib/server/db-url.ts`);
 * senão, dados simulados (demonstração). Só o `DATABASE_URL` da integração Neon, sem a senha do app,
 * não basta: ele é do dono das tabelas.
 */
export function usarBanco(): boolean {
  return appDatabaseUrl() !== null
}
