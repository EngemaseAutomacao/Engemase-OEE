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

## API dos gateways (`/api/gateway/v1`)

Primeiro código real de servidor: `enroll`, `sync` e `config` ([docs/04](../../docs/04-protocolo-gateway-nuvem.md), contrato em `@engemase/contracts`).

- Lógica em `lib/server/gateway/` (sem Next.js: recebe `Request` e um banco do Drizzle e devolve `Response`); os `app/api/gateway/v1/*/route.ts` só repassam.
- Banco: `DATABASE_URL` (Neon com pooler; usuário membro de `app_user`) e, opcional, `DATABASE_POOL_MAX` (padrão 5). Sem `DATABASE_URL`, as rotas respondem 503 e o build não conecta em nada.
- Toda leitura/escrita de um gateway roda em `withTenant()` (`app_user` + `app.org_id` do gateway autenticado, sob RLS); o token é buscado pelo hash antes (`app.resolve_gateway_token`).

## Login e acesso por cliente (W5)

Better Auth (senha, sessão, 2FA) + autorização nossa ([docs/15](../../docs/15-multi-cliente-e-acesso.md)).

- **Login** (`app/(auth)/login`): a tela do protótipo chama Server Actions (`actions.ts`) que usam `auth.api.*` no servidor. Senha ≥ 12 sem regra de composição; senha nova conferida contra vazamentos (k-anonimato, `lib/server/auth/password.ts`; sem rede, aceita). 5 senhas erradas em 15 min → 15 min bloqueado (`throttle.ts`, tabela `auth_login_throttle`, chave = hash do e-mail). Sessão de 12 h renovada com o uso; "manter conectado" até 30 dias, nunca para a equipe Engemase (`session-policy.ts`).
- **2FA** (TOTP + 10 códigos de recuperação, plugin two-factor): cadastro em `/conta/seguranca`; obrigatório para a equipe Engemase e o admin do cliente (D14) — sem ele, `requireTenant` manda para o cadastro.
- **`/api/auth/*` fechado por padrão** (`lib/server/auth/routes.ts`): só `get-session`, `sign-out`, `sign-in/email` e a verificação do 2FA; o teste falha se o Better Auth ganhar rota não classificada.
- **`requireTenant(slug)`** (`lib/server/access/require-tenant.ts`; para route handlers, `tenantForRequest` em `route.ts`): sessão → cliente da URL → vínculo, papel, escopo, estado do cliente e concessão Engemase, lidos sob RLS (`load.ts`) e decididos por `decideAccess` (`context.ts`, função pura). Sem acesso → 404. Dados de cliente só por funções que recebem o `TenantContext` (`data.ts`) e aplicam o escopo (`scope.ts`). Exemplo real: `GET /api/clientes/{cliente}/maquinas`.
- **Proxy** (`proxy.ts`): com `AUTH_ENFORCED` ligado, tela do sistema sem cookie de sessão vai para `/login?next=…` (checagem otimista; a autorização é no servidor). As telas do mock ainda não usam `requireTenant` (W8).

| Variável | Para quê |
|---|---|
| `AUTH_ENFORCED` | `true` exige login nas telas do sistema; `false` deixa o protótipo navegável. **Sem a variável: ligado em produção (`NODE_ENV=production`, inclusive na Vercel) e desligado no `next dev`.** Para manter a demonstração aberta na Vercel até a W8, crie `AUTH_ENFORCED=false` lá |
| `BETTER_AUTH_SECRET` | Segredo (≥ 32 caracteres, `openssl rand -base64 32`), diferente por ambiente. Sem ele o login fica indisponível (com `AUTH_ENFORCED=false`, a tela entra em modo demonstração e vai para `/inicio`) |
| `BETTER_AUTH_URL` | Endereço canônico (ex.: `https://engemase-oee.vercel.app`); única origem confiável |
| `AUTH_DATABASE_URL` | Conexão do Better Auth com um usuário do papel `auth_service` (ver packages/db/README.md). Sem ela usa `DATABASE_URL`, o que só funciona em banco local com superusuário |

Testes (`pnpm --filter web test`): `test/access` (isolamento entre clientes, escopo, papéis, Engemase, suspenso, 2FA; rota com login real) e `test/auth` (Better Auth de verdade no PGlite: bloqueio, sessão, 2FA, política de senha, lista de rotas).
