"use client"

import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react"
import { toast } from "sonner"

import { num } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Botão "Exportar" (CSV / Excel). No protótipo só confirma com um toast. */
export function ExportMenu({
  baseName,
  rowCount,
  scopeLabel,
  disabled,
}: {
  /** Nome do arquivo sem extensão, ex.: "oee_plastiform_2026-10-28_a_2026-11-10". */
  baseName: string
  rowCount: number
  /** Resumo dos filtros aplicados, mostrado no toast. */
  scopeLabel: string
  disabled?: boolean
}) {
  const exportAs = (ext: "csv" | "xlsx") => {
    toast.success(`Arquivo ${ext === "csv" ? "CSV" : "Excel"} gerado`, {
      description: `${baseName}.${ext} · ${num(rowCount)} ${rowCount === 1 ? "linha" : "linhas"} · ${scopeLabel}`,
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <DownloadIcon />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Exporta os dados com os filtros atuais</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => exportAs("csv")}>
          <FileTextIcon />
          CSV (separado por ;)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => exportAs("xlsx")}>
          <FileSpreadsheetIcon />
          Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
