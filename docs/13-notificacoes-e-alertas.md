# 13 — Notificações e alertas

Alertas avisam as pessoas certas quando algo exige ação: máquina parada há muito tempo, falha, gateway offline, OEE abaixo da meta, paradas sem motivo. Ver [ADR-014](10-decisoes-arquiteturais.md#adr-014--alertas-central-no-app--web-push-próprio).

## Princípios

1. **A central de notificações (o sino) é a fonte da verdade.** O push não chega em todo lugar (iPhone só com o app instalado, desktop só com o navegador aberto, modo "Não perturbe" silencia). Todo alerta fica na central; push, e-mail e WhatsApp são **canais de entrega**.
2. **Push próprio (Web Push padrão):** Push API + Service Worker + chaves VAPID, envio pelas próprias Vercel Functions com a biblioteca `web-push`, inscrições no Neon. Sem custo por mensagem e sem terceiros.
3. **Respeitar o escopo:** ninguém recebe alerta de máquina que não pode ver (cliente e unidades do usuário).
4. **Anti-spam é requisito.** Duração mínima, histerese, deduplicação, agrupamento, horário de silêncio e escalonamento. O Chrome revoga a permissão e limita a taxa de sites que mandam muitas notificações ignoradas.

## Onde funciona (2026)

| Plataforma | Push | Observações |
|---|---|---|
| Chrome / Edge (Windows, macOS, Linux) | Sim | Só com o navegador em execução |
| Chrome Android | Sim | O caminho mais confiável para celular e tablet |
| Firefox desktop e Android | Sim | |
| Safari macOS | Sim | |
| **iPhone / iPad** | **Só com o app instalado na Tela de Início** (iOS/iPadOS 16.4+) | O usuário precisa "Adicionar à Tela de Início" e abrir pelo ícone. A interface vai ensinar isso |
| Smart TVs | Não confiável | TV/Andon **não usa push**: alarme visual e sonoro dentro da página |

Limitações que afetam o desenho:
- a permissão só pode ser pedida **depois de um clique** do usuário, num botão que explique o benefício;
- **toda mensagem precisa mostrar uma notificação** (no Safari, após 3 envios "silenciosos" a inscrição é revogada) — nada de push para sincronizar dados;
- payload de ~4 KB: só título, texto curto, link e identificadores;
- inscrições expiram: o app reenvia a inscrição a cada abertura e o servidor remove as que respondem 404/410;
- botões de ação dentro da notificação só no Chrome/Edge.

**Tablet do operador:** preferir **Android** (no iPad, o app instalado não mantém a tela acesa). No tablet compartilhado, a inscrição é **do dispositivo** (ligada à máquina/linha), não do operador, e é desvinculada no logout.

## Canais

| Canal | Uso | Custo de referência |
|---|---|---|
| **Central no app (sino)** | Sempre | — |
| **Web Push** | Tempo real para quem está fora da tela | Gratuito |
| **E-mail (Resend)** | Resumos (turno/dia), escalonamento, gateway offline para a TI do cliente | Plano a confirmar |
| **WhatsApp Cloud API** | Escalonamento de **crítico sem reconhecimento** (F2b) | ~R$ 0,035 por mensagem de utilidade (confirmar com a Meta); exige templates aprovados e opt-in |
| **Telegram** | Equipe interna Engemase (frota de gateways) | Gratuito |
| SMS | Último nível, só se contratado | Cotação |

## Catálogo inicial de alertas (presets por cliente)

| Tipo | Condição | Padrão | Avaliação |
|---|---|---|---|
| Máquina parada | Estado "parada" há ≥ X min | X = 10 min · aviso | Cron de 1 min; resolve na ingestão |
| Falha | Estado "falha" (com código) | 0–5 min · crítico | Na ingestão + cron |
| Gateway offline | Sem contato há > 60 s, por ≥ 5 min | Crítico · engenharia do cliente + suporte Engemase | Cron de 1 min (unificado com o watchdog) |
| Sem comunicação / dados atrasados | Máquina sem dados há N s | 5 min · aviso · **suprimido se o gateway já estiver offline** | Cron de 1 min |
| OEE abaixo da meta | OEE do turno < meta, depois de M min de turno | M = 120 min · aviso · no máximo 1 por turno | Cron de 5–15 min e no fechamento do turno |
| Paradas sem motivo | Paradas acima do limite de micro-parada sem motivo há > Y min | Y = 30 min · informativo · supervisor · agrupado | Cron de 5 min |
| Acesso remoto | Pedido de acesso aguardando aprovação; sessão iniciada/encerrada | Para o admin do cliente | Evento ([12](12-acesso-remoto-vpn.md)) |
| Operacionais Engemase | Buffer > 80%, relógio > 2 s, ingestão ou cron falhando | Só equipe Engemase | Ingestão / cron |

Falta no modelo atual uma **meta de OEE** por máquina/linha (`oee_target`), que passa a existir.

## Ciclo de vida de um alerta

`aberto → notificado → reconhecido → resolvido` (ou `resolvido automaticamente` quando a condição some, ex.: a máquina volta a produzir).

- **Deduplicação:** um alerta aberto por (regra, máquina); novas ocorrências atualizam o mesmo alerta.
- **Histerese:** só resolve depois de a condição sumir por um tempo mínimo, para não "piscar".
- **Agrupamento:** várias máquinas paradas na mesma linha viram uma notificação.
- **Horário de silêncio** por usuário, exceto para críticos se o usuário optar.
- **Escalonamento:** crítico sem reconhecimento em N min → próximo nível (supervisor → gerente; push → e-mail → WhatsApp).
- **Reconhecer** pela própria notificação (botão no Chrome/Edge; nos outros, abre a tela do alerta) ou pela central.

## Preferências do usuário

Por usuário: quais tipos de alerta, quais unidades/linhas/máquinas (dentro do seu escopo), canais (push, e-mail, WhatsApp), horário de silêncio e **dispositivos inscritos** (lista com nome do aparelho, data e botão "remover").

Botão **"Ativar notificações neste dispositivo"** no perfil e no sino: explica o benefício, pede a permissão, registra a inscrição e envia uma notificação de teste. No iPhone/iPad, mostra antes o passo a passo de instalar o app na Tela de Início.

## Pipeline

1. **Avaliação:** na ingestão (`/sync`, via `after()`) para o imediato (falha, resolução automática); **cron de 1 minuto** para o que depende de duração, escalonamento e novas tentativas.
2. **Criação/atualização** do `alert_event` (com deduplicação).
3. **Destinatários:** usuários com permissão de ver a máquina + preferências + regra.
4. **Entrega:** grava `notification` (central) e enfileira o envio por canal (`notification_delivery`), com tentativas e registro de erro. Inscrições mortas (404/410) são removidas.
5. Em volume maior, a fila de envio pode ir para Vercel Queues (quando sair do beta).

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `alert_rule` | organização, escopo (unidade/linha/máquina), tipo, parâmetros (limites, duração mínima), severidade, destinatários (papéis/usuários), escalonamento, ativo |
| `alert_event` | regra, máquina/gateway, estado, aberto/reconhecido/resolvido em, por quem, dados do momento |
| `notification` | usuário, alerta (ou outro evento), título, texto, link, lida em |
| `notification_delivery` | notificação, canal, inscrição, status, tentativas, erro |
| `push_subscription` | usuário **ou dispositivo de quiosque**, endpoint, chaves, user agent, nome do aparelho, criado/visto em, último sucesso |
| `notification_preference` | usuário, tipos, escopo, canais, horário de silêncio |

## Service worker e PWA

- O app vira **PWA** (manifest + service worker), seguindo o guia oficial do Next.js 16 (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`): chaves VAPID em variáveis de ambiente, Server Actions de inscrever/cancelar.
- O service worker **sempre** mostra a notificação recebida e, ao clicar, abre a tela do alerta.
- Ícones e nome do app: os da Engemase por padrão; por cliente quando houver identidade própria ([14](14-identidade-visual-e-temas.md)).

## Fases

- **MVP:** central de notificações (sino) e página de alertas, com os alertas avaliados pelo cron; preferências básicas.
- **F2a:** Web Push (Chrome/Edge/Firefox/Android + iPhone com app instalado), escalonamento e resumos por e-mail, reconhecimento, dispositivos inscritos.
- **F2b:** WhatsApp (templates aprovados, opt-in), Telegram para a equipe Engemase, agrupamentos avançados.
- **F3:** webhooks, Slack/Teams na API pública, SMS sob demanda.

## A confirmar

Tabela oficial de preços do WhatsApp em BRL · plano do Resend para contas novas · limites de taxa do Chrome · push/tela sempre ligada em Smart TV e iPadOS recente · versão estável da biblioteca `web-push`.
