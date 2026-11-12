# 17 — O que falta: backlog, decisões e próximos passos

> Consolidado de duas auditorias de 11/11/2026 (documentação e implementação), atualizado em 12/11/2026 com o fechamento da Fase 0 de código. Os relatórios completos estão em `docs/rascunhos/auditoria-documentacao.md` e `docs/rascunhos/auditoria-implementacao.md`. Este documento substitui as estimativas de prazo do `docs/09` onde houver conflito.

## 1. Situação em uma tabela

| Área | Situação |
|---|---|
| Arquitetura e documentação | **Ampla e alinhada ao código.** Contradições corrigidas; `docs/04`, `06` e `07` conferidos contra os pacotes; projeto do gateway consolidado no `docs/16`; documentos de operação em `docs/operacao/`. Restam as lacunas da seção 4 |
| Protótipo da interface (`apps/web`) | **Completo para validação.** Todas as telas no layout novo, inclusive console Engemase, terminal pareado (`/terminal`) e tela de linha. Cálculo do OEE agregado pela soma das bases. 39+ rotas sem erro em desktop e celular |
| **Implementação real** | **Fase 0 de código pronta.** Contrato, cálculo de OEE, banco com RLS, API real `/enroll` `/sync` `/config` com testes, agente Go revisado, simulador, pacote `.deb`, receita da imagem e CI. Teste de ponta a ponta (simulador → agente → API → banco) verde. Faltam contas na nuvem e hardware |
| Ambientes (Vercel, Neon, domínio) | **Não criados.** Dependem de contas da Engemase |
| Hardware de bancada | **Não comprado.** É o maior risco de prazo (importação) |
| Decisões do dono do produto | **37 pendentes** (seção 3). Sete delas bloqueiam o início da Fase 0 |

## 2. Backlog até o piloto

Premissas: 2 desenvolvedores (**Web** e **Gateway**), semana 1 = 16/11/2026, sem contar o recesso de fim de ano.

| ID | Épico | Trilha | Fase | Semanas | Depende de | Pronto quando |
|---|---|---|---|---|---|---|
| N1 | Contas e ambientes (Vercel Pro, Neon, domínio, Sentry, proteção de branch) | Fora do código | F0 | 1 | — | Projeto, banco e domínio criados |
| W1 | Fundação do monorepo, CI, `.env.example`, Sentry básico | Web | F0 | 1 | N1 | PR verde e preview funcionando |
| X1 | `packages/contracts` (Zod → JSON Schema + fixtures + teste em Go) | Ambos | F0 | 1 | Ajustes do protocolo (D-proto) | Fixtures validam em TS e em Go |
| W2a | Schema núcleo + primeira migração | Web | F0 | 1 | W1 | Migração aplicada no branch de preview |
| W3 | `/enroll` + `/sync` mínimos gravando na Neon + PoC do driver com 100 gateways | Web | F0 | 1 | W2a, X1 | Saída da Fase 0 (com G0) |
| G0 | Esqueleto do agente, codec, transportes TCP/RTU, `modbus read`, plc-sim, `.deb` mínimo, envio provisório de `/sync` | Gateway | F0 | 3 | Hardware na bancada | R1000 lê as 3 RS-485 e um CLP TCP por 24 h e envia `/sync` |
| W2b | RLS completa, FKs compostas, partições, seeds, branch-semente sintético | Web | F1 | 1 | W2a | Teste de catálogo verde |
| W6 | API completa: config versionada, fila de comandos, ingestão completa, saúde, limites | Web | F1 | 1,5 | W3 | Gateway simulado aplica config e responde a comandos |
| W4 | `oee-core` em produção (golden + propriedades) | Web | F1 | 1 | — | Exemplo de 78,4% e propriedades verdes |
| G1 | Núcleo de coleta | Gateway | F1 | 2 | G0 | 72 h com conservação de 100% das peças |
| G2 | Buffer e uplink | Gateway | F1 | 2 | G1, X1, W6 | 100 agentes contra o preview por 1 h sem erro |
| W5 | Identidade e multi-cliente (Better Auth, `requireTenant`, escopo, definir senha + e-mail, concessões, testes de isolamento) | Web | F1 | 3 | W2b | Testes de isolamento verdes no CI |
| G3 | Config remota, comandos e saúde | Gateway | F1 | 1,5 | G2, W6 | Config aplicada em < 15 s |
| W7 | Cron (5 jobs) | Web | F1 | 1 | W4, W6 | Fechamento de turno e recálculo conferidos |
| G4 | Produto instalável (`.deb` completo, CLI, energia) | Gateway | F1 | 1,5 | G3, hardware | Instalação em ≤ 15 min só com o roteiro |
| G4b | OTA mínimo (recomendado antes do piloto) | Gateway | F1 | 1–1,5 | G4 | Atualização e rollback na bancada |
| W8 | Troca do mock (1): cadastros, gateways, tags, console mínimo | Web | F1 | 2 | W5, W6 | Máquina colocada no ar pela web, de ponta a ponta |
| W9 | Troca do mock (2): ao vivo, timeline, relatório, operador, terminais | Web | F1 | 2 | W4, W7, W8 | Dashboard e relatório com dados reais |
| W11 | Segurança e qualidade (CSP/HSTS, Firewall, Playwright, isolamento nível 4) | Web | F1 | 1–1,5 | W5 | e2e verde |
| P | Piloto (2 semanas) + teste de longa duração na bancada | Ambos | F1 | 2 | W9, W11, G4b | Critérios do `docs/09` |
| W10 / W12 | Alertas no app e central de ajuda (durante o piloto) | Web | F1 | 1,5 | W7 / W5 | — |

**Caminho crítico:** `N1 → W1 → W2a → W3 → W2b → W6 → W4 → W5 → W7 → W8 → W9 (+W11) → Piloto`.
- A trilha web leva cerca de 15 semanas; a do gateway, cerca de 12,5. A folga do gateway vai para W11 e para o teste de longa duração.
- **Piloto estimado: semana 14 a 16** (meados de fevereiro a início de março de 2027, sem o recesso). É de 3 a 5 semanas depois do Gantt do `docs/09`.
- **Atenção (projeto do gateway, [16 §9](16-projeto-do-gateway.md#9-prazo-e-riscos)):** com a página local, a rede local com checkpoint, a imagem própria e a bancada, a trilha do gateway soma 17–20 semanas e **passa a ser o caminho crítico** (piloto nas semanas 19–21). Para manter 14–16: um segundo desenvolvedor ou técnico em tempo parcial **e** o corte de MVP do doc 16.
- **Cortes possíveis para adiantar:**
  - terminais só se houver tablet (−0,5 semana);
  - console mínimo (−0,5 semana);
  - alertas e ajuda depois do piloto;
  - configuração de rede pela nuvem só na F2.

**Já adiantado:** a parte de código de W1, X1, W2a, W3, W4 e G0, e boa parte de W2b (RLS completa e FKs compostas) e de G4 (`.deb`, units, firewall, imagem). Ficam pendentes as partes que dependem de contas (deploy, Neon, PoC com 100 gateways) e de hardware (bancada, pacote de suporte ao R1000).

## 3. Decisões pendentes do dono do produto

A ordem de urgência vem da Fase 0. Os padrões adotados até a decisão estão nos relatórios da auditoria.

**Bloqueiam a Fase 0 (decidir na semana de 16/11):**

| # | Decisão | Padrão adotado hoje |
|---|---|---|
| D2 | Hardware: venda, comodato ou locação; rota de compra | R1000 R10xx-00, courier no piloto |
| D7 | Região e residência dos dados no Brasil | Proposta: São Paulo (Vercel `gru1`; Neon em região de São Paulo, se disponível — confirmar) |
| D26 | Marcas de CLP prioritárias e bloco OEE v1 | 32 registradores a partir do HR 1000, words em CDAB |
| D28 | Domínios (produto e host dos gateways) | `oee.engemase.com.br` e `gw.oee.engemase.com.br` |
| D29 | OTA mínimo antes do piloto | Sim (+1 a 1,5 semana) |
| D36 | Aceitar a nova estimativa (piloto nas semanas 14–16) e os cortes | — |
| D37 | Aceitar formalmente as ADRs ainda como "Proposta" | Tratadas como decididas |
| D38 | Isolamento no banco: aceitar a RLS por variável de sessão (`app.org_id`) ou endurecer | Aceita: a variável pode ser trocada por qualquer SQL rodando como a aplicação; o risco depende de não haver SQL arbitrário (injeção). Endurecer = valor assinado pelo servidor ou um papel por cliente (`packages/db/README.md`) |

**Antes do contrato do piloto:**

| # | Decisão | Padrão adotado hoje |
|---|---|---|
| D1 | Modelo comercial (por máquina, planta ou gateway; planos) | Limites editados pelo super admin |
| D4 | Encerramento: prazos, formato, recolhimento dos gateways | 30 + 30 dias; CSV |
| D5 | Acesso da Engemase aos dados de produção | Liberado com registro; o cliente pode exigir aprovação |
| D6 | Retenção do histórico | 2 anos por minuto; auditoria 5 anos |
| D14 | 2FA para usuários do cliente | Opcional (conflita com a aprovação de VPN "com MFA") |
| D18 | Tablet na máquina e identificação do operador | Android; operador escolhido numa lista |

**Uso e regras de cálculo (podem esperar até a Fase 1):**
- **Acesso:** D11 escopo por linha/máquina · D12 quem adiciona usuários · D13 quem configura gateways · D15 área obrigatória · D16 vários CNPJs · D17 super admins iniciais.
- **Cálculo:** D21 `NO_COMM` · D22 setup · D23 micro-parada de 60 s · D24 performance > 100% · D25 faixas e metas de OEE.
- **Gateway e campo:** D27 kit padrão (supercapacitor, caixa pronta, switch) · D30 página local no MVP · D31 mudança de rede pela nuvem.
- **Canais e fornecedores:** D32 Tailscale × NetBird · D33 WhatsApp/SMS · D34 subdomínio e white label · D35 escala do 1º ano.
- **Outros:** D3 inadimplência · D8 versão on-premises · D9 ERP/MES · D10 gravação de sessão · D19 escrita no CLP · D20 política de acesso remoto.

## 4. Lacunas de especificação

| # | Tema | O que falta | Quando |
|---|---|---|---|
| L1 | Contrato `/sync`, `/enroll`, `/config` | **Fechada:** `packages/contracts` e `docs/04`. Pendente só o que é da F1: `logs.upload`/`log.level` mínimos, `/releases/latest`, `409 config_outdated` e `429` | F0 ✓ |
| L2 | Turnos e calendário | Dia do turno noturno, feriados, exceções, turnos sobrepostos, produção fora do turno, vigência, "dia produtivo" | F1 |
| L3 | Refugo manual e troca de produto | Soma ou substituição do refugo do CLP, motivos de refugo, retrabalho, lançamentos atrasados e estornos | F1 |
| L4 | Metas e faixas de OEE | `oee_target` (onde e quem define) e faixas 85/60 documentadas | F1 |
| L5 | MTBF/MTTR, Pareto, TEEP | Fórmulas exatas | F2 |
| L6 | Exportação | Formatos, colunas, fuso, separador decimal, job assíncrono | F2 |
| L7 | LGPD | Contrato SaaS + DPA, termos, suboperadores, transferência internacional, operador de chão, incidentes | Antes do piloto |
| L8 | Região de hospedagem | Escolha e registro (D7) | F0 |
| L9 | Planos e preços | Catálogo, cobrança, hardware, serviços | Antes da venda |
| L10 | Onboarding comercial | Proposta, questionário, critérios para "Ativo", treinamento | Antes da venda |
| L11 | SLA e suporte | Disponibilidade, RPO/RTO, horários, ferramenta de chamados, status page | Antes do piloto |
| L12 | Testes de aceite | Critérios por requisito, tolerância do OEE, carga, matriz de navegadores e TVs | F1 |
| L13 | Observabilidade | SLOs, alertas operacionais, métricas de ingestão, retenção de logs | F1 |
| L14 | Backup e recuperação | RPO/RTO, teste de restauração. **Depois de restaurar o banco, os dados confirmados não voltam dos gateways.** Backup das chaves (OTA, VAPID, CA SSH) | F1 |
| L15 | Documentação para o usuário | Guias por papel e notas de versão. Já feitos: 6 runbooks, ficha de TI, roteiro de bancada e guia por fabricante (`docs/operacao/`). Faltam 4 runbooks (contagem divergente, restauração PITR, rotação de token, troca de hardware) | Piloto |
| L23 | Gateway em trânsito | Gateway ativado na bancada e desligado para envio gera "Gateway offline" no cliente. Falta um estado "em trânsito/não instalado" que suprime o alerta | F1 |
| L24 | Revisão do agente no campo | Diagnóstico de RS-485 pelo técnico depende de leituras pela API local do agente (o `tecnico` não para o agente nem acessa a serial) | F1 |
| L25 | Rollback do agente × esquema do buffer | Um agente anterior recusa um `buffer.db` com `user_version` maior e reinicia sem parar. Até aqui as mudanças no buffer são só colunas acrescentadas (o `user_version` fica em 1, e o rollback funciona). Antes da primeira migração que suba o `user_version`, o atualizador (G4b) precisa saber a versão de esquema de cada pacote (no manifesto) e recusar o rollback automático para um pacote de esquema anterior | F1 (com G4b) |
| L16 | Modelo de dados consolidado | Tabelas dos docs 12–15 no `docs/06` (sendo implementadas em `packages/db`) | F0 |
| L17 | Jobs agendados | Alertas, reconciliação da VPN, expiração de concessões e tokens, partições | F1 |
| L18 | i18n | Biblioteca e catálogos de texto | F2 |
| L19 | Terminais e operador | Código de pareamento, várias TVs por linha, lista de operadores, fila offline × reclassificação | F1 |
| L20 | Autenticação | Política de senha, duração de sessão, bloqueio, recuperação do 2FA, SSO | F1 |
| L21 | Limites da API | Números do rate limit por gateway | F1 |
| L22 | Ciclo de vida do gateway | Consolidado no [`docs/16`](16-projeto-do-gateway.md) (MVP simplificado; completo na F2) | — |

## 5. Pendências do protótipo

Fechadas em 12/11/2026: OEE agregado pela soma das bases e "sem dado" como "—"; rotas `/terminal` e `/terminal/parear`; papel "visualizador" só leitura; status "Encerrado" e "Aguardando definir senha"; comando com gateway offline expira em 2 min; tela de linha `/[cliente]/linhas/[linhaId]`; Modbus RTU sobre TCP e data bits fixo em 8 no assistente; template do bloco OEE com `plc.heartbeat` e sem `count.good`.

Continua valendo: `generateStaticParams` e `instant = false` são permitidos só no protótipo e precisam sair na versão real.

## 6. Itens fora do código

- **Hardware de bancada:**
  - 2 R1000 R10xx-00 (2 GB/16 GB, revisão v1.1) e o módulo SuperCAP;
  - fonte 24 V DIN e disjuntor;
  - 1 CLP com Modbus TCP nativo (Schneider M221 ou Delta);
  - 1 módulo de I/O com contador e um barramento RS-485 com 2–3 escravos e cabo 120 Ω;
  - relé e mini PC para os testes automáticos;
  - kit do técnico;
  - tablet Android e TV, se houver tablet.
- **Contas:**
  - agora: Vercel Pro, Neon, domínio e DNS, Sentry;
  - semana 6: Resend;
  - antes da F2: Tailscale.
- **Compra e importação:** cotação formal; despachante para a NCM; consulta a um OCD sobre a ANATEL para equipamento sem rádio.
- **Jurídico:** contrato SaaS e DPA, termos de uso, política de privacidade, encarregado (DPO), termo de piloto. (A ficha técnica para o TI já existe: `docs/operacao/ficha-tecnica-ti-cliente.md`.)
- **Pacote de suporte ao R1000** (`engemase-r1000-support`: overlay da Seeed e `rtc-pcf8563w` para o kernel fixado): sem ele as RS-485 ficam sem alimentação e não há LEDs nem RTC. Só dá para fazer com a placa na mão.

## 7. Próximos 10 passos (semana de 16 a 20/11/2026)

1. Pedir cotação formal e comprar o hardware de bancada. O prazo de importação é o maior risco.
2. Consultar o despachante e um OCD sobre a NCM e a ANATEL.
3. Criar as contas (Vercel Pro, Neon, domínio, Sentry) e a proteção de branch no GitHub.
4. Dono do produto decide os bloqueios da Fase 0 (D2, D7, D26, D28, D29, D36, D37, D38).
5. Abrir o PR do branch de trabalho, revisar e ligar o CI (já inclui o teste de ponta a ponta).
6. Aplicar as migrações 0000–0004 num branch Neon de preview e confirmar que o papel de login é membro de `app_user` e que o dono das tabelas não tem BYPASSRLS.
7. Deploy de preview na Vercel com `DATABASE_URL` e rodar o PoC com 100 gateways simulados contra ele (W3).
8. Escrever o publicador de config e o gerador de códigos de ativação na web (hoje só a API do gateway existe).
9. Equipe de automação: implementar o `FB_OEE_ENGEMASE` (`docs/operacao/`) na primeira marca de CLP e escolher o cliente e a linha do piloto.
10. Com o hardware: roteiro de bancada (`docs/operacao/verificacao-bancada-r1000.md`), receita do pacote de suporte ao R1000 e primeira imagem Trixie.
