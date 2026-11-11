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
