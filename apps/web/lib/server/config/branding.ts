/**
 * Identidade visual do cliente (docs/14, F2): cor da marca, modo do menu, nome exibido e nome curto.
 * Os tokens de claro e escuro são calculados AQUI no servidor (o mesmo algoritmo da prévia,
 * `components/settings/brand-color.ts`): a cor enviada pelo navegador nunca vira token sem conferência.
 * Cor colada numa cor de estado (produzindo, parada, falha, setup) é recusada.
 *
 * Só a equipe Engemase altera (`config.write`, D12); leitura por quem vê a configuração. Sob a RLS do
 * cliente e auditado. "Restaurar padrão" apaga a linha (sem linha = padrão Engemase).
 */
import { auditLog, clientBranding, withTenant } from "@engemase/db"
import { z } from "zod"
import { ENGEMASE_BRAND, analyzeBrand, normalizeHex } from "@/components/settings/brand-color"
import type { BrandTokens, SidebarMode } from "@/components/settings/types"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "./products"

export const BRAND_ALGORITHM_VERSION = 1

export interface ClientBrandingRow {
  readonly displayName: string
  readonly shortName: string
  readonly preset: string | null
  readonly brandColor: string
  readonly sidebarMode: SidebarMode
  readonly tokens: BrandTokens
  readonly adjusted: boolean
}

const Input = z.object({
  displayName: z.string().trim().min(1, "Informe o nome exibido.").max(40, "Nome exibido com até 40 caracteres."),
  shortName: z.string().trim().min(1, "Informe o nome curto.").max(12, "Nome curto com até 12 caracteres."),
  preset: z.string().trim().max(40).nullable().optional(),
  brandColor: z.string().max(10),
  sidebarMode: z.enum(["neutral", "brand-dark", "light"], { error: "Modo do menu inválido." }),
})

export function brandingTokens(v: unknown): v is BrandTokens {
  const ok = (m: unknown) =>
    typeof m === "object" && m !== null && ["primary", "ring", "sidebar"].every((k) => typeof (m as Record<string, unknown>)[k] === "string" && /^#[0-9a-f]{6}$/i.test((m as Record<string, string>)[k]!))
  return typeof v === "object" && v !== null && ok((v as Record<string, unknown>).light) && ok((v as Record<string, unknown>).dark)
}

/** Identidade do cliente, ou `null` (padrão Engemase). Linha com tokens estragados também vale como padrão. */
export async function lerAparencia(db: GatewayDb, ctx: TenantContext): Promise<ClientBrandingRow | null> {
  assertPermission(ctx, "data.read")
  const [row] = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(clientBranding).limit(1))
  if (row === undefined || !brandingTokens(row.tokens)) return null
  return {
    displayName: row.displayName,
    shortName: row.shortName,
    preset: row.preset,
    brandColor: row.brandColor,
    sidebarMode: row.sidebarMode,
    tokens: row.tokens,
    adjusted: row.adjusted,
  }
}

/** Calcula e grava a identidade (cria ou substitui). */
export async function salvarAparencia(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ tokens: BrandTokens; adjusted: boolean }>> {
  assertPermission(ctx, "config.write")
  const parsed = Input.safeParse(input)
  if (!parsed.success) return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
  const v = parsed.data
  const brand = normalizeHex(v.brandColor)
  if (brand === null) return { ok: false, mensagem: "Cor inválida. Use o formato #RRGGBB." }
  const a = analyzeBrand(brand, v.sidebarMode)
  if (a.proximity.level === "block") {
    return { ok: false, mensagem: `Cor muito parecida com o ${a.proximity.stateLabel ?? "uma cor de estado"}: escolha outra para não confundir os estados das máquinas.` }
  }
  const tokens: BrandTokens = {
    light: { primary: a.light.primary, ring: a.light.ring, sidebar: a.light.sidebar },
    dark: { primary: a.dark.primary, ring: a.dark.ring, sidebar: a.dark.sidebar },
  }
  const values = {
    displayName: v.displayName,
    shortName: v.shortName,
    preset: v.preset ?? null,
    brandColor: brand,
    sidebarMode: v.sidebarMode,
    tokens,
    adjusted: a.light.adjusted,
    algorithmVersion: BRAND_ALGORITHM_VERSION,
    updatedBy: ctx.access.kind === "terminal" ? null : ctx.user.id,
    updatedAt: new Date(),
  }
  return withTenant(db, ctx.organizationId, async (tx) => {
    const [before] = await tx.select({ brandColor: clientBranding.brandColor, sidebarMode: clientBranding.sidebarMode, displayName: clientBranding.displayName }).from(clientBranding).limit(1)
    await tx
      .insert(clientBranding)
      .values({ organizationId: ctx.organizationId, ...values })
      .onConflictDoUpdate({ target: clientBranding.organizationId, set: values })
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "branding.updated",
      entityType: "client_branding",
      before: before ?? null,
      after: { brand_color: brand, sidebar_mode: v.sidebarMode, display_name: v.displayName, short_name: v.shortName, tokens },
    })
    return { ok: true as const, dados: { tokens, adjusted: a.light.adjusted } }
  })
}

/** Volta ao padrão Engemase (apaga a identidade própria). */
export async function restaurarAparencia(db: GatewayDb, ctx: TenantContext): Promise<ConfigResult<{ brandColor: string }>> {
  assertPermission(ctx, "config.write")
  return withTenant(db, ctx.organizationId, async (tx) => {
    const removed = await tx.delete(clientBranding).returning({ brandColor: clientBranding.brandColor })
    if (removed.length > 0) {
      await tx.insert(auditLog).values({
        organizationId: ctx.organizationId,
        ...auditActor(ctx),
        action: "branding.reset",
        entityType: "client_branding",
        before: { brand_color: removed[0]?.brandColor ?? null },
        after: { brand_color: ENGEMASE_BRAND },
      })
    }
    return { ok: true as const, dados: { brandColor: ENGEMASE_BRAND } }
  })
}
