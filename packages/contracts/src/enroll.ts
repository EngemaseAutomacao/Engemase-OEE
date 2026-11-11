/**
 * POST /api/gateway/v1/enroll — troca o código de ativação (uso único, 8 caracteres,
 * expira em 24 h) pelas credenciais do gateway. Resposta 201.
 */
import { z } from "zod"
import { EntityIdSchema, HostnameSchema, SemverSchema, UtcDateTimeSchema } from "./common"
import { SerialPortSchema } from "./modbus"

/** Código de ativação: 8 caracteres A–Z/0–9, exibido como "ABCD-1234" (hífen opcional). */
export const ActivationCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/, "código de ativação inválido (ex.: ABCD-1234)")

/** Normaliza o código digitado (maiúsculas, sem espaços, com hífen no meio). */
export function normalizeActivationCode(input: string): string {
  const raw = input.toUpperCase().replace(/[\s-]/g, "")
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

export const CpuArchSchema = z.enum(["arm64", "amd64", "arm"])
export type CpuArch = z.infer<typeof CpuArchSchema>

export const HardwareInfoSchema = z.object({
  arch: CpuArchSchema,
  model: z.string().min(1).max(120),
  mem_mb: z.int().min(1),
  // Opcionais (identidade gravada na bancada, /data/identity/hw.json; ver docs/16)
  serial_number: z.string().min(1).max(64).optional().describe("Número de série Engemase (ex.: EGW-00042)"),
  board_revision: z.string().min(1).max(32).optional(),
  image_version: z.string().min(1).max(32).optional().describe("Versão da imagem do sistema gravada na bancada"),
  profile: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional()
    .describe("Perfil de hardware do agente (ex.: recomputer-r1000)"),
  serial_ports: z.array(SerialPortSchema).max(16).optional().describe("Portas RS-485 lógicas disponíveis"),
})
export type HardwareInfo = z.infer<typeof HardwareInfoSchema>

export const EnrollRequestSchema = z.object({
  code: ActivationCodeSchema,
  hostname: HostnameSchema,
  agent_version: SemverSchema,
  hw: HardwareInfoSchema,
})
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>

/** Token do gateway: "gw_live_" (ou "gw_test_") + 256 bits aleatórios codificados. Guardado só como hash SHA-256 na nuvem. */
export const GatewayTokenSchema = z
  .string()
  .max(160)
  .regex(/^gw_(?:live|test)_[A-Za-z0-9_-]{43,128}$/, "token de gateway inválido")

export const EnrollResponseSchema = z.object({
  gateway_id: EntityIdSchema,
  token: GatewayTokenSchema,
  org: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "slug de organização inválido")
    .describe("Slug do cliente"),
  server_time: UtcDateTimeSchema.optional(),
})
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>
