/**
 * Porta de entrada dos dados das telas de acompanhamento do cliente (visão geral, máquinas, linhas,
 * relatórios, notificações, ajuda, Andon e tela do operador).
 *
 * - Com `DATABASE_URL`: `requireTenant(slug)` (sessão → cliente → papel/escopo; sem acesso, 404 ou login)
 *   e leitura no banco sob RLS, com o cálculo do `@engemase/oee-core`. Lê o pedido: chame dentro de
 *   `<Suspense>` (Cache Components).
 * - Sem `DATABASE_URL` (demonstração na Vercel): dados simulados de `@/lib/mock`.
 *
 * Cliente inexistente → `notFound()`. Memorizado por pedido: layout e página que pedem o mesmo cliente
 * leem o banco uma vez por combinação de necessidades.
 */
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { cache } from "react"
import type { TenantContext } from "@/lib/server/access/context"
import { requireTenant } from "@/lib/server/access/require-tenant"
import { getDb } from "@/lib/server/db"
import { usarBanco } from "../fonte"
import { lerClienteDoBanco } from "./banco"
import { clienteSimulado } from "./simulado"
import type { ClienteDados, NecessidadesCliente } from "./tipos"

export type { ClienteDados, JanelaTurno, NecessidadesCliente, OeeAgregado } from "./tipos"

const carregar = cache(async (slug: string, chave: string): Promise<ClienteDados> => {
  const needs = JSON.parse(chave) as NecessidadesCliente
  if (!usarBanco()) {
    const dados = clienteSimulado(slug)
    if (!dados) notFound()
    return dados
  }
  const ctx = await requireTenant(slug)
  const db = getDb()
  if (db === null) throw new Error("DATABASE_URL não configurado")
  // Marca o render como dinâmico antes de ler o relógio (Cache Components).
  await connection()
  return lerClienteDoBanco(db, ctx, needs, Date.now())
})

/** Dados do cliente da URL para a tela (ver as necessidades em `NecessidadesCliente`). */
export function getClientData(slug: string, needs: NecessidadesCliente = {}): Promise<ClienteDados> {
  const chave = JSON.stringify({
    diasOee: needs.diasOee ?? 0,
    diasTurnos: needs.diasTurnos ?? 0,
    paradas: needs.paradas ?? false,
    notificacoes: needs.notificacoes ?? false,
    somenteCadastro: needs.somenteCadastro ?? false,
  })
  return carregar(slug, chave)
}

const carregarComContexto = cache(async (ctx: TenantContext, chave: string): Promise<ClienteDados> => {
  const needs = JSON.parse(chave) as NecessidadesCliente
  const db = getDb()
  if (db === null) throw new Error("DATABASE_URL não configurado")
  await connection()
  return lerClienteDoBanco(db, ctx, needs, Date.now())
})

/**
 * Dados do cliente para um contexto JÁ conferido que não vem de sessão de pessoa: o terminal pareado
 * (`lib/server/terminal`, escopo = as máquinas do terminal). Só com banco.
 */
export function getClientDataForContext(ctx: TenantContext, needs: NecessidadesCliente = {}): Promise<ClienteDados> {
  const chave = JSON.stringify({
    diasOee: needs.diasOee ?? 0,
    diasTurnos: needs.diasTurnos ?? 0,
    paradas: needs.paradas ?? false,
    notificacoes: needs.notificacoes ?? false,
    somenteCadastro: needs.somenteCadastro ?? false,
  })
  return carregarComContexto(ctx, chave)
}
