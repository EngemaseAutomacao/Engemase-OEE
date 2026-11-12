# 04 — Protocolo gateway ↔ nuvem (v1)

Contrato entre o `oee-gateway` e a API em `/api/gateway/v1`. A **fonte da verdade** é o pacote `packages/contracts`: schemas Zod, exportados como JSON Schema e usados pelos testes de contrato do agente Go.

## Princípios

- **HTTPS, somente saída**, porta 443. Respeita `HTTPS_PROXY` e CA corporativa, quando houver.
- **Um ciclo, uma requisição.** O `/sync` envia dados e saúde e recebe confirmação, comandos e aviso de config nova. Menos requisições significa menos custo e menos pontos de falha.
- **Idempotente.** Reenviar o mesmo lote não muda nada.
- **Compactado.** `Content-Encoding: gzip`. Limite de **1 MB por lote**, bem abaixo do limite de 4,5 MB do corpo de requisição das Vercel Functions.
- **Versionado** no path (`/v1`). Mudanças compatíveis (campos novos opcionais) não mudam a versão.
- **IDs em UUIDv7** em toda a API, os mesmos do banco ([06](06-banco-de-dados.md#convenções)). Nos exemplos, apelidos legíveis como `mch_inj03`, `dev_inj03` e `tag_temp1` (também no exemplo de config do [03](03-gateway.md#configuração-de-tags)) são **ilustrativos**: não existem IDs com prefixo (o `gw_live_` é prefixo do token, não de ID).

## Autenticação

| Etapa | Mecanismo |
|---|---|
| Provisionamento | Código de ativação de uso único (8 caracteres, expira em 24 h, guardado como hash) |
| Operação | `Authorization: Bearer <token>`. Token aleatório de 256 bits, guardado **somente como hash SHA-256** no banco |
| Revogação | Pela web. A próxima chamada recebe `401` e o agente para de enviar e registra o erro |
| Rotação | Comando `token.rotate`: o agente recebe o novo token e o antigo vale por mais 10 min |

Cabeçalhos enviados em toda chamada:

```
Authorization: Bearer gw_live_...
User-Agent: oee-gateway/1.2.0 (linux; arm64)
Content-Type: application/json
Content-Encoding: gzip
```

## Endpoints

| Método | Rota | Uso |
|---|---|---|
| `POST` | `/api/gateway/v1/enroll` | Troca o código de ativação por credenciais |
| `POST` | `/api/gateway/v1/sync` | Ciclo principal: dados, saúde, resultados de comandos → ack, comandos, versão de config |
| `GET` | `/api/gateway/v1/config` | Config completa (com `If-None-Match` → `304`) |
| `GET` | `/api/gateway/v1/releases/latest?channel=stable&arch=arm64` | Metadados da versão-alvo (OTA mínimo do `oee-updater`, M4b/D29; ainda fora do contrato v1) |

### `POST /enroll`

```json
// requisição
{ "code": "ABCD-1234", "hostname": "egw-00042", "agent_version": "1.0.0",
  "hw": { "arch": "arm64", "model": "reComputer R1000", "mem_mb": 2048,
          "serial_number": "EGW-00042", "board_revision": "v1.1", "image_version": "2026.11.0",
          "profile": "recomputer-r1000", "serial_ports": ["rs485-1", "rs485-2", "rs485-3"] } }

// resposta 201
{ "gateway_id": "01a1599c-a300-7f51-9864-1073dc9781ca", "token": "gw_live_8f2c...", "org": "acme",
  "server_time": "2026-11-10T19:42:10.512Z" }
```

- O código aceita `ABCD-1234` ou `ABCD1234` (maiúsculas, A–Z e 0–9).
- Os campos opcionais de `hw` vêm da identidade gravada na bancada (`/data/identity/hw.json`, [16](16-projeto-do-gateway.md#4-caminhos-usuários-e-identidade-canônico)). As portas seriais são **lógicas** (`rs485-1..3`); o perfil do agente as mapeia para `/dev/ttyAMA2`, `/dev/ttyAMA3` e `/dev/ttyAMA5` no R1000.
- Erros: código inválido → `400 activation_code_invalid`; vencido ou já usado → `410 activation_code_expired` / `activation_code_used`. O técnico vê a mensagem na página local e pede um código novo.

### `POST /sync`

Frequência padrão: **a cada 10 s**. Há também um envio **imediato** quando a máquina muda de estado, com debounce de 1 s e no máximo um envio a cada 2 s (conta do pior caso do RNF02 em [02](02-arquitetura.md#d-visualização-ao-vivo)).

**Modo interativo:** quando há comando pendente para o gateway ou uma tela de comissionamento aberta, a resposta do `/sync` traz `next_sync_s = 1` por até 5 min; depois disso, ou quando a condição acaba, volta a 10. O agente usa o `next_sync_s` da última resposta. No "Ler agora" (`tag.read`), a primeira leitura pode levar até um ciclo normal (≤ 10 s), porque o comando só chega ao gateway na resposta do próximo `/sync`; as seguintes levam ~1–2 s.

```json
{
  "batch": { "seq_from": 18231, "seq_to": 18245, "sent_at": "2026-11-11T13:02:05.120Z" },
  "agent": {
    "version": "1.2.0", "uptime_s": 86400, "config_version": 42,
    "cpu_pct": 7.5, "mem_mb": 38, "disk_free_mb": 21000,
    "buffer_pending": 15, "clock_offset_ms": 12
  },
  "devices": [
    { "id": "01a1c5fc-7cc8-7651-8317-1ff4a6a3a450", "status": "connected", "latency_ms": 18, "errors_1m": 0 }
  ],
  "events": [
    { "id": "01a1cab3-2bea-7d21-9a40-2b1c5e8f0a11", "seq": 18240, "type": "state",
      "machine_id": "mch_inj03", "at": "2026-11-11T13:01:42.250Z",
      "state": "FAULT", "fault_code": 47, "previous_state": "RUNNING" }
  ],
  "minutes": [
    { "seq": 18241, "machine_id": "mch_inj03", "t": "2026-11-11T13:01:00Z",
      "run_s": 42, "stop_s": 0, "fault_s": 18, "setup_s": 0, "no_comm_s": 0,
      "total": 14, "reject": 1, "product": "PRD-001" }
  ],
  "live": [
    { "machine_id": "mch_inj03", "at": "2026-11-11T13:02:05.000Z",
      "state": "FAULT", "state_since": "2026-11-11T13:01:42.250Z",
      "fault_code": 47, "counter_total": 1048213, "product": "PRD-001" }
  ],
  "samples": [
    { "seq": 18245, "tag_id": "tag_temp1", "at": "2026-11-11T13:02:00Z", "v": 212.4 }
  ],
  "command_results": [
    { "id": "01a1cab3-6970-7128-a24b-e40ad23f0824", "type": "tag.read", "status": "ok",
      "result": { "value": 1048213, "quality": "good", "read_ms": 21 } }
  ]
}
```

Campos que não aparecem no exemplo, todos opcionais e compatíveis com a v1:

- `agent`: `config_status` (aplicando, observando, aplicada, rejeitada, revertida), `buffer_oldest_s`, `samples_pending`, `quarantined`, `temp_c`, `emmc_wear_pct`, `ntp_synced`, `boot_id`, `unclean_boots_24h`.
- `devices[]`: `timeouts_1m`, `exceptions_1m` (por código de exceção Modbus), `last_ok_at`, `last_error`. Estados: `connected`, `degraded`, `disconnected`, `disabled`.
- `buses[]`: saúde de cada barramento RS-485 (`status` `ok`/`degraded`/`port_unavailable`, `cycle_ms`, `busy_pct`, `overruns_1m`).
- **Fila própria de amostras:** as amostras podem ter faixa própria (`batch.samples_seq_from`–`samples_seq_to`), confirmada por `ack_samples_seq` na resposta. Assim, amostras descartáveis não seguram a confirmação de eventos e minutos. Sem essa faixa, as amostras usam a fila principal.
- Um `/sync` só de saúde (sem itens) manda apenas `batch.sent_at`.

**Tipos de evento** (`events[].type`, 15 no total):

| Tipo | Quando |
|---|---|
| `state` | Mudança de estado da máquina (com `previous_state` e, em falha, `fault_code`) |
| `product` | Troca de produto lida do CLP |
| `counter_reset` · `counter_jump` · `counter_rebaseline` | Contador zerado no CLP, salto acima do plausível, nova referência após troca de config |
| `agent_start` · `agent_stop` | Início e parada do agente (motivo: desligamento, reinício, atualização, erro) |
| `power_loss` · `power_restored` | Falta e volta de energia |
| `clock_jump` | Correção grande do relógio |
| `data_loss` · `buffer_corrupted` | Perda de dados por limite de retenção, buffer corrompido ou quarentena vencida |
| `config_applied` · `config_rejected` | Resultado da aplicação de uma config |
| `remote_access` | Início, fim e recusas de acesso remoto (VPN e encaminhamento OT) |

Limites por lote: 2000 itens (eventos + minutos + amostras), 256 fotos `live`, 50 resultados de comando, 64 dispositivos e 8 barramentos. Corpo de até 1 MiB descompactado.

Em cada minuto fechado, `run_s + stop_s + fault_s + setup_s + no_comm_s = 60`. O `setup_s` conta os segundos no estado `SETUP` (ex.: estado 3 do [bloco OEE padrão](11-integracao-modbus.md#3-bloco-oee-padrão-engemase)).

Resposta `200`:

```json
{
  "ack_seq": 18245,
  "server_time": "2026-11-11T13:02:05.410Z",
  "config": { "latest_version": 43 },
  "commands": [
    { "id": "01a1cab3-7cf8-7181-a54c-66175d9dc9f8", "type": "tag.read",
      "issued_at": "2026-11-11T13:02:05.300Z", "expires_at": "2026-11-11T13:04:05.300Z",
      "payload": { "device_id": "01a1c5fc-7cc8-7651-8317-1ff4a6a3a450",
                   "address": { "area": "holding_register", "offset": 1004 },
                   "type": "uint32", "word_order": "CDAB" } }
  ],
  "next_sync_s": 1,
  "min_agent_version": "1.0.0"
}
```

`next_sync_s` é 10 no ciclo normal e 1 no modo interativo (como neste exemplo, que entrega um comando). Quando as amostras têm fila própria, a resposta traz também `ack_samples_seq`. No máximo 20 comandos por resposta.

### Tipos de comando

Todo comando traz `id`, `type`, `payload`, `expires_at` e, opcionalmente, `issued_at`. O agente corrige o relógio pelo `server_time` antes de comparar: comando que chega depois de `expires_at` **não é executado** e volta com status `expired`. Validade máxima: 24 h.

| Tipo | Uso | Validade padrão | Prazo de execução | Fase |
|---|---|---|---|---|
| `tag.read` | Teste de leitura de um endereço, antes de salvar a tag ("Ler agora") | 2 min | 5 s | MVP |
| `device.test` | Testa a conexão com um CLP. Com `device_id`: dispositivo cadastrado. **Sem `device_id`:** IP ainda não cadastrado, só dentro da sub-rede OT, com liberação do firewall por 5 min, limite de taxa e auditoria. Em RTU com parâmetros novos, exige `allow_bus_pause` | 2 min | 10 s | MVP |
| `config.reload` | Força baixar e aplicar a config | 10 min | 60 s | MVP |
| `agent.restart` | Reinicia o serviço | 10 min | 10 s | MVP |
| `modbus.scan` | Varre unit ids de um barramento RS-485 ou uma faixa de registradores, para ajudar no comissionamento | 10 min | 120 s | F2 (contrato pronto) |
| `vpn.enable` · `vpn.disable` · `vpn.status` | Sessão de acesso remoto sob demanda, com aprovação assinada ([12](12-acesso-remoto-vpn.md)) | 5 min · 1 h · 2 min | 60 s · 30 s · 10 s | F2 (contrato pronto) |
| `ot.forward.open` · `ot.forward.close` | Encaminhamento temporário para um CLP pela VPN (portas sugeridas 502, 102, 44818) | 5 min · 1 h | 30 s | F2 (contrato pronto) |
| `logs.upload` · `log.level` | Envio das últimas linhas de log e nível de log, versões mínimas junto do OTA mínimo (D29) | — | — | M4b (fora do contrato v1, entram como campos novos) |
| `agent.update` · `token.rotate` | Atualização comandada pela nuvem e rotação de credencial. No MVP, o OTA mínimo é por consulta do `oee-updater` a `/releases/latest` | — | — | F2 (fora do contrato v1) |

**Resultados** (`command_results[]`): sempre com `id`, `type` e `status`. `ok` traz `result` tipado pelo `type`; `error`, `expired` e `rejected` trazem `error.code`. Um tipo que o agente não conhece ou ainda não implementa (os marcados F2, no agente do MVP) volta como `rejected` com `unsupported`, sem travar o `/sync`. Códigos de erro de comando: `unsupported`, `invalid_payload`, `expired`, `timeout`, `device_not_found`, `target_not_allowed`, `bus_not_found`, `bus_pause_required`, `port_unavailable`, `connection_failed`, `read_timeout`, `modbus_exception`, `decode_error`, `config_fetch_failed`, `config_invalid`, `policy_denied`, `approval_invalid`, `session_conflict`, `session_not_found`, `vpn_failed`, `internal_error`.

### `GET /config`

Devolve a config completa do gateway com `ETag`; com `If-None-Match` igual à versão atual, responde `304`. Decisões do contrato que valem para a config:

- **Protocolos:** `modbus-tcp`, `modbus-rtu` e `modbus-rtu-over-tcp` (quadro RTU com CRC dentro de TCP, típico de conversor serial↔Ethernet transparente).
- **Unit id:** 0–255 em Modbus TCP (normalmente 1); 1–247 em RTU e em RTU sobre TCP (0 é broadcast).
- **Serial:** `data_bits` é sempre 8 (7 bits é Modbus ASCII, fora do MVP); paridade N/E/O; 1 ou 2 stop bits.
- **Leitura:** até 125 registradores ou 2000 bits por leitura; polling mínimo de 100 ms em TCP e 200 ms em RTU; `uint32`/`int32`/`float32` exigem `word_order`.
- **Papel `plc.heartbeat`:** contador que o CLP incrementa. Com `heartbeat_timeout_s` na regra da máquina, heartbeat parado vira `NO_COMM` mesmo que o Modbus responda. Exige uma tag com esse papel.

## Regras de processamento na nuvem

| Dado | Persistência | Idempotência |
|---|---|---|
| `events` (`state`) | `machine_state_event` (fecha o intervalo anterior e abre o novo; aceita eventos fora de ordem) | `id` UUIDv7 gerado na borda → `ON CONFLICT (id) DO NOTHING` |
| `events` (`product`) | `production_run` | Por `id` |
| `events` (`remote_access`) | `remote_access_event` | Por `id` |
| `events` (os outros 12 tipos) | `audit_log`, com ator "gateway" e o `id` do evento como id da linha | Por `id` |
| `minutes` | `production_minute` (inclui `good`, quando o CLP tem contador de boas) | PK `(machine_id, bucket_start)` → upsert (a borda só envia minutos fechados) |
| `live` | `machine_live` (uma linha por máquina, com `speed`) | Upsert, só se `at` for mais novo que o gravado |
| `samples` | `tag_sample` (particionada, retenção curta) | PK `(tag_id, at)` → `DO NOTHING` |
| `agent`, `devices`, `buses` | `gateway` e `gateway_device_status` (última foto). Histórico de saúde resumido: F1 | Upsert |
| `command_results` | `gateway_command` | Por `id` |

Além disso:

- Se `minutes` ou `events` caem em um **turno já consolidado**, o turno é marcado como "sujo" (`oee_shift.dirty = true`) e recalculado pelo cron. Os horários do turno usam o fuso da unidade, inclusive turnos que atravessam a meia-noite. Ver [07](07-calculo-oee.md#dados-atrasados).
- Tudo de um `/sync` é gravado **em uma transação**. O `ack_seq` só é devolvido após o commit. O token é conferido de novo **dentro** da transação, junto com o bloqueio da linha do gateway: um token revogado ou rotacionado durante o envio não grava nada.
- A API valida que cada `machine_id`, `tag_id`, `device_id` e id de comando pertence ao gateway autenticado (vínculo `gateway_machine`, com `organization_id` e chaves compostas). Um gateway nunca escreve em máquina de outro gateway ou de outra organização.
  - Nos itens **da fila** (eventos, minutos, amostras), uma referência alheia devolve `400 unknown_reference` com o caminho do item, para o agente isolá-lo.
  - Na **foto do ciclo** (`live`, `devices`, `command_results`), a referência alheia é **ignorada em silêncio**: o agente não tem como isolar esses itens, e um 400 travaria a fila inteira.
- Timestamps no futuro além de `server_time` + 2 min são rejeitados (inclusive em `live`). Um minuto reenviado com valores diferentes é atualizado e a versão anterior vai para o `audit_log`; o **alerta** dessa reescrita é da F1.
- **Comandos:** cada resposta leva até 20 comandos abertos; os não respondidos são reenviados (o agente descarta repetidos pelo `id`). Comando vencido vira `expired`. Comando que não passa no schema do contrato (tipo fora da v1, payload inválido, validade acima de 24 h) é marcado `rejected` na nuvem e nunca é enviado.
- **`next_sync_s`:** 1 enquanto houver comando aberto com menos de 5 min; senão, o `sync_interval_s` da config publicada (padrão 10). O modo interativo da tela de comissionamento aberta é da F1.
- **Ainda não implementado na API:** `429` (fica com o Firewall da Vercel) e `409 config_outdated`.
- **Suspensão do cliente não interrompe a ingestão:** o gateway continua enviando e nada se perde ([15](15-multi-cliente-e-acesso.md#6-ciclo-de-vida-do-cliente)).

## Erros e retentativas

Toda resposta de erro (4xx/5xx, exceto `304`) tem o corpo `{ "error": { "code", "message", "retry_after_s"?, "issues"?, "request_id"? } }`. Em `invalid_payload`, `issues[]` traz o caminho do item e, quando houver, o id da regra violada (ex.: `minute.seconds_sum`).

| Código | HTTP | Significado | Ação do agente |
|---|---|---|---|
| — | `200` | OK | Remove da fila até `ack_seq` (e das amostras até `ack_samples_seq`) |
| `invalid_payload` | `400` | Schema ou regra semântica | **Isola o item problemático** (bisseção do lote), manda-o para quarentena e não trava a fila |
| `unknown_reference` | `400` | `machine_id`, `tag_id`, `device_id` ou comando que não pertence ao gateway | Isola o item |
| `timestamp_out_of_range` | `400` | Timestamp além de `server_time` + 2 min | Isola o item |
| `activation_code_invalid` | `400` | Código de ativação inválido | Mostra ao técnico |
| `unauthorized` · `token_revoked` | `401` | Token ausente, inválido ou revogado | Para de enviar, mantém o buffer, registra alarme local |
| `not_found` | `404` | Rota ou recurso inexistente | Mostra ao técnico |
| `config_outdated` | `409` | Config desatualizada para a operação | Baixa a config e tenta de novo |
| `activation_code_expired` · `activation_code_used` | `410` | Código vencido (24 h) ou já usado | Mostra ao técnico |
| `payload_too_large` | `413` | Lote acima de 1 MiB descompactado | Divide o lote ao meio |
| `unsupported_media_type` | `415` | Content-Type ou Content-Encoding errado | Mostra ao técnico |
| `rate_limited` | `429` | Limite de taxa | Respeita `Retry-After` |
| `internal_error` · `service_unavailable` | `500` · `503` | Falha temporária | Backoff exponencial com jitter (1 s → 5 min), mantendo o buffer |

Sem corpo reconhecível (proxy, rede), o agente decide pelo status HTTP com as mesmas regras.

## Evolução para MQTT (Fase 3)

O agente terá a interface `Uplink` desde o MVP:

```go
type Uplink interface {
    Sync(ctx context.Context, b Batch) (SyncResponse, error)
    FetchConfig(ctx context.Context, haveVersion int) (*Config, error)
}
```

Uma implementação `mqtt` pode publicar os mesmos payloads (ou Sparkplug B) num broker gerenciado. Os payloads JSON e as regras de idempotência acima continuam valendo. Muda só o transporte.
