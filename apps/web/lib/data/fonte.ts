/** Fonte dos dados das telas: banco quando DATABASE_URL existe; senão, dados simulados (demonstração). */
export function usarBanco(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
