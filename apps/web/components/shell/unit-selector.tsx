"use client"

import { useState } from "react"
import { Building2Icon } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * Seletor de unidade no cabeçalho. No protótipo é só visual;
 * na versão real filtra as telas e respeita o escopo de unidades do usuário.
 */
export function UnitSelector({ units }: { units: { id: string; name: string }[] }) {
  const [value, setValue] = useState("all")
  if (units.length <= 1) return null
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger size="sm" className="w-[190px]" aria-label="Unidade">
        <Building2Icon className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas as unidades</SelectItem>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
