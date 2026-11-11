"use client"

import { useTheme } from "next-themes"

/**
 * Paleta categórica dos gráficos de relatório (validada para daltonismo, passos próprios
 * para claro e escuro). Ordem fixa: OEE, Disponibilidade, Performance, Qualidade — a mesma
 * cor representa o mesmo indicador em todos os gráficos.
 */
const SERIES = {
  light: { oee: "#2a78d6", availability: "#eb6834", performance: "#1baf7a", quality: "#eda100" },
  dark: { oee: "#3987e5", availability: "#d95926", performance: "#199e70", quality: "#c98500" },
}

export function useChartTheme() {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return {
    dark,
    series: dark ? SERIES.dark : SERIES.light,
    /** Barras neutras (ex.: tempo planejado) e o texto que vai dentro delas. */
    neutral: dark ? "#52606f" : "#c3cdd9",
    neutralText: dark ? "#f4f4f5" : "#1e293b",
    /** Linhas de referência (meta, 80%). */
    reference: dark ? "#a1a1aa" : "#64748b",
    /** Tinta forte para linhas de destaque (ex.: % acumulado). */
    ink: dark ? "#e4e4e7" : "#334155",
    /** Faixa-meta (fundo suave). */
    targetBand: dark ? "rgba(34,197,94,0.10)" : "rgba(22,163,74,0.08)",
    /** Cor da superfície do card (anel entre segmentos). */
    surface: dark ? "#132131" : "#ffffff",
  }
}
