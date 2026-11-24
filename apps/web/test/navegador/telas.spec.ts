/**
 * Fumaça das telas principais (W11): cada tela abre com status < 400, sem erro no console nem
 * exceção na página e sem rolagem horizontal, no celular (Pixel 7) e no computador (1440×900).
 * Os ids vêm dos dados simulados do protótipo (`lib/mock`), os mesmos que o build pré-renderiza.
 */
import { expect, type Page, test } from "@playwright/test"

interface Tela {
  readonly nome: string
  readonly caminho: string
}

const TELAS: readonly Tela[] = [
  { nome: "apresentação do produto", caminho: "/" },
  { nome: "login", caminho: "/login" },
  { nome: "início (seletor de cliente)", caminho: "/inicio" },
  { nome: "visão geral do cliente", caminho: "/plastiform" },
  { nome: "lista de máquinas", caminho: "/plastiform/maquinas" },
  { nome: "detalhe da máquina", caminho: "/plastiform/maquinas/mch_inj01" },
  { nome: "detalhe da linha", caminho: "/plastiform/linhas/lin_injA" },
  { nome: "relatório de OEE", caminho: "/plastiform/relatorios/oee" },
  { nome: "relatório de paradas", caminho: "/plastiform/relatorios/paradas" },
  { nome: "gateways do cliente", caminho: "/plastiform/config/gateways" },
  { nome: "andon da linha (TV)", caminho: "/plastiform/andon/lin_injA" },
  { nome: "tela do operador", caminho: "/plastiform/operador/mch_inj01" },
  { nome: "terminal de chão de fábrica", caminho: "/terminal/trm_02/mch_inj01" },
  { nome: "console Engemase", caminho: "/admin" },
  { nome: "clientes (console)", caminho: "/admin/clientes" },
]

/** Junta os erros do console e as exceções não tratadas da página. */
function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(`console: ${msg.text()}`)
  })
  page.on("pageerror", (error) => erros.push(`exceção: ${error.message}`))
  return erros
}

for (const tela of TELAS) {
  test(`${tela.nome} (${tela.caminho}) abre sem erro e sem rolagem horizontal`, async ({ page }) => {
    const erros = coletarErros(page)

    const resposta = await page.goto(tela.caminho, { waitUntil: "load" })
    expect(resposta, "sem resposta do servidor").not.toBeNull()
    expect(resposta?.status(), `status HTTP de ${tela.caminho}`).toBeLessThan(400)

    // Algo visível no corpo e a hidratação do React concluída (erros de hidratação aparecem no console).
    await expect(page.locator("body")).toBeVisible()
    await page.waitForTimeout(750)

    const largura = await page.evaluate(() => ({
      pagina: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      janela: window.innerWidth,
    }))
    expect(largura.pagina, `rolagem horizontal: página com ${largura.pagina}px numa janela de ${largura.janela}px`).toBeLessThanOrEqual(
      largura.janela,
    )

    expect(erros, "erros no console ou exceções na página").toEqual([])
  })
}

test("rota desconhecida responde 404 sem exceção na página", async ({ page }) => {
  const erros: string[] = []
  page.on("pageerror", (error) => erros.push(error.message))
  const resposta = await page.goto("/nao-existe/rota-de-teste", { waitUntil: "load" })
  expect(resposta?.status()).toBe(404)
  expect(erros).toEqual([])
})
