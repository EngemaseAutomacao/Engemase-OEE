# PoC de carga — 100 gateways simulados (W3)

| | |
|---|---|
| **Para quê** | Saída da Fase 0 ([docs/09](../09-roadmap.md#fase-0-fundação-e-provas-de-conceito-3-semanas)): provar o driver de banco (`pg` com pool + pooler da Neon, transação interativa da RLS) e a API dos gateways com **100 gateways** ([docs/17 L12](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)), dentro da meta da L13: **99% dos `/sync` respondidos em menos de 1 s** |
| **Onde está** | `apps/web/test/poc/carga-gateways.test.ts` (roda com o Vitest, fora da suíte normal) · comando `pnpm --filter web poc:gateways` |
| **Pronto hoje** | Roda local com PGlite (sem servidor) ou com um Postgres 18 local; e contra qualquer endereço da API (ex.: `next start` local ou um preview da Vercel) |
| **Falta para o oficial** | Contas da Vercel e da Neon (N1), migrações aplicadas num branch da Neon (passo 6 do [docs/17 §7](../17-backlog-e-pendencias.md#7-próximos-10-passos-semana-de-16-a-20112026)) e o deploy de preview com `DATABASE_URL` |
| **Quem roda** | Engenharia (N2). Nunca contra a produção |

## 1. O que o teste faz

1. **Seed:** cria N clientes, cada um com um gateway **ativo** (token), 3 máquinas, 1 CLP Modbus TCP, 2 escravos RTU num barramento RS-485 e a config publicada — a config de exemplo do contrato (`packages/contracts/fixtures/gateway-config.valid.tcp-and-rtu-bus.json`) com ids novos por gateway. Slug dos clientes: `poc-<rodada>-001`…
2. **Gateways simulados** (todos ao mesmo tempo, com início espalhado no intervalo), como o agente Go faz:
   - `GET /api/gateway/v1/config` (resposta validada com o `GatewayConfigSchema`);
   - `POST /api/gateway/v1/sync` a cada `POC_INTERVALO_MS`, `POC_CICLOS` vezes, com gzip e `Authorization: Bearer`. Cada `/sync` leva a saúde do agente, dos 3 CLPs e do barramento, o **live** das 3 máquinas, **um evento de estado** por máquina e **um minuto fechado** por máquina. O corpo é montado e validado com o `SyncRequestSchema` e a resposta com o `SyncResponseSchema` (`ack_seq` tem de ser igual ao `seq_to` do lote).
3. **Medidas por rota** (`config` e `sync`): total, erros, status HTTP, p50, p95, p99 e máximo em ms (do lado do gateway: rede + função + banco).
4. **Conferência no banco:** cada gateway gravou exatamente `3 máquinas × POC_CICLOS` minutos em `production_minute` (sem perda nem duplicata).
5. **Passa** se não houve erro (`POC_MAX_ERROS`, padrão 0), todos os `/sync` foram feitos e o **p99 do `/sync` ≤ `POC_META_P99_MS`** (padrão 1000 ms).

A carga por gateway é **mais pesada que a real**: o agente manda um minuto por máquina a cada 6 `/sync` (60 s / 10 s); o teste manda um minuto em todo `/sync`. Com 100 gateways a cada 10 s são **10 `/sync` por segundo**, 30 minutos gravados por segundo.

O teste **não** sobe o agente Go nem o `tools/plc-sim`: a cadeia completa (CLP simulado → agente → API → banco) é o teste ponta a ponta (`pnpm --filter web test:e2e`, job `e2e` do CI). Aqui o alvo é a API e o banco sob carga.

## 2. Variáveis

Todas opcionais (lista também no `apps/web/.env.example`):

| Variável | Padrão | O que é |
|---|---|---|
| `POC_N` | 5 | Gateways simulados |
| `POC_CICLOS` | 5 | `/sync` por gateway |
| `POC_INTERVALO_MS` | 1000 | Intervalo entre os `/sync` de um gateway (o agente usa 10000) |
| `POC_API_URL` | — | API de fora (ex.: `https://<preview>.vercel.app`). Sem ela, a API roda no próprio processo (`node:http` com os handlers dos `route.ts`) |
| `POC_DATABASE_URL` | — | Postgres do seed e da conferência, **como dono das tabelas** (a RLS não deixa o `app_user` criar clientes). Sem ela, PGlite em memória |
| `POC_DATABASE_URL_APP` | `POC_DATABASE_URL` | Só com a API no processo: conexão que a API usa (usuário membro de `app_user`, como em produção) |
| `POC_POOL_MAX` | 5 | Pool da API no processo (o mesmo papel do `DATABASE_POOL_MAX`) |
| `POC_MIGRAR` | — | `1` aplica as migrações em `POC_DATABASE_URL` antes (banco vazio) |
| `POC_META_P99_MS` | 1000 | p99 máximo aceito do `/sync` |
| `POC_MAX_ERROS` | 0 | Erros aceitos |
| `POC_RELATORIO` | — | Caminho de um JSON com o resultado (anexar ao registro do PoC) |

## 3. Rodar local (hoje)

Na raiz do monorepo, depois de `pnpm install`:

**a) PGlite, sem servidor** (confere a lógica; o PGlite tem uma conexão só, então os tempos não valem como medida):

```bash
pnpm --filter web poc:gateways
```

**b) Postgres 18 local com o driver `pg`** (o mesmo de produção). As migrações usam `uuidv7()`, que só existe a partir do Postgres 18:

```bash
docker run -d --name oee-poc -p 55432:5432 -e POSTGRES_PASSWORD=poc postgres:18
docker exec oee-poc createdb -U postgres poc
POC_N=20 POC_MIGRAR=1 POC_DATABASE_URL=postgres://postgres:poc@127.0.0.1:55432/poc \
  pnpm --filter web poc:gateways
```

Rodando de novo no mesmo banco, tire o `POC_MIGRAR=1` (as migrações já estão lá; cada rodada cria clientes novos). O usuário `postgres` é superusuário: a API assume o `app_user` com `SET LOCAL ROLE` dentro de cada transação, como em produção, mas não prova as permissões do usuário de login — isso fica para a Neon (seção 4).

**c) Pelo Next.js de verdade** (rotas, `getDb()` e o pool de `lib/server/db.ts`):

```bash
pnpm --filter web build
DATABASE_URL=postgres://postgres:poc@127.0.0.1:55432/poc pnpm --filter web start --port 3200
# em outro terminal:
POC_N=100 POC_CICLOS=3 POC_INTERVALO_MS=10000 POC_API_URL=http://127.0.0.1:3200 \
  POC_DATABASE_URL=postgres://postgres:poc@127.0.0.1:55432/poc pnpm --filter web poc:gateways
```

Resultado de referência (24/11/2026, contêiner de desenvolvimento, Postgres 16 local com uma função `uuidv7()` provisória, `next start`, 100 gateways × 3 ciclos a cada 10 s): **400 requisições, 0 erros**, `/sync` p50 45 ms · p95 139 ms · p99 454 ms; 900 de 900 minutos gravados. Serve só para saber que o roteiro funciona: o número que vale é o da seção 4.

## 4. Rodar o oficial (quando a Neon e a Vercel existirem)

**Antes**

1. Na Neon, criar um **branch próprio para o PoC** (ex.: `poc-100-gateways`), a partir do branch de preview já migrado — nunca o de produção. Ele é descartado no fim.
2. Conferir no branch (passo 6 do [docs/17 §7](../17-backlog-e-pendencias.md#7-próximos-10-passos-semana-de-16-a-20112026)): o papel de login da aplicação é membro de `app_user`; o dono das tabelas não tem `BYPASSRLS`.
3. Na Vercel, um **deploy de preview** com `DATABASE_URL` = URL **com pooler** (`-pooler`) do branch do PoC, com o usuário de login da aplicação. Região da função: `gru1` (`apps/web/vercel.json`).
4. Se o preview tiver **Deployment Protection** (Vercel Authentication), o gateway simulado não passa. Use um *Protection Bypass for Automation* e mande o cabeçalho — ou desligue a proteção só durante o PoC e religue no fim. Anote qual foi usado.
5. Rodar de uma máquina **no Brasil** (escritório da Engemase), para a latência parecer a de uma planta. Do runner do GitHub (EUA) o p99 sai pior do que o real.

**Rodar** (o seed usa a URL **direta** do branch com o **dono** das tabelas; o comando não aplica migração):

```bash
POC_N=100 POC_CICLOS=30 POC_INTERVALO_MS=10000 \
POC_API_URL=https://<deploy-de-preview>.vercel.app \
POC_DATABASE_URL='postgres://<dono>:<senha>@<host-direto-do-branch>/<banco>?sslmode=require' \
POC_RELATORIO=poc-100-gateways.json \
pnpm --filter web poc:gateways
```

São 5 minutos de carga (30 × 10 s) mais o seed (~30 INSERTs por gateway, 5 em paralelo). Para a primeira rodada, comece com `POC_N=10`. Depois das 100, repita com `POC_INTERVALO_MS=1000` (equivale a 1.000 gateways no intervalo normal) para achar o limite.

**Olhar durante e depois**

| Onde | O quê |
|---|---|
| Saída do teste | Tabela por rota (p50/p95/p99/máx, status) e "minutos gravados X de Y" |
| Vercel → Observability / Logs | Duração das funções `/api/gateway/v1/sync`, *cold starts*, erros 5xx, instâncias simultâneas |
| Neon → Monitoring | Conexões no pooler, CPU do compute, tempo de consulta. Conexões abertas ≈ instâncias × `DATABASE_POOL_MAX` |
| `POC_RELATORIO` | JSON com tudo, para anexar ao registro |

**Critério de aprovação** (W3, docs/09 Fase 0):

- 0 erros em 100 gateways × 30 ciclos (3.000 `/sync`) e todos os minutos gravados;
- `/sync` com **p99 < 1 s** (L13);
- nenhum erro de conexão do pooler (`too many connections`, `timeout exceeded when trying to connect`).

Se o p99 passar de 1 s: olhar primeiro o *cold start* (primeiro `/sync` de cada instância), depois o tempo de consulta na Neon e só então o `DATABASE_POOL_MAX`. O driver serverless da Neon via WebSocket é a alternativa prevista no docs/09; o driver HTTP não serve (a RLS exige transação interativa, `apps/web/lib/server/db.ts`).

**Depois**

1. Registrar o resultado (data, commit, região, N, ciclos, p50/p95/p99, erros, conexões máximas na Neon) no `docs/00-status.md` ou no PR do W3, com o JSON anexado.
2. Apagar o branch da Neon do PoC (leva junto os clientes `poc-*`) e religar a proteção do preview se ela foi desligada.

## 5. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `function uuidv7() does not exist` | Postgres abaixo do 18. Use o `postgres:18` (a Neon já é 18) |
| Todas as requisições com 503 `service_unavailable` | Deploy sem `DATABASE_URL` |
| 401 em tudo | Seed num banco diferente do que a API usa (confira o branch da Neon nas duas URLs) |
| HTML de login da Vercel em vez de JSON | *Deployment Protection* ligada (seção 4, item 4) |
| `permission denied` no seed | `POC_DATABASE_URL` com o usuário da aplicação: o seed precisa do dono das tabelas |
| `timestamp no futuro` (400) | Relógio da máquina que roda o teste adiantado mais de 2 min em relação ao servidor |
