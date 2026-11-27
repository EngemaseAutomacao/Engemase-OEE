# apps/web — Plataforma Engemase OEE (Next.js)

Interface da plataforma. As telas de acompanhamento leem o banco quando `DATABASE_URL` existe (ver "Dados das telas"); sem banco, e nas telas ainda não trocadas, usam os dados simulados (`lib/mock`).

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

## Dados das telas: banco ou simulado (`lib/data`)

As telas trocadas pelo banco leem só da camada `lib/data/`. Cada função usa o banco quando `DATABASE_URL` existe e os dados simulados (`lib/mock`) quando não (a demonstração na Vercel não tem banco): `usarBanco()` em `lib/data/fonte.ts`.

- **Acompanhamento do cliente (W9)** — `lib/data/cliente`: `getClientData(slug, necessidades)` devolve um `ClienteDados` com as mesmas consultas do protótipo (`getMachinesWithLive`, `getTimeline`, `getHourlyProduction`, `getDailyOee`, `getShiftHistory`, `getStopRecords`, `getPareto`, `aggregateOee`, `getNotifications`...). Usado por visão geral, máquinas, máquina, linha, relatórios de OEE e de paradas, notificações, ajuda, Andon e tela do operador (e pelo menu/cabeçalho do layout, com `somenteCadastro`).
  - Com banco: `requireTenant(slug)` (sessão, papel, escopo; sem acesso → 404) e leitura sob RLS (`banco.ts`); o cálculo é do `@engemase/oee-core` (`calculo.ts`, puro, testado em `test/data`). Turno corrente = janela do turno que contém "agora" (fora do horário, o último que terminou). Turnos fechados: `oee_shift` quando o fechamento gravou e não está sujo; senão, calculado dos eventos e minutos (histórico somado em blocos de 15 min). Conexões e tags só com leitura técnica.
  - "Dados atrasados": `machine_live.at` com mais de 30 s ou gateway sem `/sync` há mais de 6 min (fica fora do OEE agregado, como no protótipo).
  - As páginas leem dentro de `<Suspense>` (esqueleto em `components/shell/page-skeleton.tsx`), sem `generateStaticParams`. O layout `(shell)/[cliente]` mantém `generateStaticParams`/`instant = false` enquanto as telas de `config/*` não tiverem `<Suspense>`.
  - `/terminal/[id]` é só simulação: com banco responde 404 (o terminal real abre pelo token do aparelho, ainda não implementado).

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
  `exigirEquipe` (papel de plataforma) e um `withTenant` por cliente (`app.cron_organizations()`).
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
- **Real × demonstração:** o projeto `engemase-oee` (sistema real) só mostra dados do banco; telas que ainda não têm versão real mostram "Em breve" (`components/shell/tela-em-breve.tsx`) e o `/inicio` leva cada pessoa ao console ou ao(s) cliente(s) dela. O projeto `engemase-oee-demo` roda o mesmo código com `ENGEMASE_DEMONSTRACAO=1`: nunca enxerga banco, usa só os dados simulados de `lib/mock` e mostra a faixa "Ambiente de demonstração".
- Banco: endereços por papel em `lib/server/db-url.ts`. Na Vercel, o app e o login usam o `DATABASE_URL` da integração Neon (com pooler) com os próprios usuários (`app_login` com `APP_DB_PASSWORD`; `auth_login` com `AUTH_DB_PASSWORD`), ou `APP_DATABASE_URL`/`AUTH_DATABASE_URL` completos, e **nunca** o dono; sem a senha, as telas seguem simuladas e a API dos gateways responde 503. Fora da Vercel (dev, testes), o `DATABASE_URL` vale como está. Opcional: `DATABASE_POOL_MAX` (padrão 5). As migrações e os usuários de login saem do build de produção, antes do `next build` (`vercel.json`; ver [packages/db](../../packages/db/README.md#implantação-neon--vercel)).
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
> 2ª tentativa das 11h). **Desde 27/11/2026 as outras quatro são chamadas pelo cron-job.org** (conta da Engemase),
> com `GET` e o cabeçalho `Authorization: Bearer <CRON_SECRET>`: `alertas` (1 min), `expiracao` (5 min), `vpn`
> (15 min) e `turnos` (de hora em hora, no minuto 10), sempre em `https://engemase-oee.vercel.app/api/cron/<job>`.
> Trocou o `CRON_SECRET` na Vercel? Troque também nas quatro tarefas do cron-job.org e publique de novo. Chamada a
> mais não faz mal: cada janela roda uma vez só (`app.cron_claim`). Ao passar para o Pro, troque `PLANO_VERCEL`
> para `"pro"`, ponha no `vercel.json` as 6 entradas da tabela (o teste `test/cron/cron.test.ts` confere que os
> dois batem) e desligue as tarefas do cron-job.org.

| Rota | Quando | O que faz |
|---|---|---|
| `/api/cron/alertas` | 1 min | Gateway sem `/sync` há mais de 6 min → alerta crítico (resolve ao voltar); gateway "Em trânsito" (L23: `in_transit_until` no futuro e `installed_at` nulo) não alerta e o alerta aberto resolve; minuto reescrito resolve em 24 h |
| `/api/cron/expiracao` | 5 min | Comandos, concessões de suporte e token anterior vencidos |
| `/api/cron/vpn` | 15 min | Pedidos de acesso sem decisão (24 h); `vpn.disable`/`ot.forward.close` para sessões e encaminhamentos vencidos |
| `/api/cron/limpeza` | 03:30 UTC | Limitador, histórico dos crons, saúde (30 dias), comandos (90 dias), códigos antigos; login (`auth-cleanup.ts`: bloqueios vencidos, verificações e links "definir senha" antigos); auditoria além de `AUDITORIA_RETENCAO_DIAS` (padrão 5 anos, D6; `app.audit_log_purge`, lotes de 5.000); partições de `production_minute`/`tag_sample` com `maintainPartitions()` pela conexão de manutenção (sem `DATABASE_MAINTENANCE_URL`, registra e pula) |
| `/api/cron/resumo-diario` | 10h e 11h UTC | Resumo por cliente para a equipe Engemase pelo Resend (a 2ª chamada só envia se a 1ª falhou) |
| `/api/cron/turnos` | :10 de cada hora | Fechamento de turno (W7): cada turno terminado há 5 min ou mais, nos últimos 7 dias, ganha uma linha em `oee_shift` por máquina ativa, calculada pelo `@engemase/oee-core` (feriado da unidade não tem turno); depois recalcula os turnos sujos (`dirty`: dado atrasado do `/sync`, refugo lançado depois). Até 300 cálculos por cliente por execução; o resto aparece em `shifts_pending` e sai na hora seguinte |

- Protegidas por `CRON_SECRET` (a Vercel manda `Authorization: Bearer <CRON_SECRET>`): sem a variável, 503; segredo errado, 401.
- Uma execução por janela (`cron_run`, `app.cron_claim`): chamada repetida responde `skipped`; erro libera a janela.
- Para rodar à mão: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/limpeza`.
- Fechamento e recálculo de turno em `lib/server/production/oee-shifts.ts`; o `/sync` marca o turno sujo com um
  UPDATE que trava a linha, e o recálculo pega a linha com `FOR UPDATE SKIP LOCKED`: dado que chega durante o
  recálculo deixa o turno sujo de novo, nunca se perde.

### Regras de produção conferidas no servidor (`lib/server/production`)

Funções para as telas da W8 chamarem (a rota confere login, permissão e escopo antes). A tela do operador usa as Server Actions de `app/(kiosk)/[cliente]/operador/actions.ts` (`floor.act` + máquina no escopo; refugo e estorno por `recordQualityEntry`/`reverseQualityEntry`). Erros esperados saem como
`ProductionRuleError` (código + mensagem em português; status HTTP em `PRODUCTION_ERROR_STATUS`).

| Função | Regra |
|---|---|
| `saveShift` (`shifts.ts`) | Turnos da mesma unidade não se sobrepõem (dias da semana, vigência e turno noturno, L2); turno com turnos já fechados não muda horário, dias nem pausas (encerre a vigência e crie outro); pausas dentro do turno; auditoria |
| `recordQualityEntry` (`quality.ts`) | Refugo manual soma ao do CLP; prazo até o fim do turno seguinte, depois só supervisor ou admin do cliente (L3); motivo ativo; operador ativo da mesma unidade (L19); marca o turno consolidado como sujo; auditoria |
| `reverseQualityEntry` (`quality.ts`) | Estorno com motivo, um por lançamento, mesmo prazo do lançamento; auditoria |
| `classifyStop` (`floor.ts`) | Motivo numa parada ou falha (STOPPED/FAULT); motivo ativo do cliente; vale a última classificação e `reasonId = null` desfaz (L19); mesmo prazo do refugo (L3); máquina no escopo de quem age (`allowMachine`); auditoria (`downtime.classified`/`downtime.unclassified`) e turno sujo |
| `changeProduct` (`floor.ts`) | Troca de produto pelo operador (docs/05: quando não vier do CLP): fecha a corrida aberta e abre outra em `production_run` (origem `operator`); auditoria e turno sujo. O cálculo (tela e fechamento de turno) preenche os minutos SEM produto do CLP com a corrida que valia (`fillMinuteProducts`, `runs.ts`); minuto com produto do CLP fica como está |

### Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Banco (ver acima) |
| `DATABASE_POOL_MAX` | não | Conexões por instância (padrão 5) |
| `CRON_SECRET` | sim, para os crons | Segredo das rotas `/api/cron/*` (a Vercel envia sozinha) |
| `DATABASE_MAINTENANCE_URL` | não | Conexão direta (sem pooler) com o papel DONO das tabelas, só para a limpeza diária criar/apagar partições (DDL). Aberta e fechada na tarefa. Sem ela, as partições não são mantidas (a 0013 deixou 3 meses / 8 semanas adiante) e o log avisa |
| `AUDITORIA_RETENCAO_DIAS` | não | Dias que a auditoria fica guardada (padrão 1825 = 5 anos, D6; mínimo 365, que o banco também confere). Valor inválido: a auditoria não é limpa e a tarefa responde 500 |
| `RESEND_API_KEY` · `RESUMO_DIARIO_DE` · `RESUMO_DIARIO_PARA` | não | Resumo diário por e-mail (remetente verificado no Resend; destinatários separados por vírgula). Sem elas o resumo não é enviado |

## Login e acesso por cliente (W5)

Better Auth (senha, sessão, 2FA) + autorização nossa ([docs/15](../../docs/15-multi-cliente-e-acesso.md)).

- **Login** (`app/(auth)/login`): a tela do protótipo chama Server Actions (`actions.ts`) que usam `auth.api.*` no servidor. Senha ≥ 12 sem regra de composição; senha nova conferida contra vazamentos (k-anonimato, `lib/server/auth/password.ts`; sem rede, aceita). 5 senhas erradas em 15 min → 15 min bloqueado (`throttle.ts`, tabela `auth_login_throttle`, chave = hash do e-mail). Sessão de 12 h renovada com o uso; "manter conectado" até 30 dias, nunca para a equipe Engemase (`session-policy.ts`).
- **2FA** (TOTP + 10 códigos de recuperação, plugin two-factor): **opcional para todos** (D14). Ativa-se em `/conta/seguranca` com a senha atual: a tela mostra um QR code de verdade (`lib/qr.ts`, biblioteca `qrcode`, desenhado no servidor) para o aplicativo escanear, com a chave para digitar como alternativa; desativa-se ali também, com a senha.
- **`/api/auth/*` fechado por padrão** (`lib/server/auth/routes.ts`): só `get-session`, `sign-out`, `sign-in/email` e a verificação do 2FA; o teste falha se o Better Auth ganhar rota não classificada. Redefinição de senha e "definir senha" passam só por Server Actions.
- **Convite e "definir senha"** (`lib/server/users/invite.ts`, `lib/server/auth/set-password.ts`, tela `/definir-senha`): o admin do cliente (ou o super admin) convida pelo **e-mail** — a pessoa é achada/criada no servidor, nunca por `user_id` do navegador (revisão W11 §3.2); unidades e máquinas do escopo são conferidas sob a RLS (id de outro cliente é recusado). Conta nova recebe um link de uso único (72 h) com o token no **fragmento** (`/definir-senha#t=…`, fora de logs); o banco guarda o hash (`account_token`). Quem já tem senha só recebe o aviso do novo acesso. Reenvio troca o link. Server Actions em `app/(shell)/[cliente]/config/usuarios/actions.ts`, ligadas à tela (W8, 27/11/2026).
- **Cadastro de motivos de parada** (`config/motivos`): dados em `lib/data/config/motivos.ts` (uso dos últimos 7 dias); regras em `lib/server/config/reasons.ts` (`config.write`, RLS, motivos herdam categoria/cor do grupo, nome único entre irmãos, ocultar leva os filhos, motivo usado só é ocultado, `system_key` protegido, auditoria `downtime_reason.*`). O mapa de códigos de falha (`fault_code_map`, por máquina/modelo, F2) ainda não tem tela no sistema real. Testes em `test/access/config-reasons.test.ts`.
- **Cadastro de produtos** (`config/produtos`): dados em `lib/data/config/produtos.ts`; regras em `lib/server/config/products.ts` (`config.write`, RLS, código único entre os não excluídos, exclusão lógica, ciclos por máquina em `product_machine`, auditoria `product.*`); Server Actions finas em `config/actions.ts`. Importação por CSV só na demonstração. Testes em `test/access/config-products.test.ts`.
- **Tela "Usuários" do cliente** (`config/usuarios`): lista real em `lib/server/users/list.ts` (vínculo, papel e escopo sob a RLS; nome, e-mail, 2FA, senha e último uso pelo banco do login, só das pessoas que a RLS mostrou) e dados da página em `lib/data/config/usuarios.ts` (inclui o quadro "Acesso da equipe Engemase" real). Ver: `config.read`; gerenciar: `users.manage`. Alterar papel/escopo e desativar/reativar em `lib/server/users/manage.ts`: ninguém altera o próprio acesso; o cliente nunca fica sem admin ativo (linhas dos admins travadas com `FOR UPDATE` na mesma transação); desativar é por cliente (`member_access.active`), sem banir a conta; reativar respeita `limits.users`; tudo auditado com antes/depois (`user.access_change`, `user.disable`, `user.enable`). "Enviar redefinição de senha" (`requestMemberPasswordReset`) reaproveita o pedido do "Esqueci minha senha": só para vínculo ativo e conta com senha criada, limite por e-mail igual e limite "por IP" com chave própria do admin (não gasta o do escritório), auditado (`user.password_reset_requested`, inclusive quando barrado). Pessoas da equipe Engemase não são geridas pela tela do cliente. "Outro admin" que impede rebaixar/desativar o último é só quem já criou a senha e não está bloqueado (lido do banco do login ANTES da transação). Vagas travadas por `pg_advisory_xact_lock` (`lib/server/users/seats.ts`). Quem só tem `config.read` não recebe 2FA nem último acesso dos colegas; a lista não diz se a pessoa tem outros clientes. Login e `/inicio` só levam a clientes com vínculo ativo (`activeClients` em `lib/server/auth/landing.ts`). Testes em `test/access/users-manage.test.ts`.
- **Esqueci minha senha** (diálogo do login → `app/(auth)/senha-actions.ts` → `lib/server/auth/password-reset.ts`; tela `/redefinir-senha`): resposta igual exista ou não a conta, envio depois da resposta (`after`), limite de 3 pedidos/h por e-mail e 10/h por IP (`attempts.ts`, mesma tabela `auth_login_throttle` com chaves próprias), link de 30 min com o token no fragmento e guardado como hash (`verification.storeIdentifier`). Salvar derruba as sessões e o bloqueio. Envio de token: 20/15 min por IP.
- **Aviso de conta bloqueada** (`lock-notice.ts`): no 5º erro, e-mail à dona da conta (só se a conta existe e não está banida).
- **Reiniciar o 2FA de outra pessoa** (`lib/server/users/two-factor-reset.ts`): admin do cliente para membros do próprio cliente que não são admin nem têm vínculo com outro cliente; super admin para qualquer membro do cliente; nunca a si mesmo nem a equipe Engemase; suporte e engenheiro de campo não podem (sem `users.manage`). Apaga segredo e códigos, desliga o 2FA, encerra as sessões, audita antes (`user.two_factor_reset`) e avisa a pessoa.
- **E-mail** (`lib/server/email`): Resend com `RESEND_API_KEY` + `EMAIL_FROM`; sem eles, só registra no log (destinatário mascarado e assunto; o texto com o link só fora de produção).
- **Resumos com escopo** (`lib/server/access/summary.ts`, D11): totais de produção por máquina/linha/unidade, CSV, alertas abertos e auditoria somam só o que o escopo deixa (escopo por máquinas: a linha e a unidade somam só as máquinas permitidas).
- **`requireTenant(slug)`** (`lib/server/access/require-tenant.ts`; para route handlers, `tenantForRequest` em `route.ts`): sessão → cliente da URL → vínculo, papel, escopo, estado do cliente e concessão Engemase, lidos sob RLS (`load.ts`) e decididos por `decideAccess` (`context.ts`, função pura). Sem acesso → 404. Dados de cliente só por funções que recebem o `TenantContext` (`data.ts`) e aplicam o escopo (`scope.ts`). Exemplo real: `GET /api/clientes/{cliente}/maquinas`.
- **Proxy** (`proxy.ts`): com `AUTH_ENFORCED` ligado, tela do sistema sem cookie de sessão vai para `/login?next=…` (checagem otimista; a autorização é no servidor). Com banco, a casca do cliente e as telas de cadastro passam por `requireTenant` (W8).

| Variável | Para quê |
|---|---|
| `AUTH_ENFORCED` | `true` exige login nas telas do sistema; `false` deixa o protótipo navegável. **Sem a variável: ligado em produção (`NODE_ENV=production`, inclusive na Vercel) quando o `BETTER_AUTH_SECRET` existe, e desligado no `next dev`.** Enquanto o login não for configurado na Vercel, a demonstração continua aberta; ao criar o segredo, o login passa a ser exigido (para manter a demonstração aberta mesmo assim até a W8, crie `AUTH_ENFORCED=false`) |
| `BETTER_AUTH_SECRET` | Segredo (≥ 32 caracteres, `openssl rand -base64 32`), diferente por ambiente. Sem ele o login fica indisponível (com `AUTH_ENFORCED=false`, a tela entra em modo demonstração e vai para `/inicio`) |
| `BETTER_AUTH_URL` | Endereço canônico (ex.: `https://engemase-oee.vercel.app`); única origem confiável |
| `AUTH_DATABASE_URL` | Conexão do Better Auth com um usuário do papel `auth_service` (ver packages/db/README.md). Sem ela usa `DATABASE_URL`, o que só funciona em banco local com superusuário |
| `EMAIL_FROM` + `RESEND_API_KEY` | E-mails da conta (convite, redefinição, bloqueio, 2FA reiniciado). Sem eles nada é enviado (só log); configure antes de convidar pessoas em produção |

Testes (`pnpm --filter web test`): `test/access` (isolamento entre clientes, escopo, papéis, Engemase, suspenso, 2FA; rota com login real; `users.test.ts` convite/definir senha/2FA e **nível 3**; `summary.test.ts` agregados, CSV, alertas e auditoria com escopo, **nível 4**), `test/auth` (Better Auth de verdade no PGlite: bloqueio, sessão, 2FA, política de senha, lista de rotas, redefinição de senha, aviso de bloqueio, envio de e-mail) e `test/cron/auth-cleanup.test.ts` (limpeza do login no job `limpeza`).
