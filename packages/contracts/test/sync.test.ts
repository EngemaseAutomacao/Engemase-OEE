import { describe, expect, it } from "vitest"
import {
  EVENT_TYPES,
  FUTURE_TOLERANCE_MS,
  MAX_BATCH_ITEMS,
  MinuteSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  findTimestampsAfter,
  type SyncRequest,
} from "../src/index"
import {
  syncRequestAllEventTypes,
  syncRequestHealthOnly,
  syncRequestRealistic,
  syncRequestSamplesQueue,
  syncResponseRealistic,
} from "../scripts/fixtures/valid"
import { clone, issueKeys, rulesOf } from "./helpers"

function variant(base: SyncRequest, mutate: (r: SyncRequest) => void): SyncRequest {
  const r = clone(base)
  mutate(r)
  return r
}

describe("SyncRequestSchema", () => {
  it("aceita os exemplos válidos", () => {
    for (const r of [syncRequestRealistic, syncRequestHealthOnly, syncRequestSamplesQueue, syncRequestAllEventTypes]) {
      expect(issueKeys(SyncRequestSchema, r)).toEqual([])
    }
  })

  it("a fixture de todos os eventos cobre todos os tipos", () => {
    expect(new Set(syncRequestAllEventTypes.events.map((e) => e.type))).toEqual(new Set(EVENT_TYPES))
  })

  it("seq_from sem seq_to (ou invertido) viola batch.seq_pair", () => {
    const onlyFrom = variant(syncRequestRealistic, (r) => {
      delete r.batch.seq_to
    })
    expect(rulesOf(SyncRequestSchema, onlyFrom)).toContain("batch.seq_pair")
    const inverted = variant(syncRequestRealistic, (r) => {
      r.batch.seq_from = 18246
    })
    expect(rulesOf(SyncRequestSchema, inverted)).toContain("batch.seq_pair")
  })

  it("com fila própria, as amostras precisam da sua faixa e podem repetir seq da fila principal", () => {
    const noRange = variant(syncRequestSamplesQueue, (r) => {
      delete r.batch.samples_seq_from
      r.batch.samples_seq_to = 9003
    })
    expect(rulesOf(SyncRequestSchema, noRange)).toContain("batch.seq_pair")
    const sameSeq = variant(syncRequestSamplesQueue, (r) => {
      r.batch.samples_seq_from = 501
      r.batch.samples_seq_to = 503
      r.samples = r.samples?.map((s, i) => ({ ...s, seq: 501 + i }))
    })
    expect(issueKeys(SyncRequestSchema, sameSeq)).toEqual([])
  })

  it("sem fila própria, amostras entram na faixa principal", () => {
    const r = variant(syncRequestRealistic, (req) => {
      const s = req.samples?.[0]
      if (s) s.seq = 18300
    })
    expect(rulesOf(SyncRequestSchema, r)).toEqual(["batch.seq_range"])
  })

  it(`mais de ${MAX_BATCH_ITEMS} itens no lote`, () => {
    const r = variant(syncRequestHealthOnly, (req) => {
      req.batch.seq_from = 1
      req.batch.seq_to = 3000
      req.samples = Array.from({ length: 1001 }, (_, i) => ({
        seq: i + 1,
        tag_id: "01a159aa-9938-7379-92bb-ea1d43c0b4ad",
        at: new Date(Date.UTC(2026, 10, 11, 12, 0, 0) + i * 1000).toISOString(),
        v: i,
      }))
      req.minutes = Array.from({ length: 1000 }, (_, i) => ({
        seq: 1002 + i,
        machine_id: "01a159a1-4a68-72de-9057-14e72d836a47",
        t: new Date(Date.UTC(2026, 10, 10, 0, 0, 0) + i * 60_000).toISOString(),
        run_s: 60,
        stop_s: 0,
        fault_s: 0,
        setup_s: 0,
        no_comm_s: 0,
        total: 1,
        reject: 0,
      }))
    })
    expect(rulesOf(SyncRequestSchema, r)).toEqual(["batch.items_max"])
  })

  it("minuto: a soma precisa ser exatamente 60 (nem mais, nem menos)", () => {
    const minute = syncRequestRealistic.minutes[0]
    expect(rulesOf(MinuteSchema, { ...minute, run_s: 59 })).toEqual(["minute.seconds_sum"])
    expect(rulesOf(MinuteSchema, { ...minute, setup_s: 1 })).toEqual(["minute.seconds_sum"])
    expect(issueKeys(MinuteSchema, { ...minute, run_s: 30, setup_s: 30 })).toEqual([])
  })

  it("minuto: t com milissegundos zerados é aceito; com segundos, não", () => {
    const minute = syncRequestRealistic.minutes[0]
    expect(issueKeys(MinuteSchema, { ...minute, t: "2026-11-11T13:00:00.000Z" })).toEqual([])
    expect(issueKeys(MinuteSchema, { ...minute, t: "2026-11-11T13:00:00.500Z" })).toEqual(["t"])
  })

  it("timestamps: só UTC com Z", () => {
    for (const at of ["2026-11-11T13:01:42.250+00:00", "2026-11-11 13:01:42Z", "2026-02-30T10:00:00Z", "13:01:42Z"]) {
      const r = variant(syncRequestRealistic, (req) => {
        const e = req.events?.[0]
        if (e) e.at = at
      })
      expect(issueKeys(SyncRequestSchema, r), at).toEqual(["events.0.at"])
    }
  })

  it("amostra repetida (tag_id, at)", () => {
    const r = variant(syncRequestRealistic, (req) => {
      const [a, b] = req.samples ?? []
      if (a && b) b.tag_id = a.tag_id
      if (a && b) b.at = a.at
    })
    expect(rulesOf(SyncRequestSchema, r)).toEqual(["sample.unique"])
  })

  it("status repetido para o mesmo dispositivo e resultado repetido para o mesmo comando", () => {
    const r = variant(syncRequestRealistic, (req) => {
      const [a, b] = req.devices ?? []
      if (a && b) b.id = a.id
      const [c, d] = req.command_results ?? []
      if (c && d) d.id = c.id
    })
    expect(rulesOf(SyncRequestSchema, r).sort()).toEqual(["command_result.unique", "device_status.unique"])
  })

  it("data_loss com período invertido", () => {
    const r = variant(syncRequestAllEventTypes, (req) => {
      const e = req.events?.find((ev) => ev.type === "data_loss")
      if (e?.type === "data_loss") e.period_to = "2026-10-10T07:00:00Z"
    })
    expect(rulesOf(SyncRequestSchema, r)).toEqual(["interval.order"])
  })

  it("findTimestampsAfter aponta dados além da tolerância", () => {
    const serverTime = new Date("2026-11-11T13:00:00Z")
    const limit = new Date(serverTime.getTime() + FUTURE_TOLERANCE_MS)
    // limite = 13:02:00; live.*.at (13:02:04–05) passa, o resto não
    expect(findTimestampsAfter(syncRequestRealistic, limit)).toEqual(["live.0.at", "live.1.at", "live.2.at"])
    expect(findTimestampsAfter(syncRequestRealistic, new Date("2026-11-11T14:00:00Z"))).toEqual([])
  })
})

describe("SyncResponseSchema", () => {
  it("aceita a resposta do docs/04", () => {
    expect(issueKeys(SyncResponseSchema, syncResponseRealistic)).toEqual([])
  })

  it("next_sync_s entre 1 e 300 e min_agent_version em semver", () => {
    expect(issueKeys(SyncResponseSchema, { ...syncResponseRealistic, next_sync_s: 301 })).toEqual(["next_sync_s"])
    expect(issueKeys(SyncResponseSchema, { ...syncResponseRealistic, min_agent_version: "1.0" })).toEqual([
      "min_agent_version",
    ])
  })
})
