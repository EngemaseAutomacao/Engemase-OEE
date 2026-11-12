/**
 * Relógio e fuso do protótipo, num módulo sem dados. `lib/format.ts` e os relógios dos
 * componentes de cliente importam daqui para não levar os cadastros simulados ao navegador.
 *
 * "Agora" fixo do protótipo: 11/11/2026 10:42 (horário de Brasília), no meio do 1º turno.
 * Componentes de servidor NÃO devem usar Date.now()/new Date() (Cache Components);
 * usem esta constante.
 */
export const MOCK_NOW = "2026-11-11T13:42:00.000Z"
export const DEFAULT_TZ = "America/Sao_Paulo"

/** Instante "agora" do protótipo em ms (para cálculos de duração em componentes de servidor). */
export const nowMs = () => Date.parse(MOCK_NOW)
