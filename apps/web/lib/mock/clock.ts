/**
 * Relógio e fuso do protótipo, num módulo sem dados. `lib/format.ts` e os relógios dos
 * componentes de cliente importam daqui para não levar os cadastros simulados ao navegador.
 *
 * "Agora" fixo do protótipo: 11/11/2026 10:42 (horário de Brasília), no meio do 1º turno.
 * Componentes de servidor NÃO devem usar Date.now()/new Date() (Cache Components);
 * usem esta constante.
 *
 * Com banco (W8), a camada de dados chama `usarRelogioReal()` depois de ler o pedido (sessão): a
 * partir daí, NESTE pedido, `agoraIso()`/`nowMs()` e os padrões de `ago()`/`since()` usam o relógio
 * real. O valor fica no `cache` do React (um por pedido), então as telas simuladas continuam no
 * instante fixo e nada vaza entre pedidos. No navegador é sempre o instante fixo.
 */
import { cache } from "react"

export const MOCK_NOW = "2026-11-11T13:42:00.000Z"
export const DEFAULT_TZ = "America/Sao_Paulo"

const relogioDoPedido = cache((): { iso: string | null } => ({ iso: null }))

/** Liga o relógio real neste pedido (só depois de ler a sessão ou o banco: render já dinâmico). */
export function usarRelogioReal(iso: string): void {
  relogioDoPedido().iso = iso
}

/** "Agora" em ISO: o relógio real do pedido (telas com banco) ou o instante fixo do protótipo. */
export function agoraIso(): string {
  if (typeof window !== "undefined") return MOCK_NOW
  return relogioDoPedido().iso ?? MOCK_NOW
}

/** Instante "agora" em ms (para cálculos de duração em componentes de servidor). */
export const nowMs = () => Date.parse(agoraIso())
