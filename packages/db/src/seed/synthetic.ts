/**
 * Seed sintético: dados de DEMONSTRAÇÃO para desenvolvimento local e para o branch-semente da Neon (de onde
 * saem os branches de preview; docs/06, "Ambientes e migrações"). Nunca é cópia de produção e nunca roda em
 * produção: ver `assertSeedAllowed()` (variável de ambiente) e `assertSyntheticDatabase()` (o banco só pode
 * ter clientes de demonstração, com slug `demo-...`).
 *
 * Determinístico e idempotente: os ids saem de um hash do nome lógico (`seedId()`), as séries temporais de um
 * gerador pseudoaleatório com semente fixa por máquina e dia, e tudo é gravado com `ON CONFLICT DO NOTHING`.
 * Rodar de novo não duplica nada (só acrescenta os minutos que passaram desde a última vez).
 *
 * Grava como dono do banco: a conexão precisa ser superusuário ou ter BYPASSRLS (com a RLS forçada, o dono
 * sem BYPASSRLS não enxerga nem grava dados de cliente). Postgres local em Docker já conecta assim.
 */
import { createHash, randomBytes } from "node:crypto"
import { sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { sha256Hex } from "../lookups"
import * as s from "../schema/index"
import type { MachineState } from "../schema/enums"

/** Qualquer banco do Drizzle para Postgres (pg, PGlite, Neon via WebSocket), com ou sem schema. */
// biome-ignore lint/suspicious/noExplicitAny: o schema do banco não importa aqui.
export type SeedDatabase = PgDatabase<PgQueryResultHKT, any>

/** Prefixo obrigatório do slug dos clientes de demonstração. */
export const SEED_SLUG_PREFIX = "demo-"

/** Variável de ambiente que libera o seed (precisa valer exatamente "sintetico"). */
export const SEED_ENV_FLAG = "ENGEMASE_SEED"
export const SEED_ENV_VALUE = "sintetico"

export class SeedRefusedError extends Error {
  override readonly name = "SeedRefusedError"
}

/**
 * Recusa o seed fora de desenvolvimento/branch-semente: exige `ENGEMASE_SEED=sintetico` e recusa quando
 * `VERCEL_ENV=production` ou `NODE_ENV=production`.
 */
export function assertSeedAllowed(env: Readonly<Record<string, string | undefined>>): void {
  if (env[SEED_ENV_FLAG] !== SEED_ENV_VALUE) {
    throw new SeedRefusedError(
      `Seed sintético bloqueado: defina ${SEED_ENV_FLAG}=${SEED_ENV_VALUE} (só em banco local ou no branch-semente).`,
    )
  }
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") {
    throw new SeedRefusedError("Seed sintético bloqueado: ambiente de produção (VERCEL_ENV/NODE_ENV = production).")
  }
}

export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows
    if (Array.isArray(rows)) return rows as T[]
  }
  return []
}

/** Slug da organização interna da Engemase (bancada, testes; docs/15 seção 3), gravada pelo seed de plataforma. */
export const ENGEMASE_LAB_SLUG = "engemase-lab"

/** Recusa conexão que não enxerga todas as linhas (sem SUPERUSER nem BYPASSRLS, com a RLS forçada). */
export async function assertOwnerConnection(db: SeedDatabase, label: string): Promise<void> {
  const role = rowsOf<{ ok: boolean }>(
    await db.execute(sql`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_catalog.pg_roles WHERE rolname = current_user`),
  )
  if (role[0]?.ok !== true) {
    throw new SeedRefusedError(
      `${label} bloqueado: a conexão precisa ser superusuário ou ter BYPASSRLS (as tabelas de cliente têm RLS forçada).`,
    )
  }
}

/**
 * Recusa o seed num banco que já tem cliente de verdade (slug sem o prefixo `demo-`; a organização interna
 * "Engemase Lab" não conta) ou numa conexão que não enxerga todas as linhas (sem SUPERUSER nem BYPASSRLS: a
 * checagem de clientes daria "vazio" sem ser).
 */
export async function assertSyntheticDatabase(db: SeedDatabase): Promise<void> {
  await assertOwnerConnection(db, "Seed sintético")
  const real = rowsOf<{ slug: string }>(
    await db.execute(
      sql`SELECT slug FROM public.organization
          WHERE left(slug, ${SEED_SLUG_PREFIX.length}) <> ${SEED_SLUG_PREFIX} AND slug <> ${ENGEMASE_LAB_SLUG} LIMIT 5`,
    ),
  )
  if (real.length > 0) {
    throw new SeedRefusedError(
      `Seed sintético bloqueado: o banco tem clientes que não são de demonstração (${real.map((r) => r.slug).join(", ")}).`,
    )
  }
}

/** UUID determinístico (formato RFC 9562, versão 8) a partir de um nome lógico. */
export function seedId(name: string): string {
  const h = createHash("sha256").update(`engemase-seed:${name}`).digest("hex")
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

/** Gerador pseudoaleatório pequeno (mulberry32) com semente a partir de um texto. */
function prng(seedText: string): () => number {
  let a = createHash("sha256").update(seedText).digest().readUInt32LE(0)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

interface DemoMachine {
  readonly key: string
  readonly name: string
  readonly code: string
  readonly idealCycleS: number
}

interface DemoClient {
  readonly slug: string
  readonly name: string
  readonly plan: string
  readonly machinesContracted: number
  readonly unitName: string
  readonly lines: readonly { readonly key: string; readonly name: string; readonly machines: readonly DemoMachine[] }[]
  readonly products: readonly { readonly code: string; readonly name: string }[]
  readonly operators: readonly { readonly name: string; readonly employeeCode: string | null }[]
}

/** Clientes de demonstração (nomes fictícios; e-mails no domínio reservado `.example`). */
export const DEMO_CLIENTS: readonly DemoClient[] = [
  {
    slug: "demo-metalurgica",
    name: "Metalúrgica Demonstração",
    plan: "pro",
    machinesContracted: 20,
    unitName: "Planta Joinville",
    lines: [
      {
        key: "estampagem",
        name: "Estampagem",
        machines: [
          { key: "prensa-01", name: "Prensa 01", code: "PR-01", idealCycleS: 4 },
          { key: "prensa-02", name: "Prensa 02", code: "PR-02", idealCycleS: 4.5 },
        ],
      },
      {
        key: "usinagem",
        name: "Usinagem",
        machines: [
          { key: "torno-01", name: "Torno CNC 01", code: "TN-01", idealCycleS: 45 },
          { key: "centro-01", name: "Centro de usinagem 01", code: "CU-01", idealCycleS: 90 },
        ],
      },
    ],
    products: [
      { code: "1001", name: "Suporte 40 mm" },
      { code: "1002", name: "Flange 3 pol." },
    ],
    operators: [
      { name: "Ana Souza", employeeCode: "1042" },
      { name: "Bruno Lima", employeeCode: "1057" },
      { name: "Carla Dias", employeeCode: null },
    ],
  },
  {
    slug: "demo-plasticos",
    name: "Plásticos Demonstração",
    plan: "starter",
    machinesContracted: 10,
    unitName: "Fábrica Caxias",
    lines: [
      {
        key: "injecao",
        name: "Injeção",
        machines: [
          { key: "injetora-01", name: "Injetora 01", code: "INJ-01", idealCycleS: 6 },
          { key: "injetora-02", name: "Injetora 02", code: "INJ-02", idealCycleS: 8 },
        ],
      },
      {
        key: "sopro",
        name: "Sopro",
        machines: [{ key: "sopradora-01", name: "Sopradora 01", code: "SP-01", idealCycleS: 12 }],
      },
    ],
    products: [
      { code: "7", name: "Tampa 28 mm" },
      { code: "8", name: "Frasco 500 ml" },
    ],
    operators: [
      { name: "Diego Alves", employeeCode: "2001" },
      { name: "Elisa Rocha", employeeCode: "2002" },
    ],
  },
]

/** Feriados nacionais de data fixa (L2: cadastrados por unidade). */
const FIXED_HOLIDAYS: readonly [string, string][] = [
  ["01-01", "Confraternização Universal"],
  ["04-21", "Tiradentes"],
  ["05-01", "Dia do Trabalho"],
  ["09-07", "Independência do Brasil"],
  ["10-12", "Nossa Senhora Aparecida"],
  ["11-02", "Finados"],
  ["11-15", "Proclamação da República"],
  ["11-20", "Dia da Consciência Negra"],
  ["12-25", "Natal"],
]

export interface SeedSyntheticOptions {
  /** Instante "agora" da geração (padrão: o relógio). As séries cobrem `days` dias inteiros antes dele. */
  readonly now?: Date
  /** Dias de séries temporais (minuto, eventos, refugo). Padrão: 7. */
  readonly days?: number
}

export interface SeedSyntheticResult {
  readonly organizations: readonly { readonly slug: string; readonly id: string }[]
  readonly productionMinutes: number
  readonly stateEvents: number
  /**
   * Tokens de gateway em claro, só dos gateways criados AGORA (o banco guarda só o hash). Servem para apontar
   * o simulador para o banco local. Numa segunda execução, a lista vem vazia.
   */
  readonly gatewayTokens: readonly { readonly slug: string; readonly gatewayId: string; readonly token: string }[]
}

interface Segment {
  readonly state: MachineState
  readonly start: number
  readonly end: number
}

/** Estados de um dia de uma máquina, em blocos de minutos inteiros (mesmo resultado para o mesmo dia). */
function daySegments(machineKey: string, dayStart: number): Segment[] {
  const rnd = prng(`${machineKey}:${new Date(dayStart).toISOString().slice(0, 10)}`)
  const segments: Segment[] = []
  let t = dayStart
  const end = dayStart + DAY
  while (t < end) {
    const r = rnd()
    let state: MachineState
    let minutes: number
    if (r < 0.7) {
      state = "RUNNING"
      minutes = 20 + Math.floor(rnd() * 160)
    } else if (r < 0.85) {
      state = "STOPPED"
      minutes = 3 + Math.floor(rnd() * 25)
    } else if (r < 0.94) {
      state = "FAULT"
      minutes = 2 + Math.floor(rnd() * 40)
    } else if (r < 0.98) {
      state = "SETUP"
      minutes = 15 + Math.floor(rnd() * 30)
    } else {
      state = "NO_COMM"
      minutes = 1 + Math.floor(rnd() * 10)
    }
    const segEnd = Math.min(end, t + minutes * MINUTE)
    segments.push({ state, start: t, end: segEnd })
    t = segEnd
  }
  return segments
}

async function insertInBatches<T extends Record<string, unknown>>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>,
  size = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size))
}

/**
 * Grava os clientes de demonstração completos (cadastros, gateways, turnos, feriados, motivos, operadores e
 * séries temporais). Chama `assertSyntheticDatabase()` antes; a liberação por ambiente
 * (`assertSeedAllowed`) fica com quem chama (o script `db:seed`).
 */
export async function seedSynthetic(db: SeedDatabase, options: SeedSyntheticOptions = {}): Promise<SeedSyntheticResult> {
  const nowMs = Math.floor((options.now ?? new Date()).getTime() / MINUTE) * MINUTE
  const days = options.days ?? 7
  if (!Number.isInteger(days) || days < 0 || days > 120) throw new RangeError("days: inteiro de 0 a 120")
  const firstDay = Math.floor(nowMs / DAY) * DAY - days * DAY

  await assertSyntheticDatabase(db)

  return db.transaction(async (tx) => {
    const organizations: { slug: string; id: string }[] = []
    const gatewayTokens: { slug: string; gatewayId: string; token: string }[] = []
    let productionMinutes = 0
    let stateEvents = 0

    const engemaseUser = seedId("user:engemase-suporte")
    await tx
      .insert(s.user)
      .values({ id: engemaseUser, name: "Suporte Engemase (demo)", email: "suporte@engemase-demo.example", role: "support" })
      .onConflictDoNothing()

    for (const client of DEMO_CLIENTS) {
      const k = (name: string) => seedId(`${client.slug}:${name}`)
      const organizationId = k("organization")
      organizations.push({ slug: client.slug, id: organizationId })

      await tx.insert(s.organization).values({ id: organizationId, name: client.name, slug: client.slug }).onConflictDoNothing()
      await tx
        .insert(s.clientAccount)
        .values({ organizationId, status: "active", plan: client.plan, limits: { machines: client.machinesContracted } })
        .onConflictDoNothing()

      // Pessoas: admin (escopo todo o cliente), supervisor e operador.
      const people = [
        { key: "admin", name: `Admin ${client.name}`, role: "client_admin" as const },
        { key: "supervisor", name: `Supervisor ${client.name}`, role: "supervisor" as const },
        { key: "operador", name: `Operador ${client.name}`, role: "operator" as const },
      ]
      for (const p of people) {
        const userId = k(`user:${p.key}`)
        await tx
          .insert(s.user)
          .values({ id: userId, name: p.name, email: `${p.key}@${client.slug}.example`, emailVerified: true })
          .onConflictDoNothing()
        await tx.insert(s.member).values({ id: k(`member:${p.key}`), organizationId, userId }).onConflictDoNothing()
        await tx
          .insert(s.memberAccess)
          .values({ id: k(`access:${p.key}`), organizationId, memberId: k(`member:${p.key}`), role: p.role, scope: "all" })
          .onConflictDoNothing()
      }

      const unitId = k("unit")
      await tx.insert(s.unit).values({ id: unitId, organizationId, name: client.unitName }).onConflictDoNothing()
      const areaId = k("area:geral")
      await tx.insert(s.area).values({ id: areaId, organizationId, unitId, name: "Geral" }).onConflictDoNothing()

      // Gateway ativo (alimenta as máquinas) e um segundo "Em trânsito" (L23), ativado na bancada.
      const gatewayId = k("gateway:1")
      const token = `gw_live_${randomBytes(24).toString("base64url")}`
      const insertedGateway = await tx
        .insert(s.gateway)
        .values({
          id: gatewayId,
          organizationId,
          unitId,
          name: `Gateway ${client.unitName}`,
          status: "active",
          tokenHash: sha256Hex(token),
          configVersionLatest: 1,
          configVersionApplied: 1,
          agentVersion: "0.1.0",
          lastSeenAt: new Date(nowMs),
          installedAt: new Date(firstDay),
        })
        .onConflictDoNothing()
        .returning({ id: s.gateway.id })
      if (insertedGateway.length > 0) gatewayTokens.push({ slug: client.slug, gatewayId, token })
      await tx
        .insert(s.gateway)
        .values({
          id: k("gateway:transito"),
          organizationId,
          unitId,
          name: "Gateway reserva (em trânsito)",
          status: "active",
          tokenHash: sha256Hex(`gw_live_${randomBytes(24).toString("base64url")}`),
          inTransitSince: new Date(nowMs - 2 * DAY),
          inTransitUntil: new Date(nowMs + 28 * DAY),
        })
        .onConflictDoNothing()

      // Cadastros de produção.
      const productIds = client.products.map((p) => k(`product:${p.code}`))
      for (const [i, p] of client.products.entries()) {
        await tx
          .insert(s.product)
          .values({ id: productIds[i], organizationId, code: p.code, name: p.name })
          .onConflictDoNothing()
      }
      const shifts = [
        { key: "t1", name: "Turno 1", startTime: "06:00", endTime: "14:00", days: [1, 2, 3, 4, 5, 6] },
        { key: "t2", name: "Turno 2", startTime: "14:00", endTime: "22:00", days: [1, 2, 3, 4, 5] },
        { key: "t3", name: "Turno 3", startTime: "22:00", endTime: "06:00", days: [1, 2, 3, 4, 5] },
      ]
      for (const sh of shifts) {
        await tx
          .insert(s.shift)
          .values({
            id: k(`shift:${sh.key}`),
            organizationId,
            unitId,
            name: sh.name,
            startTime: sh.startTime,
            endTime: sh.endTime,
            daysOfWeek: sh.days,
            breaks: sh.key === "t3" ? [] : [{ start: sh.key === "t1" ? "10:00" : "18:00", end: sh.key === "t1" ? "10:30" : "18:30", name: "Refeição" }],
          })
          .onConflictDoNothing()
      }
      const year = new Date(nowMs).getUTCFullYear()
      for (const y of [year, year + 1]) {
        for (const [md, name] of FIXED_HOLIDAYS) {
          await tx
            .insert(s.unitHoliday)
            .values({ id: k(`holiday:${y}-${md}`), organizationId, unitId, holidayDate: `${y}-${md}`, name })
            .onConflictDoNothing()
        }
      }
      const reasons = [
        { key: "no_comm", name: "Sem comunicação", category: "unplanned" as const, systemKey: "no_comm", color: "#6B7280" },
        { key: "material", name: "Falta de material", category: "unplanned" as const, systemKey: null, color: "#F59E0B" },
        { key: "corretiva", name: "Manutenção corretiva", category: "unplanned" as const, systemKey: null, color: "#EF4444" },
        { key: "setup", name: "Troca de ferramenta", category: "setup" as const, systemKey: null, color: "#3B82F6" },
        { key: "refeicao", name: "Refeição", category: "planned" as const, systemKey: null, color: "#10B981" },
      ]
      for (const [i, r] of reasons.entries()) {
        await tx
          .insert(s.downtimeReason)
          .values({
            id: k(`reason:${r.key}`),
            organizationId,
            name: r.name,
            category: r.category,
            systemKey: r.systemKey,
            color: r.color,
            sortOrder: i,
          })
          .onConflictDoNothing()
      }
      const rejectReasons = ["Rebarba", "Bolha", "Dimensional fora", "Contaminação"]
      for (const [i, name] of rejectReasons.entries()) {
        await tx
          .insert(s.rejectReason)
          .values({ id: k(`reject:${i}`), organizationId, name, code: `R${i + 1}`, sortOrder: i })
          .onConflictDoNothing()
      }
      const operatorIds = client.operators.map((o) => k(`operator:${o.name}`))
      for (const [i, o] of client.operators.entries()) {
        await tx
          .insert(s.unitOperator)
          .values({ id: operatorIds[i], organizationId, unitId, name: o.name, employeeCode: o.employeeCode })
          .onConflictDoNothing()
      }
      await tx
        .insert(s.alertRule)
        .values({
          id: k("alert:parada"),
          organizationId,
          name: "Máquina parada há mais de 10 min",
          type: "machine_stopped",
          severity: "warning",
          params: { minDurationMin: 10 },
        })
        .onConflictDoNothing()

      // Linhas, máquinas, dispositivos e tags; depois as séries de cada máquina.
      for (const [li, ln] of client.lines.entries()) {
        const lineId = k(`line:${ln.key}`)
        await tx
          .insert(s.line)
          .values({ id: lineId, organizationId, unitId, areaId, name: ln.name, oeeTarget: 0.85, sortOrder: li })
          .onConflictDoNothing()
        for (const m of ln.machines) {
          const machineId = k(`machine:${m.key}`)
          await tx
            .insert(s.machine)
            .values({
              id: machineId,
              organizationId,
              unitId,
              lineId,
              name: m.name,
              code: m.code,
              idealCycleS: m.idealCycleS,
              stateRules: { mode: "state_code", map: { "0": "STOPPED", "1": "RUNNING", "2": "FAULT", "3": "SETUP" } },
            })
            .onConflictDoNothing()
          await tx.insert(s.gatewayMachine).values({ organizationId, gatewayId, machineId, unitId }).onConflictDoNothing()
          const deviceId = k(`device:${m.key}`)
          await tx
            .insert(s.device)
            .values({
              id: deviceId,
              organizationId,
              gatewayId,
              name: `CLP ${m.name}`,
              protocol: "modbus-tcp",
              params: { host: `192.168.10.${20 + li * 10 + ln.machines.indexOf(m)}`, port: 502, unit_id: 1 },
            })
            .onConflictDoNothing()
          for (const tag of [
            { key: "estado", name: "Estado", role: "state.code" as const, offset: 1000, dataType: "uint16" as const },
            { key: "contador", name: "Contador total", role: "count.total" as const, offset: 1002, dataType: "uint32" as const },
          ]) {
            await tx
              .insert(s.tag)
              .values({
                id: k(`tag:${m.key}:${tag.key}`),
                organizationId,
                gatewayId,
                deviceId,
                machineId,
                name: tag.name,
                address: { area: "holding_register", offset: tag.offset },
                dataType: tag.dataType,
                pollMs: 1000,
                role: tag.role,
              })
              .onConflictDoNothing()
          }
          for (const [pi, productId] of productIds.entries()) {
            await tx
              .insert(s.productMachine)
              .values({ organizationId, productId: productId as string, machineId, idealCycleS: m.idealCycleS * (1 + pi * 0.1) })
              .onConflictDoNothing()
          }

          // Séries: estados em blocos de minutos inteiros, minuto a minuto e trocas de produto por dia.
          const minutes: (typeof s.productionMinute.$inferInsert)[] = []
          const events: (typeof s.machineStateEvent.$inferInsert)[] = []
          const runs: (typeof s.productionRun.$inferInsert)[] = []
          let counter = 0
          let last: Segment | undefined
          for (let day = firstDay; day <= nowMs; day += DAY) {
            const product = client.products[Math.floor(day / DAY) % client.products.length]
            if (product === undefined) continue
            runs.push({
              id: k(`run:${m.key}:${day}`),
              organizationId,
              machineId,
              productId: k(`product:${product.code}`),
              productCode: product.code,
              startedAt: new Date(day),
              endedAt: day + DAY <= nowMs ? new Date(day + DAY) : null,
              source: "plc",
            })
            const rnd = prng(`${m.key}:${day}:pecas`)
            for (const seg of daySegments(m.key, day)) {
              if (seg.start >= nowMs) break
              const end = Math.min(seg.end, nowMs)
              last = { state: seg.state, start: seg.start, end }
              events.push({
                id: k(`event:${m.key}:${seg.start}`),
                organizationId,
                machineId,
                state: seg.state,
                startedAt: new Date(seg.start),
                endedAt: end < nowMs ? new Date(end) : null,
                reasonId:
                  seg.state === "NO_COMM"
                    ? k("reason:no_comm")
                    : seg.state === "SETUP"
                      ? k("reason:setup")
                      : seg.state === "STOPPED" && rnd() < 0.6
                        ? k("reason:material")
                        : null,
                classifiedOperatorId: seg.state === "STOPPED" ? (operatorIds[0] ?? null) : null,
                source: "edge",
              })
              for (let t = seg.start; t < end; t += MINUTE) {
                const running = seg.state === "RUNNING"
                const total = running ? Math.max(0, Math.round((60 / m.idealCycleS) * (0.85 + rnd() * 0.15))) : 0
                const reject = total > 0 && rnd() < 0.08 ? 1 : 0
                counter += total
                minutes.push({
                  organizationId,
                  machineId,
                  bucketStart: new Date(t),
                  runS: running ? 60 : 0,
                  stopS: seg.state === "STOPPED" ? 60 : 0,
                  faultS: seg.state === "FAULT" ? 60 : 0,
                  setupS: seg.state === "SETUP" ? 60 : 0,
                  noCommS: seg.state === "NO_COMM" ? 60 : 0,
                  total,
                  reject,
                  productCode: product.code,
                })
              }
            }
          }
          await insertInBatches(runs, (batch) => tx.insert(s.productionRun).values(batch).onConflictDoNothing())
          await insertInBatches(events, (batch) => tx.insert(s.machineStateEvent).values(batch).onConflictDoNothing())
          await insertInBatches(minutes, (batch) => tx.insert(s.productionMinute).values(batch).onConflictDoNothing())
          productionMinutes += minutes.length
          stateEvents += events.length
          if (last !== undefined) {
            await tx
              .insert(s.machineLive)
              .values({
                organizationId,
                machineId,
                state: last.state,
                stateSince: new Date(last.start),
                counterTotal: counter,
                productCode: client.products[Math.floor(nowMs / DAY) % client.products.length]?.code ?? null,
                at: new Date(nowMs),
              })
              .onConflictDoNothing()
          }

          // Refugo manual (L3): um lançamento por dia; o do primeiro dia é estornado (lançado em dobro).
          for (let day = firstDay; day + DAY <= nowMs; day += DAY) {
            const entryId = k(`quality:${m.key}:${day}`)
            await tx
              .insert(s.qualityEntry)
              .values({
                id: entryId,
                organizationId,
                machineId,
                at: new Date(day + 10 * 60 * MINUTE),
                quantity: 2 + (Math.floor(day / DAY) % 5),
                rejectReasonId: k(`reject:${Math.floor(day / DAY) % rejectReasons.length}`),
                operatorId: operatorIds[Math.floor(day / DAY) % operatorIds.length] ?? null,
                createdBy: k("user:supervisor"),
              })
              .onConflictDoNothing()
            if (day === firstDay) {
              await tx
                .insert(s.qualityEntry)
                .values({
                  id: k(`quality:${m.key}:${day}:estorno`),
                  organizationId,
                  machineId,
                  at: new Date(day + 11 * 60 * MINUTE),
                  quantity: -(2 + (Math.floor(day / DAY) % 5)),
                  reversesId: entryId,
                  reversalReason: "Lançado em dobro",
                  createdBy: k("user:supervisor"),
                })
                .onConflictDoNothing()
            }
          }
        }
      }

      await tx
        .insert(s.auditLog)
        .values({
          id: k("audit:seed"),
          organizationId,
          actorType: "system",
          actorLabel: "Seed sintético",
          action: "seed.synthetic",
          entityType: "organization",
          entityId: organizationId,
        })
        .onConflictDoNothing()
    }

    return { organizations, productionMinutes, stateEvents, gatewayTokens }
  })
}
