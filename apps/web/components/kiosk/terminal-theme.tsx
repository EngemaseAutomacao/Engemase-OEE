"use client"

/**
 * Aplica o tema cadastrado do terminal pareado ao abrir a tela (docs/14). O aparelho é dedicado (nunca o
 * navegador de uma pessoa, docs/15 risco 12), então o tema fica guardado nele; o botão de tema da tela ainda
 * troca até a próxima abertura. "Automático" segue o aparelho.
 */
import { useEffect } from "react"
import { useTheme } from "next-themes"

export function TerminalTheme({ theme }: { theme: "dark" | "light" | "system" }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme(theme)
  }, [theme, setTheme])
  return null
}
