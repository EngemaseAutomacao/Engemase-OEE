/**
 * Regras semânticas do contrato: validações que o JSON Schema não consegue expressar
 * (referências cruzadas, unicidade, somas, faixas que dependem de outro campo).
 *
 * O Zod aplica todas. O JSON Schema exportado NÃO aplica nenhuma delas: o agente Go
 * precisa implementá-las (as fixtures inválidas com `layer: "semantic"` cobrem cada uma).
 * Cada problema gerado aqui leva `params.rule` com o id da regra.
 */
import type { z } from "zod"

export const RULES = {
  // Endereçamento Modbus
  "address.bit_area": "Coils e discrete inputs só aceitam type \"bool\", sem \"bit\" e sem \"word_order\".",
  "address.register_bool_bit": "Em registrador, type \"bool\" exige \"bit\" (0–15).",
  "address.bit_only_bool": "\"bit\" só vale para type \"bool\" em registrador.",
  "address.word_order": "Tipos de 32 bits exigem \"word_order\"; bool e tipos de 16 bits não aceitam.",
  "address.range": "O endereço final (offset + registradores do tipo − 1) não pode passar de 65535.",
  // Blocos
  "block.range": "start + count − 1 não pode passar de 65535.",
  "block.overlap": "Blocos da mesma área no mesmo dispositivo não podem se sobrepor.",
  // Tags
  "tag.block_partial": "A tag não pode ficar parcialmente dentro de um bloco.",
  "tag.poll_source": "Tag fora de bloco exige poll_ms; tag dentro de bloco não pode ter poll_ms (vale o do bloco).",
  "tag.machine_ref": "machine_id da tag precisa existir em machines.",
  "tag.machine_required": "Tags com papel diferente de \"custom\" exigem machine_id.",
  "tag.role_type": "Tipo incompatível com o papel da tag.",
  "tag.role_unique": "No máximo uma tag por máquina e papel (exceto \"custom\").",
  "tag.sampling_role": "\"sampling\" só vale para os papéis \"custom\" e \"speed.actual\".",
  "tag.sampling_interval": "sampling.min_interval_s não pode ser maior que sampling.max_interval_s.",
  // Leitura
  "poll.rtu_min": "Em RTU, poll_ms mínimo é 200.",
  // Identidade e referências
  "ids.unique": "Ids repetidos (barramentos, dispositivos, tags ou máquinas).",
  "bus.ref": "params.bus do dispositivo RTU precisa existir em serial_buses.",
  "bus.port_unique": "Cada porta serial só pode estar em um barramento.",
  "bus.unit_unique": "unit_id repetido no mesmo barramento.",
  "tcp.endpoint_unique": "Dois dispositivos com o mesmo host, porta e unit_id.",
  "tcp.endpoint_protocol": "Dispositivos no mesmo host e porta precisam usar o mesmo protocolo (modbus-tcp ou modbus-rtu-over-tcp).",
  "limits.tags": "Máximo de 2000 tags por gateway.",
  // Máquinas
  "machine.mode_roles": "Papel obrigatório ausente: signals exige state.running; state_code exige state.code; count_derived exige count.total.",
  "machine.comm_loss": "comm_loss_after_s × 1000 deve ser ≥ 3 × o maior poll_ms das tags de estado/contador da máquina.",
  "machine.heartbeat": "heartbeat_timeout_s exige uma tag plc.heartbeat na máquina.",
  "machine.state_map": "O mapa de state_code precisa ter pelo menos um código.",
  // /sync
  "batch.seq_pair": "seq_from e seq_to vêm juntos e seq_from ≤ seq_to (idem para samples_seq_from/samples_seq_to).",
  "batch.seq_required": "Lote com events/minutes (ou samples sem fila própria) exige a faixa seq_from–seq_to.",
  "batch.seq_range": "O seq de cada item precisa estar dentro da faixa do lote.",
  "batch.seq_unique": "seq repetido no lote (na mesma fila).",
  "batch.items_max": "events + minutes + samples não podem passar de 2000 itens por lote.",
  "event.id_unique": "id de evento repetido no lote.",
  "minute.unique": "Minuto repetido (machine_id, t) no lote.",
  "minute.seconds_sum": "Em cada minuto fechado, run_s + stop_s + fault_s + setup_s + no_comm_s = 60.",
  "live.unique": "Mais de uma linha live para a mesma máquina.",
  "live.since": "state_since não pode ser posterior a at.",
  "sample.unique": "Amostra repetida (tag_id, at) no lote.",
  "device_status.unique": "Status repetido para o mesmo dispositivo.",
  "command_result.unique": "Resultado repetido para o mesmo comando.",
  // Comandos
  "command.expiry": "expires_at precisa ser posterior a issued_at, com validade de no máximo 24 h.",
  "command.unique": "Comando repetido (mesmo id) na resposta.",
  "scan.range": "Faixa de varredura inválida (início maior que o fim ou faixa grande demais).",
  "device_test.bus": "serial_bus só vale para modbus-rtu e precisa ter o mesmo id de params.bus.",
  "probe.range": "A leitura de teste não pode passar do offset 65535.",
  "interval.order": "O fim do período não pode ser anterior ao início.",
} as const

export type RuleId = keyof typeof RULES

export const RULE_IDS = Object.keys(RULES) as RuleId[]

/** Adiciona um problema semântico com `params.rule`. */
export function addRuleIssue(
  ctx: z.RefinementCtx,
  rule: RuleId,
  path: PropertyKey[],
  message: string = RULES[rule],
): void {
  ctx.addIssue({ code: "custom", message, path, params: { rule } })
}
