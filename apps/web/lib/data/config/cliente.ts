/**
 * Repositório de UM cliente para a casca (menu, cabeçalho) e as telas de cadastro (W8).
 *
 * Com banco: `requireTenant(slug)` (sessão → cliente → vínculo/escopo/concessão sob RLS; sem acesso,
 * 404) e uma foto do cadastro do cliente. Sem banco: os dados simulados. Memorizado por pedido: a
 * casca e a página leem o banco uma vez.
 */
import { notFound } from "next/navigation"
import { cache } from "react"
import { getClientBySlug as clienteSimulado } from "@/lib/mock"
import type { Client } from "@/lib/mock"
import { usarRelogioReal } from "@/lib/mock/clock"
import { hasPermission, type TenantContext } from "@/lib/server/access/context"
import type { Permission } from "@/lib/server/access/permissions"
import { requireTenant } from "@/lib/server/access/require-tenant"
import { getCurrentSession } from "@/lib/server/auth/current"
import { usarBanco } from "../fonte"
import { bancoObrigatorio } from "../admin/acesso"
import { type Repositorio, repositorioEmMemoria, repositorioMock } from "../admin/repositorio"
import { fotoDoCliente } from "../admin/snapshot"

export interface ClienteCarregado {
  readonly r: Repositorio
  readonly client: Client
  /** Contexto de acesso (só com banco). */
  readonly ctx: TenantContext | null
}

/** Cliente da URL e o repositório dele; `null` = não existe (ou sem acesso: a página responde 404). */
export const carregarCliente = cache(async (slug: string): Promise<ClienteCarregado | null> => {
  if (!usarBanco()) {
    const client = clienteSimulado(slug)
    return client ? { r: repositorioMock, client, ctx: null } : null
  }
  const ctx = await requireTenant(slug)
  const session = await getCurrentSession()
  if (session === null) return null
  const agora = new Date()
  usarRelogioReal(agora.toISOString())
  const r = repositorioEmMemoria(await fotoDoCliente(bancoObrigatorio(), ctx, session, agora))
  const client = r.getClientById(ctx.organizationId)
  return client ? { r, client, ctx } : null
})

/** Para as telas de cadastro: cliente + permissão do papel (sem a permissão, 404 como no requireTenant). */
export async function exigirCliente(slug: string, permissao: Permission = "config.read"): Promise<ClienteCarregado> {
  const c = await carregarCliente(slug)
  if (c === null) notFound()
  if (c.ctx !== null && !hasPermission(c.ctx, permissao)) notFound()
  return c
}
