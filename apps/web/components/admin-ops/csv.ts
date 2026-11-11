"use client"

const BOM = String.fromCharCode(0xfeff)

/** Gera e baixa um CSV (separador ";", com BOM para abrir certo no Excel). Use só em handlers. */
export function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const text = [header.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))].join("\n")
  const blob = new Blob([BOM + text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
