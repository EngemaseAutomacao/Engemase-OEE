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
| `GET` | `/api/gateway/v1/releases/latest?channel=stable&arch=arm64` | Metadados da versão-alvo (OTA, F2) |

### `POST /enroll`

```json
// requisição
{ "code": "ABCD-1234", "hostname": "gw-planta1-linhaA", "agent_version": "1.0.0",
  "hw": { "arch": "arm64", "model": "reComputer R1000", "mem_mb": 4096 } }

// resposta 201
{ "gateway_id": "01a1c5d4-9208-752e-89a7-834df2a74de4", "token": "gw_live_8f2c...", "org": "acme" }
```

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
      "state": "FAULT", "fault_code": 47 }
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
    { "id": "01a1cab3-6970-7128-a24b-e40ad23f0824", "status": "ok", "result": { "value": 1048213, "quality": "good", "read_ms": 21 } }
  ]
}
```

Em cada minuto fechado, `run_s + stop_s + fault_s + setup_s + no_comm_s = 60`. O `setup_s` conta os segundos no estado `SETUP` (ex.: estado 3 do [bloco OEE padrão](11-integracao-modbus.md#3-bloco-oee-padrão-engemase)).

Resposta `200`:

```json
{
  "ack_seq": 18245,
  "server_time": "2026-11-11T13:02:05.410Z",
  "config": { "latest_version": 43 },
  "commands": [
    { "id": "01a1cab3-7cf8-7181-a54c-66175d9dc9f8", "type": "tag.read",
      "payload": { "device_id": "01a1c5fc-7cc8-7651-8317-1ff4a6a3a450",
                   "address": { "area": "holding_register", "offset": 1004 },
                   "type": "uint32", "word_order": "CDAB" } }
  ],
  "next_sync_s": 1,
  "min_agent_version": "1.0.0"
}
```

`next_sync_s` é 10 no ciclo normal e 1 no modo interativo (como neste exemplo, que entrega um comando).

### Tipos de comando

| Tipo | Uso | Fase |
|---|---|---|
| `tag.read` | Teste de leitura de um endereço, antes de salvar a tag | MVP |
| `device.test` | Testa a conexão com um CLP (IP e parâmetros) | MVP |
| `config.reload` | Força baixar e aplicar a config | MVP |
| `agent.restart` | Reinicia o serviço | MVP |
| `modbus.scan` | Varre unit ids de um barramento RS-485 ou faixa de registradores, para ajudar no comissionamento | F2 |
| `agent.update` | Atualiza para a versão indicada (OTA) | F2 |
| `token.rotate` | Rotação de credencial | F2 |
| `logs.upload` | Envia as últimas N linhas de log para diagnóstico | F2 |

Comandos têm **expiração** (ex.: 2 min para `tag.read`). Um comando expirado não é executado.

## Regras de processamento na nuvem

| Dado | Persistência | Idempotência |
|---|---|---|
| `events` | `machine_state_event` (fecha o intervalo anterior e abre o novo) | `id` UUIDv7 gerado na borda → `ON CONFLICT (id) DO NOTHING` |
| `minutes` | `production_minute` | PK `(machine_id, bucket_start)` → upsert (a borda só envia minutos fechados) |
| `live` | `machine_live` (uma linha por máquina) | Upsert, só se `at` for mais novo que o gravado |
| `samples` | `tag_sample` (particionada, retenção curta) | PK `(tag_id, at)` → `DO NOTHING` |
| `agent`, `devices` | `gateway` e `gateway_device_status` (última foto) + histórico de saúde resumido | Upsert |
| `command_results` | `gateway_command` | Por `id` |

Além disso:

- Se `minutes` ou `events` caem em um **turno já consolidado**, o turno é marcado como "sujo" (`oee_shift.dirty = true`) e recalculado pelo cron. Ver [07](07-calculo-oee.md#dados-atrasados).
- Tudo de um `/sync` é gravado **em uma transação**. O `ack_seq` só é devolvido após o commit.
- A API valida que cada `machine_id` e `tag_id` pertence ao gateway autenticado (vínculo `gateway_machine`, com `organization_id` e chaves compostas). Um gateway nunca escreve em máquina de outro gateway ou de outra organização.
- Timestamps no futuro além de uma tolerância (ex.: `server_time` + 2 min) são rejeitados; reescrita de um minuto já gravado com valor diferente gera alerta e guarda a versão anterior.
- **Suspensão do cliente não interrompe a ingestão:** o gateway continua enviando e nada se perde ([15](15-multi-cliente-e-acesso.md#6-ciclo-de-vida-do-cliente)).

## Erros e retentativas

| Código | Significado | Ação do agente |
|---|---|---|
| `200` | OK | Remove da outbox até `ack_seq` |
| `400` | Payload inválido | Registra erro, **isola o item problemático** (envia os itens um a um para achar o culpado), não trava a fila |
| `401` | Token inválido ou revogado | Para de enviar, mantém o buffer, registra alarme local |
| `409` | Config desatualizada para a operação | Baixa a config e tenta de novo |
| `413` | Lote grande demais | Divide o lote ao meio |
| `429` | Limite de taxa | Respeita `Retry-After` |
| `5xx` / rede | Falha temporária | Backoff exponencial com jitter (1 s → 5 min), mantendo o buffer |

## Evolução para MQTT (Fase 3)

O agente terá a interface `Uplink` desde o MVP:

```go
type Uplink interface {
    Sync(ctx context.Context, b Batch) (SyncResponse, error)
    FetchConfig(ctx context.Context, haveVersion int) (*Config, error)
}
```

Uma implementação `mqtt` pode publicar os mesmos payloads (ou Sparkplug B) num broker gerenciado. Os payloads JSON e as regras de idempotência acima continuam valendo. Muda só o transporte.
