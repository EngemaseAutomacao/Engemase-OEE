# Revisão de segurança W11 — cabeçalhos HTTP e isolamento entre clientes (RLS, D38)

**Data:** 24/11/2026 · **Escopo:** épico W11 ([docs/17 §2](../17-backlog-e-pendencias.md)), cabeçalhos da plataforma web ([docs/08](../08-seguranca-e-operacao.md), "Plataforma web") e o limite aceito da RLS (D38, [docs/17 §3](../17-backlog-e-pendencias.md#3-decisões); [packages/db/README.md](../../packages/db/README.md), "Isolamento por cliente"; [docs/15 §4](../15-multi-cliente-e-acesso.md#4-isolamento-de-dados-defesa-em-camadas)).

**Fora do escopo:** login e sessão (Better Auth, W5, em paralelo), Vercel Firewall (depende da conta, N1) e as telas do protótipo.

## 1. Resumo

| Gravidade | Achado | Onde | Feito | Falta / quem |
|---|---|---|---|---|
| Média | A web não mandava nenhum cabeçalho de segurança (nem CSP, nem HSTS, nem proteção contra iframe) | `apps/web/next.config.ts` | Cabeçalhos em todas as respostas (§2), conferidos no navegador | Nonce na CSP quando as telas reais saírem do prerender (§2.2) — web |
| Média | O `app_user` pode vincular **qualquer** pessoa (por `user_id`) ao próprio cliente e, a partir daí, lê nome e e-mail dela pela política de `"user"` | `0001_rls.sql` (GRANT em `member`; `user_member_of_tenant`) | Teste que fixa o comportamento (`rls.test.ts`) e regra para a W5 (§3.2) | W5: a Server Action resolve a pessoa pelo e-mail no servidor; nunca aceita `user_id` do navegador |
| Baixa | Com o login da aplicação herdando `app_user` (o `IN ROLE app_user` do README), uma consulta **fora** do `withTenant` usa o cliente que tiver sobrado na sessão do pool | `packages/db/README.md` (criação do login) | README passa a mandar criar o login com `NOINHERIT`; teste prova que assim a consulta falha alto (§3.3) | Implantação (N1): criar o login assim na Neon |
| Baixa | Restrições `UNIQUE` sem `organization_id` em tabelas de cliente respondem "já existe" antes da FK composta recusar: com o UUID de um gateway de B, o cliente A descobre se uma porta serial existe | `0000_init.sql` (`serial_bus_gateway_port_uq` e outras, §3.4) | Registrado | Quando houver migração de contrato (não é aditiva): incluir `organization_id` nessas restrições — banco |
| Aceito (D38) | SQL arbitrário como `app_user` troca `app.org_id` com `set_config` | `0001_rls.sql` (`app.current_org_id`) | Revisto: o limite continua documentado e testado; caminhos para endurecer em §3.5 | Decisão do dono do produto, se um cliente exigir |

Sem achados críticos ou altos. Nenhuma migração nova: as falhas encontradas não fecham com mudança só aditiva (§3).

## 2. Cabeçalhos HTTP (apps/web)

### 2.1 O que foi feito

`apps/web/lib/cabecalhos-seguranca.ts`, ligado por `headers()` no `next.config.ts` para `/:path*` (páginas, arquivos estáticos e a API dos gateways). Também `poweredByHeader: false`.

| Cabeçalho | Valor | Por quê |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; media-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Nada carrega de outro domínio; sem plugins, `<base>` e formulário para fora; ninguém embute o app |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | 2 anos. Sem `preload`: o domínio ainda é o da Vercel (D28) |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Links para fora não levam o caminho (`/<cliente>/maquinas/...`) |
| `Permissions-Policy` | câmera, microfone, localização, pagamento, USB, serial etc. desligados; `clipboard-write`, `fullscreen` e `screen-wake-lock` só na própria origem | O app copia o link do cliente e o andon usa tela cheia |
| `X-Frame-Options` | `DENY` | Navegadores antigos sem `frame-ancestors` |
| `Cross-Origin-Opener-Policy` | `same-origin` | |
| `X-DNS-Prefetch-Control` | `off` | |

Em `next dev` a CSP inclui `'unsafe-eval'` (o React usa nas pilhas de erro) e não tem `upgrade-insecure-requests`. `apps/web/test/cabecalhos-seguranca.test.ts` falha se alguém afrouxar a CSP (origem curinga, `unsafe-eval` em produção, sumir `frame-ancestors`/`object-src`).

### 2.2 Por que sem nonce (por enquanto)

O guia do Next 16.4 (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) diz que a CSP com nonce exige **renderização dinâmica de todas as páginas** e é **incompatível com o prerender parcial**. O app usa `cacheComponents` (prerender parcial) e o protótipo pré-gera as páginas por cliente. Por isso `script-src` aceita script inline (`'unsafe-inline'`): os scripts inline são os dados do RSC que o Next injeta e o script do next-themes que evita o "piscar" do tema.

O que a CSP atual **ainda bloqueia**: script de qualquer outro domínio, `eval` em produção, `<object>`/`<embed>`, `<base>` trocado, formulário enviado para fora, `fetch`/WebSocket para fora (`connect-src 'self'`, o que também segura exfiltração por XSS) e o app em iframe. O que **não** bloqueia: um `<script>` inline injetado por XSS. Contra isso, a defesa é o React (escapa todo texto) e a regra de não usar `dangerouslySetInnerHTML` com dado de usuário (hoje não há nenhum uso no app).

**Quando endurecer:** na implementação real (W5 em diante) as telas de cliente deixam de ser estáticas (docs/15 §4, item 6). Nessa hora, avaliar a CSP com nonce gerada no `proxy.ts` (receita do guia acima, `script-src 'self' 'nonce-…' 'strict-dynamic'`), sabendo que ela desliga o prerender parcial nessas rotas. Alternativa a avaliar: `experimental.sri` (hash dos arquivos no build) — não resolve os scripts inline do RSC sozinho.

### 2.3 Conferência no navegador (24/11/2026)

Chromium (Playwright) contra `next build` + `next start` e contra `next dev`, 23 rotas (início, login, conta, console da Engemase, visão geral, máquinas, máquina, linha, relatórios OEE e paradas, gateway, aparência, ajuda, andon, operador e terminais), em **computador (1440×900) e celular (390×844)**, tema **claro e escuro**:

- produção: **92 de 92** aberturas sem violação de CSP (evento `securitypolicyviolation`), sem erro no console, sem pedido bloqueado, status 200 e tema certo; fontes carregadas; gráficos do ECharts desenhados (renderizador SVG; 4 gráficos e 55 caminhos na tela da máquina);
- desenvolvimento: **0 violações de CSP** e 0 pedidos bloqueados. As 21 aberturas com erro no console são avisos do Next em dev sobre `params` fora de `<Suspense>` (validação de navegação instantânea do protótipo), sem relação com os cabeçalhos;
- controle (a CSP está valendo): script de `https://example.com` bloqueado (`script-src-elem`), iframe para fora bloqueado (`frame-src`), `eval` em script inline bloqueado, e o app aberto dentro de um iframe de outra origem vem vazio (`frame-ancestors`);
- tema: escolher "escuro", recarregar e o next-themes aplica a classe antes da hidratação (script inline permitido).

Os scripts usados ficaram fora do repositório (scratchpad da sessão). Para repetir: abrir cada rota com o Playwright, registrar `securitypolicyviolation` com `addInitScript` e conferir o console; lembrar que o `page.evaluate` roda pelo DevTools e **ignora a CSP** (para testar `eval`, injete o script no HTML com `page.route`).

### 2.4 Pendências dos cabeçalhos

- **Modo TV/andon dentro de iframe:** docs/08 previa abrir exceção se ele fosse embutido. Hoje nada é embutido e todas as rotas têm `frame-ancestors 'none'`. Se um cliente pedir, abrir **só** `/[cliente]/andon/*` para a origem combinada.
- **Vercel Firewall** (taxa por IP/rota): depende da conta (N1).
- **Relatório de violações** (`report-to`): o projeto não usa Sentry. O endereço que vai receber os relatórios da CSP ainda está por decidir.
- **`preload` do HSTS:** só com domínio próprio.

## 3. Isolamento entre clientes no banco (RLS, D38)

### 3.1 O que foi revisto

Migrações `0000`–`0006`, `src/tenancy.ts`, `src/lookups.ts`, os testes de `packages/db/test` e o uso no app (`apps/web/lib/server/db.ts`, `lib/server/gateway/*`). Cada ponto abaixo foi **tentado de verdade** no PGlite, como `app_user` com `app.org_id` do cliente A e um cliente B completo no banco.

| Tentativa como `app_user` (cliente A) | Resultado |
|---|---|
| `SELECT`/`INSERT`/`UPDATE`/`DELETE` em linhas de B, em todas as tabelas de cliente | Bloqueado (já coberto por `rls.test.ts`) |
| Ler `pg_stats` / `pg_stats_ext` de tabelas com RLS (valores mais comuns de B) | Nada volta: o Postgres esconde estatísticas de tabela com RLS ativa |
| `EXPLAIN` | Só a estimativa de linhas da tabela toda (vazamento de volume, irrelevante) |
| Chamar `app.enable_tenant_rls`, criar tabela em `public`, `TRUNCATE` | `permission denied` |
| Tabela legível sem RLS forçada | Nenhuma |
| Funções `SECURITY DEFINER` | Só as `app.resolve_*`, donas `app_lookup`, `search_path` fixo, EXECUTE só para `app_user` (já coberto por `catalog.test.ts`) |
| `app.resolve_org_slug('beta')` | Devolve o id de B — previsto: não autoriza nada, o vínculo é conferido depois |
| `INSERT`/`UPDATE` em `member` com o `user_id` de uma pessoa de B, depois `SELECT` em `"user"` | **Funciona** e mostra nome e e-mail dela (§3.2) |
| `INSERT` em `serial_bus` com o gateway de B e a porta que B usa | Erro de **unicidade** (porta de B existe) em vez do erro de FK (§3.4) |
| `set_config('app.org_id', B, true)` | Troca de cliente — limite aceito (D38, §3.5) |

### 3.2 Vínculo de pessoa de outro cliente (média)

**Caminho:** Server Action de "adicionar usuário" que aceite `user_id` do navegador → `INSERT INTO member (organization_id = A, user_id = <pessoa de B>)` passa (a FK de `member.user_id` não olha cliente, e entrar num segundo cliente é fluxo previsto, docs/15 §5) → a política `user_member_of_tenant` de `"user"` passa a mostrar essa pessoa a A (nome, e-mail, imagem). O mesmo vale para `UPDATE member SET user_id = …`, que ainda leva junto o papel e o escopo do vínculo.

**Por que não foi corrigido no banco:** o fluxo único de entrada de usuário (docs/15 §5) cria a conta "se não existir" e adiciona o membro na mesma transação — ou seja, vincular uma pessoa que já existe em outro cliente é legítimo, e a RLS não tem como saber se o vínculo foi pedido por quem pode. Tirar o `INSERT` em `member` do `app_user` decide como a W5 (Better Auth, em andamento) grava membros; fica para ela.

**Feito na W5 (25/11/2026):** o convite (`apps/web/lib/server/users/invite.ts`) acha ou cria a pessoa pelo e-mail digitado, no servidor, e ignora qualquer `userId` vindo do navegador (teste em `test/access/users.test.ts`); nenhuma ação muda `member.user_id`. O gatilho opcional abaixo continua pendente (pede migração).

**Regra para a W5:** a Server Action resolve a pessoa **pelo e-mail digitado, no servidor**, e nunca recebe `user_id` do navegador; `member.user_id` nunca muda depois de criado (trocar de pessoa = remover o vínculo e criar outro). Opcional, quando a W5 fechar o fluxo: um gatilho que recuse `UPDATE` de `member.user_id` (aditivo). `rls.test.ts` fixa o comportamento atual ("limite (revisão W11)") e deve mudar junto.

### 3.3 Login da aplicação sem herança (baixa)

O README mandava criar o login como `CREATE ROLE app_login LOGIN PASSWORD '…' IN ROLE app_user`, que **herda** os privilégios de `app_user`. Com isso, uma consulta feita **fora** do `withTenant` (bug) roda como o login e a RLS usa o `app.org_id` que estiver na sessão. Se alguma requisição tiver deixado o cliente na **sessão** (`set_config(..., false)` ou `SET` sem `LOCAL`, por bug) numa conexão do pool, a requisição seguinte, de outro cliente, lê os dados do primeiro. O teste novo reproduz isso.

**Correção:** criar o login **sem herança** — ele só ganha privilégios no `SET LOCAL ROLE app_user` que o `withTenant` já faz:

```sql
CREATE ROLE app_login LOGIN NOINHERIT PASSWORD '…';
GRANT app_user TO app_login WITH INHERIT FALSE, SET TRUE;
```

Assim, consulta fora do `withTenant` dá `permission denied` (falha alto) e, com cliente esquecido na sessão, o `withTenant` de outro cliente é recusado por `app.set_tenant` (o teste confere os três casos). README atualizado. Na Neon, conferir também que o dono das tabelas não é o login da aplicação e que se usa o endereço com pooler só com transações (o pooler da Neon é PgBouncer em modo transação: `SET` de sessão "vaza" entre clientes do pool, `SET LOCAL` não).

### 3.4 Oráculo de existência por restrição única (baixa)

Restrições únicas de tabelas de cliente **sem** `organization_id`, conferidas antes da FK composta: `serial_bus_gateway_port_uq (gateway_id, port)`, `gateway_config_version_uq (gateway_id, version)`, `gateway_machine_machine_uq (machine_id)`, `fault_code_map_machine_code_uq (machine_id, fault_code)`, `fault_code_map_template_code_uq`, `alert_event_open_dedup_uq (rule_id, dedup_key)`, `remote_access_session_live_uq (gateway_id, requested_by)`, `member_access_member_uq (member_id)` e as chaves primárias de `member_unit`/`member_machine`. Quem tem o **UUID** de um objeto de B consegue saber se uma combinação existe (erro de unicidade em vez de erro de FK). Os hashes de token (`*_token_hash_uq`, `code_hash`) também, mas aí é preciso o segredo.

Risco baixo: os UUIDv7 têm 74 bits aleatórios e não aparecem para outro cliente. Correção (não aditiva, porque troca a restrição): incluir `organization_id` em cada uma, por exemplo `UNIQUE (gateway_id, organization_id, port)` — mesma regra, já que o id do pai é único. Fazer numa migração de contrato antes de haver dados reais, ou deixar como está.

### 3.5 O limite aceito (D38) continua de pé

`app.org_id` é parâmetro de sessão comum: SQL injetado como `app_user` troca o cliente com `set_config` (e `RESET ROLE` volta ao papel do login). A revisão confirma que é o único caminho conhecido de passar por cima da RLS e que ele exige **SQL arbitrário**. Hoje nenhum dado de entrada vira texto de SQL: os `sql.raw`/`sql.identifier` existentes só recebem constantes do código (nome de papel de `DB_ROLES` no `withTenant`, nome de função de `LOOKUP_FUNCTIONS` em `lookups.ts`, nome de tabela tipado em `sync.ts` e listas dos CHECKs do schema), e a API dos gateways passa os valores pelo Drizzle com parâmetros.

Para manter: (1) **proibir** `sql.raw`/concatenação com dado de entrada (revisão de código e, quando houver CI, uma regra de lint); (2) o login sem herança (§3.3); (3) os testes de isolamento de rota (nível 3 do item 7 da docs/15 §4) na W5.

Se um cliente exigir mais (contrato), as opções, da mais barata para a mais cara: (a) `app.set_tenant` SECURITY DEFINER que confere um valor **assinado** pelo servidor (HMAC com segredo que o banco guarda numa tabela que o `app_user` não lê) e grava o cliente numa tabela temporária por transação, com `app.current_org_id()` lendo de lá — injeção ainda chamaria `set_tenant`, mas sem a assinatura não troca de cliente; (b) papéis de banco por cliente; (c) projeto Neon dedicado (docs/06).

### 3.6 Testes de isolamento: onde estamos (item 7 da docs/15 §4)

| Nível | O que é | Situação |
|---|---|---|
| 1 | Catálogo (toda tabela de cliente com RLS forçada) | Feito (`packages/db/test/catalog.test.ts`) |
| 2 | RLS direto no banco | Feito (`rls.test.ts`, `composite-fk.test.ts`, `lookups.test.ts`), com os 2 testes novos desta revisão |
| 3 | Cada rota e Server Action com usuário de A tentando ids de B | API dos gateways (`apps/web/test/gateway/isolation.test.ts`), camada de acesso (`test/access/isolation.test.ts`) e, desde 25/11/2026 (W5), convite, reenvio e reinício do 2FA com unidade, máquina e vínculo de B (`test/access/users.test.ts`). Telas reais: a cada troca do mock (W8) |
| 4 | Exportações e relatórios, com escopo por unidade e por máquina | Desde 25/11/2026 (W5): totais de produção por máquina/linha/unidade, CSV, alertas abertos e auditoria com escopo `units`/`machines` e cliente B no banco (`lib/server/access/summary.ts`, `test/access/summary.test.ts`). PDF e as telas de relatório usam essas funções quando saírem do protótipo (W8/W9) |

## 4. Verificações desta revisão

`pnpm typecheck`, `pnpm lint`, `pnpm test` (inclui os testes novos de cabeçalhos e de RLS) e `pnpm build` verdes; conferência no navegador da §2.3.
