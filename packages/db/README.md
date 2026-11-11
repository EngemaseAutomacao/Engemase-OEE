# @engemase/db

Schema do banco (Drizzle ORM, **Postgres 18**), migrações SQL versionadas e **Row-Level Security por cliente**. Base: [docs/06](../../docs/06-banco-de-dados.md), [docs/15](../../docs/15-multi-cliente-e-acesso.md) (seções 4 e 9), [docs/12](../../docs/12-acesso-remoto-vpn.md) e [docs/13](../../docs/13-notificacoes-e-alertas.md).

## Como testar

```bash
pnpm --filter @engemase/db test        # Vitest + PGlite (Postgres 18 em WASM, sem servidor)
pnpm --filter @engemase/db typecheck
pnpm --filter @engemase/db db:generate # gera SQL a partir do schema (não precisa de banco)
```

Os testes aplicam as migrações num banco vazio e provam, com dois clientes completos (uma linha em **todas** as tabelas de cliente):

| Arquivo | O que garante |
|---|---|
| `test/catalog.test.ts` | Toda tabela com `organization_id` tem RLS **habilitada e forçada** e a política restritiva; FK sempre composta com o cliente; papéis sem `BYPASSRLS`; políticas permissivas só as previstas. Inclui um teste que cria uma tabela "esquecida" e confere que ela é pega |
| `test/rls.test.ts` | Com `app.org_id = A`: `SELECT` em cada tabela só mostra A; `INSERT`/`UPDATE`/`DELETE` em B bloqueados; sem cliente definido não se vê nada; GRANTs (auditoria só inserção, `client_account` só leitura) |
| `test/composite-fk.test.ts` | Impossível ligar o gateway de A a uma máquina de B (mesmo como dono do banco); tag só em máquina ligada ao gateway do dispositivo; gateway e máquina da mesma unidade |
| `test/lookups.test.ts` | Busca por hash de token antes de saber o cliente (gateway, ativação, terminal, tokens próprios) |
| `test/migrations.test.ts` | Migrações aplicam do zero e são idempotentes; **schema TS e migrações não divergem** (falha se esquecerem o `db:generate`) |
| `test/enums.test.ts` | "Enums" do banco iguais aos de `@engemase/contracts`; CHECKs recusam valores inválidos |

## Estrutura

```
src/schema/      tabelas por domínio (auth, assets, access, connectivity, production-*, alerts, remote-access)
src/tenancy.ts   withTenant(), papéis, lista das tabelas de cliente
src/lookups.ts   sha256Hex() e busca por hash de token (funções SECURITY DEFINER)
migrations/      0000_init.sql (drizzle-kit) e 0001_rls.sql (MANUAL: papéis, RLS, GRANTs, funções)
```

## Isolamento por cliente

- **Toda tabela com `organization_id` é tabela de cliente** (inclusive séries temporais). `organization_id` é `NOT NULL`, exceto em `audit_log` (eventos de plataforma).
- **RLS `ENABLE` + `FORCE`**, com `tenant_isolation` **restritiva** (`organization_id = app.current_org_id()`, que lê `current_setting('app.org_id', true)`) e `tenant_access` permissiva, ambas para `app_user`. Sem `app.org_id` na transação: zero linhas e nenhuma escrita.
- **FKs compostas** `(x_id, organization_id)` com `UNIQUE (id, organization_id)` nos pais. A hierarquia também amarra a unidade: área da linha, máquina ↔ gateway (`gateway_machine`) e tag ↔ máquina ligada ao gateway.
- **Uso na aplicação** (driver com transação interativa: `pg` com pool ou Neon via WebSocket, nunca o driver HTTP):

```ts
import { machine, withTenant } from "@engemase/db"

const machines = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(machine))
```

`withTenant` abre a transação, faz `SET LOCAL ROLE app_user` (padrão; falha alto se a conexão não puder assumir o papel) e `SELECT app.set_tenant(<uuid>)`, que recusa trocar de cliente no meio da transação.

### Papéis do banco (criados pela `0001_rls.sql`, todos `NOLOGIN` e sem `BYPASSRLS`)

| Papel | Para quê |
|---|---|
| `app_user` | Aplicação. Tabelas de cliente sob RLS; `"user"` só mostra membros do cliente atual; sem acesso a `session`/`account`/`verification` |
| `auth_service` | Better Auth: só as tabelas de identidade, enxergando `member`/`user` de todos os clientes (não apaga `organization`) |
| `app_lookup` | Dono das funções `app.resolve_*_token(hash)` (SECURITY DEFINER, `search_path` fixo). Lê só as colunas de credencial |

Na implantação, criar os usuários de login **por SQL** (não pelo console da Neon), sem segredo em migração, por exemplo `CREATE ROLE app_login LOGIN PASSWORD '…' IN ROLE app_user;`.

### Ao criar uma tabela nova

1. Declarar no `src/schema/` (com `organizationId()` e FKs compostas, se for de cliente) e rodar `pnpm db:generate`.
2. Numa migração manual (`pnpm exec drizzle-kit generate --custom --name <nome>`): `SELECT app.enable_tenant_rls('public.<tabela>');` e os `GRANT`s para `app_user`.
3. `pnpm test`: o teste de catálogo falha se faltar RLS ou se uma FK entre tabelas de cliente não for composta.

## Decisões

- **UUIDv7 gerado no banco** (`uuidv7()` nativo do Postgres 18; Neon e PGlite 0.5 já são 18). Eventos da borda trazem o próprio id.
- **"Enums" em `text` + `CHECK`** (evoluem sem `ALTER TYPE`). Os que vêm do contrato são espelhados em `src/schema/enums.ts`, com teste contra `@engemase/contracts`.
- **Colunas em snake_case explícito** (não dependemos da opção `casing` do Drizzle).
- **Tabelas a mais que os docs citam** e o fluxo precisa: `gateway_enrollment`, `serial_bus`, `gateway_device_status`, `tag_sample`, `notification_delivery`, `platform_assignment_unit`.
- **Sem cascata a partir de `organization`**: excluir um cliente é runbook (docs/15, seção 6).
- **Tabelas do Better Auth declaradas de forma mínima** (`src/schema/auth.ts`); serão geradas/ajustadas pelo Better Auth na W5, mantendo ids `uuid`.

## Pendências

- **Seed** a partir dos dados simulados do protótipo (`apps/web/lib/mock`): não feito. Caminho sugerido: mover os dados para um pacote compartilhado, mapear os ids de texto (`usr_ana`, `mch_...`) para UUIDs determinísticos e gravar como dono. O seed sintético de `test/fixtures.ts` já cobre todas as tabelas e pode virar a base do branch-semente de preview. Atenção: o mock tem o estado `PLANNED_STOP`, que no banco não é estado bruto (é classificação por motivo).
- **Script de migração contra a Neon** (`db:migrate` com `pg`) e bootstrap da organização "Engemase Lab" + primeiro super admin: dependem das contas (N1).
- **Particionamento** (`pg_partman`) de `production_minute` e `tag_sample`, e retenção (W2b).
- **Better Auth (W5):** gerar as tabelas definitivas (+ `two_factor`); decidir como "criar conta + membro + escopo na mesma transação" (docs/15, seção 5) convive com o papel `auth_service`.
- **Console da Engemase:** leituras entre clientes (lista de clientes, frota de gateways) e eventos de plataforma na auditoria precisam de um papel de plataforma próprio (ainda não criado).
- **Confirmar na Neon** se o papel dono das tabelas tem `BYPASSRLS` (com `FORCE`, sem ele o dono não lê dados de cliente; migrações de dados precisam disso).
- `machine_template` e `oee_hour` (F2/opcional) e `remote_access_recording` (Fase C) ainda não existem.
