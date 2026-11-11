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
  oee/      domínio: StateBadge, OeeRing, OeeBreakdown, KpiCard, MachineCard, StateTimeline
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
