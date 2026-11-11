import { describe, expect, it } from "vitest"
import {
  API_ERRORS,
  API_ERROR_CODES,
  API_ROUTES,
  ActivationCodeSchema,
  EnrollRequestSchema,
  ErrorResponseSchema,
  GatewayConfigSchema,
  agentActionForStatus,
  apiError,
  issuesFromZodError,
  normalizeActivationCode,
} from "../src/index"
import { configTcpAndRtuBus, enrollRequest } from "../scripts/fixtures/valid"
import { clone, issueKeys } from "./helpers"

describe("enroll", () => {
  it("rotas da API v1", () => {
    expect(API_ROUTES).toEqual({
      enroll: "/api/gateway/v1/enroll",
      sync: "/api/gateway/v1/sync",
      config: "/api/gateway/v1/config",
    })
  })

  it("código de ativação: 8 caracteres A–Z/0–9, com ou sem hífen", () => {
    for (const ok of ["ABCD-1234", "ABCD1234", "Z9Z9-0000"]) expect(ActivationCodeSchema.safeParse(ok).success, ok).toBe(true)
    for (const bad of ["abcd-1234", "ABC-1234", "ABCD-12345", "ABCD 1234", ""]) {
      expect(ActivationCodeSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it("normalizeActivationCode deixa o código digitado no formato do contrato", () => {
    expect(normalizeActivationCode(" abcd 1234 ")).toBe("ABCD-1234")
    expect(normalizeActivationCode("abcd-1234")).toBe("ABCD-1234")
    expect(ActivationCodeSchema.safeParse(normalizeActivationCode("x9y8z7w6")).success).toBe(true)
  })

  it("hostname e versão do agente", () => {
    expect(issueKeys(EnrollRequestSchema, { ...enrollRequest, hostname: "-gw" })).toEqual(["hostname"])
    expect(issueKeys(EnrollRequestSchema, { ...enrollRequest, agent_version: "v1.0" })).toEqual(["agent_version"])
    expect(issueKeys(EnrollRequestSchema, { ...enrollRequest, agent_version: "1.3.0-beta.1" })).toEqual([])
  })
})

describe("erros", () => {
  it("cada código tem status 4xx/5xx e ação do agente", () => {
    for (const code of API_ERROR_CODES) {
      const info = API_ERRORS[code]
      expect(info.status >= 400 && info.status < 600, code).toBe(true)
      const body = apiError(code)
      expect(body.status).toBe(info.status)
      expect(ErrorResponseSchema.safeParse(body.body).success, code).toBe(true)
    }
  })

  it("segue a tabela do docs/04", () => {
    expect(agentActionForStatus(200)).toBe("ok")
    expect(agentActionForStatus(400)).toBe("isolate_item")
    expect(agentActionForStatus(401)).toBe("stop_sending")
    expect(agentActionForStatus(409)).toBe("refresh_config")
    expect(agentActionForStatus(413)).toBe("split_batch")
    expect(agentActionForStatus(429)).toBe("retry_after")
    expect(agentActionForStatus(503)).toBe("backoff")
    // 403 costuma vir de proxy corporativo: não é motivo para parar de enviar
    expect(agentActionForStatus(403)).toBe("fix_and_retry")
    for (const code of API_ERROR_CODES) {
      const { status, action } = API_ERRORS[code]
      if (action !== "fix_and_retry") expect(agentActionForStatus(status), code).toBe(action)
    }
  })

  it("issuesFromZodError leva caminho, mensagem e regra", () => {
    const config = clone(configTcpAndRtuBus)
    const dev = config.devices[2]
    if (dev?.protocol === "modbus-rtu") dev.params.unit_id = 1
    const result = GatewayConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
    if (result.success) return
    const issues = issuesFromZodError(result.error)
    expect(issues).toEqual([
      { path: ["devices", 2, "params", "unit_id"], message: "unit_id repetido no mesmo barramento.", rule: "bus.unit_unique" },
    ])
    const body = apiError("invalid_payload", "Config inválida.", { issues })
    expect(ErrorResponseSchema.parse(body.body).error.issues?.[0]?.rule).toBe("bus.unit_unique")
  })
})
