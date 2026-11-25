# apps/web — Plataforma Engemase OEE (Next.js)

Protótipo da interface. **Por enquanto usa dados simulados** (`lib/mock`) e roda só localmente.

## Rodar localmente

Na raiz do monorepo:

```bash
pnpm install
```

```bash
pnpm dev
```

Abra http://localhost:3000. Comece pela página inicial (seletor de cliente) ou vá direto para `/plastiform` (área do cliente) e `/admin` (console Engemase).

Variáveis de ambiente: copie `.env.example` para `.env.local` (fica fora do git). Cada variável tem comentário dizendo para que serve, se o código já lê e em quais ambientes da Vercel criar. Nada é obrigatório para o protótipo; sem `DATABASE_URL` a API dos gateways responde 503.

## Stack

Next.js 16 (App Router, Cache Components ligado) · React 19 · Tailwind CSS 4 · shadcn/ui (componentes em `components/ui`, copiados do repositório oficial) · Apache ECharts · lucide-react · next-themes.

## Estrutura

```
app/
  page.tsx                         seletor de cliente (/)
  (auth)/login/                    login
  (shell)/[cliente]/...            área do cliente (menu lateral)
  (kiosk)/[cliente]/andon|operador tela cheia (TV e tablet)
  (admin)/admin/...                console da plataforma (equipe Engemase)
components/
  ui/       shadcn/ui (não editar sem necessidade)
  shell/    layout: menu, cabeçalho, PageHeader/PageBody
  dashboard/ PADRÃO VISUAL: StatCard, SectionCard, IconCircle, Ring, Gauge, Donut, StatePipeline, ActivityTimeline
  oee/      domínio: StateBadge, OeeRing, OeeBreakdown, KpiCard, MachineCard, StateTimeline
  overview/ dados e gráficos da Visão geral (referência de como montar uma página no padrão novo)
  charts/   EChart (wrapper do ECharts com tema claro/escuro)
lib/
  mock/     dados simulados + funções de consulta (trocar pela camada real depois)
  format.ts formatação pt-BR (pct, num, duration, time, ago...)
  states.ts cores e rótulos dos estados de máquina, faixas de OEE
  roles.ts  rótulos de papéis, planos e status
```

## Convenções (importante com Cache Components)

1. **Rotas dinâmicas sempre com `generateStaticParams`**, usando os helpers de `lib/mock` (`clientParams`, `machineParams`, `lineParams`, `gatewayParams`, `adminClientParams`). Assim `await params` e `usePathname()` funcionam sem `<Suspense>`.
2. **Nada de `Date.now()`, `new Date()` sem argumento ou `Math.random()` em componentes de servidor.** Use `MOCK_NOW`/`nowMs()` e `seededRandom()` de `lib/mock`. Em componentes de cliente, só dentro de `useEffect` ou handlers.
3. **Não usar `searchParams`/`useSearchParams`** no protótipo (filtros ficam em estado local de componentes de cliente). Se precisar, envolver em `<Suspense>`.
4. Páginas são **componentes de servidor**; interatividade (filtros, diálogos, abas com estado, gráficos) vai em componentes `"use client"` pequenos, recebendo dados já prontos por props.
5. Textos da interface em **português do Brasil**; código e identificadores em inglês.
6. Cores de estado: classes `bg-state-*`/`text-state-*` e `STATE_META` (`lib/states.ts`); em gráficos use `STATE_META[x].hex` e `TONE_HEX`.
7. Ações (salvar, convidar, testar leitura) no protótipo só mostram um `toast` (sonner) — não há backend ainda.
8. **Padrão visual** (inspirado na referência aprovada pelo dono do produto; ver `app/(shell)/[cliente]/page.tsx`):
   - página: `<div className="flex flex-col gap-5 p-4 md:p-6">`, título `text-2xl font-bold` + subtítulo `text-sm text-muted-foreground`, ações/filtros à direita;
   - indicadores em `StatCard` (ícone em círculo colorido, valor grande, variação ↑/↓);
   - blocos em `SectionCard` (cartão `rounded-2xl`, título + link "Ver tudo"/ação à direita);
   - tabelas dentro de `SectionCard`, com `overflow-x-auto`; badges suaves; ações como botões-ícone quadrados suaves;
   - cores: azul Engemase (primária), azul-marinho, teal `#0e9384` e laranja `#e96549` só em ícones decorativos; estados de máquina sempre com `STATE_META`;
   - barras de rolagem já estão ocultas globalmente (não reintroduzir).

## Dados das telas: banco ou simulado (W8)

A demonstração na Vercel não tem banco. Por isso as telas leem por `lib/data/`: cada função usa o banco quando
`DATABASE_URL` existe (`usarBanco()` em `lib/data/fonte.ts`) e os dados simulados quando não existe.

- **Console Engemase e cadastros** (`lib/data/admin/*`, `lib/data/config/*`): os montadores dos componentes
  (`buildClientDetail`, `buildFleet`, `buildGatewayDetail`...) recebem um `Repositorio` (`lib/data/admin/repositorio.ts`):
  `repositorioMock` ou `repositorioEmMemoria(foto)`, com a foto do banco lida em `snapshot.ts` nos tipos do protótipo.
  Cadastro de um cliente: `carregarCliente`/`exigirCliente` (`requireTenant` + permissão; sem acesso, 404). Console:
  `exigirEquipe` (papel de plataforma + 2FA) e um `withTenant` por cliente (`app.cron_organizations()`).
- Com banco, as páginas leem o pedido: o conteúdo fica num componente dentro de `<Suspense>` (esqueleto em
  `components/shell/carregando.tsx`). "Agora" passa a ser o relógio real no pedido (`usarRelogioReal`, `lib/mock/clock.ts`).
- **Gravações** por Server Actions validadas com zod, que conferem de novo sessão, cliente e permissão e registram na
  auditoria: `app/(admin)/admin/actions.ts` (novo cliente, só super admin) e `app/(shell)/[cliente]/config/actions.ts`
  (unidade, área, linha, gateway + código de ativação, nova máquina com CLP e sinais + publicação da config, comandos
  `tag.read`/`device.test`/`config.reload`/`agent.restart`). Os componentes sabem a fonte por `FonteDadosProvider`
  (`components/config/fonte-dados.tsx`): sem banco, continuam simulando com `toast`.
- Ainda simulados com banco: dados ao vivo, OEE, notificações, acesso remoto, terminais, aparência; turnos, produtos,
  motivos, usuários do cliente (telas de config fora da W8); concessões/atribuições da equipe; reverter versão de config.

## Checagens

```bash
pnpm --filter web typecheck
```

```bash
pnpm --filter web lint
```

```bash
pnpm --filter web build
```

```bash
pnpm --filter web test       # API dos gateways (Vitest + PGlite, sem servidor)
pnpm --filter web test:e2e   # plc-sim → agente Go → API → banco (precisa do Go 1.24; ~1 min)
```

```bash
pnpm --filter web build && pnpm --filter web test:navegador   # Playwright: telas principais no celular e no computador
pnpm --filter web poc:gateways                                # PoC de carga com N gateways simulados (docs/operacao/poc-100-gateways.md)
```

## API dos gateways (`/api/gateway/v1`)

Primeiro código real de servidor: `enroll`, `sync` e `config` ([docs/04](../../docs/04-protocolo-gateway-nuvem.md), contrato em `@engemase/contracts`).

- Lógica em `lib/server/gateway/` (sem Next.js: recebe `Request` e um banco do Drizzle e devolve `Response`); os `app/api/gateway/v1/*/route.ts` só repassam.
- Banco: `DATABASE_URL` (Neon com pooler; usuário membro de `app_user`) e, opcional, `DATABASE_POOL_MAX` (padrão 5). Sem `DATABASE_URL`, as rotas respondem 503 e o build não conecta em nada.
- Toda leitura/escrita de um gateway roda em `withTenant()` (`app_user` + `app.org_id` do gateway autenticado, sob RLS); o token é buscado pelo hash antes (`app.resolve_gateway_token`).
- **Limites de taxa (L21)** em `rate-limit.ts`, guardados no Postgres (`app.rate_limit_take`, GCRA), para valer entre instâncias serverless: `/sync` 60/min por gateway (rajada 10), `/config` 30/min (rajada 5), `/enroll` 10/h por IP e 5 tentativas por código. Acima disso, `429 rate_limited` com `retry_after_s` e `Retry-After`.
- **`409 config_outdated`** no `/sync`: referência fora do gateway com o agente numa config anterior à publicada (e sem tê-la recusado); senão `400 unknown_reference`.
- **Histórico de saúde** em `gateway_health_sample` (janela de 5 min) e **alerta de minuto reescrito** (regra do sistema `minute_rewritten`, `lib/server/alerts/system.ts`).

### Operações da web sobre os gateways (sem tela ainda; chamadas pelas Server Actions da W8)

| Função | Arquivo | O que faz |
|---|---|---|
| `publishGatewayConfig` | `lib/server/gateway/publish.ts` | Monta a config do contrato a partir do cadastro, valida e grava a próxima versão (sem mudança: `unchanged`) |
| `createActivationCode` | `lib/server/gateway/activation.ts` | Código ABCD-1234 de 24 h (só o hash no banco); invalida os anteriores não usados |
| `enqueueGatewayCommand` · `getGatewayCommand` · `cancelGatewayCommand` | `lib/server/gateway/commands.ts` | Fila de comandos: valida pelo contrato, entrega no `/sync`, guarda o resultado |

Erros esperados saem como `GatewayAdminError` (código + mensagem em português + problemas por campo). Quem chama confere antes o login e a permissão (W5) e passa o `actor` para a auditoria.

## Tarefas agendadas (`/api/cron/*`, L17)

Lógica em `lib/server/cron/` (`runner.ts` + um arquivo por job); os `route.ts` só repassam. Horários em UTC:

> **Fase de testes, plano gratuito (Hobby) da Vercel (desde 24/11/2026).** O Hobby recusa o deploy inteiro quando o
> `vercel.json` tem tarefa que roda mais de uma vez por dia. Por isso `PLANO_VERCEL = "hobby"` em
> `lib/server/cron/jobs.ts` e o `vercel.json` agenda só `limpeza` (03:30) e `resumo-diario` (só às 10h, sem a
> 2ª tentativa das 11h). `alertas`, `expiracao` e `vpn` continuam no código, sem agendamento: rodam só à mão (curl
> abaixo). **Antes de clientes usarem os alertas**, passe o projeto para o Pro, troque `PLANO_VERCEL` para `"pro"`
> e ponha no `vercel.json` as 5 entradas da tabela (o teste `test/cron/cron.test.ts` confere que os dois batem).

| Rota | Quando | O que faz |
|---|---|---|
| `/api/cron/alertas` | 1 min | Gateway sem `/sync` há mais de 6 min → alerta crítico (resolve ao voltar); minuto reescrito resolve em 24 h |
| `/api/cron/expiracao` | 5 min | Comandos, concessões de suporte e token anterior vencidos |
| `/api/cron/vpn` | 15 min | Pedidos de acesso sem decisão (24 h); `vpn.disable`/`ot.forward.close` para sessões e encaminhamentos vencidos |
| `/api/cron/limpeza` | 03:30 UTC | Limitador, histórico dos crons, saúde (30 dias), comandos (90 dias), códigos antigos; partições pendentes (W2b) |
| `/api/cron/resumo-diario` | 10h e 11h UTC | Resumo por cliente para a equipe Engemase pelo Resend (a 2ª chamada só envia se a 1ª falhou) |

- Protegidas por `CRON_SECRET` (a Vercel manda `Authorization: Bearer <CRON_SECRET>`): sem a variável, 503; segredo errado, 401.
- Uma execução por janela (`cron_run`, `app.cron_claim`): chamada repetida responde `skipped`; erro libera a janela.
- Para rodar à mão: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/limpeza`.

### Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Banco (ver acima) |
| `DATABASE_POOL_MAX` | não | Conexões por instância (padrão 5) |
| `CRON_SECRET` | sim, para os crons | Segredo das rotas `/api/cron/*` (a Vercel envia sozinha) |
| `RESEND_API_KEY` · `RESUMO_DIARIO_DE` · `RESUMO_DIARIO_PARA` | não | Resumo diário por e-mail (remetente verificado no Resend; destinatários separados por vírgula). Sem elas o resumo não é enviado |

## Login e acesso por cliente (W5)

Better Auth (senha, sessão, 2FA) + autorização nossa ([docs/15](../../docs/15-multi-cliente-e-acesso.md)).

- **Login** (`app/(auth)/login`): a tela do protótipo chama Server Actions (`actions.ts`) que usam `auth.api.*` no servidor. Senha ≥ 12 sem regra de composição; senha nova conferida contra vazamentos (k-anonimato, `lib/server/auth/password.ts`; sem rede, aceita). 5 senhas erradas em 15 min → 15 min bloqueado (`throttle.ts`, tabela `auth_login_throttle`, chave = hash do e-mail). Sessão de 12 h renovada com o uso; "manter conectado" até 30 dias, nunca para a equipe Engemase (`session-policy.ts`).
- **2FA** (TOTP + 10 códigos de recuperação, plugin two-factor): cadastro em `/conta/seguranca`; obrigatório para a equipe Engemase e o admin do cliente (D14) — sem ele, `requireTenant` manda para o cadastro.
- **`/api/auth/*` fechado por padrão** (`lib/server/auth/routes.ts`): só `get-session`, `sign-out`, `sign-in/email` e a verificação do 2FA; o teste falha se o Better Auth ganhar rota não classificada.
- **`requireTenant(slug)`** (`lib/server/access/require-tenant.ts`; para route handlers, `tenantForRequest` em `route.ts`): sessão → cliente da URL → vínculo, papel, escopo, estado do cliente e concessão Engemase, lidos sob RLS (`load.ts`) e decididos por `decideAccess` (`context.ts`, função pura). Sem acesso → 404. Dados de cliente só por funções que recebem o `TenantContext` (`data.ts`) e aplicam o escopo (`scope.ts`). Exemplo real: `GET /api/clientes/{cliente}/maquinas`.
- **Proxy** (`proxy.ts`): com `AUTH_ENFORCED` ligado, tela do sistema sem cookie de sessão vai para `/login?next=…` (checagem otimista; a autorização é no servidor). Com banco, a casca do cliente e as telas de cadastro passam por `requireTenant` (W8).

| Variável | Para quê |
|---|---|
| `AUTH_ENFORCED` | `true` exige login nas telas do sistema; `false` deixa o protótipo navegável. **Sem a variável: ligado em produção (`NODE_ENV=production`, inclusive na Vercel) quando o `BETTER_AUTH_SECRET` existe, e desligado no `next dev`.** Enquanto o login não for configurado na Vercel, a demonstração continua aberta; ao criar o segredo, o login passa a ser exigido (para manter a demonstração aberta mesmo assim até a W8, crie `AUTH_ENFORCED=false`) |
| `BETTER_AUTH_SECRET` | Segredo (≥ 32 caracteres, `openssl rand -base64 32`), diferente por ambiente. Sem ele o login fica indisponível (com `AUTH_ENFORCED=false`, a tela entra em modo demonstração e vai para `/inicio`) |
| `BETTER_AUTH_URL` | Endereço canônico (ex.: `https://engemase-oee.vercel.app`); única origem confiável |
| `AUTH_DATABASE_URL` | Conexão do Better Auth com um usuário do papel `auth_service` (ver packages/db/README.md). Sem ela usa `DATABASE_URL`, o que só funciona em banco local com superusuário |

Testes (`pnpm --filter web test`): `test/access` (isolamento entre clientes, escopo, papéis, Engemase, suspenso, 2FA; rota com login real) e `test/auth` (Better Auth de verdade no PGlite: bloqueio, sessão, 2FA, política de senha, lista de rotas).
