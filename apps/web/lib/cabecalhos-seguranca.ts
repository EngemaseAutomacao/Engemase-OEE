/**
 * Cabeçalhos de segurança HTTP de todas as respostas (páginas, arquivos e API dos gateways).
 * Usado por `next.config.ts` (`headers()`); a revisão está em docs/operacao/revisao-seguranca-w11.md.
 *
 * Por que a CSP não usa nonce: o app usa `cacheComponents` (prerender parcial) e páginas pré-geradas.
 * Nonce exige renderizar toda página a cada pedido e é incompatível com o prerender parcial (guia
 * "Content Security Policy" em node_modules/next/dist/docs). Por isso `script-src` aceita os scripts
 * inline do próprio Next.js (dados do RSC) e do next-themes com 'unsafe-inline', mas **só da mesma
 * origem**: script de outro domínio, `<object>`, `<base>`, envio de formulário para fora e o app
 * dentro de `<iframe>` continuam bloqueados. A proteção principal contra XSS segue sendo o React
 * (escapa todo texto) e a regra de nunca usar `dangerouslySetInnerHTML` com dado de usuário.
 */

/** Cabeçalho no formato que o `headers()` do next.config espera. */
export type Cabecalho = { key: string; value: string }

/** Monta a Content-Security-Policy. Em desenvolvimento o React precisa de `eval` (pilhas de erro). */
export function politicaDeConteudo({ desenvolvimento }: { desenvolvimento: boolean }): string {
  const diretivas: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(desenvolvimento ? ["'unsafe-eval'"] : [])],
    // Estilos inline: atributos `style` do React, ECharts, Radix e sonner.
    ["style-src", "'self'", "'unsafe-inline'"],
    // data:/blob: para o ECharts (exportar imagem) e ícones gerados.
    ["img-src", "'self'", "data:", "blob:"],
    // next/font baixa as fontes no build e as serve da própria origem.
    ["font-src", "'self'"],
    // 'self' cobre também o WebSocket do recarregamento em desenvolvimento (mesma origem).
    ["connect-src", "'self'"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["media-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    // Ninguém embute o app (clickjacking). Se o modo TV/andon precisar ir num iframe de outro site,
    // abrir só aquela rota, para a origem combinada (docs/08, "Cabeçalhos").
    ["frame-ancestors", "'none'"],
  ]
  // Em produção, qualquer `http://` que escapar vira `https://`. Fora dela o servidor local é http.
  if (!desenvolvimento) diretivas.push(["upgrade-insecure-requests"])
  return diretivas.map((d) => d.join(" ")).join("; ")
}

/** Recursos do navegador que o app não usa ficam desligados para a página e para qualquer iframe. */
const PERMISSOES = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "publickey-credentials-get=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
  // Usados pelo app (copiar link do cliente; modo TV/andon em tela cheia) só na própria origem.
  "clipboard-write=(self)",
  "fullscreen=(self)",
  "screen-wake-lock=(self)",
].join(", ")

/** Todos os cabeçalhos de segurança. `desenvolvimento` = `next dev`. */
export function cabecalhosDeSeguranca({ desenvolvimento }: { desenvolvimento: boolean }): Cabecalho[] {
  return [
    { key: "Content-Security-Policy", value: politicaDeConteudo({ desenvolvimento }) },
    // 2 anos, com subdomínios. Sem `preload`: o domínio ainda é o da Vercel (D28). O navegador
    // ignora HSTS recebido por http, então o servidor local não é afetado.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSOES },
    // Navegadores antigos que não entendem `frame-ancestors`.
    { key: "X-Frame-Options", value: "DENY" },
    // Janela aberta por outro site não consegue mexer nesta (e vice-versa).
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ]
}
