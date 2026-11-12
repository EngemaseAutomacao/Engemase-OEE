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
| Decisões | **Todas tomadas** em 12/11/2026 (seção 3): 10 pelo dono do produto e o restante pela equipe técnica, como escolhas provisórias. Nenhuma bloqueia a Fase 0 |

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

## 3. Decisões

Em 12/11/2026 o dono do produto decidiu D1, D5, D6, D7, D11, D12, D13, D26, D28 e D38 e pediu que a equipe técnica escolhesse o restante pelo que for melhor para o sistema e para a Engemase. **Todas podem ser revistas:** para mudar, registre aqui a nova escolha, com a data, e avise quem cuida do que ela afeta.

**Decididas pelo dono do produto (12/11/2026):**

| # | Decisão | Escolha |
|---|---|---|
| D1 | Modelo comercial | A Engemase vende o software como **assinatura cobrada por máquina**, com planos (Starter, Pro, Enterprise). Valores em L9 |
| D5 | Acesso da Engemase aos dados de produção | **Sempre liberado**, com registro na auditoria visível ao cliente e faixa na tela. O cliente não aprova esse acesso (a aprovação de sessão de acesso remoto ao gateway, D20, continua) |
| D6 | Retenção | Dados por minuto: **2 anos**. Auditoria: **5 anos** |
| D7 | Região | **São Paulo:** Vercel `gru1`, Neon na AWS `sa-east-1` |
| D11 | Escopo de acesso das pessoas | Todo o cliente, unidades **ou máquinas**. Fail-closed: nada listado = nenhum acesso |
| D12 | Quem gerencia usuários | O **admin do cliente** gerencia os usuários do cliente. O resto da configuração (unidades, linhas, máquinas, gateways, tags, terminais, turnos, produtos, motivos, aparência) é feito pela **Engemase** |
| D13 | Quem configura gateways | **Só a Engemase.** Todo cliente é "gerenciado pela Engemase"; o papel de cliente "engenheiro" vira leitura técnica |
| D26 | Marcas de CLP prioritárias | **Siemens, Schneider, Rockwell e ABB.** Bloco OEE v1 mantido (32 registradores a partir do HR 1000, words em CDAB) |
| D28 | Domínio | **Só o da Vercel por enquanto** (`engemase-oee.vercel.app`, para produto e gateways) |
| D38 | Isolamento entre clientes no banco | **RLS por variável de sessão aceita**, com o limite documentado em `packages/db/README.md` |

**Escolhidas pela equipe técnica (12/11/2026, provisórias):**

| # | Decisão | Escolha | Por quê |
|---|---|---|---|
| D2 | Hardware | **Comodato:** o gateway é da Engemase e fica com o cliente enquanto a assinatura valer. Contrato mínimo de 12 meses; a taxa de implantação cobre parte do hardware. Venda só sob pedido (Enterprise). Compra: courier no piloto, importação formal para a frota | Frota padronizada e sob controle da Engemase (D13, OTA, troca rápida), menor barreira de entrada e recolhimento simples no encerramento |
| D3 | Inadimplência | Aviso com 5 dias de atraso. Com 30 dias, cliente **Suspenso**: login bloqueado com aviso; os gateways continuam enviando e os dados ficam guardados; volta ao pagar | Não perde dados nem exige novo comissionamento; evita um estado "só leitura" em todas as ações |
| D4 | Encerramento | 30 dias para exportar (CSV) + 30 para excluir. O cliente devolve os gateways em até 30 dias (coleta agendada pela Engemase, frete do cliente); gateway não devolvido é cobrado pelo valor de reposição | Prazos simples, já previstos no runbook e no contrato; CSV basta |
| D8 | Versão on-premises | **Não** | Mantém Vercel e Neon; o Postgres padrão deixa a porta aberta |
| D9 | Integração com ERP/MES | **F3.** Exportação CSV na F2; API pública depois. Antecipar só com um cliente-âncora que pague por isso | Não atrasa o MVP |
| D10 | Gravação de sessão remota | **Fase A:** trilha de auditoria + log de I/O do `sudo`. Bastion (Teleport/Warpgate) só se virar requisito de venda | Custo e complexidade baixos no piloto |
| D14 | 2FA | **Obrigatório para a equipe Engemase e para o admin do cliente**; opcional para os demais | O admin gerencia usuários e aprova sessões de acesso remoto (D20): resolve o conflito com a aprovação "com MFA" |
| D15 | Área obrigatória | **Sim no banco.** Cada unidade nasce com a área "Geral", que a interface esconde quando é a única | Consultas mais simples sem obrigar o cliente a pensar em áreas |
| D16 | Grupo com vários CNPJs | Um cliente = um contrato (CNPJ de cobrança). Cada unidade pode ter o **próprio CNPJ** (opcional) | Atende grupos industriais sem dividir o cliente |
| D17 | Super admins iniciais | **2 pessoas** da direção técnica (nomes no seed de produção). Equipe inicial da Engemase de até 5 pessoas, todas com 2FA | Mínimo para não depender de uma pessoa só |
| D18 | Tablet e operador | Android com tela sempre acesa; **operador escolhido numa lista**; PIN e crachá na F2. Sem tablet, o supervisor classifica no desktop | Simples no chão e com dado pessoal mínimo (LGPD) |
| D19 | Escrita no CLP | **Não no v1** (ADR-008) | Segurança da planta |
| D20 | Política de acesso remoto | **Cada sessão aprovada pelo admin do cliente** (com 2FA). Janela de manutenção pré-aprovada e acesso de emergência só se o contrato previr | É o que a TI e a segurança do cliente esperam para acesso à rede OT |
| D21 | Como contar `NO_COMM` | **Parada não planejada** com motivo "Sem comunicação" e selo "dados incompletos" | Excluir do tempo planejado inflaria o OEE |
| D22 | Como contar setup | **Perda de disponibilidade.** A Engemase pode marcá-lo como planejado num cliente, se o contrato pedir | OEEs comparáveis entre clientes |
| D23 | Micro-parada | **60 s**, perda de performance, sem pedir motivo; ajustável por máquina pela Engemase | Menos apontamentos no chão |
| D24 | Performance > 100% | **Guarda o valor real** e alerta acima de 105% (ciclo ideal errado). Produção durante parada planejada volta a ser tempo planejado | Limitar a 100% esconderia cadastro errado |
| D25 | Faixas e metas de OEE | **Faixas fixas para todos:** verde ≥ 85%, amarelo de 60% a 85%, vermelho < 60%. Meta opcional por máquina, definida pela Engemase com o cliente na implantação | Cores de estado e faixas travadas (docs/14); comparável entre clientes |
| D27 | Kit padrão | **Caixa pré-montada pela Engemase** (opção B) com R1000 e fonte; **SuperCAP em todas** as unidades depois do teste T-PWR-3; switch OT só quando a planta não tiver, cobrado à parte | Com comodato (D2), padronizar reduz instalação, erro e suporte |
| D29 | OTA mínimo antes do piloto | **Sim**, com `logs.upload` e `log.level` mínimos | Com a Engemase operando a frota (D2, D13), atualizar sem visita é obrigatório |
| D30 | Página local no MVP | **Sim, reduzida** | Comissionar sem internet |
| D31 | Mudança de rede pela nuvem | **F2**; no MVP, só local | Risco de perder um gateway remoto |
| D32 | VPN | **Tailscale Standard** depois da PoC; NetBird self-hosted como plano B | Menor esforço; plano B se a residência de dados exigir |
| D33 | WhatsApp e SMS | **WhatsApp na F2b**; SMS não | Canal que o chão de fábrica usa; SMS caro e pouco lido |
| D34 | Subdomínio por cliente e white label | **F3** | Depende de domínio próprio (D28) |
| D35 | Escala do primeiro ano | Contas para **100 máquinas**; meta de **500** | Define os planos da Neon e da Vercel |
| D36 | Prazo | **Aceita:** reforço parcial + corte de MVP; piloto nas semanas 14 a 16 (meados de fevereiro a início de março de 2027) | — |
| D37 | ADRs "Proposta" | **Aceitas formalmente** ([docs/10](10-decisoes-arquiteturais.md)), com as notas das decisões acima | Já eram seguidas pelo código |

**Recomendação sobre o domínio (D28):** registrar o domínio próprio **antes de o primeiro gateway ir para um cliente**. A TI do cliente libera a saída pelo nome do host, e trocar o host depois exige atualizar o `cloud.url` de cada gateway instalado.

**Ainda dependem de dados (não de decisão):** nomes dos super admins (D17), valores dos planos (L9), cotação do hardware (D2).

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

**Escolhas provisórias para as lacunas (equipe técnica, 12/11/2026).** Servem de padrão para a Fase 1; cada uma vira especificação no documento indicado quando for implementada.

| # | Escolha |
|---|---|
| L2 | O turno pertence ao dia em que **começa** (o turno da noite de segunda é de segunda). Feriados por unidade, cadastrados pela Engemase: sem turno = tempo não planejado. Turnos não se sobrepõem na mesma unidade. Produção fora do turno conta as peças e o tempo produzido vira planejado (como D24). Mudança de turno vale dali para a frente, sem recalcular o passado |
| L3 | Refugo manual **soma** ao refugo do CLP, nunca o substitui. Motivos de refugo cadastrados pela Engemase. Lançamento atrasado até o fim do turno seguinte; depois disso, só o supervisor. Estorno sempre com registro na auditoria. Retrabalho fica fora do MVP |
| L4 | Resolvida por D25 |
| L5 | MTBF = tempo produzindo ÷ número de falhas; MTTR = tempo total em falha ÷ número de falhas; TEEP = OEE × (tempo planejado ÷ tempo de calendário). F2 |
| L6 | CSV UTF-8 com BOM, separador `;` e vírgula decimal (abre direto no Excel em português). Datas no fuso da unidade, em ISO 8601 com o deslocamento. Colunas iguais às da tela. Acima de 100 mil linhas, vira tarefa assíncrona com link por e-mail |
| L12 | OEE da plataforma igual ao da planilha de referência com diferença de até 0,5 ponto percentual por turno. Peças iguais ao contador do CLP no turno, salvo período `NO_COMM` registrado. Navegadores: Chrome e Edge atuais, Safari do iOS atual; TV com Chrome ou Android TV. Carga: 100 gateways simulados (W3) |
| L13 | Sentry para erros e logs da Vercel. Meta: 99% dos `/sync` respondidos em menos de 1 s. Alerta para a Engemase quando um gateway passa 15 min sem `/sync` ou o atraso do buffer passa de 10 min |
| L14 | PITR do Neon na janela do plano contratado; RPO e RTO os do SLA ([`docs/negocio/sla-e-suporte.md`](negocio/sla-e-suporte.md)). Teste de restauração a cada 3 meses (runbook 08). Chaves (OTA, VAPID, CA SSH) num cofre de senhas da empresa, com 2 pessoas com acesso |
| L17 | Vercel Cron: alertas (1 min); expiração de concessões, tokens e códigos (5 min); reconciliação da VPN (15 min); partições e limpeza (diário); resumo diário por e-mail (diário) |
| L18 | Só português do Brasil até a F2. Quando entrar o segundo idioma (provavelmente espanhol), usar `next-intl` |
| L19 | Várias TVs por linha, sim. Lista de operadores por unidade, cadastrada pela Engemase (nome e matrícula opcional). Fila offline no tablet por até 24 h. Se o tablet e o desktop reclassificarem a mesma parada, vale a última, e as duas ficam na auditoria |
| L20 | Senha de 12 caracteres ou mais, sem regra de composição, recusada se aparecer em vazamentos conhecidos (consulta por k-anonimato). Depois de 5 erros, espera de 15 min e aviso por e-mail. Sessão de 12 h renovada com o uso; "manter conectado" até 30 dias (a equipe Engemase fica sempre em 12 h). 2FA por aplicativo autenticador (TOTP), com 10 códigos de recuperação. O admin do cliente reinicia o 2FA dos usuários; a Engemase reinicia o do admin, com conferência de identidade. SSO (Microsoft e Google) na F3 |
| L21 | `/sync`: 60 por minuto por gateway (rajada de 10). `/enroll`: 10 por hora por IP e 5 tentativas por código. `/config`: 30 por minuto por gateway. Acima disso, `429` com `retry_after_s` |
| L23 | Novo estado **"Em trânsito"**: o gateway ativado na bancada não gera alerta de offline até o primeiro `/sync` no cliente ou até a Engemase marcá-lo como instalado. Prazo máximo de 30 dias |

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
