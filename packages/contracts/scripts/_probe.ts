import { z } from "zod"
const s = z.object({
  a: z.iso.datetime(),
  b: z.uuidv7(),
  c: z.string().regex(/^x$/),
  d: z.iso.datetime().check(z.regex(/:00(\.0+)?Z$/)),
  e: z.record(z.string().regex(/^-?\d+$/), z.enum(["A", "B"])),
  f: z.discriminatedUnion("k", [z.object({ k: z.literal("x"), v: z.number() }), z.object({ k: z.literal("y") })]),
  g: z.number().int().min(0).optional(),
  h: z.union([z.number(), z.boolean()]),
})
console.log(JSON.stringify(z.toJSONSchema(s, { io: "input" }), null, 1))
console.log(JSON.stringify(z.toJSONSchema(s, { io: "output" }).additionalProperties))
const r = z.object({ x: z.number() }).superRefine((v, ctx) => { if (v.x > 1) ctx.addIssue({ code: "custom", message: "m", path: ["x"], params: { rule: "r1" } }) })
console.log(r.constructor.name, JSON.stringify(r.safeParse({ x: 2 }).error?.issues))
const inner = z.discriminatedUnion("type", [z.object({ status: z.literal("ok"), type: z.literal("a") }), z.object({ status: z.literal("ok"), type: z.literal("b") })])
const outer = z.discriminatedUnion("status", [inner, z.object({ status: z.enum(["error", "expired"]), type: z.string() })])
console.log(JSON.stringify(outer.safeParse({ status: "ok", type: "c" }).error?.issues))
console.log(outer.safeParse({ status: "expired", type: "c" }).success)
