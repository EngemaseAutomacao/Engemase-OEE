> **Rascunho** gerado pela auditoria de 11/11/2026 (documentação e decisões). Consolidado em `docs/17-backlog-e-pendencias.md`.

# Auditoria da documentação e decisões pendentes (Engemase OEE, 11/11/2026)

**O que li:** `README.md`, `docs/00` a `docs/15` e os dois rascunhos em `docs/rascunhos/`. Do protótipo vi só os nomes de rota em `apps/web/app` e fiz buscas pontuais com grep. Não editei nenhum arquivo. O doc 16 do gateway está sendo consolidado em paralelo; aqui ele aparece como "em andamento".

**Resumo:**
- O repositório tem só `apps/web` e `docs`. **Não existem ainda** `packages/` (o `pnpm-workspace.yaml` declara `packages/*`), `gateway/`, `tools/`, `deploy/`, `.github/` nem `turbo.json`. Hoje o contrato gateway↔nuvem existe apenas como exemplos JSON no `docs/04`.
- **Requisitos funcionais:** o protótipo mostra 7 dos 20 (sim), 5 em parte e 8 não. Duas observações:
  - **RF08 (turnos) e RF09 (produtos), que são do MVP, ainda estão como placeholder.**
  - RF13 (relatório de paradas) e RF14 (TV Andon), que são da Fase 2, já estão prontos.
- **ADRs:** 15 das 16 ainda estão como "Proposta". O README, porém, diz "planejamento concluído".
- **Maiores buracos de especificação:**
  - contrato formal do `/sync`;
  - calendário de turnos;
  - refugo manual;
  - região de hospedagem e LGPD;
  - planos e preços;
  - SLA;
  - backup e recuperação (depois de um restore do banco, os gateways não reenviam o que já foi confirmado);
  - metas de OEE.

---

## 1. Cobertura dos requisitos (`docs/01`)

**Legenda:**
- "Sim": a tela existe com dados simulados.
- "Parcial": existe só uma parte, ou componente não ligado a nenhuma página.
- "Não": a rota não existe ou mostra "em construção".
- "n/a": requisito da borda ou da infraestrutura, que não aparece na interface.

### Requisitos funcionais

| ID | Fase | Onde está especificado | Protótipo | Observação |
|---|---|---|---|---|
| RF01 Hierarquia | MVP | 15 §1–2; 06 "Ativos" e "Multi-tenancy"; 05 "Isolamento" | Sim | `/[cliente]/config/unidades`; seletor de cliente em `app/page.tsx`; o seletor de unidade é só visual (`components/shell/unit-selector.tsx`) |
| RF02 Provisionamento por código | MVP | 02 Fluxo A; 04 "Autenticação" e `POST /enroll`; 06 `gateway_enrollment`; 03 "Sistema operacional e instalação" | Parcial | `config/gateways` é placeholder. `components/access/provision-dialog.tsx` e `activation-dialog.tsx` existem, mas `gateways-view.tsx` não é importado por nenhuma página |
| RF03 Conexões e tags por papel | MVP | 03 "Configuração de tags"; 04 `GET /config`; 06 "Conectividade"; 11 §6 | Parcial | Conexões e tags aparecem só para leitura no detalhe da máquina (`components/monitoring/connection-card.tsx`). `config/maquinas/nova` é placeholder e o assistente `components/config/wizard-*.tsx` não está ligado a nenhuma página |
| RF04 Teste de leitura | MVP | 04 "Tipos de comando" (`tag.read`, `device.test`); 02 Fluxo C; 05 "Autogestão" (passos 3 e 6) | Parcial | Botão "Testar leitura" simulado (toast) em `components/monitoring/connection-actions.tsx`. "Ler agora" e "Testar conexão" só existem no assistente desligado |
| RF05 Dashboard ao vivo | MVP | 02 Fluxo D; 05 "Dados ao vivo"; 06 `machine_live` | Sim | `/[cliente]`, `/[cliente]/maquinas` e `/maquinas/[maquinaId]`. Não há a tela de linha (`/linhas/[lineId]` do 05) |
| RF06 Linha do tempo | MVP | 05 (mapa de telas, stack ECharts); 06 `machine_state_event`; 09 Fase 1 | Sim | `components/monitoring/machine-timeline.tsx` |
| RF07 Motivo de parada | MVP | 05 "Tela do operador"; 07 "Modelo de estados" e "Micro-paradas" | Sim | `/(kiosk)/[cliente]/operador/[maquinaId]` e `classify-stop-dialog.tsx` |
| RF08 Turnos, calendário, paradas planejadas | MVP | 06 `shift` e `planned_downtime`; 07 "Algoritmo" (passos 1–2) | **Não** | `config/turnos` é placeholder |
| RF09 Produtos e ciclo ideal | MVP | 06 `product` e `product_machine`; 07 (passo 5) | **Não** | `config/produtos` é placeholder. A troca de produto existe no terminal (`components/kiosk/product-dialog.tsx`) |
| RF10 Relatório de OEE | MVP | 05 `relatorios/oee`; 07 | Sim | `/relatorios/oee`. Inclui a cascata de perdas, que o 07 coloca em F2+ |
| RF11 Status dos gateways | MVP | 04 (`agent` e `devices` do `/sync`); 06 `gateway` e `gateway_device_status`; 08 "Observabilidade" | Parcial | `config/gateways`, `config/gateways/[gatewayId]` e `admin/gateways` são placeholders. O status do CLP aparece no detalhe da máquina |
| RF12 Classificação por código de falha | F2 | 06 `fault_code_map`; 07 (estado `FAULT`) | Não | `config/motivos` é placeholder. A regra para vários códigos ativos, prioridade e sobrescrita pelo operador não está especificada |
| RF13 Pareto, MTBF/MTTR, exportação | F2 | 07 "Métricas complementares"; 05 `relatorios/paradas` | Sim / Parcial | `/relatorios/paradas` tem Pareto e "MTBF/MTTR estimado". `components/reports/export-menu.tsx` só mostra um toast |
| RF14 TV/Andon | F2 | 05 `/terminal`; 15 §1 e §8 (#11–12); 14 "Tema do usuário" | Sim | `/(kiosk)/[cliente]/andon/[linhaId]`, em caminho diferente do especificado (ver C8) |
| RF15 Alertas | F2 | 13 (inteiro); ADR-014 | Parcial | Sino (`components/shell/notification-bell.tsx`); `/notificacoes` é placeholder; `components/monitoring/alerts-panel.tsx` não é usado |
| RF16 OTA | F2 | 03 "Atualização remota (OTA)"; 04 `releases/latest` e `agent.update`; rascunho de software §2.6 e M4b | Não | — |
| RF17 Templates e importação CSV | F2 | 05 "Autogestão"; 06 `machine_template`; 11 §3 | Não | Não há rota `config/templates`. O formato do CSV não está definido |
| RF18 Varredura Modbus | F2 | 04 `modbus.scan`; 11 §7; 15 §8 (#13) | Não | Só aparece no assistente desligado |
| RF19 API pública e webhooks | F3 | 05 `/api/v1/*`; 09 Fase 3; 15 §1 ("Integração") | Não | Sem especificação de recursos, autenticação ou eventos |
| RF20 Escrita no CLP | F3+ | ADR-008; 08 "Gateway"; 09 Fase 3 | Não | Correto, fica fora do v1 |

### Requisitos não funcionais

| ID | Onde está especificado | Protótipo | Observação |
|---|---|---|---|
| RNF01 Sem perda de dados | 03 "Buffer offline"; 02 (princípios 4–5); 04 "Regras de processamento"; rascunho de software §4.4 | n/a | Coerente: o RNF pede ≥ 7 dias e o 03 adota 30 dias / 1 GB |
| RNF02 ≤ 5 s / ≤ 15 s | 02 Fluxo D; 04 (frequência do `/sync`); 05 "Dados ao vivo"; ADR-009 | n/a | Com os padrões documentados, o tempo pode passar de 5 s (ver C1) |
| RNF03 Só saída 443 | 02 (princípio 2); ADR-003; 08 "Gateway"; rascunho de rede §2 | n/a | — |
| RNF04 Somente leitura | ADR-008; 08; rascunho de software §3.3 (lint `forbidigo`) | n/a | — |
| RNF05 Multi-tenant | 15 §4; ADR-016; 06 "Multi-tenancy" | Parcial | URL por cliente. As 7 rotas com `generateStaticParams` são permitidas só no protótipo (15 §4.6) |
| RNF06 UTC e fuso da planta | 06 "Convenções"; 07 (passo 1 e "Casos especiais") | n/a | Falta regra para relatórios que somam unidades em fusos diferentes e para o fuso das exportações |
| RNF07 500 máquinas / 100 gateways | 02 "Escalabilidade"; 06 "Volume"; 08 "Custos" | n/a | As contas do 02 e do 06 são para 100 máquinas / 20 gateways; a Fase 0 testa só 100 gateways |
| RNF08 Hardware modesto 24/7 | 03 "Hardware"; rascunho de software §2.5 e §6.4 | n/a | — |
| RNF09 Auditoria | 06 `audit_log`; 08 "Auditoria"; 15 §3 e §9 | Não | `config/auditoria` e `admin/auditoria` são placeholders |
| RNF10 i18n | Só no 01 | Não | Nenhum doc define a abordagem; `apps/web/package.json` não tem biblioteca de i18n |
| RNF11 LGPD | 08 (linha "LGPD"); 06 (retenção); 12 "Ficha técnica" | n/a | Especificação mínima (ver L7) |

### Funcionalidades especificadas que não têm RF

Estes itens estão previstos para o MVP nos docs 05, 09, 13 e 15, mas não constam em RF01–RF20:
- refugo manual e troca de produto (05 "Tela do operador");
- central de notificações (13 "Fases");
- central de ajuda (09, linha 62);
- console Engemase e ciclo de vida do cliente (15 §6–7);
- terminais pareados (15);
- e-mail transacional (15 §5);
- metas de OEE (13, linha 56);
- CLI e página local de campo (rascunhos).

Também ficam sem RF o acesso remoto por VPN (12) e a identidade visual (14). **Sugestão:** criar RF21 em diante.

---

## 2. Lacunas de especificação para implementar

| # | Tema | O que já existe | O que falta | Bloqueia |
|---|---|---|---|---|
| L1 | **Contrato `/sync` e `/enroll` (`packages/contracts`)** | Exemplos JSON no 04; ajustes propostos no rascunho de software §9 (#3–#7) e no rascunho de rede §7 | Ver detalhe abaixo da tabela | Critério de saída da Fase 0 |
| L2 | **Turnos e calendário** | Uma linha em 07:74 (turno que atravessa a meia-noite pertence à data de início); `shift` e `planned_downtime` (06) | Dia da semana do turno noturno; feriados e exceções (RF08 cita "calendário", mas não há tabela); intervalos dentro do turno (o protótipo tem `breaks` em `Shift`, o 06 usa `planned_downtime` com "recorrência" sem formato); turnos sobrepostos; máquina produzindo fora do turno; vigência e recálculo quando o turno muda; "dia produtivo" dos relatórios diários | RF08 e `oee-core` (Fase 1) |
| L3 | **Refugo manual, retrabalho, troca de produto** | `quality_entry` e `production_run` (06); 07:77; 05 "Tela do operador" | 07:77 diz "menos ajustes manuais de `quality_entry`" (o refugo manual deveria somar ao refugo e reduzir as boas?); tabela de motivos de refugo; regra quando o CLP já envia `count.reject` (dupla contagem); retrabalho (Q mede "refugo e retrabalho", mas não há campo); a que turno pertence um lançamento atrasado; edição e estorno; permissão após o fechamento; produto desconhecido vindo do CLP | Tela do operador (Fase 1) |
| L4 | **Metas e faixas de OEE** | 13:56 cria `oee_target`; o 14 diz que as faixas são travadas | `oee_target` não está no 06 nem no mapa de rotas; os valores das faixas só existem no protótipo (85% / 60% em `apps/web/lib/states.ts`) | Alerta "OEE abaixo da meta" e cores |
| L5 | MTBF/MTTR, Pareto, TEEP | Citados no 07 | Fórmulas (quais paradas entram: micro-paradas, planejadas, `NO_COMM`) | F2 (já aparece no protótipo) |
| L6 | **Exportação** | Formatos citados em 4 lugares: RF13 (CSV/Excel), 12 (CSV/PDF), P7 (CSV/Parquet), rascunho de rede 6.4 (PDF de instalação) | Colunas; job assíncrono; limites; validade do link no Blob; fuso; separador decimal (CSV com ";"); exportação completa do cliente | F2, encerramento, LGPD |
| L7 | **LGPD e privacidade** | 08:52; retenção sugerida no 06; ficha técnica do 12 | Papéis de controlador e operador, DPA, termos de uso e política de privacidade; lista de suboperadores (Vercel, Neon, Resend, Sentry, Tailscale) e transferência internacional; **operador de chão** (nome no terminal, mas não há tabela `operator` no 06 nem no 15 §9; uso para avaliar desempenho individual); pedido de exclusão × 06:156 ("dados de produção nunca são apagados"; anonimizar `classificado_por`?); retenção de logs com IP; resposta a incidentes | Contrato do piloto |
| L8 | **Região de hospedagem** | Nada (nenhum doc cita região da Vercel ou da Neon) | Escolher a região; isso afeta latência e LGPD | Fase 0 |
| L9 | **Planos e preços** | Q8 e P5; o protótipo inventou `starter|pro|enterprise` com limites (`apps/web/lib/mock/types.ts`) | Catálogo de planos; unidade de cobrança; preço do hardware (venda ou comodato); serviços (bloco OEE "2–8 h por CLP" e instalação de ~1 dia, rascunho de rede §6.5); métricas de limite; faturamento | Venda e piloto pago |
| L10 | **Onboarding comercial** | 15 §7 (só a parte técnica, assistente de 3 passos); rascunho de rede §6 (visita, testes de aceite, termo) | Proposta e contrato; questionário de pré-venda; quem passa o cliente de "Implantação" para "Ativo" e com que critério; treinamento de usuários; cronograma padrão; recolhimento dos gateways no encerramento | Primeira venda |
| L11 | **SLA e suporte** | Nada | Disponibilidade alvo, RPO e RTO; horário e severidades; **ferramenta de chamados** (05:30, 09:62 e 15:58 citam "chamado #1042", mas o sistema não é definido); status page; janelas de manutenção; troca em garantia e estoque de gateways reserva | Contrato |
| L12 | **Testes de aceite** | 09:70–73 (piloto); casos golden (07); isolamento (15 §4.7); falhas F1–F20 (rascunho de software §7.5); testes em campo T1–T10 (rascunho de rede §6.3) | Critérios por RF; tolerância do "OEE batendo com o cálculo manual" (09:73); teste de carga da web para o RNF07; como medir o RNF02; matriz de navegadores, TVs e tablets; acessibilidade além do contraste | Saída da Fase 1 |
| L13 | **Observabilidade da nuvem** | 08 "Observabilidade" (lista de ferramentas) | SLOs; alertas e quem recebe (ver C15); métricas de ingestão (atraso, rejeições e quarentena por gateway); monitoramento dos crons; retenção de logs (Log Drain "se necessário"); correlação gateway↔requisição; limpeza de dados sensíveis no Sentry | Operação |
| L14 | **Backup e recuperação** | 06 "Backup e recuperação": restore point-in-time (PITR) "conforme o plano" e exportação lógica "ex.: semanal", sem destino | RPO e RTO; teste de restauração. **Depois de um PITR, os dados já confirmados não voltam**, porque o rascunho de software §4.4 apaga a outbox confirmada a cada 10 min; o runbook do 08 ("Restaurar banco (PITR) e reprocessar turnos") não trata isso. Falta também backup do Blob, da CA SSH no KMS, das chaves VAPID e da chave Ed25519 do OTA (perder essa chave deixa a frota sem atualização) | Produção |
| L15 | **Documentação para o usuário final** | 09:62 (central de ajuda) | Conteúdo por papel (operador, supervisor, admin, TI do cliente); guia de instalação do PWA no iPhone (13); especificação do bloco OEE e biblioteca de blocos de função (FB) por fabricante (11 §3); os 6 runbooks marcados "a escrever" no 08; notas de versão | Piloto |
| L16 | Modelo de dados consolidado | 06 | O 06 não tem as tabelas dos docs 12–15 (`remote_access_*`, `alert_*`, `notification*`, `push_subscription`, `client_branding`, `terminal`, `support_access_grant`, `platform_assignment`), nem `oee_target`, operador ou `gateway_network_config` | Fase 0 (schema) |
| L17 | Jobs agendados | 05 "Jobs" | Faltam: avaliação de alertas (13), reconciliação da VPN a cada minuto (12), expiração de concessões, atribuições e terminais (15), manutenção de partições (pg_partman), limpeza de `account_token` | Fase 1 |
| L18 | i18n (RNF10) | Só a linha no 01 | Biblioteca, catálogos de texto, formatos de número e data, unidades | Baixo agora, caro depois |
| L19 | Terminais e operador | 15 (`terminal`); 05:149 ("fila local") | Formato e validade do código de pareamento; várias TVs por linha; onde se cadastra a lista de operadores; conflito entre a fila offline do tablet e uma reclassificação feita no desktop | Fase 1 |
| L20 | Autenticação | 15 §5 e §8 | Política de senha; duração da sessão; bloqueio por tentativas (15 #15 só diz "rate limit"); recuperação do 2FA; SSO corporativo | Fase 1 |
| L21 | Limites da API | 08 "Rate limiting": "limite por gateway na aplicação" | Os números | Fase 1 |
| L22 | Ciclo de vida do gateway | 08 (runbook de troca de hardware) | Preparação da imagem, troca, descomissionamento: **em andamento no doc 16** | — |

**Detalhe do que falta em L1 (contrato):**
- a pasta `packages/` ainda não existe;
- JSON Schema com campos obrigatórios, tipos e limites (itens por array, tamanho de strings);
- corpo da resposta 400, para apontar o item ruim;
- erros do `/enroll`: código inválido, expirado ou já usado;
- `ack_seq` com duas filas;
- catálogo de tipos de evento (o 04 só mostra `state`);
- campo `setup_s` no minuto;
- schema e ETag do `GET /config`;
- `payload` e `result` de cada tipo de comando;
- quando ocorre o 409;
- o que o agente faz abaixo de `min_agent_version`;
- mapeamento de `produto`: uint16 no bloco OEE (11 §3) e string `"PRD-001"` no 04;
- formato dos IDs (ver C13).

---

## 3. Contradições e trechos desatualizados

### Entre os documentos

| # | Tema | Onde | Divergência | Sugestão |
|---|---|---|---|---|
| C1 | RNF02 ≤ 5 s | 01:57 × 03:294, 04:53 e 02:126 | Debounce de estado de 2 s, mais envio imediato com debounce de 1 s (no máximo um a cada 2 s), mais polling de 3–5 s nas telas: no pior caso ~9 s. O teste T3 do rascunho de rede (l. 883) aceita "até 15 s" | Rever o RNF ou reduzir o polling da tela ao vivo e da TV |
| C2 | Latência do "Ler agora" | 02:121 ("1 a 10 s") × rascunho de software M3 (l. 1276, "< 3 s") | O comando só chega ao gateway na resposta do próximo `/sync`, que sai a cada 10 s | Definir no contrato como a tela de comissionamento ativa o modo rápido |
| C3 | Fase da TV Andon | RF14 = F2 (01:44) e 09:81 × 09:68 (terminais pareados com TV Andon na Fase 1) e 14:81 (tema da TV no MVP) | MVP ou F2? | Decidir e alinhar |
| C4 | Fase dos alertas | RF15 = F2 (01:45) × 13:102 e 09:61 (central e alertas por cron no MVP); 05:135 `gateway-watchdog` "(F2)" × 09:64 (Fase 1) | Fase indefinida | Dividir o RF15 entre in-app (MVP) e canais externos (F2) |
| C5 | Frota de gateways no console | 09:66 (Fase 1) × 09:87 (Fase 2) | Aparece nas duas fases | Remover da Fase 2 |
| C6 | 2FA e RLS | 08:44, 15:20 e ADR-016 (2FA da Engemase e RLS no MVP) × 09:83 ("2FA obrigatório para perfis administrativos. Avaliar RLS", na Fase 2). Além disso, 12:76 exige aprovação "com MFA" pelo admin do cliente × P8 (2FA opcional para o cliente) | Fases diferentes e um requisito incompatível com o padrão | Corrigir o 09; decidir a P8 |
| C7 | E-mail e convites | 05:17 ("Resend (F2) — Convites"), 05:13, 05:24 (`/convite/[token]`), 05:80 e o contexto da ADR-010 × 15:79–80, 15:122 e 09:67 | O 15 põe o e-mail no MVP e proíbe o fluxo de convites do Better Auth (usa token próprio para definir senha) | Atualizar o 05 e a ADR-010 |
| C8 | Mapa de rotas | 05:24–55 e 02:165 (`app/(app)/[org]`) × `apps/web/app` | Ver detalhe abaixo da tabela | Reescrever o mapa do 05 a partir das rotas reais |
| C9 | OPC UA e S7 citados como se fossem do MVP | README:82; 02:64, 103, 177, 183; 03:8, 348; 05:75, 78; 08:109 × ADR-011 e 09:36 | Simulador "Modbus + OPC UA", "subscription OPC UA", assistente "conforme Modbus, S7, OPC UA", runbook "PUT/GET, permissões OPC UA". Também 04:45: o exemplo de `/enroll` traz `"model": "Revolution Pi Connect 4"`, mas o hardware padrão (ADR-012) é o R1000 | Marcar como "futuro" ou remover |
| C10 | Operador | 15:23 ("não é conta de login") × 15:38 (papel `operator` com escopo de unidades), 05:89 (operador vê dashboards e relatórios) e 01 "Perfis" | Operador é pessoa com login ou não? | Decidir; o terminal já cobre o uso no chão |
| C11 | Nomes de papéis | 01, linhas 15–23 ("Engenheiro / integrador", "Supervisor / gestor", sem Suporte nem Engenheiro de campo; o super admin "gerencia planos") × 15 §2–3 | Lista desatualizada | Usar os papéis do 15 |
| C12 | Área opcional; termo "planta" | RF01 e P9 (área opcional) × ER do 06:59–60 (planta → área → linha, área obrigatória); "plant" (06) × "unidade" (15, protótipo) × "plantas" (05:39) | Modelo e vocabulário divergentes | Um termo só; corrigir o ER |
| C13 | Formato dos IDs | 06:154 (UUIDv7) × exemplos do 04 (`gw_01JD2X…`, `dev_01JD3K`, `cmd_01JD4A`, `mch_inj03`) | Prefixo e ULID nos exemplos | Definir o formato dos IDs externos |
| C14 | SSH no gateway | 08:31 ("SSH opcional pela OT") e 03:344 ("desabilitado ou só com chave") × 12:45 e 12:119 (OpenSSH só em 127.0.0.1, certificados curtos) | Políticas diferentes | Adotar o 12 |
| C15 | Canal interno de alertas | 08:90 ("e-mail/Slack") × 13:40 e 13:104 (Telegram) | Canais diferentes | Escolher um |
| C16 | Status das ADRs | 10:7–22 (15 de 16 "Proposta") × README:5 ("planejamento concluído"); a ADR-007 está "Substituída pela 016", que ainda é só "Proposta" | O status não reflete a realidade | Aceitar formalmente (ver D37) |
| C17 | Roadmap não reestimado | ADR-016 (10:240, "+3 a 4 semanas na parte web") × 09:42 (Fase 1 em ~7 semanas, já com console, RLS, terminais, notificações, ajuda e e-mail); 09:101 ainda pede resposta para a "Q2 (hardware)", que já foi respondida | Prazo inconsistente | Reestimar |
| C18 | SETUP sem campo no minuto | 03:270 e 11 §3 (estado 3 = setup) × 04 `minutes` e `production_minute` no 06 (sem `setup_s`); o 07 trata setup como categoria de motivo | Os segundos do minuto não fecham em 60 | Já proposto no rascunho de software §9 (#5) |
| C19 | Página local | 03:338 (Fase 2) × rascunho de software §2.8 (status no MVP, opcional) × rascunho de rede §6.2 (a instalação do MVP depende dela) | Fase diferente em cada texto | Resolver no doc 16 |
| C20 | Caminho da credencial | 03:93 (`/etc/oee-gateway/credentials.json`) × rascunho de software §2.3 e §9 (#1) (`/var/lib/oee-gateway`) | Ajuste ainda não aplicado; o rascunho §9 lista 13 ajustes pendentes aos docs 03, 04, 07 e 09 | Aplicar na consolidação |

**Detalhe do C8 (mapa de rotas):**
- O 05 usa `[org]`; o código usa `[cliente]`.
- O 05 tem `config/plantas`, `linhas` e `maquinas`; o código tem `config/unidades`.
- `/linhas/[lineId]` não existe no protótipo.
- O 05 (e o 15:133) prevê `/terminal/parear` e `/terminal`; o código tem `/(kiosk)/[cliente]/andon/[linhaId]` e `/(kiosk)/[cliente]/operador/[maquinaId]`.
- `/[cliente]/maquinas` (lista) e `config/maquinas/nova` não constam no 05.
- As 7 subrotas de `/admin` só aparecem no 15 §7.
- Não há rota para a política e a aprovação de acesso remoto (12), para as regras de alerta (13) nem para metas de OEE.

### Entre os rascunhos do gateway (para quem consolida o doc 16, em andamento)

| # | Divergência |
|---|---|
| R1 | Papel das portas: o rascunho de rede (l. 16–17) diz ETH0 = OT e ETH1 = IT; o de software (§2.9, l. 317, e `gateway.yaml`, l. 882–883) diz IT = `eth0` e OT = `eth1` |
| R2 | O rascunho de software (l. 64 e §5.3, l. 962) diz "A nuvem nunca altera a rede"; o de rede (§1.4.1) prevê a aba "Rede" na web com o comando `net.apply` |
| R3 | O rascunho de software diz que só o atualizador e o helper de VPN têm privilégio (l. 13; tabela §2.1 sem o `oee-netd`); o de rede cria o daemon root `oee-netd` |
| R4 | Nome e fase do comando de identificação: `gateway.identify` em F2 (software, l. 44) × `gw.identify` (rede, l. 675), que o teste T9 (l. 889) já usa na instalação do MVP |
| R5 | Os comandos `net.*`, os endpoints `/ping` e `/uploads/{id}` e o host `gw.oee.engemase.com.br`, propostos nos rascunhos, ainda não estão no 04 |

### Documentos × protótipo

| # | Divergência |
|---|---|
| P1 | Com o gateway offline, "Testar leitura" fica "enfileirada e será executada quando o gateway voltar" (`components/monitoring/connection-actions.tsx`); o 04:121 diz que comandos expiram (2 min) e um comando expirado não é executado |
| P2 | O papel `viewer` é descrito como "ideal para TV / Andon" (`apps/web/lib/roles.ts`); o 15:27 proíbe contas compartilhadas, porque a TV é um terminal pareado |
| P3 | Rotas de quiosque dentro de `/[cliente]/…`; o 15:133 exige caminho próprio `/terminal`, nunca misturado com sessão de pessoa |
| P4 | Planos `starter|pro|enterprise` e limites com `retentionMonths` (`apps/web/lib/mock/types.ts`) e faixas de OEE 85/60 (`apps/web/lib/states.ts`) não existem em nenhum doc |
| P5 | `ClientStatus` não tem "Encerrado" (15 §6); `UserStatus` usa "Convite pendente", mas o 15 fala em "definir senha" |
| P6 | `PLANNED_STOP` é tratado como estado de máquina; no 07, parada planejada é classificação ou calendário, e a borda não gera esse estado |
| P7 | Prioridade invertida: RF13 e RF14 (F2) prontos, enquanto RF08 e RF09 (MVP) estão como placeholder |

---

## 4. Decisões pendentes do dono do produto (consolidadas, sem duplicatas)

### A. Comercial e contrato

| # | Decisão | Fonte | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|---|
| D1 | Modelo comercial: cobrar por máquina, planta ou gateway; planos e limites | 01 Q8; 15 P5; 09 Fase 3; protótipo | Limites editados pelo super admin, com bloqueio na criação; cobrança automática só na F3; nomes de plano só no protótipo | Cobrança no MVP exige integração de pagamento e o estado de inadimplência antes do piloto; a unidade de cobrança define as métricas em `client_account` |
| D2 | Hardware: venda, comodato ou locação; rota de compra | ADR-012; 03 "Compra, impostos e ANATEL"; 08 "Custos" | R1000 R10xx-00 2 GB/16 GB; courier no piloto, importação formal na frota; "normalmente repassado ao cliente". Falta cotação e confirmação de NCM e ANATEL | Comodato muda o contrato e o recolhimento; usar o RevPi (compra nacional) custa ~1,8–2,5× |
| D3 | Inadimplência | 15 P6 | Perde acesso; os gateways continuam enviando | "Só leitura" exige um novo estado e checagem em todas as Server Actions |
| D4 | Encerramento: prazos, formato e quem recolhe os gateways | 15 P7 | 30 dias para exportar + 30 para excluir; CSV/Parquet; recolhimento indefinido | Parquet exige pipeline próprio; prazos diferentes mudam o runbook e o contrato |
| D5 | Acesso da Engemase aos dados de produção | 15 P4 | Liberado com registro e faixa na tela; o cliente pode exigir aprovação | Aprovação caso a caso como padrão leva um fluxo de aprovação de concessões ao MVP |
| D6 | Retenção do histórico | 01 Q5; 06 "Volume" | Minuto: 2 anos; eventos e `oee_shift`: indefinido; auditoria: 5 anos; amostras: 30–90 dias | Exigência de 5 anos ou mais antecipa o arquivamento frio (F3) e aumenta o custo de armazenamento |
| D7 | Região e residência de dados no Brasil | Nenhum doc (lacuna L8); 12 "Ficha técnica" | Indefinido; o controle da Tailscale fica fora do Brasil | Exigir Brasil obriga a confirmar a região na Vercel e na Neon e a trocar a VPN por NetBird self-hosted ou Headscale |
| D8 | Versão on-premises | 01 Q7 | Não; só manter Postgres padrão | Se sim, é preciso abstrair Cron, Blob e Firewall da Vercel |
| D9 | Integração com ERP/MES | 01 Q9 | F3, sem formato | Um cliente-âncora que exija isso antecipa a API pública e as ordens de produção |
| D10 | Gravação de sessão remota à prova de adulteração | 12 "Auditoria e gravação"; ADR-013 | Fase A (trilha + log de I/O do `sudo`) | Se for requisito de venda, entra um bastion (Teleport/Warpgate) e muda o helper |

### B. Acesso e uso

| # | Decisão | Fonte | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|---|
| D11 | Escopo por linha ou máquina para pessoas | 15 P1 | Cliente + unidade | Muda `member_unit`, os filtros de agregados e os testes de isolamento |
| D12 | O admin do cliente adiciona a própria equipe no MVP? | 15 P2 | Sim, e a Engemase também | Só a Engemase tira a tela de usuários do cliente e aumenta a carga do suporte |
| D13 | Quem configura gateways e tags | 15 P3 | Ambos, por cliente (`managed_by_engemase`) | Só a Engemase simplifica os papéis e o assistente; só o cliente exige uma interface de comissionamento muito mais guiada |
| D14 | 2FA para usuários do cliente | 15 P8; 09:83; 12:76 | Obrigatório para a Engemase, opcional para o cliente | Obrigatório para admins traz o cadastro de 2FA para o fluxo "definir senha"; deixar opcional conflita com a aprovação de VPN "com MFA" |
| D15 | Área é obrigatória? | 15 P9 | Opcional | Obrigatória simplifica consultas; o ER do 06 já a desenha assim |
| D16 | Grupo com vários CNPJs | 15 P10 | Um cliente com várias unidades | CNPJ por unidade (o protótipo guarda só um `cnpj` por cliente) |
| D17 | Super admins iniciais e tamanho da equipe Engemase | 15 P11 | Indefinido (sugestão: 2–3 pessoas) | Define o seed de produção e as licenças da VPN (custo estimado para 10 técnicos) |
| D18 | Tablet na máquina e identificação do operador | 01 Q4; 15 §1; 13 | Tela do operador no MVP; Android preferido; operador escolhido numa lista (PIN e crachá na F2) | Sem tablet, a classificação passa ao supervisor no desktop; com iPad, sem tela sempre acesa nem push confiável; o registro nominal pesa na LGPD (L7) |
| D19 | Escrita no CLP | 01 Q6; ADR-008 | Não no v1 | Se sim, novo modelo de segurança e quebra do RNF04 |
| D20 | Política padrão de acesso remoto | 12 "Fluxo de uma sessão" | "Com aprovação"; emergência só se o contrato prever | Janela pré-aprovada ou emergência como padrão exige cláusula contratual |

### C. Regras de cálculo (padrões do `docs/07` a validar)

| # | Decisão | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|
| D21 | Como contar `NO_COMM` | Parada não planejada, com selo de "dados incompletos" | Excluir do tempo planejado infla o OEE |
| D22 | Como contar setup | Perda de disponibilidade (configurável por cliente) | Tratar como planejado torna os OEEs incomparáveis entre clientes |
| D23 | Limite de micro-parada | 60 s, perda em performance, sem pedir motivo | Limite maior significa menos apontamentos e mais perda em P |
| D24 | Performance > 100% e produção durante parada planejada | Guarda o valor real e alerta acima de 105%; o tempo produzido volta a ser planejado | Limitar a 100% esconde ciclo ideal errado |
| D25 | Faixas e metas de OEE | Faixas 85/60 só no protótipo; `oee_target` sem dono nem nível definido | Faixas por cliente contrariam o 14 ("travadas") |

### D. Gateway e campo

| # | Decisão | Fonte | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|---|
| D26 | Marcas de CLP prioritárias e bloco OEE v1 | 01 Q1; 11 §3; 09 Fase 0 | Proposta de 32 registradores a partir do HR 1000, palavras em CDAB | Mudar o layout depois de programar CLPs exige versionar o bloco e os templates |
| D27 | Kit padrão: supercapacitor em todas as unidades, caixa pré-montada (opção B), quem fornece o switch OT | Rascunho de rede §4.6 e §7 | Supercapacitor sugerido em todas; B e switch indefinidos | Sem supercapacitor, a função F25 vai para a F2 e há risco de eMMC corrompido; a caixa B soma ~R$ 400–900 e reduz a montagem; o switch soma R$ 400–1.500 |
| D28 | Domínios (produto e host dos gateways) e IPv6 | Rascunho de rede §0 e §7; 08 (só "ex.") | `oee.engemase.com.br` e `gw.oee.engemase.com.br` como exemplos; IPv6 desligado | Trocar o FQDN depois exige nova liberação no firewall de cada cliente |
| D29 | OTA mínimo antes do piloto (M4b) | Rascunho de software §8 (l. 1285) | Recomendado sim (+1 a 1,5 semana) | Sem ele, qualquer correção no piloto exige ir à fábrica (no MVP não há VPN) |
| D30 | Escopo do MVP do gateway: página local de status e amostras `custom` | Rascunho de software F12 e F23 | Página opcional; amostras "se houver folga" | Sem página local, comissionar sem internet depende só da CLI (C19) |
| D31 | Mudança de rede pela nuvem (`net.apply`) | Rascunhos (R2) | Contraditório | Permitir aumenta o risco de perder um gateway remoto; resolver no doc 16 |

### E. Fornecedores e canais

| # | Decisão | Fonte | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|---|
| D32 | VPN: Tailscale ou NetBird | ADR-013; 12 "Custo de referência" | Tailscale Standard, pendente de PoC e de confirmação escrita da cobrança | NetBird self-hosted se a residência de dados (D7) exigir |
| D33 | WhatsApp e SMS | 13 "Canais" | WhatsApp na F2b (~R$ 0,035 por mensagem); SMS só se contratado | Exige templates aprovados pela Meta e opt-in |
| D34 | Subdomínio por cliente e white label | 14 "App instalável"; ADR-015 | F3 | Antecipar mexe com cookies, DNS e `trustedOrigins` (15 #2 proíbe domínios de cliente) e é pré-requisito para o push no iPhone por cliente |

### F. Escopo e prazo

| # | Decisão | Fonte | Padrão hoje | Impacto de decidir diferente |
|---|---|---|---|---|
| D35 | Escala do primeiro ano | 01 Q3; RNF07 | Contas para 100 máquinas; meta de 500 | Define os planos da Neon e da Vercel e quando entra MQTT |
| D36 | Reestimar a Fase 1 e redistribuir MVP × F2 | ADR-016 (+3 a 4 semanas); M4b; C3–C5; 09 (2 devs, início em 16/11/2026) | 7 semanas + 2 de piloto | Afeta a data do piloto |
| D37 | Aceitar formalmente as ADRs "Proposta" (001–010, 012–016) | 10 | Tratadas como decididas (o protótipo já segue 001, 010 e 015) | Reabrir uma delas (por exemplo, Better Auth ou Neon) muda a Fase 0 |

**Ordem sugerida:** a Fase 0 começa em 16/11/2026 e precisa antes de D2, D7, D26, D28, D29, D36 e D37. O contrato do piloto precisa de D1, D4–D6, D14, D18 e das lacunas L7, L9 e L11.
