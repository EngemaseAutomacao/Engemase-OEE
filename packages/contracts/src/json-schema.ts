/**
 * Exportação dos schemas Zod como JSON Schema (draft 2020-12), usada pelo
 * script `build:schema` e pelos testes de contrato do agente Go.
 *
 * Dois sabores por schema:
 * - `schema/<nome>.json` (tolerante): aceita campos desconhecidos. É o que o agente usa
 *   em tempo de execução, para que campos novos opcionais (mudança compatível) não
 *   quebrem agentes antigos.
 * - `schema/strict/<nome>.json` (estrito): `additionalProperties: false` em todo objeto.
 *   Para testes: pega erro de digitação em campo produzido pelo agente.
 *
 * As regras semânticas (ver `RULES`) não cabem em JSON Schema e não aparecem aqui.
 */
import { z } from "zod"
import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  CommandSchema,
  OtForwardApprovalClaimsSchema,
  VpnApprovalClaimsSchema,
} from "./commands"
import { CONTRACT_VERSION } from "./common"
import { GatewayConfigSchema } from "./config"
import { EnrollRequestSchema, EnrollResponseSchema } from "./enroll"
import { ErrorResponseSchema } from "./errors"
import { SyncRequestSchema, SyncResponseSchema } from "./sync"

export const JSON_SCHEMA_BASE_URL = `https://oee.engemase.com.br/schemas/gateway/${CONTRACT_VERSION}`

export interface ContractSchemaEntry {
  /** Nome do arquivo, sem extensão. */
  readonly name: string
  readonly title: string
  readonly description: string
  readonly schema: z.ZodType
}

export const CONTRACT_SCHEMAS = [
  {
    name: "enroll-request",
    title: "POST /enroll — requisição",
    description: "Troca do código de ativação pelas credenciais do gateway.",
    schema: EnrollRequestSchema,
  },
  {
    name: "enroll-response",
    title: "POST /enroll — resposta 201",
    description: "Credenciais do gateway (o token só aparece aqui).",
    schema: EnrollResponseSchema,
  },
  {
    name: "sync-request",
    title: "POST /sync — requisição",
    description: "Lote de dados (eventos, minutos, live, amostras), saúde e resultados de comandos.",
    schema: SyncRequestSchema,
  },
  {
    name: "sync-response",
    title: "POST /sync — resposta 200",
    description: "Confirmação (ack), hora do servidor, versão de config, comandos e ritmo do próximo sync.",
    schema: SyncResponseSchema,
  },
  {
    name: "gateway-config",
    title: "GET /config — resposta 200",
    description: "Configuração completa do gateway: barramentos, dispositivos Modbus, blocos, tags, máquinas e uplink.",
    schema: GatewayConfigSchema,
  },
  {
    name: "command",
    title: "Comando tipado",
    description: "Comando entregue na resposta do /sync, validado pelo tipo.",
    schema: CommandSchema,
  },
  {
    name: "command-envelope",
    title: "Envelope de comando",
    description: "Validação genérica do comando antes de olhar o tipo (aceita tipos futuros).",
    schema: CommandEnvelopeSchema,
  },
  {
    name: "command-result",
    title: "Resultado de comando",
    description: "Item de command_results no /sync.",
    schema: CommandResultSchema,
  },
  {
    name: "error-response",
    title: "Resposta de erro",
    description: "Corpo padrão das respostas 4xx/5xx da API dos gateways.",
    schema: ErrorResponseSchema,
  },
  {
    name: "vpn-approval-claims",
    title: "Claims da aprovação de VPN",
    description: "Payload do JWS (EdDSA) que acompanha vpn.enable.",
    schema: VpnApprovalClaimsSchema,
  },
  {
    name: "ot-forward-approval-claims",
    title: "Claims da aprovação de encaminhamento OT",
    description: "Payload do JWS (EdDSA) que acompanha ot.forward.open.",
    schema: OtForwardApprovalClaimsSchema,
  },
] as const satisfies readonly ContractSchemaEntry[]

export type ContractSchemaName = (typeof CONTRACT_SCHEMAS)[number]["name"]
export type JsonSchemaFlavor = "tolerant" | "strict"

/** Gera o JSON Schema de um schema do contrato. */
export function buildJsonSchema(entry: ContractSchemaEntry, flavor: JsonSchemaFlavor): Record<string, unknown> {
  const generated = z.toJSONSchema(entry.schema, {
    target: "draft-2020-12",
    io: flavor === "strict" ? "output" : "input",
    unrepresentable: "throw",
    reused: "inline",
  }) as Record<string, unknown>
  const { $schema, ...rest } = generated
  const path = flavor === "strict" ? `strict/${entry.name}.json` : `${entry.name}.json`
  return {
    $schema,
    $id: `${JSON_SCHEMA_BASE_URL}/${path}`,
    title: entry.title,
    description: `${entry.description} Contrato gateway ↔ nuvem ${CONTRACT_VERSION}. Gerado de @engemase/contracts; não edite à mão.`,
    ...rest,
  }
}

/** Todos os arquivos de JSON Schema: caminho relativo a `schema/` → conteúdo. */
export function buildAllJsonSchemas(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  for (const entry of CONTRACT_SCHEMAS) {
    out.set(`${entry.name}.json`, buildJsonSchema(entry, "tolerant"))
    out.set(`strict/${entry.name}.json`, buildJsonSchema(entry, "strict"))
  }
  return out
}

/** Serialização estável usada nos arquivos (2 espaços + quebra de linha final). */
export function serializeJsonSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}
