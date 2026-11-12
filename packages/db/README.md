# @engemase/db

Schema do banco (Drizzle ORM, **Postgres 18**), migrações SQL versionadas e **Row-Level Security por cliente**. Base: [docs/06](../../docs/06-banco-de-dados.md), [docs/15](../../docs/15-multi-cliente-e-acesso.md) (seções 2, 3, 4 e 9), [docs/12](../../docs/12-acesso-remoto-vpn.md) e [docs/13](../../docs/13-notificacoes-e-alertas.md).

## Como testar

```bash
pnpm --filter @engemase/db test        # Vitest + PGlite (Postgres 18 em WASM, sem servidor)
pnpm --filter @engemase/db typecheck
pnpm --filter @engemase/db db:generate # gera SQL a partir do schema (não precisa de banco)
```

Os testes aplicam as migrações num banco vazio e provam, com dois clientes completos (uma linha em **todas** as tabelas de cliente):

| Arquivo | O que garante |
|---|---|
| `test/catalog.test.ts` | Toda tabela com `organization_id` tem RLS **habilitada e forçada** e a política restritiva; **toda tabela que o `app_user` pode ler** (inclusive `organization` e `"user"`) tem RLS forçada; FK sempre composta com o cliente; papéis sem `BYPASSRLS`; políticas permissivas só as previstas; funções SECURITY DEFINER donas `app_lookup`, com `search_path` fixo e EXECUTE só para `app_user`. Inclui testes que criam tabelas "esquecidas" e conferem que elas são pegas |
| `test/rls.test.ts` | Com `app.org_id = A`: `SELECT` em cada tabela (e em `organization`) só mostra A; `INSERT`/`UPDATE`/`DELETE` em B bloqueados; sem cliente definido não se vê nada; GRANTs (auditoria só inserção, `client_account` só leitura, `organization` só leitura). Caso próprio para o escopo por máquina (`member_machine`). Também fixa o **limite** documentado abaixo (`set_config` direto troca o cliente) |
| `test/composite-fk.test.ts` | Impossível ligar o gateway de A a uma máquina de B (mesmo como dono do banco); tag só em máquina ligada ao gateway do dispositivo; gateway e máquina da mesma unidade; escopo de pessoa (`member_unit`, `member_machine`) só com unidade/máquina do mesmo cliente; estorno de qualidade só de lançamento existente do mesmo cliente |
| `test/lookups.test.ts` | Busca por hash de token antes de saber o cliente (gateway, ativação, terminal, tokens próprios), **estado** da credencial (código usado/vencido, token revogado/rotacionado) e slug da URL → cliente |
| `test/migrations.test.ts` | Migrações aplicam do zero e são idempotentes; **schema TS e migrações não divergem** (falha se esquecerem o `db:generate`); a 0005 liga `managed_by_engemase` dos clientes que já existiam mesmo com um dono de tabelas **sem `BYPASSRLS`** (como na Neon) |
| `test/enums.test.ts` | "Enums" e faixas do banco iguais aos de `@engemase/contracts` (inclusive `fault_code` uint32 em `bigint` e o formato do slug do cliente, `org` do /enroll); campos de minuto/live do contrato têm coluna; CHECKs recusam valores inválidos (escopo `machines` aceito, admin só com `all`, concessão de suporte sem aprovação, limites inteiros >= 0) |

## Estrutura

```
src/schema/      tabelas por domínio (auth, assets, access, connectivity, production-*, alerts, remote-access)
src/tenancy.ts   withTenant(), papéis, lista das tabelas de cliente
src/lookups.ts   sha256Hex(), busca por hash de token (e estado da credencial) e por slug (funções SECURITY DEFINER)
migrations/      0000_init.sql (drizzle-kit) e 0001_rls.sql (MANUAL: papéis, RLS, GRANTs, funções)
                 0002_contract_columns_quality_reversal.sql (drizzle-kit, com o UNIQUE movido para antes da FK)
                 0003_organization_rls_state_lookups.sql (MANUAL: RLS em organization, funções de estado e slug)
                 0004_organization_slug_check.sql (drizzle-kit: formato do slug; + COMMENT manual do limite da RLS)
                 0005_member_machine_owner_decisions.sql (drizzle-kit + MANUAL: member_machine com RLS,
                   decisões D1, D5, D11 e D13; liga managed_by_engemase dos clientes existentes)
```

## Isolamento por cliente

- **Toda tabela com `organization_id` é tabela de cliente** (inclusive séries temporais). `organization_id` é `NOT NULL`, exceto em `audit_log` (eventos de plataforma).
- **RLS `ENABLE` + `FORCE`**, com `tenant_isolation` **restritiva** (`organization_id = app.current_org_id()`, que lê `current_setting('app.org_id', true)`) e `tenant_access` permissiva, ambas para `app_user`. Sem `app.org_id` na transação: zero linhas e nenhuma escrita.
- **FKs compostas** `(x_id, organization_id)` com `UNIQUE (id, organization_id)` nos pais. A hierarquia também amarra a unidade: área da linha, máquina ↔ gateway (`gateway_machine`) e tag ↔ máquina ligada ao gateway.
- **Slug do cliente no formato do contrato** (`organization_slug_chk`, `ORG_SLUG_PATTERN` em `src/schema/enums.ts`): é o `org` que o /enroll devolve ao gateway. Quem cria cliente (Better Auth, console) deve validar antes de gravar; o banco recusa o resto.
- **`organization` também tem RLS forçada:** o `app_user` só enxerga o cliente da transação (`id = app.current_org_id()`); sem cliente, nenhum. Para resolver o slug da URL antes de saber o cliente: `resolveOrganizationSlug(db, slug)` (`app.resolve_org_slug`), que devolve só o id — e não autoriza nada (o vínculo se confere depois, com `withTenant`).
- **Uso na aplicação** (driver com transação interativa: `pg` com pool ou Neon via WebSocket, nunca o driver HTTP):

```ts
import { machine, withTenant } from "@engemase/db"

const machines = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(machine))
```

`withTenant` abre a transação, faz `SET LOCAL ROLE app_user` (padrão; falha alto se a conexão não puder assumir o papel) e `SELECT app.set_tenant(<uuid>)`, que recusa trocar de cliente no meio da transação.

> **Limite da RLS por cliente (aceito pelo dono do produto em 12/11/2026, D38):** ela protege contra **bug do app** (consulta sem `WHERE`, `withTenant` esquecido, id de outro cliente vindo da URL), **não contra SQL arbitrário rodando como `app_user`** (injeção de SQL). `app.org_id` é um parâmetro de sessão comum: qualquer papel o altera com `set_config('app.org_id', …, true)` ou `SET LOCAL`, sem passar por `app.set_tenant` — a recusa de trocar de cliente só vale para quem chama `app.set_tenant`. Por isso todo SQL do app vai **parametrizado** (Drizzle ou `sql` com parâmetros), nunca concatenado. O `COMMENT` de `app.set_tenant`/`app.current_org_id` (0004) e um teste em `test/rls.test.ts` registram o limite. Isolamento mais forte, se for preciso: cliente amarrado a algo que o `app_user` não forja (ex.: `set_tenant` SECURITY DEFINER validando um valor assinado pelo servidor) ou papéis por cliente.

### Papéis do banco (criados pela `0001_rls.sql`, todos `NOLOGIN` e sem `BYPASSRLS`)

| Papel | Para quê |
|---|---|
| `app_user` | Aplicação. Tabelas de cliente sob RLS; `"user"` só mostra membros do cliente atual; sem acesso a `session`/`account`/`verification` |
| `auth_service` | Better Auth: só as tabelas de identidade, enxergando `member`/`user`/`organization` de todos os clientes (não apaga `organization`) |
| `app_lookup` | Dono das funções `app.resolve_*` (SECURITY DEFINER, `search_path` fixo, EXECUTE só para `app_user`). Lê só as colunas de credencial e `organization (id, slug)` |

### Buscas antes de saber o cliente (`src/lookups.ts`)

| Função SQL | Helper TS | Devolve |
|---|---|---|
| `app.resolve_gateway_token(hash)` | `resolveByTokenHash(db, "gatewayToken", h)` | `(id, organization_id)` só de token válido (atual ou anterior na janela) |
| `app.resolve_gateway_token_state(hash)` | `resolveGatewayTokenState(db, h)` | `(id, organization_id, state)`: `active` · `previous` (autenticam) · `rotated` · `pending_enrollment` (401 `unauthorized`) · `revoked` (401 `token_revoked`) |
| `app.resolve_gateway_enrollment(hash)` | `resolveByTokenHash(db, "gatewayEnrollment", h)` | `(id, organization_id)` só de código válido |
| `app.resolve_gateway_enrollment_state(hash)` | `resolveGatewayEnrollmentState(db, h)` | `(id, organization_id, gateway_id, state)`: `valid` · `used` / `expired` (410) · `gateway_revoked` (400 `activation_code_invalid`) |
| `app.resolve_terminal_token(hash)` · `app.resolve_account_token(hash)` | `resolveByTokenHash(db, "terminalToken" \| "accountToken", h)` | `(id, organization_id)` só de token válido |
| `app.resolve_org_slug(slug)` | `resolveOrganizationSlug(db, slug)` | `(id)` do cliente |

Nenhuma linha = segredo desconhecido (400 `activation_code_invalid` / 401 `unauthorized`). Os ids dos estados não válidos servem para auditoria e **nunca** voltam na resposta ao gateway. Para o `token_revoked` funcionar, a revogação do gateway deve manter o `token_hash`.

Na implantação, criar os usuários de login **por SQL** (não pelo console da Neon), sem segredo em migração, por exemplo `CREATE ROLE app_login LOGIN PASSWORD '…' IN ROLE app_user;`.

### Ao criar uma tabela nova

1. Declarar no `src/schema/` (com `organizationId()` e FKs compostas, se for de cliente) e rodar `pnpm db:generate`.
2. Numa migração manual (`pnpm exec drizzle-kit generate --custom --name <nome>`): `SELECT app.enable_tenant_rls('public.<tabela>');` e os `GRANT`s para `app_user`.
3. `pnpm test`: o teste de catálogo falha se faltar RLS ou se uma FK entre tabelas de cliente não for composta.

**Ajustar dados de tabela de cliente numa migração:** com a RLS forçada, o dono das tabelas sem `BYPASSRLS` não enxerga nenhuma linha, e um `UPDATE` simples passa sem fazer nada. Use o padrão da 0005: `ALTER TABLE x NO FORCE ROW LEVEL SECURITY` → `UPDATE` → `ALTER TABLE x FORCE ROW LEVEL SECURITY`, tudo na transação da migração (o migrator do Drizzle aplica numa transação só). O teste de catálogo pega se o `FORCE` não voltar.

## Decisões

- **UUIDv7 gerado no banco** (`uuidv7()` nativo do Postgres 18; Neon e PGlite 0.5 já são 18). Eventos da borda trazem o próprio id.
- **"Enums" em `text` + `CHECK`** (evoluem sem `ALTER TYPE`). Os que vêm do contrato são espelhados em `src/schema/enums.ts`, com teste contra `@engemase/contracts`.
- **Colunas em snake_case explícito** (não dependemos da opção `casing` do Drizzle).
- **Tabelas a mais que os docs citam** e o fluxo precisa: `gateway_enrollment`, `serial_bus`, `gateway_device_status`, `tag_sample`, `notification_delivery`, `platform_assignment_unit`.
- **Sem cascata a partir de `organization`**: excluir um cliente é runbook (docs/15, seção 6).
- **Decisões do dono do produto de 12/11/2026** (docs/15):
  - **D11, escopo por máquina:** `member_access.scope` é `all`, `units` ou `machines`; as máquinas ficam em `member_machine` (FKs compostas, RLS forçada). Fail-closed: escopo `units`/`machines` sem nenhuma linha = nenhum acesso. O admin do cliente fica sempre com `all` (`member_access_admin_scope_chk`). Os agregados que respeitam o escopo são regra da camada de acesso a dados, não do banco.
  - **D12/D13, gestão:** o admin do cliente grava só usuários (`member`, `member_access`, `member_unit`, `member_machine`); o resto da configuração é da equipe Engemase. `client_account.managed_by_engemase` tem padrão `true` (todo cliente é gerenciado no MVP). O banco isola por cliente; quem pode o quê dentro do cliente é regra da aplicação.
  - **D5, acesso da Engemase:** sempre liberado com registro. `support_access_grant` nasce `active`, sem estados `requested`/`denied` nem colunas de aprovação. A aprovação de sessões de acesso remoto (`remote_access_*`, D20) não mudou.
  - **D1, cobrança por máquina com planos:** `client_account.plan` (texto) e `limits.machines` (máquinas contratadas). Valores de `limits` são inteiros >= 0 (`client_account_limits_chk`). Preços ficam fora do banco; não há tabela de faturamento.
  - **D38:** RLS por variável de sessão aceita, com o limite descrito em "Isolamento por cliente".
- **Tabelas do Better Auth declaradas de forma mínima** (`src/schema/auth.ts`); serão geradas/ajustadas pelo Better Auth na W5, mantendo ids `uuid`.

## Pendências

- **Seed** a partir dos dados simulados do protótipo (`apps/web/lib/mock`): não feito. Caminho sugerido: mover os dados para um pacote compartilhado, mapear os ids de texto (`usr_ana`, `mch_...`) para UUIDs determinísticos e gravar como dono. O seed sintético de `test/fixtures.ts` já cobre todas as tabelas e pode virar a base do branch-semente de preview. Atenção: o mock tem o estado `PLANNED_STOP`, que no banco não é estado bruto (é classificação por motivo).
- **Script de migração contra a Neon** (`db:migrate` com `pg`) e bootstrap da organização "Engemase Lab" + primeiro super admin: dependem das contas (N1). O projeto Neon fica em AWS `sa-east-1` (São Paulo, D7).
- **Particionamento** (`pg_partman`) de `production_minute` e `tag_sample`, e retenção (W2b). Retenção decidida (D6, 12/11/2026): `production_minute` por **2 anos** e `audit_log` por **5 anos** (docs/06, "Volume, particionamento e retenção").
- **Better Auth (W5):** gerar as tabelas definitivas (+ `two_factor`); decidir como "criar conta + membro + escopo na mesma transação" (docs/15, seção 5) convive com o papel `auth_service`.
- **Console da Engemase:** leituras entre clientes (lista de clientes, frota de gateways) e eventos de plataforma na auditoria precisam de um papel de plataforma próprio (ainda não criado).
- **Confirmar na Neon** se o papel dono das tabelas tem `BYPASSRLS` (com `FORCE`, sem ele o dono não lê dados de cliente). Dentro de migração, o padrão `NO FORCE` → `UPDATE` → `FORCE` (0005) dispensa o `BYPASSRLS`; backfill e scripts fora de migração ainda precisam dele.
- `machine_template` e `oee_hour` (F2/opcional) e `remote_access_recording` (Fase C) ainda não existem.
- **Estorno de qualidade (L3 do docs/17):** o banco garante só que o estorno aponta para lançamento existente do mesmo cliente, com quantidade negativa. Ainda não garante "no máximo um estorno por lançamento", "quantidade igual à do original" nem "não estornar um estorno" (regras entre linhas: na API, ou com índice único parcial em `reverses_id` quando a regra fechar).
