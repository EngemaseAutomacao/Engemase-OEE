/**
 * Regras da aplicação do W2b conferidas no servidor (lib/server/production): turnos sem sobreposição na
 * mesma unidade e mudança de turno só para a frente (L2); prazo do lançamento atrasado de refugo, estorno
 * com auditoria e turno consolidado marcado como sujo (L3); operador da mesma unidade (L19).
 */
import { generateShiftWindows } from "@engemase/oee-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ShiftRow } from "@/lib/server/production/calendar"
import { type ProductionActor, ProductionRuleError } from "@/lib/server/production/errors"
import { lateEntryDeadline, recordQualityEntry, reverseQualityEntry } from "@/lib/server/production/quality"
import { findShiftOverlap, saveShift } from "@/lib/server/production/shifts"
import { count, createTestDatabase, EXAMPLE_CONFIG, remapIds, rows, type SeededClient, seedClient, type TestDatabase } from "../gateway/support"

const ENGEMASE: ProductionActor = { type: "engemase", id: null, label: "Engenheiro de campo", clientRole: null }
const OPERATOR: ProductionActor = { type: "user", id: null, label: "Operador", clientRole: "operator" }
const SUPERVISOR: ProductionActor = { type: "user", id: null, label: "Supervisor", clientRole: "supervisor" }

function row(partial: Partial<ShiftRow> & Pick<ShiftRow, "startTime" | "endTime">): ShiftRow {
  return { id: partial.name ?? "t", name: "Turno", daysOfWeek: [1, 2, 3, 4, 5], breaks: [], validFrom: null, validTo: null, ...partial }
}

async function rejects(promise: Promise<unknown>, code: string): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ProductionRuleError)
  expect((error as ProductionRuleError).code).toBe(code)
  return (error as ProductionRuleError).message
}

describe("turnos sem sobreposição (L2)", () => {
  it("detecta cruzamento no mesmo dia, na virada da noite e respeita dias da semana e vigência", () => {
    const manha = row({ name: "Manhã", startTime: "06:00", endTime: "14:00" })
    const tarde = row({ name: "Tarde", startTime: "14:00", endTime: "22:00" })
    const noite = row({ name: "Noite", startTime: "22:00", endTime: "06:00" })
    expect(findShiftOverlap(tarde, [manha])).toBeNull() // encostar não é sobrepor
    expect(findShiftOverlap(noite, [manha, tarde])).toBeNull()

    const longo = row({ name: "Longo", startTime: "13:00", endTime: "15:00" })
    expect(findShiftOverlap(longo, [manha])?.message).toContain('se sobrepõe ao turno "Manhã"')

    // Noite de sexta (só sexta) entra no sábado de manhã: cruza com um turno de sábado 05:00–09:00.
    const noiteSexta = row({ name: "Noite de sexta", startTime: "22:00", endTime: "06:00", daysOfWeek: [5] })
    const sabado = row({ name: "Sábado", startTime: "05:00", endTime: "09:00", daysOfWeek: [6] })
    expect(findShiftOverlap(sabado, [noiteSexta])?.message).toContain("no sábado")
    expect(findShiftOverlap(row({ name: "Domingo", startTime: "05:00", endTime: "09:00", daysOfWeek: [7] }), [noiteSexta])).toBeNull()

    // Vigências que não se tocam (turno antigo encerrado, novo depois) não se sobrepõem.
    const antigo = row({ name: "Antigo", startTime: "06:00", endTime: "14:00", validTo: "2026-11-30" })
    const novo = row({ name: "Novo", startTime: "07:00", endTime: "15:00", validFrom: "2026-12-01" })
    expect(findShiftOverlap(novo, [antigo])).toBeNull()
    expect(findShiftOverlap({ ...novo, validFrom: "2026-11-30" }, [antigo])).not.toBeNull()
    // Antigo só com fim de vigência no passado distante e novo sem vigência: ainda se sobrepõem antes do fim.
    expect(findShiftOverlap(row({ name: "Sem vigência", startTime: "07:00", endTime: "15:00" }), [{ ...antigo, validTo: "2020-01-31" }])).not.toBeNull()
  })
})

describe("gravações de produção no servidor", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function freshClient(): Promise<SeededClient> {
    return seedClient(t.db, { slug: `regras-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
  }

  const MANHA = { name: "Manhã", startTime: "06:00", endTime: "14:00", daysOfWeek: [1, 2, 3, 4, 5], breaks: [{ start: "10:00", end: "10:30" }] }

  describe("saveShift", () => {
    it("grava com auditoria, recusa sobreposição e dados inválidos", async () => {
      const c = await freshClient()
      const { id } = await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: MANHA, actor: ENGEMASE })
      expect(await count(t, "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'shift.created'", [id])).toBe(1)

      const msg = await rejects(
        saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, name: "Extra", startTime: "13:00", endTime: "17:00", breaks: [] }, actor: ENGEMASE }),
        "shift_overlap",
      )
      expect(msg).toContain('"Manhã"')
      await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, name: "Tarde", startTime: "14:00", endTime: "22:00", breaks: [] }, actor: ENGEMASE })

      await rejects(
        saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, name: "Ruim", startTime: "23:00", endTime: "23:30", breaks: [{ start: "10:00", end: "10:30" }] }, actor: ENGEMASE }),
        "invalid_input",
      )
      await rejects(
        saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, daysOfWeek: [] }, actor: ENGEMASE }),
        "invalid_input",
      )
      // Unidade de outro cliente: a RLS esconde.
      const other = await freshClient()
      await rejects(saveShift(t.db, { organizationId: c.organizationId, unitId: other.unitId, shift: MANHA, actor: ENGEMASE }), "not_found")
    })

    it("turno com turnos fechados não muda de horário (vale dali para a frente); nome e vigência mudam", async () => {
      const c = await freshClient()
      const { id } = await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: MANHA, actor: ENGEMASE })
      // Antes de consolidar, o horário pode mudar.
      await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shiftId: id, shift: { ...MANHA, startTime: "05:30" }, actor: ENGEMASE })
      await t.client.query("INSERT INTO oee_shift (organization_id, machine_id, shift_date, shift_id) VALUES ($1, $2, '2026-11-23', $3)", [
        c.organizationId,
        c.machineIds[0],
        id,
      ])
      await rejects(
        saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shiftId: id, shift: { ...MANHA, startTime: "07:00" }, actor: ENGEMASE }),
        "shift_already_consolidated",
      )
      await saveShift(t.db, {
        organizationId: c.organizationId,
        unitId: c.unitId,
        shiftId: id,
        shift: { ...MANHA, startTime: "05:30", name: "Manhã (até novembro)", validTo: "2026-11-30" },
        actor: ENGEMASE,
      })
      // O turno novo, a partir de dezembro, não se sobrepõe ao antigo encerrado.
      await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, startTime: "07:00", endTime: "15:00", validFrom: "2026-12-01" }, actor: ENGEMASE })
      expect(await rows(t, "SELECT name FROM shift WHERE unit_id = $1 ORDER BY valid_from NULLS FIRST", [c.unitId])).toEqual([
        { name: "Manhã (até novembro)" },
        { name: "Manhã" },
      ])
    })
  })

  describe("lançamento de refugo", () => {
    it("prazo: fim do turno seguinte (puro)", () => {
      const windows = generateShiftWindows({
        timeZone: "UTC",
        from: "2026-11-20",
        to: "2026-11-26",
        shifts: [
          { id: "m", start: "06:00", end: "14:00", daysOfWeek: [1, 2, 3, 4, 5] },
          { id: "t", start: "14:00", end: "22:00", daysOfWeek: [1, 2, 3, 4, 5] },
        ],
      })
      const at = (iso: string) => Date.parse(iso)
      // Segunda 10:00 (manhã) → fim da tarde de segunda.
      expect(lateEntryDeadline(at("2026-11-23T10:00:00Z"), windows)).toBe(at("2026-11-23T22:00:00Z"))
      // Sexta à tarde → fim da manhã de segunda (fim de semana sem turno).
      expect(lateEntryDeadline(at("2026-11-20T15:00:00Z"), windows)).toBe(at("2026-11-23T14:00:00Z"))
      // Fora de turno (segunda 23:00) → fim do primeiro turno depois (manhã de terça).
      expect(lateEntryDeadline(at("2026-11-23T23:00:00Z"), windows)).toBe(at("2026-11-24T14:00:00Z"))
      // Sem turnos: 24 h.
      expect(lateEntryDeadline(at("2026-11-23T10:00:00Z"), [])).toBe(at("2026-11-24T10:00:00Z"))
    })

    it("operador dentro do prazo; depois, só supervisor; turno consolidado fica sujo; estorno com auditoria", async () => {
      const c = await freshClient()
      await t.client.query("UPDATE unit SET timezone = 'UTC' WHERE id = $1", [c.unitId])
      const { id: shiftId } = await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, breaks: [] }, actor: ENGEMASE })
      await saveShift(t.db, { organizationId: c.organizationId, unitId: c.unitId, shift: { ...MANHA, name: "Tarde", startTime: "14:00", endTime: "22:00", breaks: [] }, actor: ENGEMASE })
      await t.client.query("INSERT INTO oee_shift (organization_id, machine_id, shift_date, shift_id, dirty) VALUES ($1, $2, '2026-11-23', $3, false)", [
        c.organizationId,
        c.machineIds[0],
        shiftId,
      ])
      const [reason] = await rows<{ id: string }>(t, "INSERT INTO reject_reason (organization_id, name) VALUES ($1, 'Rebarba') RETURNING id", [c.organizationId])
      const entry = { machineId: c.machineIds[0]!, at: new Date("2026-11-23T10:00:00Z"), quantity: 5, rejectReasonId: reason!.id }

      // Segunda 21:00 (antes do fim da tarde): o operador lança.
      const ok = await recordQualityEntry(t.db, { organizationId: c.organizationId, entry, actor: OPERATOR, now: new Date("2026-11-23T21:00:00Z") })
      expect(ok.late).toBe(false)
      expect(await rows(t, "SELECT dirty FROM oee_shift WHERE shift_id = $1", [shiftId])).toEqual([{ dirty: true }])

      // Terça 08:00: passou do fim do turno seguinte. Operador não; supervisor sim (marcado como atrasado).
      const later = new Date("2026-11-24T08:00:00Z")
      const msg = await rejects(recordQualityEntry(t.db, { organizationId: c.organizationId, entry, actor: OPERATOR, now: later }), "late_entry_deadline")
      expect(msg).toContain("supervisor")
      const late = await recordQualityEntry(t.db, { organizationId: c.organizationId, entry, actor: SUPERVISOR, now: later })
      expect(late.late).toBe(true)
      expect(await count(t, "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'quality_entry.created' AND (after ->> 'late')::boolean", [late.id])).toBe(1)

      // Estorno: motivo obrigatório, um só, com auditoria; operador fora do prazo não estorna.
      await rejects(reverseQualityEntry(t.db, { organizationId: c.organizationId, entryId: ok.id, reason: " ", actor: SUPERVISOR, now: later }), "invalid_input")
      await rejects(reverseQualityEntry(t.db, { organizationId: c.organizationId, entryId: ok.id, reason: "Peça boa", actor: OPERATOR, now: later }), "late_entry_deadline")
      const rev = await reverseQualityEntry(t.db, { organizationId: c.organizationId, entryId: ok.id, reason: "Peça boa", actor: SUPERVISOR, now: later })
      expect(await rows(t, "SELECT quantity, reverses_id, reversal_reason FROM quality_entry WHERE id = $1", [rev.id])).toEqual([
        { quantity: -5, reverses_id: ok.id, reversal_reason: "Peça boa" },
      ])
      expect(await count(t, "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'quality_entry.reversed'", [ok.id])).toBe(1)
      await rejects(reverseQualityEntry(t.db, { organizationId: c.organizationId, entryId: ok.id, reason: "De novo", actor: SUPERVISOR, now: later }), "already_reversed")
      await rejects(reverseQualityEntry(t.db, { organizationId: c.organizationId, entryId: rev.id, reason: "Estorno do estorno", actor: SUPERVISOR, now: later }), "already_reversed")
    })

    it("recusa futuro, quantidade inválida, motivo desativado e operador de outra unidade", async () => {
      const c = await freshClient()
      const now = new Date("2026-11-23T12:00:00Z")
      const base = { machineId: c.machineIds[0]!, at: new Date("2026-11-23T11:00:00Z"), quantity: 1 }
      const call = (entry: Record<string, unknown>) =>
        recordQualityEntry(t.db, { organizationId: c.organizationId, entry: { ...base, ...entry } as typeof base, actor: OPERATOR, now })
      await rejects(call({ at: new Date("2026-11-23T12:05:00Z") }), "invalid_input")
      await rejects(call({ quantity: 0 }), "invalid_input")
      await rejects(call({ quantity: 1.5 }), "invalid_input")
      const [off] = await rows<{ id: string }>(t, "INSERT INTO reject_reason (organization_id, name, active) VALUES ($1, 'Antigo', false) RETURNING id", [c.organizationId])
      await rejects(call({ rejectReasonId: off!.id }), "not_found")
      const [unit2] = await rows<{ id: string }>(t, "INSERT INTO unit (organization_id, name) VALUES ($1, 'Planta 2') RETURNING id", [c.organizationId])
      const [op] = await rows<{ id: string }>(t, "INSERT INTO unit_operator (organization_id, unit_id, name) VALUES ($1, $2, 'Ana') RETURNING id", [c.organizationId, unit2!.id])
      await rejects(call({ operatorId: op!.id }), "not_found")
      // Máquina de outro cliente: a RLS esconde.
      const other = await freshClient()
      await rejects(call({ machineId: other.machineIds[0] }), "not_found")
      expect(await count(t, "SELECT 1 FROM quality_entry WHERE organization_id = $1", [c.organizationId])).toBe(0)
    })
  })
})
