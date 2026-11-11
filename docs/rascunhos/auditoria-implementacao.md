> **Rascunho** gerado pela auditoria de 11/11/2026 (implementação e backlog). Consolidado em `docs/17-backlog-e-pendencias.md`.

# O que falta no sistema Engemase OEE: implementação real e backlog (11/11/2026)

## Resumo

- **A implementação real ainda não começou.** O repositório tem 233 arquivos versionados: a documentação (`docs/00` a `docs/15` e 2 rascunhos) e o protótipo `apps/web`, que usa dados simulados.
- **As pastas planejadas não existem:** `packages/`, `gateway/`, `tools/`, `deploy/`, `.github/`, `turbo.json`, `go.work`, `.env.example`, `vercel.json`, `apps/web/app/api`, `apps/web/server/`, `middleware.ts`/`proxy.ts` e `instrumentation.ts`. Também não há nenhum arquivo `.go`, `.sql` ou `.test`/`.spec`, nem Dockerfile.
- **O protótipo não tem nenhuma peça de backend.** O `apps/web/package.json` não tem drizzle, better-auth, @neondatabase, zod, @tanstack, resend, web-push, @sentry, vitest nem playwright. Também não há Route Handler (`route.ts`) nem `"use server"`. As ações apenas mostram um aviso na tela (`toast` do sonner, em 12 arquivos).
- **O checklist da Fase 0 em `docs/09` está todo desmarcado.** As 22 telas que ainda são placeholder estão sendo construídas em paralelo e não foram auditadas aqui. O `docs/16` (projeto do gateway) está sendo consolidado em paralelo.

Como conferir:
```bash
for p in packages gateway tools deploy .github turbo.json go.work .env.example vercel.json apps/web/app/api apps/web/server; do [ -e "$p" ] && echo "EXISTE $p" || echo "FALTA $p"; done
git ls-files | grep -E "\.(test|spec)\.|\.go$|\.sql$|Dockerfile|\.env"   # vazio
grep -rl "@/lib/mock" apps/web/app apps/web/components | wc -l           # 63
grep -cE "^export (async )?(function|const)" apps/web/lib/mock/index.ts # 47
```

---

## 1. O que foi previsto e o que existe

| Componente | Previsto em | Existe hoje? | O que falta |
|---|---|---|---|
| Monorepo (Turborepo + módulo Go) | ADR-001, `docs/02` §Estrutura, `docs/09` F0 | **Parcial.** `pnpm-workspace.yaml` já inclui `packages/*`, mas não há pacotes. O `package.json` da raiz só tem scripts `--filter web` e não tem `test` | `turbo.json`; `packages/{db,contracts,oee-core}`; `go.work` (gateway + `tools/plc-sim` + `tools/release-sign`); lint e formatação compartilhados |
| `packages/db` (schema Drizzle, migrações, RLS, seeds) | `docs/06`, `docs/15` §4 e §9, `docs/13` (tabelas), ADR-004/005/007 | **Não** | **Schema:** cerca de 36 tabelas do MVP (`docs/06` + `docs/15` §9) e 4 a 6 de alertas (`docs/13`), mais as tabelas do Better Auth. **Banco:** `drizzle.config`, primeira migração em SQL, `FORCE ROW LEVEL SECURITY` com política por `app.org_id`, papel de banco sem `BYPASSRLS`, FKs compostas `(id, organization_id)`, vínculo `gateway_machine`, partições com pg_partman (`production_minute` mensal, `tag_sample` diária) e índices parciais. **Seeds:** super admin e "Engemase Lab" por script auditado, mais o branch-semente sintético. **PoC do driver** com carga de 100 gateways |
| `packages/contracts` | `docs/04`, `docs/09` F0 | **Não** | Schemas Zod de `enroll`/`sync`/`config`/comandos, exportação para JSON Schema, fixtures e teste de contrato TS↔Go. Antes, decidir os ajustes do rascunho de software §9 (duas filas de ack, `setup_s`, tipos de evento, `config_status`). Eles ainda não estão no `docs/04`: o grep por `setup_s` e `ack_samples_seq` volta vazio |
| `packages/oee-core` (testes golden) | `docs/07`, `docs/09` F1 | **Não.** O OEE só é calculado no mock, e com dois desvios do `docs/07` (abaixo) | Funções puras: turnos no fuso IANA, paradas planejadas, micro-paradas, produção durante parada planejada, tempo ideal por produto e agregação Σ(boas × ciclo) ÷ Σ planejado. Teste golden (exemplo de 78,4%) e testes de propriedade. Nenhum dos dois desvios abaixo pode ir para a camada real |
| Autenticação (Better Auth) | `docs/15` §5, ADR-010, `docs/08` | **Não.** `app/(auth)/login/page.tsx` é só a tela | Plugins organization, admin, twoFactor e `nextCookies`; `membershipLimit`; `trustedOrigins` sem curinga. `/api/auth/*` fechado por lista de permissão, com teste de CI para rota não classificada. Fluxo "definir senha" com `account_token` próprio (token no `#` da URL). 2FA obrigatório para a equipe Engemase. Limite de tentativas no login, no 2FA e nos códigos |
| Multi-cliente / `requireTenant` / camada de dados | `docs/15` §2–4, `docs/05` | **Não.** O grep por `requireTenant` volta vazio e não existe `apps/web/server/` | `TenantContext` e camada de acesso a dados obrigatória. Escopo por unidade que falha fechado (`member_access`/`member_unit`). Concessão de suporte e atribuição de campo com prazo. Faixa "Engemase acessando". 404 para quem não tem acesso. `Cache-Control: private`. Remover `generateStaticParams` (7 arquivos) e `export const instant = false` (`app/layout.tsx`), proibidos na versão real (`docs/15` §4.6) |
| Terminais (TV/tablet) | `docs/15` §1 e §8 (itens 11–12), `docs/05` | **Não.** O protótipo usa `app/(kiosk)/[cliente]/andon/[linhaId]` e `operador/[maquinaId]` | Tabela `terminal`, pareamento por código, token de dispositivo (só o hash), revogação e prazo absoluto, em caminho próprio `/terminal` e `/terminal/parear`. Corrigir `lib/roles.ts`, que descreve o visualizador como "ideal para TV / Andon": isso contradiz a regra "sem contas compartilhadas" |
| API dos gateways `/api/gateway/v1` | `docs/04`, `docs/02` fluxos A–C | **Não** (não existe `app/api`) | **Endpoints:** `POST /enroll` (código com hash, válido por 24 h; token de 256 bits guardado como SHA-256), `POST /sync` (gzip, até 1 MB, uma transação, ack só depois do commit), `GET /config` (ETag/304). **Comandos:** fila com expiração (`tag.read`, `device.test`, `config.reload`, `agent.restart`); revogação de token. **Configuração:** `config_version` imutável com diff e "reverter". Do rascunho de rede: `GET /ping` e host próprio (`gw.oee…`). `releases/latest` fica para a F2 |
| Ingestão e idempotência | `docs/04` §Regras de processamento, `docs/07` §Dados atrasados | **Não** | **Gravação:** `ON CONFLICT (id) DO NOTHING` para eventos (UUIDv7); upsert de `production_minute (machine_id, bucket_start)`; `machine_live` só quando o dado é mais novo; `tag_sample DO NOTHING`. **Validações:** máquina e tag pertencem ao gateway; rejeitar timestamps no futuro (+2 min); reescrita de minuto gera alerta e guarda a versão anterior. **Efeitos:** marcar `oee_shift.dirty`; a ingestão continua com o cliente suspenso. Teste de carga com 100 gateways |
| Cron jobs | `docs/05` §Jobs, `docs/02` E | **Não** (sem `vercel.json` nem `app/api/cron`) | No MVP: `close-shifts`, `recompute-dirty`, `gateway-watchdog`, `expire-commands` e `retention`, protegidos por `CRON_SECRET`, idempotentes e em lotes. Na F2: `daily-report` |
| Alertas e push | `docs/13`, ADR-014 | **Não.** Existe só a interface do sino; não há manifest nem service worker em `app/` ou `public/` | **MVP:** `alert_rule`, `alert_event`, `notification`, `notification_preference`, `oee_target`; avaliação no cron e na ingestão (`after()`); deduplicação e histerese. **F2a:** PWA, Web Push (VAPID, `web-push`, `push_subscription`, `notification_delivery`), escalonamento por e-mail. **F2b:** WhatsApp e Telegram |
| E-mail transacional | `docs/15` §5 (MVP); o `docs/05` ainda diz F2 | **Não** | Resend com domínio remetente (SPF/DKIM). Modelos: definir senha, redefinir senha, aviso de acesso da Engemase e aviso de suspensão |
| Troca dos dados simulados pela camada real | `docs/05`; `apps/web/README.md` ("trocar pela camada real depois") | **Não.** 63 arquivos importam `@/lib/mock`; `lib/mock/index.ts` exporta 47 funções | **Dados:** reescrever as 47 funções sobre a camada de dados com escopo de cliente. **Ações:** Server Actions com Zod e `audit_log` no lugar dos avisos `toast`. **Ao vivo:** `/api/live` com TanStack Query (não instalado). **Limpeza:** remover `MOCK_NOW` e `seededRandom`. **Rotas previstas e ausentes:** `/[cliente]/linhas/[lineId]` (RF05), definir senha e `/terminal/*`. Status do cliente sem o estado "encerrado" (`lib/mock/types.ts:18` × `docs/15` §6) |
| Agente do gateway em Go (`gateway/`) | `docs/03`; rascunho de software §3–8 (M0–M9) | **Não** (sem `go.mod` e sem nenhum `.go`) | Marcos M0 a M4b do rascunho: codec, planejador de leituras, drivers TCP/RTU, motor de estados e contadores, outbox SQLite, uplink, comandos, saúde e CLI. O daemon `oee-netd` (18 menções no rascunho de rede) **não aparece** no rascunho de software nem no plano M0–M9: precisa ser estimado ou adiado |
| Simulador `tools/plc-sim` | `docs/03` §Simulador, `docs/09` F0 | **Não** | Servidor Modbus TCP (`simonvetter/modbus`), escravo RTU próprio sobre PTY, bloco OEE padrão, cenários com semente, relógio acelerado e gabarito para o teste de conservação de peças. O `docs/03` ainda cita OPC UA, que está fora do MVP |
| Pacote `.deb` e OTA | `docs/03` §OTA, `docs/08` CI/CD, rascunho de software §7.3 | **Não** (sem `deploy/gateway`, `.goreleaser.yaml` e `tools/release-sign`) | Units systemd com hardening, sysusers/tmpfiles, `postinst`, `install.sh`, nftables e sysctl. M4b (OTA mínimo): `oee-updater`, manifesto assinado em Ed25519, rollback e publicação no Vercel Blob. Chave de assinatura num environment protegido do GitHub |
| Helper de VPN | `docs/12`, ADR-013 (F2) | **Não** | PoC Tailscale (6 itens do `docs/12`); `oee-remote-access` (tsnet); CA SSH em KMS; tabelas `remote_access_*`; aprovação com MFA; kill switch local e global |
| CI (GitHub Actions) | `docs/08` §CI/CD, rascunho de software §7.4 | **Não** (sem `.github/`) | **Web:** lint, typecheck, Vitest, build. **Gateway:** vet, golangci-lint com `forbidigo`, `test -race`, e2e com plc-sim (TCP e RTU/PTY), govulncheck. **Contratos:** fixtures TS↔Go. **Banco:** migração no branch Neon do preview e em produção antes de promover o deploy. **Releases:** Playwright contra o preview; tag `gateway-v*` → goreleaser |
| Ambientes (Vercel, Neon, branch-semente) | `docs/08` §Ambientes, `docs/06` §Ambientes, `docs/15` §8 (item 8) | **Não dá para ver pelo repositório.** Não há `vercel.json` nem `.env.example`, e `.vercel/` está no `.gitignore` | **Projeto:** Vercel Pro com Deployment Protection; Neon pela integração da Vercel, com os branches de preview criados **a partir do branch-semente sintético** (nunca da produção). **Domínios:** `oee.engemase.com.br` e o host dos gateways. **Variáveis:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`, token do Blob e, na F2, VAPID. **Banco:** papel da aplicação sem `BYPASSRLS` |
| Observabilidade | `docs/08` §Observabilidade | **Não** (sem `@sentry` e sem `instrumentation.ts`) | Sentry com limpeza de tokens nos logs (`docs/15` §8, item 9); `pg_stat_statements`; alertas de ingestão e de cron; Log Drain se necessário. Os 6 runbooks do `docs/08` estão marcados como "a escrever" |
| Testes | `docs/05` (Vitest/Playwright), `docs/07`, `docs/15` §4.7, rascunho de software §7.5 | **Não** (nenhum arquivo de teste e nenhum script `test`) | **Web:** unitários do oee-core (golden e propriedade), testes de contrato, e2e com Playwright e testes de isolamento nos 4 níveis do `docs/15` §4.7 (catálogo, RLS, rotas e Server Actions com IDs de outro cliente, exportações). **Gateway:** cobertura ≥ 85%, cenários de falha F1–F20, conservação de peças e testes na bancada com hardware real (HIL) |
| Segurança web (limite de taxa, CSP) | `docs/08` §Plataforma web, `docs/15` §8 | **Não.** `apps/web/next.config.ts` não tem `headers()` | CSP, HSTS, `X-Frame-Options` (com exceção para a TV), `Referrer-Policy: no-referrer`; regras do Vercel Firewall; limite por gateway na aplicação; `audit_log` em toda alteração |
| LGPD | `docs/08` §LGPD, RNF11, `docs/12` (metadados da Tailscale fora do Brasil), `docs/15` §6 | **Não** (nada no código nem nos documentos) | Retenção configurável, exportação e exclusão a pedido, runbook de encerramento de cliente e registro de quem acessou (suporte e VPN). A parte jurídica está na seção 3 |

### 1.1 Inconsistências que afetam o backlog

Estes pontos devem ser resolvidos no `docs/16` (em andamento) e nos documentos 04, 05 e 09 antes de escrever o código.

1. **Critério de saída da Fase 0 × plano do gateway.** O `docs/09` exige que o gateway "envie `/sync` e os dados apareçam gravados na Neon". O M0 do rascunho de software não tem uplink, que só entra no M2. É preciso incluir um envio provisório na Fase 0 ou mudar o critério.
2. **`docs/04` desatualizado.** Ainda não tem os ajustes 3 a 7 do rascunho de software §9 nem os comandos `net.*` e `/ping` do rascunho de rede. O `packages/contracts` depende dessa decisão.
3. **`oee-netd` sem estimativa** (ver a linha do agente Go acima).
4. **RLS duplicada no roadmap.** O `docs/09`, linha 83, ainda tem "Avaliar RLS" na Fase 2, mas o `docs/06` e o `docs/15` põem a RLS no MVP.
5. **Teste de driver errado.** O `docs/09`, linha 37, compara "serverless HTTP vs `pg` + pool". Só que a RLS exige transação interativa (`docs/15` §4), então o driver HTTP não serve para as consultas de cliente. A PoC deve comparar `pg` + pool com o driver serverless da Neon via WebSocket.
6. **Resend:** o `docs/05`, linha 17, diz "Resend (F2)"; o `docs/15` §5 põe no MVP.
7. **Desvios do cálculo de OEE no protótipo.** `aggregateOee` (`apps/web/lib/mock/index.ts:91–101`) usa média simples, que o `docs/07` proíbe. `generated.ts:218` devolve disponibilidade 0 quando o tempo planejado é 0; o `docs/07`, passo 7, manda devolver `null`.

---

## 2. Backlog priorizado

### 2.1 Premissas

- Dois desenvolvedores: **Web** (dev 1) e **Gateway** (dev 2), revezando como diz o `docs/09`.
- A semana 1 começa em 16/11/2026, a data de início do Gantt do `docs/09`. As semanas são de trabalho efetivo; o recesso de fim de ano não está no Gantt e empurra as datas.
- As estimativas do gateway vêm do rascunho de software §8. As da web são minhas, levando em conta que as telas já existem no protótipo.

### 2.2 Épicos da Fase 0 e da Fase 1 (até o piloto)

| ID | Épico | Trilha | Fase | Semanas | Depende de | Pronto quando |
|---|---|---|---|---|---|---|
| **N1** | Contas e ambientes (seção 3) | Fora do código | F0 | 1 | — | Projeto na Vercel e na Neon e domínio criados |
| **W1** | Fundação: `turbo.json`, pacotes vazios, `go.work`, CI web, `.env.example`, Sentry básico | Web | F0 | 1 | N1 | PR verde no CI e deploy de preview funcionando |
| **X1** | `packages/contracts` (Zod → JSON Schema + fixtures + teste no Go) | Ambos | F0 | 0,5 + 0,5 | Decisão sobre o §9 | Fixtures validam em TS e em Go |
| **W2a** | Schema núcleo (organização, ativos, gateway, dispositivo, tag, eventos, minutos) + primeira migração | Web | F0 | 1 | W1 | Migração aplicada no branch de preview |
| **W3** | `/enroll` + `/sync` mínimos gravando na Neon + PoC do driver com 100 gateways | Web | F0 | 1 | W2a, X1 | Critério de saída da Fase 0 (com G0) |
| **G0** | M0: `gateway/`, codec, transportes TCP/RTU, `modbus read`, plc-sim TCP + RTU/PTY, `.deb` mínimo, CI do gateway + **envio provisório de `/sync`** | Gateway | F0 | 3 | Hardware (N2) para a bancada | R1000 lê as 3 RS-485 e um CLP TCP por 24 h e envia `/sync` |
| **W2b** | RLS completa, FKs compostas, `gateway_machine`, partições, seeds, branch-semente | Web | F1 | 1 | W2a | Teste de catálogo: toda tabela de cliente com RLS forçada |
| **W6** | API completa: config versionada (diff, reverter), fila de comandos, ingestão completa (sujos, tolerância, reescrita), saúde, limite por gateway | Web | F1 | 1,5 | W3 | Gateway simulado aplica a config e responde a comandos |
| **W4** | `oee-core` + golden + propriedades | Web | F1 | 1 | — (pode adiantar) | Exemplo de 78,4% e propriedades verdes |
| **G1** | M1: núcleo de coleta | Gateway | F1 | 2 | G0 | 72 h com conservação de 100% |
| **G2** | M2: buffer e uplink | Gateway | F1 | 2 | G1, X1, W3/W6 no preview | 100 agentes contra o preview por 1 h sem erro |
| **W5** | Identidade e multi-cliente: Better Auth, lista de permissão, `requireTenant`, camada de dados, escopo, definir senha + Resend, concessões e atribuições, testes de isolamento | Web | F1 | 3 | W2b | Testes de isolamento (níveis 1 a 3) verdes no CI |
| **G3** | M3: config remota, comandos e saúde | Gateway | F1 | 1,5 | G2, W6 | Config aplicada em < 15 s; "Ler agora" em < 3 s |
| **W7** | Cron (5 jobs) | Web | F1 | 1 | W4, W6 | Turno fechado e recálculo de dados atrasados conferidos |
| **G4** | M4: produto instalável (`.deb` completo, CLI status/diag, energia) | Gateway | F1 | 1,5 | G3, hardware | Instalação em ≤ 15 min só com o roteiro; F4, F5, F16, F17 |
| **G4b** | M4b: OTA mínimo (recomendado antes do piloto) | Gateway | F1 | 1–1,5 | G4 | Atualização e rollback na bancada |
| **W8** | Troca do mock (1): cadastros, gateways, tags e teste de leitura, console Engemase mínimo (assistente de novo cliente) | Web | F1 | 2 | W5, W6 | Máquina colocada no ar pela web, de ponta a ponta |
| **W9** | Troca do mock (2): ao vivo (`/api/live`), linha do tempo, relatório de OEE, tela do operador, terminais pareados (se Q4 = sim) | Web | F1 | 2 | W4, W7, W8 | Dashboard ao vivo e relatório com dados reais |
| **W11** | Segurança e qualidade: CSP/HSTS, Firewall, Playwright no preview, isolamento nível 4, limpeza de logs | Web (feito pelo dev 2 no revezamento) | F1 | 1–1,5 | W5 | e2e verde; cabeçalhos ativos |
| **P** | Piloto (2 semanas) + teste de longa duração de 14 dias na bancada (F18) | Ambos | F1 | 2 | W9, W11, G4b, cliente pronto | Critérios do `docs/09` |
| **W10** | Alertas MVP (sino, regras padrão, preferências básicas, `oee_target`) | Web | F1 | 1 | W7 | Durante o piloto |
| **W12** | Central de ajuda (conteúdo e abertura de chamado) | Web | F1 | 0,5 | W5 | Durante o piloto |

### 2.3 O que roda em paralelo, semana a semana

| Semana | Web (dev 1) | Gateway (dev 2) | Fora do código |
|---|---|---|---|
| 1 | W1 | G0: esqueleto, codec, CI do gateway, plc-sim TCP | Compra do hardware, contas, despachante, decisões |
| 2 | W2a + X1 | X1 (lado Go), transportes TCP/RTU, plc-sim RTU/PTY | Especificação v1 do bloco OEE |
| 3 | W3 | G0: envio provisório de `/sync`, bancada, `.deb` mínimo | Escolha do cliente piloto |
| **≈ 3–4** | **Saída da Fase 0** | | |
| 4 | W2b | G1 | |
| 5–6 | W6, depois W4 | G1 → G2 | |
| 7 | W4 → W5 | G2 | |
| 8–10 | W5 | G3, depois G4 | Liberação do TI do cliente (3 a 10 dias úteis, rascunho de rede §6.5) |
| 11 | W7 | G4 → G4b | Bloco OEE no CLP do piloto (2 a 8 h por CLP) |
| 12–13 | W8 | G4b; início do teste de 14 dias na bancada | Preparação em bancada (24 h de burn-in) |
| 14–15 | W9 | Revezamento: W11 | Termo de piloto assinado |
| 16–17 | Piloto + W10/W12 | Piloto + teste de longa duração | |

### 2.4 Caminho crítico

`N1 → W1 → W2a → W3 → W2b → W6 → W4 → W5 → W7 → W8 → W9 (+W11) → Piloto`

- **A trilha web é o caminho crítico.** São cerca de 15 semanas até ficar pronta para o piloto, contra cerca de 12,5 da trilha do gateway (G0 a G4b). O gateway tem folga de 2 a 3 semanas, que vai para o W11 e para o teste de longa duração.
- **Riscos externos que entram no caminho crítico:**
  - chegada do hardware: precisa estar na bancada até a semana 3 (saída da Fase 0) e até a semana 9 (testes de energia e watchdog do G4);
  - decisão sobre o §9 do protocolo até a semana 2 (X1);
  - cliente piloto com bloco OEE (ou módulo de I/O) e liberação do TI até a semana 13.

### 2.5 Comparação com o `docs/09`

- **Prazo:** o Gantt do `docs/09` põe o piloto na semana 11 (25/01/2027). Pela minha estimativa, ele fica entre a **semana 14 e a 16** (cerca de 15/02 a 01/03/2027, sem contar o recesso), ou seja, **de 3 a 5 semanas depois**.
- **Gateway:** M1 a M4 cabem nas 7 semanas; o M4b soma de 1 a 1,5.
- **Web:** 7 semanas não cobrem todo o escopo web da Fase 1 do `docs/09` (cerca de 13 semanas de trabalho web depois da Fase 0).
- **Cortes que adiantam o piloto (decisão do dono do produto):**
  - terminais só se Q4 = sim (−0,5 semana);
  - console Engemase mínimo, só com o assistente de novo cliente e a lista (−0,5);
  - alertas e central de ajuda para depois do piloto (já está assim no plano acima);
  - `oee-netd` para a F2, com rede estática configurada na preparação em bancada.

### 2.6 Fases 2 e 3 (estimativa aproximada)

| Épico F2 | Web | Gateway | Fonte |
|---|---|---|---|
| OTA completo (canais, rollout, `min_agent_version`), `logs.upload`, `token.rotate`, `modbus.scan` remoto | 1 | 2 (M6) | `docs/03`, rascunho de software §8 |
| Comissionamento local (página local, `identify`, enroll pela página) | — | 1,5 (M7) | rascunho de software §8 |
| `oee-netd` + mudança de rede pela web com rollback | 0,5 | 1,5–2 | rascunho de rede §1.3–1.9 |
| Acesso remoto por VPN (PoC Tailscale antes) | 2 | 2–3 (M8) | `docs/12` |
| Web Push + PWA + escalonamento por e-mail + `daily-report` | 1,5–2 | — | `docs/13` |
| Pareto, MTBF/MTTR, tendências, exportação CSV/Excel | 1,5 | — | RF13 |
| Templates, importação CSV, `fault_code_map` (classificação automática) | 1,5–2 | — | RF12, RF17 |
| Cores e logotipos por cliente (`client_branding`, Blob, manifest) | 1,5 | — | `docs/14` |
| 2FA para admins do cliente e "ver como usuário" (impersonação) somente leitura | 1 | — | `docs/15` §3 |
| Protocolos nativos (S7comm, EtherNet/IP, OPC UA), conforme Q1 | — | 2–3 por protocolo | M9 |

A F2 dá de 9,5 a 11 semanas na web e de 9 a 11,5 no gateway (sem os protocolos nativos), contra 8 semanas no `docs/09`. É preciso priorizar pela resposta à Q1.

A F3 (API pública e webhooks, MQTT/Sparkplug, billing, arquivamento frio, escrita no CLP) não foi reestimada: depende das respostas Q8 e Q9.

---

## 3. Itens que não são software

### 3.1 Hardware de bancada (`docs/09` F0, rascunho de software §7.5, rascunho de rede §6.6 e §6.7)

| Item | Observação |
|---|---|
| 2× Seeed reComputer R1000 **R10xx-00** (2 GB/16 GB) | Cerca de R$ 2.400–2.700 cada, nacionalizado por courier (`docs/03`). Pedir à Seeed confirmação por escrito de que o lote é a revisão **v1.1** |
| Módulo SuperCAP UPS LTC3350 | Necessário para o teste F5 e para o GPIO de falta de energia. A cotar |
| Fonte 24 VDC em trilho DIN, disjuntor, bornes com fusível | Ex.: Mean Well HDR-60-24 |
| 1 CLP com Modbus TCP nativo | Schneider M221 ou Delta |
| 1 módulo de I/O remoto Modbus TCP | Com contador de hardware |
| Barramento RS-485 com 2 a 3 escravos | Cabo de 120 Ω blindado, resistores de 120 Ω |
| Relé de alimentação comandado pelo host do runner + mini PC como runner da bancada | Testes F4 (500 ciclos de energia) e HIL noturno |
| Kit do técnico | Adaptador USB-RS485 isolado, USB-Ethernet, mini switch, cliente Modbus (mbpoll ou QModMaster), multímetro |
| Tablet Android e TV (se Q4 = sim) | Testes de terminal e Andon (`docs/13` recomenda Android) |

### 3.2 Contas e serviços

| Serviço | Para quê | Referência de custo (dos docs) | Quando |
|---|---|---|---|
| GitHub (org `EngemaseAutomacao`, já é o remote) | Actions, proteção de branch, environment protegido para a chave Ed25519; **runner arm64 a confirmar** | — | Agora |
| **Vercel Pro** | Hospedagem, Cron, Blob, Firewall, Deployment Protection | US$ 20 por membro/mês + uso (`docs/08`) | Agora |
| **Neon** (Marketplace da Vercel) | Banco e branches de preview a partir do branch-semente | US$ 20–160/mês em produção (`docs/06`) | Agora |
| **Domínio e DNS** | `oee.engemase.com.br` e host dos gateways (`gw.…`, nome a definir) | — | Agora |
| **Resend** | E-mail transacional (MVP), com SPF/DKIM | Plano a confirmar (`docs/13`) | Semana 6–7 |
| **Sentry** | Erros do app | Gratuito ou Team | Semana 1 |
| **Tailscale Standard** | VPN (F2); confirmar por escrito como os nós "tagged" são cobrados. O plano pessoal gratuito não pode ser usado | Cerca de US$ 80/mês sob demanda (`docs/12`) | Antes da F2 |
| KMS | CA SSH (F2) | Fornecedor a escolher | F2 |
| Meta WhatsApp Cloud API / bot do Telegram | Escalonamento (F2b) | Cerca de R$ 0,035 por mensagem (`docs/13`) | F2b |

### 3.3 Compra, importação e ANATEL

- **Cotação:** pedir cotação formal (DigiKey, Mouser ou parceiro). Courier para o piloto, importação formal (DI) via trading para a frota.
- **Despachante:** definir a NCM (8471.50 × 8517.62), que muda o imposto de importação e a anuência.
- **ANATEL a confirmar com um OCD:** se um equipamento **sem rádio**, só com Ethernet e RS-485, precisa de homologação. Se o cliente precisar de 4G, usar roteador já homologado.

### 3.4 Contrato, termos e LGPD

- **Contrato SaaS + acordo de tratamento de dados** (cliente como controlador, Engemase como operadora). Cláusulas: acesso da Engemase aos dados (P4), inadimplência (P6), encerramento, prazos e formato da exportação (P7), retenção (Q5), política e possível gravação do acesso remoto (`docs/12`, Fase C).
- **Termos de uso e política de privacidade** publicados no login. Encarregado (DPO) indicado e registro das operações de tratamento.
- **Transferência internacional:** metadados da Tailscale ficam nos EUA/Europa (`docs/12`). Definir a região da Neon e das Functions da Vercel e registrar a transferência se ficarem fora do Brasil (LGPD, art. 33).
- **Termo de piloto** com o cliente: escopo, 2 semanas, critérios de saída do `docs/09`, responsável pelo gateway. Também a ficha técnica para o TI (rascunho de rede §3).

### 3.5 Decisões e preparação do piloto

- **Perguntas abertas:** Q1 a Q9 (`docs/01`) e P1 a P11 (`docs/15` §10). As mais urgentes:
  - Q1: marcas de CLP e se a Engemase pode incluir o bloco OEE;
  - Q3: escala do primeiro ano;
  - Q4: tablet do operador;
  - P2 e P3: quem configura usuários e gateways;
  - P8: 2FA para o cliente;
  - P11: quem serão os super admins.
- **Decisões dos rascunhos:** fazer ou não o M4b; `oee-netd` no MVP ou na F2; caixa pré-montada; supercapacitor em todas as unidades; quem fornece o switch OT; nome do domínio dos gateways; IPv6.
- **Bloco OEE padrão:** especificação v1 e bloco ou rotina para a primeira marca de CLP (equipe de automação, `docs/11` §3).
- **Cliente piloto:** escolher a linha, que precisa ter contador no CLP para conferência, e pedir com antecedência a liberação do TI.

---

## 4. Os 10 próximos passos (semana de 16 a 20/11/2026)

1. **Pedir cotação formal e comprar** os 2 R1000 R10xx-00, o SuperCAP, o CLP Modbus TCP, o módulo de I/O, os escravos RS-485 e o relé da bancada (seção 3.1). O prazo de importação é o maior risco para a saída da Fase 0.
2. **Consultar o despachante e um OCD** sobre a NCM e a ANATEL (equipamento sem rádio), em paralelo com o passo 1.
3. **Criar as contas:** Vercel Pro, Neon pela integração da Vercel (deixar o branch por preview desligado até existir o branch-semente), domínio e DNS, Sentry, proteção de branch no GitHub. Resend e SPF/DKIM podem esperar até a semana 6.
4. **Dono do produto decide os bloqueios da semana 2:**
   - Q1, Q3 e Q4;
   - ajustes do protocolo do rascunho de software §9 (duas filas de ack, `setup_s`, tipos de evento, `config_status`);
   - fazer ou não o M4b; `oee-netd` no MVP ou na F2;
   - critério de saída da Fase 0 com envio provisório de `/sync`;
   - P2, P3, P8 e P11.
5. **Dev web: PR de fundação (W1).** `turbo.json`, `packages/{db,contracts,oee-core}` vazios, `go.work`, workflow de CI da web (lint, typecheck, build), `.env.example` e scripts `test`/`typecheck` na raiz.
6. **Dev gateway: esqueleto do agente (G0).** `gateway/go.mod`, codec Modbus com testes das 4 ordens de words, workflow de CI do gateway (vet, golangci-lint com `forbidigo`, `test -race`) e plc-sim TCP com o bloco OEE.
7. **Os dois juntos: contrato v1 (X1).** Schemas Zod de `enroll`/`sync`/`config` com os ajustes aprovados, exportação para JSON Schema, fixtures e leitura das fixtures no teste em Go.
8. **Dev web: começar o schema núcleo (W2a).** Drizzle, primeira migração, política de RLS por `app.org_id`, papel de banco sem `BYPASSRLS` e seed do super admin e da "Engemase Lab". Criar o branch-semente sintético na Neon.
9. **Equipe de automação e comercial:** escrever a especificação v1 do bloco OEE (`docs/11` §3), escolher o cliente e a linha do piloto e enviar ao TI a ficha técnica (rascunho de rede §3).
10. **Abrir as issues no GitHub** a partir dos épicos da seção 2.2, com as dependências marcadas. Atualizar `docs/00-status.md` e `docs/09-roadmap.md`: datas revistas, as 7 inconsistências da seção 1.1 e o recesso de fim de ano.

Arquivos de referência (todos em `/home/user/engemase-oee`):
- **Roadmap e status:** `docs/09-roadmap.md`, `docs/00-status.md`
- **Contrato e dados:** `docs/04-protocolo-gateway-nuvem.md`, `docs/06-banco-de-dados.md`, `docs/15-multi-cliente-e-acesso.md`
- **Rascunhos do gateway:** `docs/rascunhos/gateway-software.md` (§7–10), `docs/rascunhos/gateway-rede-e-instalacao.md` (§6–7)
- **Protótipo:** `apps/web/lib/mock/index.ts`, `apps/web/lib/mock/generated.ts`, `apps/web/next.config.ts`, `apps/web/package.json`, `package.json`, `pnpm-workspace.yaml`