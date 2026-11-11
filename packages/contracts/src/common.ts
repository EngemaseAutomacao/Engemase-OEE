/**
 * Tipos primitivos compartilhados pelo contrato gateway ↔ nuvem v1.
 *
 * Regra geral: nada de `.default()` nem `.transform()` nos schemas do contrato.
 * Assim a entrada e a saída do Zod são idênticas e o JSON Schema exportado
 * descreve exatamente o que trafega no fio. Valores padrão ficam em `limits.ts`
 * e são aplicados por quem consome (agente ou nuvem).
 */
import { z } from "zod"

/**
 * Ativa as mensagens padrão do Zod em português (pt-BR). Afeta a instância global do
 * Zod de quem chama (as mensagens próprias do contrato já são em português).
 */
export function useZodPortugueseMessages(): void {
  z.config(z.locales.ptBR())
}

/** Versão do contrato, igual ao segmento de versão do path da API. */
export const CONTRACT_VERSION = "v1" as const

/** Prefixo das rotas da API dos gateways. */
export const API_BASE_PATH = "/api/gateway/v1" as const

/** Rotas da API v1 (relativas à URL base da plataforma). */
export const API_ROUTES = {
  enroll: `${API_BASE_PATH}/enroll`,
  sync: `${API_BASE_PATH}/sync`,
  config: `${API_BASE_PATH}/config`,
} as const

/**
 * Identificador de entidade gerado pela nuvem (gateway, dispositivo, máquina, tag,
 * barramento, comando, sessão...). A API usa os mesmos ids do banco: UUIDv7
 * (docs/04 e docs/06). O contrato aceita qualquer UUID válido para não rejeitar
 * uma config inteira por detalhe de geração; o agente nunca interpreta o conteúdo.
 * Apelidos como "mch_inj03" nos exemplos da documentação são só ilustrativos.
 */
export const EntityIdSchema = z
  .uuid({ message: "id deve ser um UUID (a nuvem gera UUIDv7)" })
  .describe("Id de entidade (UUID; a nuvem gera UUIDv7)")

/** Identificador de pessoa/usuário (Better Auth), usado só em auditoria e aprovações. */
export const UserRefSchema = z.string().min(1).max(200)

/** Timestamp ISO 8601 em UTC, obrigatoriamente com sufixo "Z" (ex.: 2026-11-11T13:02:05.120Z). */
export const UtcDateTimeSchema = z.iso
  .datetime({ message: "timestamp inválido: use ISO 8601 em UTC com 'Z' (ex.: 2026-11-11T13:02:05.120Z)" })
  .describe("Timestamp ISO 8601 em UTC com sufixo Z")

/** Início de um minuto em UTC: segundos e frações iguais a zero (ex.: 2026-11-11T13:01:00Z). */
export const MinuteStartSchema = z.iso
  .datetime({ message: "timestamp inválido: use ISO 8601 em UTC com 'Z'" })
  .check(z.regex(/T\d{2}:\d{2}:00(?:\.0+)?Z$/, "o minuto deve começar no segundo zero (ex.: 2026-11-11T13:01:00Z)"))
  .describe("Início do minuto em UTC (segundos = 0)")

/** UUID versão 7 (ordenável no tempo), gerado na borda para idempotência. */
export const UuidV7Schema = z
  .uuidv7({ message: "id deve ser um UUIDv7" })
  .describe("UUIDv7 gerado pelo gateway")

/** Versão semântica (ex.: 1.2.0 ou 1.3.0-beta.1). */
export const SemverSchema = z
  .string()
  .max(64)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "versão inválida: use semver (ex.: 1.2.0)",
  )

/** Número de sequência da outbox do gateway (monotônico, começa em 1). */
export const SeqSchema = z.int().min(1).describe("Sequência monotônica da outbox do gateway")

/** Nome de host (RFC 1123). O último rótulo começa com letra, para não confundir com IP. */
export const HostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
    "nome de host inválido",
  )

/** Endereço IPv4 em notação decimal. */
export const Ipv4Schema = z.ipv4({ message: "IPv4 inválido" })

/** Host de rede: IPv4 ou nome de host. */
export const HostSchema = z.union([Ipv4Schema, HostnameSchema])

/** Porta TCP. */
export const TcpPortSchema = z.int().min(1).max(65535)

/** Código de produto/receita como lido do CLP ou cadastrado (texto bruto, ex.: "7" ou "PRD-001"). */
export const ProductCodeSchema = z.string().min(1).max(64)

/** Texto livre curto (mensagens, motivos). */
export const ShortTextSchema = z.string().max(2000)

/**
 * Estados de máquina (docs/07). `NO_COMM` é gerado só pelo gateway;
 * os demais vêm do CLP (sinal, código ou contagem).
 */
export const MachineStateSchema = z.enum(["RUNNING", "STOPPED", "FAULT", "SETUP", "NO_COMM"])
export type MachineState = z.infer<typeof MachineStateSchema>
export const MACHINE_STATES = MachineStateSchema.options

/** Estados que o CLP pode informar (todos menos `NO_COMM`). */
export const PlcStateSchema = z.enum(["RUNNING", "STOPPED", "FAULT", "SETUP"])
export type PlcState = z.infer<typeof PlcStateSchema>

/** Qualidade de uma leitura: boa, ruim ou vencida. */
export const QualitySchema = z.enum(["good", "bad", "stale"])
export type Quality = z.infer<typeof QualitySchema>

/** Inteiro não negativo seguro (até 2^53 − 1). */
export const NonNegativeIntSchema = z.int().min(0)

/** Valor bruto de contador do CLP (até uint32). */
export const CounterRawSchema = z.int().min(0).max(4_294_967_295)

/** JWS compacto (header.payload.assinatura em base64url), usado nas aprovações assinadas. */
export const JwsCompactSchema = z
  .string()
  .max(8192)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "aprovação deve ser um JWS compacto (header.payload.assinatura)")
  .describe("JWS compacto assinado com Ed25519 (alg EdDSA)")
