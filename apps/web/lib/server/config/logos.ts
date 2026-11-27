/**
 * Logotipos do cliente (docs/14, F2): horizontal para fundo claro, para fundo escuro e símbolo quadrado.
 *
 * - Só a equipe Engemase envia e remove (`config.write`, D12); ver = quem lê os dados do cliente.
 * - O arquivo é conferido AQUI pelo conteúdo (não pelo nome nem pelo tipo que o navegador diz): PNG, WebP
 *   ou SVG, até 1 MB; símbolo PNG com pelo menos 512 × 512 px; SVG sem script, eventos, `javascript:`,
 *   `foreignObject` nem referências externas.
 * - Guardado no Vercel Blob PRIVADO, com o hash do conteúdo no caminho; o banco guarda só o caminho
 *   (`client_logo`, RLS). A entrega é pela rota `/[cliente]/marca/[tipo]`, que confere o acesso e manda o
 *   SVG com CSP `sandbox` (mesmo aberto direto, nada roda).
 * - Auditado. Trocar ou remover apaga o arquivo antigo depois de gravar (falha ao apagar só vai para o log).
 */
import { createHash } from "node:crypto"
import { CLIENT_LOGO_KINDS, auditLog, clientLogo, withTenant } from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "./products"

export type LogoKind = (typeof CLIENT_LOGO_KINDS)[number]
export const MAX_LOGO_BYTES = 1_048_576
export const MIN_SYMBOL_PX = 512

const TIPOS = { png: "image/png", webp: "image/webp", svg: "image/svg+xml" } as const
type Formato = keyof typeof TIPOS

/** Onde os arquivos ficam (Vercel Blob privado em produção; memória nos testes). */
export interface LogoStore {
  put(pathname: string, body: Buffer, contentType: string): Promise<void>
  get(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null>
  del(pathname: string): Promise<void>
}

/** Vercel Blob privado (credencial por OIDC, `BLOB_STORE_ID`); `null` se o armazenamento não foi ligado. */
export async function blobStore(): Promise<LogoStore | null> {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return null
  const blob = await import("@vercel/blob")
  return {
    put: async (pathname, body, contentType) => {
      await blob.put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true })
    },
    get: async (pathname) => {
      const r = await blob.get(pathname, { access: "private" })
      return r && r.statusCode === 200 ? { stream: r.stream, contentType: r.blob.contentType } : null
    },
    del: (pathname) => blob.del(pathname),
  }
}

export const isLogoKind = (v: unknown): v is LogoKind => typeof v === "string" && (CLIENT_LOGO_KINDS as readonly string[]).includes(v)

/** Formato pelo conteúdo (assinatura do arquivo), não pelo nome. */
export function detectarFormato(buf: Buffer): Formato | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp"
  const inicio = buf.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(inicio)) return "svg"
  return null
}

/** Largura e altura de um PNG (cabeçalho IHDR). */
export function tamanhoPng(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.subarray(12, 16).toString("ascii") !== "IHDR") return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

/** SVG perigoso? (script, eventos, javascript:, foreignObject, referências para fora do arquivo) */
export function svgPerigoso(texto: string): string | null {
  const t = texto.toLowerCase()
  if (/<script[\s/>]/.test(t)) return "script"
  if (/<foreignobject[\s/>]/.test(t)) return "foreignObject"
  if (/\son[a-z]+\s*=/.test(t)) return "evento"
  if (/javascript\s*:/.test(t) || /data\s*:\s*text\/html/.test(t)) return "javascript"
  if (/<!entity/.test(t)) return "entidade XML"
  // href/xlink:href só para dentro do arquivo (#id) ou imagem embutida (data:image).
  for (const m of t.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/g)) {
    const v = (m[1] ?? "").trim()
    if (v !== "" && !v.startsWith("#") && !v.startsWith("data:image/")) return "referência externa"
  }
  if (/url\(\s*["']?\s*(?!#|data:image\/)[^)\s]/.test(t)) return "referência externa"
  return null
}

export interface LogoRow {
  readonly kind: LogoKind
  readonly pathname: string
  readonly contentType: string
  readonly sha256: string
  readonly sizeBytes: number
}

/** Logotipos do cliente (para mostrar). */
export async function lerLogos(db: GatewayDb, ctx: TenantContext): Promise<LogoRow[]> {
  assertPermission(ctx, "data.read")
  return withTenant(db, ctx.organizationId, (tx) =>
    tx
      .select({ kind: clientLogo.kind, pathname: clientLogo.pathname, contentType: clientLogo.contentType, sha256: clientLogo.sha256, sizeBytes: clientLogo.sizeBytes })
      .from(clientLogo),
  )
}

async function auditar(db: GatewayDb, ctx: TenantContext, action: string, after: unknown): Promise<void> {
  await withTenant(db, ctx.organizationId, (tx) =>
    tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "client_logo", after }),
  )
}

async function apagarSemFalhar(store: LogoStore, pathname: string): Promise<void> {
  try {
    await store.del(pathname)
  } catch (error) {
    console.error("[logos] não foi possível apagar o arquivo antigo", pathname, error)
  }
}

/** Envia (ou troca) um logotipo. `arquivo` vem do formulário (File). */
export async function enviarLogo(
  db: GatewayDb,
  ctx: TenantContext,
  kind: unknown,
  arquivo: unknown,
  store: LogoStore | null,
): Promise<ConfigResult<{ kind: LogoKind; sha256: string }>> {
  assertPermission(ctx, "config.write")
  if (!isLogoKind(kind)) return { ok: false, mensagem: "Tipo de logotipo inválido." }
  if (store === null) return { ok: false, mensagem: "O armazenamento de arquivos ainda não foi ligado. Avise a equipe Engemase." }
  if (!(arquivo instanceof Blob) || arquivo.size === 0) return { ok: false, mensagem: "Escolha um arquivo." }
  if (arquivo.size > MAX_LOGO_BYTES) return { ok: false, mensagem: "Arquivo maior que 1 MB. Exporte em SVG ou reduza o PNG." }
  const buf = Buffer.from(await arquivo.arrayBuffer())
  const formato = detectarFormato(buf)
  if (formato === null) return { ok: false, mensagem: "Formato não aceito. Use SVG, PNG ou WebP." }
  if (formato === "svg") {
    const motivo = svgPerigoso(buf.toString("utf8"))
    if (motivo !== null) return { ok: false, mensagem: `Este SVG tem conteúdo não permitido (${motivo}). Exporte de novo como imagem simples, ou use PNG.` }
  }
  if (kind === "symbol" && formato === "png") {
    const d = tamanhoPng(buf)
    if (d === null || d.w < MIN_SYMBOL_PX || d.h < MIN_SYMBOL_PX) return { ok: false, mensagem: `O símbolo precisa ter pelo menos ${MIN_SYMBOL_PX} × ${MIN_SYMBOL_PX} px.` }
  }
  const sha256 = createHash("sha256").update(buf).digest("hex")
  const pathname = `logos/${ctx.organizationId}/${kind}-${sha256.slice(0, 24)}.${formato}`
  const contentType = TIPOS[formato]

  await store.put(pathname, buf, contentType)
  const anterior = await withTenant(db, ctx.organizationId, async (tx) => {
    const [old] = await tx.select({ pathname: clientLogo.pathname }).from(clientLogo).where(eq(clientLogo.kind, kind)).for("update").limit(1)
    const values = { contentType, sizeBytes: buf.length, sha256, pathname, uploadedBy: ctx.access.kind === "terminal" ? null : ctx.user.id, updatedAt: new Date() }
    await tx
      .insert(clientLogo)
      .values({ organizationId: ctx.organizationId, kind, ...values })
      .onConflictDoUpdate({ target: [clientLogo.organizationId, clientLogo.kind], set: values })
    return old?.pathname ?? null
  })
  if (anterior !== null && anterior !== pathname) await apagarSemFalhar(store, anterior)
  await auditar(db, ctx, "branding.logo_updated", { kind, content_type: contentType, size_bytes: buf.length, sha256 })
  return { ok: true, dados: { kind, sha256 } }
}

/** Remove um logotipo (volta a aparecer o da Engemase). */
export async function removerLogo(db: GatewayDb, ctx: TenantContext, kind: unknown, store: LogoStore | null): Promise<ConfigResult<{ kind: LogoKind }>> {
  assertPermission(ctx, "config.write")
  if (!isLogoKind(kind)) return { ok: false, mensagem: "Tipo de logotipo inválido." }
  const removido = await withTenant(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .delete(clientLogo)
      .where(and(eq(clientLogo.organizationId, ctx.organizationId), eq(clientLogo.kind, kind)))
      .returning({ pathname: clientLogo.pathname })
    return row?.pathname ?? null
  })
  if (removido !== null) {
    if (store !== null) await apagarSemFalhar(store, removido)
    await auditar(db, ctx, "branding.logo_removed", { kind })
  }
  return { ok: true, dados: { kind } }
}

/** Remove todos (usado por "Restaurar padrão Engemase"). */
export async function removerTodosLogos(db: GatewayDb, ctx: TenantContext, store: LogoStore | null): Promise<number> {
  let n = 0
  for (const kind of CLIENT_LOGO_KINDS) {
    const before = (await lerLogos(db, ctx)).some((l) => l.kind === kind)
    if (before) {
      await removerLogo(db, ctx, kind, store)
      n++
    }
  }
  return n
}

/** Abre o arquivo de um logotipo para a rota de entrega (o acesso ao cliente já foi conferido). */
export async function abrirLogo(
  db: GatewayDb,
  ctx: TenantContext,
  kind: unknown,
  store: LogoStore | null,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; sha256: string } | null> {
  if (!isLogoKind(kind) || store === null) return null
  const row = (await lerLogos(db, ctx)).find((l) => l.kind === kind)
  if (row === undefined) return null
  const file = await store.get(row.pathname)
  return file ? { stream: file.stream, contentType: row.contentType, sha256: row.sha256 } : null
}
