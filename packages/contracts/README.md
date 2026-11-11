# @engemase/contracts

Contrato **gateway ↔ nuvem v1** (`/api/gateway/v1`), fonte da verdade do [docs/04](../../docs/04-protocolo-gateway-nuvem.md): schemas **Zod 4** e tipos TypeScript, **JSON Schema** gerado (draft 2020-12) e **fixtures** válidas e inválidas para os testes do agente Go.

## Conteúdo

| Pasta | O que tem |
|---|---|
| `src/` | Schemas e tipos: `enroll`, `sync` (lote, saúde, eventos, minutos, live, amostras), `config` (barramentos, dispositivos Modbus, blocos, tags, máquinas, uplink), `commands` (comandos, resultados e aprovações assinadas), `errors`, `limits`, `rules` |
| `schema/*.json` | JSON Schema **tolerante** (aceita campos novos): para validar em tempo de execução |
| `schema/strict/*.json` | JSON Schema **estrito** (`additionalProperties: false`): para testes, pega campo com nome errado |
| `fixtures/*.json` | Exemplos válidos e inválidos + `manifest.json` (o que cada um testa) + `test-keys.json` (chave pública de teste das aprovações) |
| `scripts/` | Geração do JSON Schema e das fixtures (as fixtures válidas são TS tipado contra o contrato) |

Schemas exportados: `enroll-request`, `enroll-response`, `sync-request`, `sync-response`, `gateway-config`, `command`, `command-envelope`, `command-result`, `error-response`, `vpn-approval-claims`, `ot-forward-approval-claims`.

## Uso

```ts
import { SyncRequestSchema, issuesFromZodError, apiError } from "@engemase/contracts"

const parsed = SyncRequestSchema.safeParse(body)
if (!parsed.success) return apiError("invalid_payload", "Payload inválido.", { issues: issuesFromZodError(parsed.error) })
```

O pacote exporta o código-fonte TS (sem build). No Next.js, incluir em `transpilePackages`.

## Regras principais

- **Ids** de entidade: UUID (a nuvem gera UUIDv7). **Eventos**: `id` UUIDv7 obrigatório (idempotência).
- **Timestamps**: ISO 8601 em UTC com `Z`. Minuto (`t`) começa no segundo zero.
- **Minuto fechado**: `run_s + stop_s + fault_s + setup_s + no_comm_s = 60` (tempo não observado vai em `no_comm_s`).
- **Lote**: até 2000 itens (events + minutes + samples), 1 MiB de JSON descompactado; `seq` dentro de `seq_from`–`seq_to`, sem repetição. Amostras podem ter fila própria (`samples_seq_*` → `ack_samples_seq`).
- **Modbus**: endereço `{area, offset}` base 0 (0–65535); unit id 1–247 em RTU (0–255 em TCP); bloco até 125 registradores ou 2000 bits; `word_order` obrigatório só em 32 bits; RTU com 8 bits de dados e `poll_ms` ≥ 200.
- **Comandos**: todo comando tem `expires_at` (validade ≤ 24 h); resultados levam `type`. Tipo desconhecido: o agente valida com `command-envelope` e responde `rejected`/`unsupported`.
- **VPN**: `vpn.enable` e `ot.forward.open` só com aprovação **JWS EdDSA** (claims em `vpn-approval-claims` / `ot-forward-approval-claims`).

### Regras semânticas (só no Zod)

Referências cruzadas, unicidade e somas não cabem em JSON Schema. Estão em `src/rules.ts` (`RULES`, com id e descrição); cada problema do Zod traz `params.rule`. **O agente Go precisa implementá-las**: no `manifest.json`, as fixtures com `layer: "semantic"` passam no JSON Schema e indicam a regra (`expect.rule`) que deve rejeitá-las.

## Para o agente Go

- Validador testado: `github.com/santhosh-tekuri/jsonschema/v6` **v6.0.3** (compila com Go 1.24). Com `AssertFormat()`, ele concorda com o ajv em todas as fixtures; os `pattern` são compatíveis com RE2.
- Em tempo de execução, use `schema/*.json` (tolerante); nos testes do que o agente produz, use `schema/strict/*.json`.
- `manifest.json`: `valid`, `layer` (`schema` | `semantic`), `expect.path` (com pontos, índices base 0), `expect.rule`, `derived_from` e `patch` aplicado.

## Testes e geração

```bash
pnpm --filter @engemase/contracts test          # Vitest: fixtures (Zod + ajv), regras, JSON Schema em dia
pnpm --filter @engemase/contracts typecheck
pnpm --filter @engemase/contracts build:schema  # regenera schema/
pnpm --filter @engemase/contracts build:fixtures # regenera fixtures/
```

Os testes falham se `schema/` ou `fixtures/` estiverem desatualizados em relação ao código.
