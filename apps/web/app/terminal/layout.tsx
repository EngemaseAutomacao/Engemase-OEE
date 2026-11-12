/**
 * Área do TERMINAL pareado (TV Andon e tablet do operador), separada da sessão de pessoa (docs/15, risco 12).
 * Na versão real, o acesso é por um cookie de aparelho próprio deste caminho (`/terminal`), emitido no pareamento;
 * nunca convive com o cookie de login de uma pessoa.
 */
export const instant = false

export default function TerminalLayout({ children }: LayoutProps<"/terminal">) {
  return <div className="min-h-dvh bg-background">{children}</div>
}
