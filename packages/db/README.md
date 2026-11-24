# @engemase/db

Schema do banco (Drizzle ORM, **Postgres 18**), migrações SQL versionadas e **Row-Level Security por cliente**. Base: [docs/06](../../docs/06-banco-de-dados.md), [docs/15](../../docs/15-multi-cliente-e-acesso.md) (seções 2, 3, 4 e 9), [docs/12](../../docs/12-acesso-remoto-vpn.md) e [docs/13](../../docs/13-notificacoes-e-alertas.md).

## Como testar

```bash
pnpm --filter @engemase/db test        # Vitest + PGlite (Postgres 18 em WASM, sem servidor)
pnpm --filter @engemase/db typecheck
pnpm --filter @engemase/db db:generate # gera SQL a partir do schema (não precisa de banco)
ENGEMASE_SEED=sintetico DATABASE_URL=postgres://… pnpm --filter @engemase/db db:seed   # migra + seed de demonstração
```

Os testes aplicam as migrações num banco vazio e provam, com dois clientes completos (uma linha em **todas** as tabelas de cliente):

| Arquivo | O que garante |
|---|---|
| `test/catalog.test.ts` | Toda tabela com `organization_id` tem RLS **habilitada e forçada** e a política restritiva; **toda tabela que o `app_user` pode ler** (inclusive `organization` e `"user"`) tem RLS forçada; FK sempre composta com o cliente; papéis sem `BYPASSRLS`; políticas permissivas só as previstas; funções SECURITY DEFINER donas `app_lookup`, com `search_path` fixo e EXECUTE só para `app_user`. Inclui testes que criam tabelas "esquecidas" e conferem que elas são pegas |
| `test/rls.test.ts` | Com `app.org_id = A`: `SELECT` em cada tabela (e em `organization`) só mostra A; `INSERT`/`UPDATE`/`DELETE` em B bloqueados; sem cliente definido não se vê nada; GRANTs (auditoria só inserção, `client_account` só leitura, `organization` só leitura). Caso próprio para o escopo por máquina (`member_machine`). Também fixa o **limite** documentado abaixo (`set_config` direto troca o cliente), o login `NOINHERIT` (consulta fora do `withTenant` falha alto) e o limite do vínculo de pessoa de outro cliente em `member` (revisão W11) |
| `test/composite-fk.test.ts` | Impossível ligar o gateway de A a uma máquina de B (mesmo como dono do banco); tag só em máquina ligada ao gateway do dispositivo; gateway e máquina da mesma unidade; escopo de pessoa (`member_unit`, `member_machine`) só com unidade/máquina do mesmo cliente; estorno de qualidade só de lançamento existente do mesmo cliente |
| `test/lookups.test.ts` | Busca por hash de token antes de saber o cliente (gateway, ativação, terminal, tokens próprios), **estado** da credencial (código usado/vencido, token revogado/rotacionado) e slug da URL → cliente |
| `test/migrations.test.ts` | Migrações aplicam do zero e são idempotentes; **schema TS e migrações não divergem** (falha se esquecerem o `db:generate`); a 0005 liga `managed_by_engemase` dos clientes que já existiam mesmo com um dono de tabelas **sem `BYPASSRLS`** (como na Neon); a 0006 para se algum cliente não tiver `limits.machines` |
| `test/partitions.test.ts` | `production_minute` (mês) e `tag_sample` (semana) particionadas, com chave, CHECKs e FKs na tabela-mãe; `ON CONFLICT` na chave funciona; RLS pela tabela-mãe e partição sem GRANT; `maintainPartitions()` cria os períodos seguintes, é idempotente, tem dry-run e apaga só partições inteiras além da retenção; a 0013 sobre tabela com dados mantém todas as linhas (sem cópia) com dono **sem `BYPASSRLS`** |
| `test/calendar-quality-operators.test.ts` | Tabelas novas do W2b (`unit_holiday`, `reject_reason`, `unit_operator`): RLS por cliente (SELECT/INSERT/UPDATE/DELETE), FKs compostas (inclusive motivo e operador em `quality_entry`, `production_run`, `machine_state_event`), unicidades; estorno de refugo (motivo obrigatório, quantidade oposta, mesma máquina, um só, não estorna estorno); gateway "Em trânsito" (até 30 dias) |
| `test/seed.test.ts` | Seed sintético só com `ENGEMASE_SEED=sintetico` e fora de produção; recusa banco com cliente real e conexão sem `BYPASSRLS`; determinístico, idempotente e respeitando a RLS |
| `test/enums.test.ts` | "Enums" e faixas do banco iguais aos de `@engemase/contracts` (inclusive `fault_code` uint32 em `bigint` e o formato do slug do cliente, `org` do /enroll); campos de minuto/live do contrato têm coluna; CHECKs recusam valores inválidos (escopo `machines` aceito, admin só com `all`, concessão de suporte sem aprovação, limites inteiros >= 0 com `machines` obrigatório) |

## Estrutura

```
src/schema/      tabelas por domínio (auth, assets, access, connectivity, production-*, alerts, remote-access)
src/tenancy.ts   withTenant(), papéis, lista das tabelas de cliente
src/lookups.ts   sha256Hex(), busca por hash de token (e estado da credencial) e por slug (funções SECURITY DEFINER)
src/partitions.ts maintainPartitions(): manutenção diária das partições (cria as futuras, apaga pela retenção)
src/seed/        seed sintético (`@engemase/db/seed`); scripts/seed.ts é o `db:seed`
migrations/      0000_init.sql (drizzle-kit) e 0001_rls.sql (MANUAL: papéis, RLS, GRANTs, funções)
                 0002_contract_columns_quality_reversal.sql (drizzle-kit, com o UNIQUE movido para antes da FK)
                 0003_organization_rls_state_lookups.sql (MANUAL: RLS em organization, funções de estado e slug)
                 0004_organization_slug_check.sql (drizzle-kit: formato do slug; + COMMENT manual do limite da RLS)
                 0005_member_machine_owner_decisions.sql (drizzle-kit + MANUAL: member_machine com RLS,
                   decisões D1, D5, D11 e D13; liga managed_by_engemase dos clientes existentes)
                 0006_client_limits_machines_required.sql (drizzle-kit: `limits.machines` obrigatório, D1)
                 0007_w2b_calendar_reject_operator_transit.sql (drizzle-kit: feriados L2, motivos de refugo e
                   estorno L3, operadores L19, gateway em trânsito L23)
                 0008_w2b_rls_new_tables_reversal_trigger.sql (MANUAL: RLS/GRANTs das tabelas novas e gatilho
                   do estorno)
                 0009_gateway_api_w6.sql (drizzle-kit: gateway.uplink, alert_rule.system_key,
                   gateway_health_sample, api_rate_limit, cron_run)
                 0010_gateway_api_w6_rls.sql (MANUAL: RLS de gateway_health_sample; funções do
                   limitador de taxa e dos crons, donas app_lookup)
                 0011_auth_two_factor_session_throttle.sql (drizzle-kit: two_factor, auth_login_throttle,
                   session.remember_me/last_active_at)
                 0012_auth_grants.sql (MANUAL: tabelas novas do login só para auth_service)
                 0013_w2b_partitions_maintenance.sql (MANUAL: partições e app.maintain_partitions; fica por
                   último porque o teste a aplica sobre um banco já com dados)
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

### Tabelas de plataforma (sem `organization_id`, 0007/0008)

`api_rate_limit` (limitador de taxa da API dos gateways) e `cron_run` (janelas das tarefas agendadas) não dão nenhum privilégio ao `app_user`: o acesso é só pelas funções abaixo (SECURITY DEFINER, donas `app_lookup`, `search_path` fixo, EXECUTE só para `app_user`), cada uma com uma operação fechada.

| Função SQL | Uso |
|---|---|
| `app.rate_limit_take(chave, intervalo_ms, rajada, agora)` | GCRA por chave: `allowed` e, se recusada, `retry_after_ms` |
| `app.rate_limit_purge(antes)` | Apaga chaves vencidas (limpeza diária) |
| `app.cron_claim(job, janela, agora, prazo_s)` · `app.cron_finish(job, janela, agora, ok, resultado)` | Uma execução por janela; erro libera a janela |
| `app.cron_purge(antes)` | Apaga o histórico antigo dos crons |
| `app.cron_organizations()` | Ids de todos os clientes, para o cron rodar um `withTenant` por cliente |

`gateway_health_sample` (histórico de saúde do gateway, 5 min) é tabela de cliente comum (RLS forçada), com `DELETE` para a retenção de 30 dias rodar como `app_user`. `alert_rule.system_key` marca as regras-preset criadas pela plataforma (uma por cliente, índice único parcial).

Nenhuma linha = segredo desconhecido (400 `activation_code_invalid` / 401 `unauthorized`). Os ids dos estados não válidos servem para auditoria e **nunca** voltam na resposta ao gateway. Para o `token_revoked` funcionar, a revogação do gateway deve manter o `token_hash`.

Na implantação, criar os usuários de login **por SQL** (não pelo console da Neon), sem segredo em migração e **sem herdar** o `app_user` (revisão W11, `docs/operacao/revisao-seguranca-w11.md` §3.3): o login só ganha privilégios no `SET LOCAL ROLE app_user` do `withTenant`, então uma consulta fora dele falha alto em vez de usar um cliente que tenha sobrado na sessão do pool.

```sql
CREATE ROLE app_login LOGIN NOINHERIT PASSWORD '…';
GRANT app_user TO app_login WITH INHERIT FALSE, SET TRUE;
```

### Ao criar uma tabela nova

1. Declarar no `src/schema/` (com `organizationId()` e FKs compostas, se for de cliente) e rodar `pnpm db:generate`.
2. Numa migração manual (`pnpm exec drizzle-kit generate --custom --name <nome>`): `SELECT app.enable_tenant_rls('public.<tabela>');` e os `GRANT`s para `app_user`.
3. `pnpm test`: o teste de catálogo falha se faltar RLS ou se uma FK entre tabelas de cliente não for composta.

**Ajustar dados de tabela de cliente numa migração:** com a RLS forçada, o dono das tabelas sem `BYPASSRLS` não enxerga nenhuma linha, e um `UPDATE` simples passa sem fazer nada. Use o padrão da 0005: `ALTER TABLE x NO FORCE ROW LEVEL SECURITY` → `UPDATE` → `ALTER TABLE x FORCE ROW LEVEL SECURITY`, tudo na transação da migração (o migrator do Drizzle com `pg`/node-postgres, neon-serverless ou PGlite aplica numa transação só; o de `neon-http` não usa transação e **não serve para migrar**: uma falha no meio deixaria a tabela sem `FORCE`). O teste de catálogo pega se o `FORCE` não voltar.

## Partições e manutenção diária (W2b)

| Tabela | Partição | Criadas adiante | Retenção |
|---|---|---|---|
| `production_minute` | Mensal (`bucket_start`) | 3 meses | 2 anos (D6) |
| `tag_sample` | Semanal (`at`, semana começa na segunda) | 8 semanas | 90 dias |

- Particionamento **nativo** (RANGE), sem `pg_partman` (o PGlite dos testes não tem a extensão; a rotina é Postgres padrão). Limites em UTC.
- A 0013 **não copia dados**: a tabela antiga vira a partição `<tabela>_legacy` (de `MINVALUE` até o início do período seguinte ao dado mais novo) e uma tabela-mãe com o mesmo nome, colunas, chave, CHECKs, FKs, RLS e GRANTs fica no lugar. O código anterior continua igual (inclusive `ON CONFLICT` na chave).
- **Tarefa agendada diária** (L17): `maintainPartitions(db)` (`app.maintain_partitions(now, dry_run)`) cria o período atual e os seguintes e apaga partições inteiras mais velhas que a retenção. Idempotente; devolve as ações para o log. Precisa conectar com o papel **dono das tabelas** (DDL): não é SECURITY DEFINER e ninguém tem EXECUTE (nem o `app_user`). Configuração em `app.partitioned_table`.
- Gravar além das partições criadas **falha alto** (`no partition of relation … found for row`): a folga de 3 meses / 8 semanas cobre semanas sem a tarefa. Dado antigo (antes da partição atual) cai na `_legacy` enquanto ela existir.
- Toda partição tem RLS forçada com a política de cliente (`app.enable_tenant_rls`, o catálogo confere) e **nenhum GRANT**: o app acessa só pela tabela-mãe. O drizzle-kit não enxerga partições (para ele são tabelas comuns).
- Fora, de propósito: `machine_state_event` e `audit_log` têm chave só em `id` (o `/sync` usa `ON CONFLICT (id)`); particionar mudaria a chave. A retenção de 5 anos da auditoria fica para quando houver dados de 5 anos.

## Seed sintético e branch-semente

`src/seed` grava dois clientes de demonstração (`demo-metalurgica`, `demo-plasticos`) com pessoas, unidade, área "Geral", linhas, máquinas, gateway ativo e um "Em trânsito", dispositivos e tags, produtos, turnos, feriados, motivos de parada e de refugo, operadores, regra de alerta e N dias (padrão 7) de `production_minute`, `machine_state_event`, `production_run`, `machine_live` e refugo com um estorno. É o conteúdo do **branch-semente** da Neon, de onde saem os previews (docs/06), e do banco local.

- **Nunca roda em produção:** o `db:seed` exige `ENGEMASE_SEED=sintetico` e recusa `VERCEL_ENV`/`NODE_ENV` = `production`; `seedSynthetic()` recusa banco com cliente cujo slug não começa com `demo-` e conexão sem SUPERUSER/BYPASSRLS.
- Determinístico (ids por hash do nome lógico, séries com semente por máquina e dia) e idempotente (`ON CONFLICT DO NOTHING`).
- Imprime o token em claro só dos gateways criados naquela execução (o banco guarda o hash), para apontar o simulador para o banco local.
- `db:seed` aplica as migrações antes (com `pg`, numa transação só); `--sem-migrar` pula, `--dias N` muda o período.

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
  - **D1, cobrança por máquina com planos:** `client_account.plan` (texto) e `limits.machines` (máquinas contratadas). Valores de `limits` são inteiros >= 0 e **`machines` é obrigatório** (`client_account_limits_chk`, 0006; a coluna não tem mais padrão `{}`): todo cliente nasce com as máquinas contratadas, inclusive a "Engemase Lab", e `0` = nenhuma máquina pode ser cadastrada. As outras chaves são opcionais: ausente = sem limite. Preços ficam fora do banco; não há tabela de faturamento.
  - **D38:** RLS por variável de sessão aceita, com o limite descrito em "Isolamento por cliente".
- **Lacunas do docs/17 (§4) aplicadas no W2b:**
  - **L2:** `unit_holiday` (feriado por unidade, um por dia): nenhum turno começa nesse dia. O turno pertence ao dia em que começa; mudança de turno é uma linha nova com `valid_from`.
  - **L3:** `reject_reason` (motivos cadastrados pela Engemase) e, em `quality_entry`, `reject_reason_id`, `reversal_reason` (obrigatório só no estorno) e `operator_id`. Lançamento comum é sempre positivo e soma ao refugo do CLP. Estorno: no máximo um por lançamento (índice único parcial), mesma máquina, quantidade oposta e nunca de outro estorno (gatilho `quality_entry_reversal_trg`, 0008).
  - **L19:** `unit_operator` (nome e matrícula opcional, única na unidade); `operator_id`/`classified_operator_id` em `quality_entry`, `production_run` e `machine_state_event`.
  - **L23:** `gateway.in_transit_since`/`in_transit_until` (até 30 dias, `gateway_in_transit_chk`) e `installed_at`. Não é um valor novo de `status`: o gateway em trânsito já está `active` e autentica.
- **Tabelas do Better Auth** (`src/schema/auth.ts`), ids `uuid`, conferidas pelo próprio Better Auth na partida (`validateSchema`). W5: `two_factor` (plugin two-factor), `auth_login_throttle` (bloqueio depois de 5 senhas erradas) e `session.remember_me`/`session.last_active_at` (0011, drizzle-kit); só o `auth_service` lê e grava (0012, manual).

## Pendências

- **Seed a partir do mock do protótipo** (`apps/web/lib/mock`): o seed sintético (`src/seed`) já serve ao desenvolvimento e ao branch-semente; usar os mesmos nomes e números do protótipo exigiria mover o mock para um pacote compartilhado. Atenção: o mock tem o estado `PLANNED_STOP`, que no banco não é estado bruto (é classificação por motivo). `oee_shift` não é semeado: sai do cálculo (W7).
- **Branch-semente na Neon** (N1): criar o branch, rodar `db:seed` nele com um papel com BYPASSRLS e apontar a integração da Vercel para ele.
- **Rota da tarefa diária de partições** (outro especialista, W7): chamar `maintainPartitions(db)` com uma conexão do dono das tabelas e registrar as ações no log.
- **Script de migração contra a Neon** (`db:migrate` com `pg`, numa transação só; nunca o migrator de `neon-http`) e bootstrap da organização "Engemase Lab" + primeiro super admin: dependem das contas (N1). O projeto Neon fica em AWS `sa-east-1` (São Paulo, D7).
- **Retenção da auditoria** (5 anos, D6): sem partição (chave em `id`); limpeza a decidir antes de 2031.
- **Better Auth (W5):** login, sessão, bloqueio e 2FA feitos (apps/web/lib/server/auth). Falta o fluxo "criar conta + membro + escopo na mesma transação" (docs/15, seção 5) e como ele convive com o papel `auth_service`. Esse fluxo deve achar a pessoa pelo e-mail no servidor e nunca aceitar `user_id` do navegador (revisão W11: o `app_user` consegue gravar `member` com qualquer `user_id`).
- **Usuários de login na implantação:** o do Better Auth (`AUTH_DATABASE_URL`) precisa HERDAR `auth_service` (`CREATE ROLE auth_login LOGIN PASSWORD '…' IN ROLE auth_service;`), porque o Better Auth não troca de papel por consulta. O do app (`DATABASE_URL`) pode ser `NOINHERIT` com `GRANT app_user TO app_login WITH INHERIT FALSE, SET TRUE`: a camada de acesso sempre roda em `withTenant` (`SET LOCAL ROLE app_user`), inclusive a busca do slug. Testado localmente assim (W5).
- **Console da Engemase:** leituras entre clientes (lista de clientes, frota de gateways) e eventos de plataforma na auditoria precisam de um papel de plataforma próprio (ainda não criado).
- **Confirmar na Neon** se o papel dono das tabelas tem `BYPASSRLS` (com `FORCE`, sem ele o dono não lê dados de cliente). Dentro de migração, o padrão `NO FORCE` → `UPDATE` → `FORCE` (0005) dispensa o `BYPASSRLS`; backfill e scripts fora de migração ainda precisam dele.
- `machine_template` e `oee_hour` (F2/opcional) e `remote_access_recording` (Fase C) ainda não existem.
- **Regras de aplicação do W2b** (o banco não garante): turnos sem sobreposição na mesma unidade (L2); prazo do lançamento atrasado e registro do estorno na auditoria (L3); operador da mesma unidade da máquina (L19); fim do trânsito no primeiro `/sync` no cliente e supressão do alerta de offline enquanto `in_transit_until > now()` e `installed_at` nulo (L23).
