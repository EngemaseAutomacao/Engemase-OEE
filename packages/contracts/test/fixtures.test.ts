import { type JsonWebKey, createPublicKey, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  OtForwardApprovalClaimsSchema,
  SyncResponseSchema,
  VpnApprovalClaimsSchema,
  type ContractSchemaName,
} from "../src/index"
import { buildFixtureFiles } from "../scripts/fixtures/build"
import {
  fixturesDir,
  issueKeys,
  jsonSchemaValidator,
  listJsonFiles,
  loadManifest,
  readFixture,
  zodSchema,
} from "./helpers"

const manifest = loadManifest()
const valid = manifest.fixtures.filter((f) => f.valid)
const invalid = manifest.fixtures.filter((f) => !f.valid)

describe("fixtures: arquivos", () => {
  it("estão em dia com scripts/fixtures (rode build:fixtures se falhar)", () => {
    const expected = buildFixtureFiles()
    for (const [name, content] of expected) {
      expect(readFileSync(join(fixturesDir, name), "utf8"), name).toBe(content)
    }
    expect(listJsonFiles(fixturesDir)).toEqual([...expected.keys()].sort())
  })

  it("o manifest lista todas as fixtures (exceto manifest e chaves)", () => {
    const listed = manifest.fixtures.map((f) => f.file).sort()
    const onDisk = listJsonFiles(fixturesDir).filter((f) => f !== "manifest.json" && f !== "test-keys.json")
    expect(listed).toEqual(onDisk)
  })

  it("cobre cada schema exportado com ao menos uma fixture válida", () => {
    const schemas = new Set(valid.map((f) => f.schema))
    for (const name of [
      "enroll-request",
      "enroll-response",
      "sync-request",
      "sync-response",
      "gateway-config",
      "command-envelope",
      "error-response",
      "vpn-approval-claims",
      "ot-forward-approval-claims",
    ] satisfies ContractSchemaName[]) {
      expect(schemas.has(name), name).toBe(true)
    }
  })

  it("tem fixtures inválidas nas duas camadas", () => {
    expect(invalid.filter((f) => f.layer === "schema").length).toBeGreaterThanOrEqual(10)
    expect(invalid.filter((f) => f.layer === "semantic").length).toBeGreaterThanOrEqual(10)
  })
})

describe.each(valid)("válida: $file", (fixture) => {
  const data = readFixture(fixture.file)

  it("passa no Zod", () => {
    expect(issueKeys(zodSchema(fixture.schema), data)).toEqual([])
  })

  it("passa no JSON Schema tolerante e no estrito", () => {
    for (const flavor of ["tolerant", "strict"] as const) {
      const validate = jsonSchemaValidator(fixture.schema, flavor)
      expect(validate(data), `${flavor}: ${JSON.stringify(validate.errors?.slice(0, 3))}`).toBe(true)
    }
  })
})

describe.each(invalid)("inválida ($layer): $file", (fixture) => {
  const data = readFixture(fixture.file)
  const expectPath = fixture.expect?.path ?? ""

  it("é rejeitada pelo Zod no caminho (e regra) esperados", () => {
    const keys = issueKeys(zodSchema(fixture.schema), data)
    expect(keys.length).toBeGreaterThan(0)
    const wanted = fixture.expect?.rule !== undefined ? `${expectPath}[${fixture.expect.rule}]` : expectPath
    expect(keys).toContain(wanted)
  })

  if (fixture.layer === "schema") {
    it("é rejeitada pelo JSON Schema tolerante", () => {
      expect(jsonSchemaValidator(fixture.schema, "tolerant")(data)).toBe(false)
    })
  } else {
    it("passa no JSON Schema (a regra é só semântica)", () => {
      expect(jsonSchemaValidator(fixture.schema, "tolerant")(data)).toBe(true)
      expect(jsonSchemaValidator(fixture.schema, "strict")(data)).toBe(true)
    })
  }
})

describe("fixtures: aprovações assinadas", () => {
  const keys = readFixture("test-keys.json") as { keys: JsonWebKey[]; approval_kid: string }
  const jwk = keys.keys[0]
  if (jwk === undefined) throw new Error("test-keys.json sem chave")
  const publicKey = createPublicKey({ key: jwk, format: "jwk" })
  const response = SyncResponseSchema.parse(readFixture("sync-response.valid.all-command-types.json"))

  function decode(jws: string): { header: Record<string, unknown>; claims: unknown; valid: boolean } {
    const [h, p, s] = jws.split(".")
    if (h === undefined || p === undefined || s === undefined) throw new Error("JWS malformado")
    const valid = verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<string, unknown>,
      claims: JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as unknown,
      valid,
    }
  }

  it("vpn.enable traz JWS EdDSA válido com claims coerentes com o payload", () => {
    const cmd = response.commands.find((c) => c.type === "vpn.enable")
    if (cmd?.type !== "vpn.enable") throw new Error("fixture sem vpn.enable")
    const { header, claims, valid: ok } = decode(cmd.payload.approval)
    expect(ok).toBe(true)
    expect(header).toEqual({ alg: "EdDSA", kid: keys.approval_kid })
    const parsed = VpnApprovalClaimsSchema.parse(claims)
    expect(parsed.session_id).toBe(cmd.payload.session_id)
    expect(Date.parse(parsed.not_after)).toBeGreaterThanOrEqual(Date.parse(cmd.payload.session_expires_at))
    expect(parsed).toEqual(readFixture("vpn-approval-claims.valid.json"))
  })

  it("ot.forward.open traz JWS válido com o mesmo alvo do payload", () => {
    const cmd = response.commands.find((c) => c.type === "ot.forward.open")
    if (cmd?.type !== "ot.forward.open") throw new Error("fixture sem ot.forward.open")
    const { claims, valid: ok } = decode(cmd.payload.approval)
    expect(ok).toBe(true)
    const parsed = OtForwardApprovalClaimsSchema.parse(claims)
    expect([parsed.forward_id, parsed.device_id, parsed.host, parsed.port]).toEqual([
      cmd.payload.forward_id,
      cmd.payload.device_id,
      cmd.payload.host,
      cmd.payload.port,
    ])
  })

  it("assinatura adulterada não verifica", () => {
    const cmd = response.commands.find((c) => c.type === "vpn.enable")
    if (cmd?.type !== "vpn.enable") throw new Error("fixture sem vpn.enable")
    const [h, , s] = cmd.payload.approval.split(".")
    const forged = Buffer.from(JSON.stringify({ ...readFixture("vpn-approval-claims.valid.json") as object, allow_ot_forward: false })).toString("base64url")
    expect(decode(`${h}.${forged}.${s}`).valid).toBe(false)
  })
})
