import { describe, expect, it } from "vitest"
import {
  BlockSchema,
  DEFAULTS,
  GatewayConfigSchema,
  MAX_TAGS,
  ROLE_ALLOWED_TYPES,
  RULES,
  RULE_IDS,
  TAG_ROLES,
  TagSchema,
  containingBlock,
  effectivePollMs,
  type GatewayConfig,
  type Tag,
} from "../src/index"
import { configTcpAndRtuBus, configTcpOnlyIo } from "../scripts/fixtures/valid"
import { uuidv7At } from "../scripts/fixtures/ids"
import { clone, issueKeys, rulesOf } from "./helpers"

const base: GatewayConfig = configTcpAndRtuBus

function variant(mutate: (c: GatewayConfig) => void): GatewayConfig {
  const c = clone(base)
  mutate(c)
  return c
}

function device(c: GatewayConfig, i: number) {
  const d = c.devices[i]
  if (d === undefined) throw new Error(`dispositivo ${i} ausente`)
  return d
}

describe("GatewayConfigSchema: casos válidos", () => {
  it("aceita a config do docs/03 e a config mínima só TCP", () => {
    expect(issueKeys(GatewayConfigSchema, base)).toEqual([])
    expect(issueKeys(GatewayConfigSchema, configTcpOnlyIo)).toEqual([])
  })

  it("aceita unit id 0 e 255 em Modbus TCP (servidor TCP direto)", () => {
    for (const unit of [0, 255]) {
      const c = variant((cfg) => {
        const d = device(cfg, 0)
        if (d.protocol === "modbus-tcp") d.params.unit_id = unit
      })
      expect(issueKeys(GatewayConfigSchema, c)).toEqual([])
    }
  })

  it("aceita porta serial lógica ou caminho /dev", () => {
    const c = variant((cfg) => {
      const bus = cfg.serial_buses[0]
      if (bus) bus.port = "/dev/ttyAMA2"
    })
    expect(issueKeys(GatewayConfigSchema, c)).toEqual([])
  })

  it("aceita RTU sobre TCP com unit id 1–247", () => {
    const c = variant((cfg) => {
      cfg.devices.push({
        id: uuidv7At("2026-11-01T00:00:00Z", "rtu-tcp"),
        protocol: "modbus-rtu-over-tcp",
        params: { host: "192.168.10.40", port: 4001, unit_id: 247 },
        tags: [],
      })
    })
    expect(issueKeys(GatewayConfigSchema, c)).toEqual([])
  })

  it("ignora campos desconhecidos (mudança compatível) e os remove na saída", () => {
    const withExtra = { ...clone(base), future_field: { a: 1 } }
    const parsed = GatewayConfigSchema.parse(withExtra)
    expect("future_field" in parsed).toBe(false)
  })
})

describe("GatewayConfigSchema: regras", () => {
  it("unit id fora de 1–247 em RTU é erro de schema", () => {
    for (const unit of [0, 248]) {
      const c = variant((cfg) => {
        const d = device(cfg, 1)
        if (d.protocol === "modbus-rtu") d.params.unit_id = unit
      })
      expect(issueKeys(GatewayConfigSchema, c)).toContain("devices.1.params.unit_id")
    }
  })

  it("bloco: 125 registradores ok, 126 não; 2000 bits ok, 2001 não", () => {
    expect(BlockSchema.safeParse({ area: "input_register", start: 0, count: 125, poll_ms: 500 }).success).toBe(true)
    expect(BlockSchema.safeParse({ area: "input_register", start: 0, count: 126, poll_ms: 500 }).success).toBe(false)
    expect(BlockSchema.safeParse({ area: "coil", start: 0, count: 2000, poll_ms: 500 }).success).toBe(true)
    expect(BlockSchema.safeParse({ area: "coil", start: 0, count: 2001, poll_ms: 500 }).success).toBe(false)
  })

  it("bloco não pode passar do offset 65535", () => {
    expect(rulesOf(BlockSchema, { area: "holding_register", start: 65500, count: 100, poll_ms: 500 })).toEqual([
      "block.range",
    ])
    expect(BlockSchema.safeParse({ area: "holding_register", start: 65411, count: 125, poll_ms: 500 }).success).toBe(true)
  })

  it("blocos de áreas diferentes podem ter a mesma faixa", () => {
    const c = variant((cfg) => {
      device(cfg, 0).blocks?.push({ area: "input_register", start: 1000, count: 14, poll_ms: 1000 })
    })
    expect(issueKeys(GatewayConfigSchema, c)).toEqual([])
  })

  it("uint32 no último registrador (65535) passa do limite", () => {
    const tag: Tag = {
      id: uuidv7At("2026-11-01T00:00:00Z", "t"),
      address: { area: "holding_register", offset: 65535 },
      type: "uint32",
      word_order: "CDAB",
      poll_ms: 1000,
      role: "custom",
    }
    expect(rulesOf(TagSchema, tag)).toEqual(["address.range"])
    expect(rulesOf(TagSchema, { ...tag, address: { area: "holding_register", offset: 65534 } })).toEqual([])
  })

  it("16 bits não aceita word_order; bit só em bool de registrador", () => {
    const tag: Tag = {
      id: uuidv7At("2026-11-01T00:00:00Z", "t2"),
      address: { area: "holding_register", offset: 10 },
      type: "uint16",
      poll_ms: 1000,
      role: "custom",
    }
    expect(rulesOf(TagSchema, { ...tag, word_order: "ABCD" })).toEqual(["address.word_order"])
    expect(rulesOf(TagSchema, { ...tag, address: { ...tag.address, bit: 2 } })).toEqual(["address.bit_only_bool"])
    expect(rulesOf(TagSchema, { ...tag, address: { area: "discrete_input", offset: 3, bit: 1 }, type: "bool" })).toEqual([
      "address.bit_area",
    ])
  })

  it("papel × tipo segue ROLE_ALLOWED_TYPES", () => {
    for (const role of TAG_ROLES) {
      for (const type of ["bool", "uint16", "float32"] as const) {
        const tag = {
          id: uuidv7At("2026-11-01T00:00:00Z", `${role}-${type}`),
          address: type === "bool" ? { area: "coil", offset: 1 } : { area: "input_register", offset: 1 },
          type,
          ...(type === "float32" ? { word_order: "ABCD" } : {}),
          poll_ms: 1000,
          role,
          machine_id: base.machines[0]?.id,
        }
        const allowed = ROLE_ALLOWED_TYPES[role].includes(type)
        expect(rulesOf(TagSchema, tag).includes("tag.role_type"), `${role}/${type}`).toBe(!allowed)
      }
    }
  })

  it("tag custom pode ficar sem máquina; os demais papéis não", () => {
    const tag = {
      id: uuidv7At("2026-11-01T00:00:00Z", "amb"),
      address: { area: "input_register", offset: 30 },
      type: "int16",
      poll_ms: 5000,
      role: "custom",
    }
    expect(rulesOf(TagSchema, tag)).toEqual([])
    expect(rulesOf(TagSchema, { ...tag, role: "fault.code" })).toEqual(["tag.machine_required"])
  })

  it("sampling só em custom/speed.actual e com min ≤ max", () => {
    const tag = {
      id: uuidv7At("2026-11-01T00:00:00Z", "smp"),
      address: { area: "input_register", offset: 30 },
      type: "int16",
      poll_ms: 5000,
      role: "custom",
      sampling: { min_interval_s: 60, max_interval_s: 10 },
    }
    expect(rulesOf(TagSchema, tag)).toEqual(["tag.sampling_interval"])
    expect(rulesOf(TagSchema, { ...tag, role: "fault.code", machine_id: base.machines[0]?.id, sampling: {} })).toEqual([
      "tag.sampling_role",
    ])
  })

  it("porta serial repetida em dois barramentos", () => {
    const c = variant((cfg) => {
      const bus = cfg.serial_buses[0]
      if (bus) cfg.serial_buses.push({ ...bus, id: uuidv7At("2026-11-01T00:00:00Z", "bus2") })
    })
    expect(rulesOf(GatewayConfigSchema, c)).toEqual(["bus.port_unique"])
  })

  it("dois dispositivos TCP no mesmo host:porta:unit", () => {
    const c = variant((cfg) => {
      cfg.devices.push({ ...clone(device(cfg, 0)), id: uuidv7At("2026-11-01T00:00:00Z", "dup"), tags: [] })
    })
    expect(rulesOf(GatewayConfigSchema, c)).toEqual(["tcp.endpoint_unique"])
  })

  it("mesmo host:porta com unit ids diferentes é permitido (conversor)", () => {
    const c = variant((cfg) => {
      const copy = clone(device(cfg, 0))
      if (copy.protocol === "modbus-tcp") copy.params.unit_id = 2
      cfg.devices.push({ ...copy, id: uuidv7At("2026-11-01T00:00:00Z", "unit2"), tags: [] })
    })
    expect(issueKeys(GatewayConfigSchema, c)).toEqual([])
  })

  it("papel repetido na mesma máquina (exceto custom)", () => {
    const c = variant((cfg) => {
      const tags = device(cfg, 2).tags
      const total = tags[0]
      if (total) tags.push({ ...total, id: uuidv7At("2026-11-01T00:00:00Z", "dup-role"), address: { area: "input_register", offset: 18 } })
    })
    expect(rulesOf(GatewayConfigSchema, c)).toEqual(["tag.role_unique"])
  })

  it("mapa de state_code vazio", () => {
    const c = variant((cfg) => {
      const rules = cfg.machines[0]?.state_rules
      if (rules?.mode === "state_code") rules.map = {}
    })
    expect(rulesOf(GatewayConfigSchema, c)).toEqual(["machine.state_map"])
  })

  it("comm_loss_after_s padrão (10 s) também é conferido contra o poll", () => {
    const c = variant((cfg) => {
      const tag = device(cfg, 2).tags[0]
      if (tag) tag.poll_ms = 5000 // 3 × 5000 > 10 s
    })
    expect(DEFAULTS.commLossAfterS).toBe(10)
    expect(rulesOf(GatewayConfigSchema, c)).toEqual(["machine.comm_loss"])
  })

  it(`mais de ${MAX_TAGS} tags no gateway`, () => {
    const c = variant((cfg) => {
      const d = device(cfg, 0)
      d.blocks = []
      d.tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => ({
        id: uuidv7At("2026-11-01T00:00:00Z", `many-${i}`),
        address: { area: "input_register", offset: i },
        type: "uint16",
        poll_ms: 1000,
        role: "custom",
      }))
    })
    const rules = rulesOf(GatewayConfigSchema, c)
    expect(rules).toContain("limits.tags")
  })

  it("todas as regras usadas no código estão documentadas em RULES", () => {
    for (const rule of RULE_IDS) expect(RULES[rule].length).toBeGreaterThan(10)
  })
})

describe("helpers de bloco", () => {
  const inj = device(base, 0)
  const sop = device(base, 1)

  it("containingBlock e effectivePollMs", () => {
    const total = inj.tags.find((t) => t.role === "count.total")
    const temp = inj.tags.find((t) => t.role === "custom")
    if (!total || !temp) throw new Error("fixture incompleta")
    expect(containingBlock(inj.blocks, total)?.start).toBe(1000)
    expect(effectivePollMs(inj, total)).toBe(500)
    expect(containingBlock(inj.blocks, temp)).toBeUndefined()
    expect(effectivePollMs(inj, temp)).toBe(1000)
    const running = sop.tags[0]
    if (!running) throw new Error("fixture incompleta")
    expect(effectivePollMs(sop, running)).toBe(250)
  })
})
