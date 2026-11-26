"use client"

/**
 * Erro no layout raiz: substitui o documento inteiro, então não tem o CSS do app (estilos inline,
 * claro/escuro pelo sistema). Mensagem em português, sem detalhe técnico, com "Tentar de novo".
 */
export default function ErroGeral({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
          textAlign: "center",
        }}
      >
        <title>Erro · Engemase OEE</title>
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>O Engemase OEE não conseguiu abrir</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
            Tente de novo em instantes. Se continuar, fale com o suporte da Engemase
            {digest ? ` e informe o código ${digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: 0,
              background: "#2c4e73",
              color: "#fff",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  )
}
