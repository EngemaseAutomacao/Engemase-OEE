/** Corridas de produto (`production_run`) aplicadas ao cálculo: função pura, sem banco. */

/** Corrida de produto (troca do CLP ou do operador). `end = null` = em aberto. */
export interface ProductRunSpan {
  readonly start: number
  readonly end: number | null
  readonly productCode: string | null
}

/**
 * Minutos sem produto do CLP recebem o produto da corrida que valia no início do minuto (docs/05: a troca
 * pelo operador vale quando o produto não vem do CLP). Minuto que já traz produto fica como está.
 */
export function fillMinuteProducts<M extends { readonly start: number; readonly productCode: string | null }>(
  minutes: readonly M[],
  runs: readonly ProductRunSpan[],
): M[] {
  if (runs.length === 0) return [...minutes]
  const sorted = [...runs].sort((a, b) => a.start - b.start)
  return minutes.map((mi) => {
    if (mi.productCode !== null) return mi
    let code: string | null = null
    for (const r of sorted) {
      if (r.start > mi.start) break
      if (r.end === null || r.end > mi.start) code = r.productCode
    }
    return code === null ? mi : { ...mi, productCode: code }
  })
}
