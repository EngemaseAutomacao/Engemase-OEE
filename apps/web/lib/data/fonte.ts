import { appDatabaseUrl, modoDemonstracao } from "@/lib/server/db-url"

export { modoDemonstracao }

/**
 * Fonte dos dados das telas: banco quando o app tem um endereço seguro (ver `lib/server/db-url.ts`);
 * senão, dados simulados. Só o `DATABASE_URL` da integração Neon, sem a senha do app, não basta: ele
 * é do dono das tabelas. Com `ENGEMASE_DEMONSTRACAO=1` (ambiente de demonstração), nunca há banco.
 */
export function usarBanco(): boolean {
  return appDatabaseUrl() !== null
}
