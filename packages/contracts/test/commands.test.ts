import { describe, expect, it } from "vitest"
import {
  COMMAND_ERROR_CODES,
  COMMAND_EXEC_TIMEOUT_S,
  COMMAND_TYPES,
  CommandEnvelopeSchema,
  CommandResultSchema,
  CommandSchema,
  DEFAULT_COMMAND_TTL_S,
  DeviceTestPayloadSchema,
  ModbusScanPayloadSchema,
  TagReadPayloadSchema,
  type Command,
} from "../src/index"
import { allCommandResults, allCommands } from "../scripts/fixtures/valid"
import { ID } from "../scripts/fixtures/ids"
import { clone, issueKeys, rulesOf } from "./helpers"

function first<T extends Command["type"]>(type: T): Extract<Command, { type: T }> {
  const cmd = allCommands.find((c): c is Extract<Command, { type: T }> => c.type === type)
  if (cmd === undefined) throw new Error(`fixture sem ${type}`)
  return clone(cmd)
}

describe("comandos", () => {
  it("as fixtures têm um comando de cada tipo e todos validam", () => {
    expect(new Set(allCommands.map((c) => c.type))).toEqual(new Set(COMMAND_TYPES))
    for (const c of allCommands) expect(issueKeys(CommandSchema, c), c.type).toEqual([])
  })

  it("TTL e prazo de execução definidos para todos os tipos", () => {
    expect(Object.keys(DEFAULT_COMMAND_TTL_S).sort()).toEqual([...COMMAND_TYPES].sort())
    expect(Object.keys(COMMAND_EXEC_TIMEOUT_S).sort()).toEqual([...COMMAND_TYPES].sort())
  })

  it("validade acima de 24 h é recusada", () => {
    const cmd = first("config.reload")
    cmd.issued_at = "2026-11-11T13:00:00Z"
    cmd.expires_at = "2026-11-12T13:00:01Z"
    expect(rulesOf(CommandSchema, cmd)).toEqual(["command.expiry"])
    cmd.expires_at = "2026-11-12T13:00:00Z"
    expect(issueKeys(CommandSchema, cmd)).toEqual([])
  })

  it("sem issued_at, só expires_at é exigido", () => {
    const cmd = first("vpn.status")
    delete cmd.issued_at
    expect(issueKeys(CommandSchema, cmd)).toEqual([])
  })

  it("o envelope aceita tipos futuros; a união tipada não", () => {
    const future = { id: ID.cmdUnknownDone, type: "token.rotate", expires_at: "2026-11-11T13:10:00Z", payload: {} }
    expect(issueKeys(CommandEnvelopeSchema, future)).toEqual([])
    expect(issueKeys(CommandSchema, future)).toEqual(["type"])
  })

  it("todo comando tipado também passa no envelope", () => {
    for (const c of allCommands) expect(issueKeys(CommandEnvelopeSchema, c), c.type).toEqual([])
  })

  it("tag.read: bool em coil sem bit; float32 exige word_order", () => {
    const base = { device_id: ID.devInj03, address: { area: "coil", offset: 5 }, type: "bool" }
    expect(issueKeys(TagReadPayloadSchema, base)).toEqual([])
    expect(
      rulesOf(TagReadPayloadSchema, { ...base, address: { area: "input_register", offset: 20 }, type: "float32" }),
    ).toEqual(["address.word_order"])
  })

  it("device.test: IP ainda não cadastrado (sem device_id) é aceito", () => {
    const payload = clone(first("device.test").payload)
    delete payload.device_id
    expect(issueKeys(DeviceTestPayloadSchema, payload)).toEqual([])
  })

  it("device.test: serial_bus só com modbus-rtu", () => {
    const payload = {
      connection: { protocol: "modbus-tcp", params: { host: "192.168.10.50", port: 502, unit_id: 1 } },
      serial_bus: { id: ID.bus1, port: "rs485-1", baud: 19200, parity: "E", data_bits: 8, stop_bits: 1 },
    }
    expect(rulesOf(DeviceTestPayloadSchema, payload)).toEqual(["device_test.bus"])
  })

  it("device.test: probe não passa do offset 65535", () => {
    const payload = clone(first("device.test").payload)
    payload.probe = { area: "holding_register", offset: 65530, count: 10 }
    expect(rulesOf(DeviceTestPayloadSchema, payload)).toEqual(["probe.range"])
  })

  it("modbus.scan de registradores: faixa invertida ou grande demais", () => {
    const scan = { mode: "registers", device_id: ID.devInj03, area: "holding_register", start: 0, end: 9999 }
    expect(issueKeys(ModbusScanPayloadSchema, scan)).toEqual([])
    expect(rulesOf(ModbusScanPayloadSchema, { ...scan, end: 10_000 })).toEqual(["scan.range"])
    expect(rulesOf(ModbusScanPayloadSchema, { ...scan, start: 10, end: 9 })).toEqual(["scan.range"])
  })

  it("vpn.enable exige aprovação JWS e control_url https", () => {
    const cmd = first("vpn.enable")
    expect(issueKeys(CommandSchema, { ...cmd, payload: { ...cmd.payload, control_url: "http://hs.local" } })).toEqual([
      "payload.control_url",
    ])
    expect(
      issueKeys(CommandSchema, { ...cmd, payload: { ...cmd.payload, control_url: "https://headscale.engemase.com.br" } }),
    ).toEqual([])
  })
})

describe("resultados", () => {
  it("as fixtures cobrem sucesso de todos os tipos e validam", () => {
    const ok = allCommandResults.filter((r) => r.status === "ok").map((r) => r.type)
    expect(new Set(ok)).toEqual(new Set(COMMAND_TYPES))
    for (const r of allCommandResults) expect(issueKeys(CommandResultSchema, r), `${r.type}/${r.status}`).toEqual([])
  })

  it("sucesso exige result do formato do tipo", () => {
    const tagRead = clone(allCommandResults[0])
    if (tagRead?.status !== "ok" || tagRead.type !== "tag.read") throw new Error("fixture fora de ordem")
    expect(issueKeys(CommandResultSchema, { ...tagRead, result: { latency_ms: 3 } }).length).toBeGreaterThan(0)
    const { result: _omit, ...withoutResult } = tagRead
    expect(issueKeys(CommandResultSchema, withoutResult)).toContain("result")
  })

  it("falha exige error com código conhecido e aceita tipo desconhecido", () => {
    const failure = {
      id: ID.cmdUnknownDone,
      type: "logs.upload",
      status: "rejected",
      error: { code: "unsupported", message: "Tipo desconhecido." },
    }
    expect(issueKeys(CommandResultSchema, failure)).toEqual([])
    expect(issueKeys(CommandResultSchema, { ...failure, error: { code: "boom", message: "x" } })).toEqual([
      "error.code",
    ])
    expect(issueKeys(CommandResultSchema, { ...failure, status: "done" }).length).toBeGreaterThan(0)
  })

  it("todo código de erro de comando tem descrição", () => {
    for (const [code, text] of Object.entries(COMMAND_ERROR_CODES)) expect(text.length, code).toBeGreaterThan(10)
  })
})
