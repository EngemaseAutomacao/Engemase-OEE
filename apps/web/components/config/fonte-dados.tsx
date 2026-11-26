"use client"

import { createContext, useContext } from "react"

/**
 * De onde vêm os dados da tela (W8): com `banco`, os botões de cadastro chamam as Server Actions e
 * gravam de verdade; sem banco (demonstração), continuam simulando com um aviso (toast).
 */
export interface FonteDados {
  readonly banco: boolean
  /** Cliente da tela (slug), para as ações de cadastro. */
  readonly slug: string | null
}

const Ctx = createContext<FonteDados>({ banco: false, slug: null })

export function FonteDadosProvider({ banco, slug, children }: { banco: boolean; slug?: string | null; children: React.ReactNode }) {
  return <Ctx value={{ banco, slug: slug ?? null }}>{children}</Ctx>
}

export function useFonteDados(): FonteDados {
  return useContext(Ctx)
}
