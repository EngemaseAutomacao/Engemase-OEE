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

**Já adiantado (24/11/2026):** W6 pronto no código (publicador de config, códigos de ativação, fila de comandos, limites da L21, `409 config_outdated`, histórico de saúde e alerta de minuto reescrito; o teste de ponta a ponta aplica config e responde a comandos) e as 5 tarefas da L17 (W7; falta o fechamento de turno e o recálculo dos turnos sujos).

**Já adiantado:** a parte de código de W1, X1, W2a, W3, W4 e G0, a parte de código de W2b (RLS completa, FKs compostas, partições com a rotina diária, seed sintético e as tabelas de L2, L3, L19 e L23; falta criar o branch-semente na Neon, que depende de N1), boa parte de G4 (`.deb`, units, firewall, imagem) e de W11 os cabeçalhos HTTP (CSP, HSTS...), a revisão do limite da RLS ([operacao/revisao-seguranca-w11.md](operacao/revisao-seguranca-w11.md)) e os testes de navegador com Playwright (faltam Firewall e os testes de isolamento de nível 3 e 4, que dependem da W5). Ficam pendentes as partes que dependem de contas (deploy, Neon, PoC oficial com 100 gateways) e de hardware (bancada, pacote de suporte ao R1000).

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
| D14 | 2FA | **Opcional para todos** (decidido em 26/11/2026), inclusive a equipe Engemase e o admin do cliente. Quem ativa escaneia um QR code no aplicativo autenticador e pode desativar com a senha | Decisão do dono do produto: menos atrito na entrada. Fica em aberto a aprovação de acesso remoto "com MFA" (D20), que supunha o admin com 2FA |
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

**Escolhas complementares (equipe técnica, 13/11/2026, provisórias):**

| Tema | Escolha |
|---|---|
| Ações de chão | Classificar paradas, lançar refugo e trocar produto: admin do cliente, supervisor e operador. O engenheiro do cliente só tem leitura técnica (saúde dos gateways, conexões e tags) e dashboards; comandos ao gateway ("Ler agora", "Testar conexão") ficam com a Engemase |
| Menu Configurações | Visível, só para leitura, ao admin e ao engenheiro do cliente; oculto para supervisor, operador e visualizador. O código de ativação de gateway nunca aparece para o cliente |
| Usuários do cliente | O admin do cliente e o super admin da Engemase (primeiro admin e apoio). Suporte e engenheiro de campo, não |
| Acesso remoto (D20) | O modo da política (com aprovação, janela pré-aprovada, emergência) é definido pela Engemase conforme o contrato; cada sessão é aprovada pelo admin do cliente, com 2FA |
| Cobrança | Mensalidade sobre o **maior** entre máquinas contratadas e máquinas ativas no mês. Cadastrar acima do contratado gera aviso à Engemase, sem bloquear. Começa quando o cliente vira "Ativo" ou 30 dias depois do primeiro gateway instalado, o que vier primeiro |
| Preços iniciais | Por máquina por mês: Starter R$ 230, Pro R$ 330, Enterprise R$ 420. Mínimo de 5, 10 e 40 máquinas. Contrato mínimo de 12 meses; desconto total de no máximo 20%. Tabela inicial, revisar depois do piloto ([`docs/negocio/planos-e-precos.md`](negocio/planos-e-precos.md)) |
| Retenção | Igual para todos os planos e clientes (D6) |
| Operação | Monitor externo pago a partir do primeiro contrato Pro ou Enterprise. Plantão 24×7 só para P1 nos planos Pro e Enterprise, com escala de 3 pessoas. Restauração completa do banco em até 2 h; PITR de 14 dias; cópias externas por 90 dias. Região reserva da Vercel: `iad1`. Sentry na região da UE. Encarregado (DPO) e substituto a nomear |
| Rockwell | CompactLogix e ControlLogix: AOI de servidor Modbus TCP da Rockwell quando o controlador suportar; senão, gateway de protocolo EtherNet/IP ↔ Modbus TCP. Driver nativo EtherNet/IP no roadmap |
| Protocolos nativos | F2: S7comm (Siemens) primeiro, depois EtherNet/IP (Rockwell); OPC UA e outros depois |
| Siemens legado | S7-300 e S7-400: a licença Modbus/TCP por CPU entra na proposta, paga pelo cliente; ou I/O remoto até existir S7comm |
| Outras marcas | Sob demanda, com teste de bancada antes do primeiro cliente, cobrado no projeto de implantação. Só prometer modelo e firmware testados |
| Bancada | S7-1200 CPU 1211C DC/DC/DC, M221 TM221CE16T, Micro820 com Ethernet e AC500-eCo V3 PM5012-T-ETH. Licenças: TIA Portal STEP 7 Basic, Studio 5000 numa edição com editor de ST e Machine Expert |

**Recomendação sobre o domínio (D28):** registrar o domínio próprio **antes de o primeiro gateway ir para um cliente**. A TI do cliente libera a saída pelo nome do host, e trocar o host depois exige atualizar o `cloud.url` de cada gateway instalado.

**Ainda dependem de dados (não de decisão):** nomes dos super admins (D17), do encarregado (DPO) e da escala de plantão; cotação do hardware (D2) e da bancada; confirmação do nome do projeto na Vercel (D28); revisão das minutas por advogado (L7).

## 4. Lacunas de especificação

| # | Tema | O que falta | Quando |
|---|---|---|---|
| L1 | Contrato `/sync`, `/enroll`, `/config` | **Fechada:** `packages/contracts` e `docs/04`. `409 config_outdated` e `429` implementados na API (24/11/2026). `log.level` e `logs.upload` no contrato (24/11/2026). Pendente só o que é da F1: `/releases/latest` | F0 ✓ |
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
| L15 | Documentação para o usuário | **Fechada (24/11/2026):** guias por papel em [`guias/`](guias/README.md) (entrar e minha conta, super admin, técnico Engemase, admin do cliente, gestor/supervisor/engenheiro, operador, TV e terminal) e [notas de versão](notas-de-versao.md), conferidos contra as telas de `apps/web/app`. Já existiam: 10 runbooks (RB-01 a RB-10), ficha de TI, roteiro de bancada e guia por fabricante (`docs/operacao/`). A cada entrega: nova entrada nas notas de versão e guia ajustado quando a tela mudar (a troca do mock, W8/W9, e o login com convite vão pedir revisão) | Piloto |
| L23 | Gateway em trânsito | Gateway ativado na bancada e desligado para envio gera "Gateway offline" no cliente. Falta um estado "em trânsito/não instalado" que suprime o alerta | F1 |
| L24 | Revisão do agente no campo | Diagnóstico de RS-485 pelo técnico depende de leituras pela API local do agente (o `tecnico` não para o agente nem acessa a serial) | F1 |
| L25 | Rollback do agente × esquema do buffer | Um agente anterior recusa um `buffer.db` com `user_version` maior e reinicia sem parar. Até aqui as mudanças no buffer são só colunas acrescentadas (o `user_version` fica em 1, e o rollback funciona). Antes da primeira migração que suba o `user_version`, o atualizador (G4b) precisa saber a versão de esquema de cada pacote (no manifesto) e recusar o rollback automático para um pacote de esquema anterior. **Regra no agente e no atualizador:** `buffer_schema` no manifesto (`oee-gateway version --buffer-schema` no build; ausente = 1), `update.CheckAutoRollback` e `buffer.FileSchemaVersion` (`gateway/internal/update`). O `oee-updater` (G4b) a aplica na instalação (recusa pacote que não abre o buffer do disco) e no rollback automático (`rollback_refused`: o agente novo fica). Falta conferir na bancada (verificação F1.9) | F1 (com G4b) |
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
| L17 | Vercel Cron: alertas (1 min); expiração de concessões, tokens e códigos (5 min); reconciliação da VPN (15 min); partições e limpeza (diário); resumo diário por e-mail (diário). **Implementado** em `/api/cron/*` (24/11/2026; partições quando houver pg_partman) |
| L18 | Só português do Brasil até a F2. Quando entrar o segundo idioma (provavelmente espanhol), usar `next-intl` |
| L19 | Várias TVs por linha, sim. Lista de operadores por unidade, cadastrada pela Engemase (nome e matrícula opcional). Fila offline no tablet por até 24 h. Se o tablet e o desktop reclassificarem a mesma parada, vale a última, e as duas ficam na auditoria |
| L20 | Senha de 12 caracteres ou mais, sem regra de composição, recusada se aparecer em vazamentos conhecidos (consulta por k-anonimato). Depois de 5 erros, espera de 15 min e aviso por e-mail. Sessão de 12 h renovada com o uso; "manter conectado" até 30 dias (a equipe Engemase fica sempre em 12 h). 2FA por aplicativo autenticador (TOTP), com 10 códigos de recuperação. O admin do cliente reinicia o 2FA dos usuários; a Engemase reinicia o do admin, com conferência de identidade. SSO (Microsoft e Google) na F3 |
| L21 | `/sync`: 60 por minuto por gateway (rajada de 10). `/enroll`: 10 por hora por IP e 5 tentativas por código. `/config`: 30 por minuto por gateway (rajada de 5). Acima disso, `429` com `retry_after_s`. **Implementado** no Postgres (24/11/2026) |
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
4. ~~Dono do produto decide os bloqueios da Fase 0 (D2, D7, D26, D28, D29, D36, D37, D38).~~ Feito em 12/11/2026 (seção 3).
5. Abrir o PR do branch de trabalho, revisar e ligar o CI (já inclui o teste de ponta a ponta).
6. Aplicar as migrações 0000–0004 num branch Neon de preview e confirmar que o papel de login é membro de `app_user` e que o dono das tabelas não tem BYPASSRLS.
7. Deploy de preview na Vercel com `DATABASE_URL` e rodar o PoC com 100 gateways simulados contra ele (W3).
8. ~~Escrever o publicador de config e o gerador de códigos de ativação na web~~ (feito em 24/11/2026: `apps/web/lib/server/gateway/publish.ts` e `activation.ts`; falta a tela, W8).
9. Equipe de automação: implementar o `FB_OEE_ENGEMASE` (`docs/operacao/`) na primeira marca de CLP e escolher o cliente e a linha do piloto.
10. Com o hardware: roteiro de bancada (`docs/operacao/verificacao-bancada-r1000.md`), receita do pacote de suporte ao R1000 e primeira imagem Trixie.

## 8. Levantamento de 24/11/2026: o que falta e quem faz

> Conferido contra o repositório em 24/11/2026 (branch `main`, commit `5edc747`). Pergunta: **o que ainda dá para fazer agora, sem contas na nuvem e sem hardware, e qual especialista faz cada parte?**

**Resposta curta.** A Fase 0 de código está pronta e o CI está verde (execução 33, 24/11/2026). Desde 13/11 não entrou código novo de produto. Os passos 1 a 3 e 5 a 7 da seção 7 seguem parados porque dependem da Engemase (compra do hardware, contas). Sem esperar por isso, dá para adiantar quase toda a Fase 1 da web e os comandos do gateway contra o Postgres local e o simulador.

**Como foi conferido:**

| Fato | Como conferir | Resultado |
|---|---|---|
| Sem pull request aberto; `main` igual ao branch de trabalho | GitHub (lista de PRs) e `git log main..HEAD` | 0 PRs; 0 commits de diferença |
| CI verde | GitHub Actions, execução 33 (`5edc747`) | sucesso |
| Login ainda não existe | `grep -rl better-auth apps packages --include=package.json` | nada |
| Telas ainda usam dados simulados | `grep -rl "@/lib/mock" apps/web/app apps/web/components \| wc -l` | 133 arquivos; 63 exports em `apps/web/lib/mock/index.ts` |
| Restos do protótipo que precisam sair (seção 5) | `grep -rln "generateStaticParams\|instant = false" apps/web/app \| wc -l` | 13 arquivos |
| Sem tarefas agendadas | `vercel.json` | só `regions: ["gru1"]`, sem `crons` |
| Comandos do gateway | `gateway/internal/commands/commands.go:67` | todos respondem `unsupported` |
| Página local e ajudante | `deploy/gateway/systemd/fase1/` | só as units; o programa não existe |
| Runbooks RB-07 a RB-10 | `docs/operacao/runbooks/` | escritos (a L15 estava desatualizada; corrigida acima) |
| Minutas jurídicas e comerciais | `grep -c "\[CONFIRMAR\|\[PROPOSTA\]\|___" docs/negocio` | ~170 campos em aberto (os `___` são dados que só a Engemase tem: CNPJ, nomes, valores) |
| Links internos da documentação | script de links relativos nos `.md` de `docs/` | 86 quebrados nos `docs/rascunhos/` (faltava `../`); **corrigidos neste levantamento** |

**Distribuição por especialista (o que dá para fazer já, sem contas nem hardware):**

| Especialista | Tarefas | Épico | Pronto quando |
|---|---|---|---|
| **Back-end (Rafael)** | 1. Publicador de config versionada e gerador de códigos de ativação (passo 8 da seção 7). 2. `409 config_outdated`, `429` com `retry_after_s` pelos limites da L21, alerta de minuto reescrito, histórico de saúde. 3. Fila de comandos na API. 4. As 5 tarefas agendadas da L17 (rotas de cron + `crons` no `vercel.json`) | W6, W7 | Gateway simulado aplica config e responde a comandos; testes verdes |
| **Back-end + Segurança (Rafael e João)** | Login com Better Auth, `requireTenant`, escopo por cliente/unidade/máquina (D11, fail-closed), papéis (D12, D13), 2FA opcional (D14), política de senha e sessão (L20), testes de isolamento entre clientes | W5 | Testes de isolamento verdes no CI |
| **Segurança (João)** | CSP/HSTS e cabeçalhos, revisão do limite aceito da RLS (D38), isolamento nível 4 | W11 | Revisão registrada; e2e verde |
| **Banco (Beatriz)** | Restante da W2b: partições, seeds e branch-semente sintético; tabelas de turnos/feriados (L2), refugo manual e estorno (L3), estado "Em trânsito" do gateway (L23), operadores por unidade (L19) | W2b | Teste de catálogo verde; migrações só aditivas |
| **Frontend (Lucas)** | Troca do mock pelo banco, começando por cadastros, gateways, tags e console mínimo; depois ao vivo, timeline, relatório, operador e terminais. Tirar `generateStaticParams`/`instant = false` (13 arquivos) a cada tela trocada | W8, W9 | Máquina colocada no ar pela web, de ponta a ponta |
| **Gateway (Go; fora dos especialistas da central, fica com o desenvolvedor do gateway)** | Handlers de `tag.read`, `device.test`, `config.reload` e `agent.restart`; `oee-localui` e `oee-helper`; OTA mínimo com `logs.upload` e `log.level` (D29) e a regra da L25 | G3, G4b | Testes com `-race` e o simulador |
| **DevOps e QA (Camila)** | Proteção da `main` no GitHub; `.env.example` completo; roteiro do PoC de 100 gateways pronto para rodar quando a Neon existir; Playwright para a W11 | W1, W3, W11 | Roteiro testado localmente; CI verde |
| **Design (Melissa)** | Só depois da troca do mock: revisar estados vazios, carregando e erro com dados reais | W8, W9 | Prints no celular e no computador |
| **Pesquisa e docs (Sofia)** | ~~Guias por papel e notas de versão (L15)~~ (feito em 24/11/2026: `docs/guias/` e `docs/notas-de-versao.md`); manter este documento, o `docs/00`, os guias e as notas de versão em dia a cada entrega | L15 | — |

**Depende só da Engemase (nenhum especialista resolve):** compra do hardware de bancada e consulta ao despachante/OCD (passos 1 e 2); contas Vercel Pro, Neon e Sentry (passo 3); preencher os dados das minutas (CNPJ, nomes dos super admins, DPO, escala de plantão) e a revisão por advogado (L7); escolher cliente e linha do piloto (passo 9).

**Incerto:** não deu para conferir daqui se o projeto na Vercel já existe nem se `engemase-oee.vercel.app` responde (a rede desta sessão bloqueia o acesso). As minutas foram revisadas em parte em 13/11 (commit `08570fb`, "correções parciais"); falta uma leitura final para ver se a revisão ficou completa.

**Próximo passo recomendado:** começar pela W5 (login e isolamento), que está no caminho crítico e destrava a W8 e a W11, e tocar a W6/W7 em paralelo. Na Engemase, a compra do hardware continua sendo o maior risco de prazo.

### 8.1 Rodada de 24/11/2026: o que cada especialista entregou

Pedido do Pablo pela Central: acionar os especialistas da tabela acima. Seis trabalharam em paralelo; os trabalhos foram juntados num só branch, conferidos juntos e publicados na `main`.

| Especialista | Entregue | Ficou faltando |
|---|---|---|
| **Back-end + Segurança (W5)** | `requireTenant` com RLS, escopo fail-closed (D11), papéis (D12/D13), 2FA opcional (D14); login com Better Auth (senha ≥ 12 com checagem de vazamento, bloqueio 5 erros/15 min, sessão L20, TOTP + 10 códigos); `/api/auth/*` fechado por padrão; 50 testes novos de isolamento e login | Fluxo "definir senha"/convite (achar a pessoa pelo e-mail no servidor, achado W11), senha esquecida, aviso por e-mail no bloqueio, reiniciar 2FA de outra pessoa, cron de limpeza de `auth_login_throttle`, seed da Engemase Lab, escopo nos agregados |
| **Back-end (W6/W7)** | Publicador de config versionada, códigos de ativação, fila de comandos, `429` no Postgres (L21), `409 config_outdated`, histórico de saúde, alerta de minuto reescrito; as 5 rotas de cron da L17 com `CRON_SECRET`; contrato de `log.level` e `logs.upload` | Fechamento de turno e recálculo dos turnos sujos (critério da W7); ligar a limpeza diária a `maintainPartitions()` (precisa da conexão do dono das tabelas); supressão do alerta de offline para gateway "Em trânsito" (L23) |
| **Banco (W2b)** | Partições nativas de `production_minute` (mês) e `tag_sample` (semana) com `app.maintain_partitions`; seed sintético protegido; tabelas de feriados (L2), motivos de refugo e estorno (L3), operadores (L19) e "Em trânsito" (L23), todas com RLS | Branch-semente na Neon (N1); retenção da auditoria; regras que ficam na aplicação (turnos sem sobreposição, prazo do lançamento atrasado) |
| **Segurança (W11)** | CSP, HSTS e demais cabeçalhos em todas as respostas (sem violação em 23 telas); revisão do limite da RLS em [operacao/revisao-seguranca-w11.md](operacao/revisao-seguranca-w11.md) | CSP com nonce quando as telas deixarem de ser estáticas; Firewall da Vercel; testes de isolamento de nível 3 e 4 (depois da W8); restrições únicas com `organization_id` (migração de contrato) |
| **Gateway (G3/G4b)** | Handlers de `tag.read`, `device.test`, `config.reload`, `agent.restart`, `log.level` e `logs.upload`; regra da L25 no manifesto; esqueleto de `oee-localui` e `oee-helper` com ativação por socket. **Depois (25/11):** `oee-updater` (pacote `oee-gateway-updater`: assinatura Ed25519, SHA-256, saúde em 5 min, rollback com a L25, retomada depois de queda de energia) e `oee-gateway update fetch`; operações do `oee-helper` (rede com checkpoint do NetworkManager, relógio, reset de fábrica, pendrive) com lista fechada e `SO_PEERCRED`; página local com login pela senha local (argon2id, bloqueio) e as telas do MVP (conexões, últimas leituras, fila, nuvem) pela API local só de leitura (`ui.sock`) | Conferência na bancada ([verificacao-bancada-r1000.md](operacao/verificacao-bancada-r1000.md) §5.7: RS-485, journald, SO_PEERCRED, NetworkManager, OTA real); par de chaves do OTA; units da página e do ajudante no `.deb` depois da bancada; comando de atualização no contrato; telas de rede, diagnóstico e leitura ao vivo da página; nftables pelo ajudante |
| **DevOps e QA (W1/W3/W11)** | `.env.example` completo; PoC de N gateways ([operacao/poc-100-gateways.md](operacao/poc-100-gateways.md), 100 gateways locais sem erro, `/sync` p99 454 ms); Playwright (15 telas, celular e computador) e job no CI; passo a passo da proteção da `main` ([operacao/protecao-da-main.md](operacao/protecao-da-main.md)) | PoC oficial na Neon (N1); aplicar a proteção da `main` (admin do repositório) |
| **Frontend (W8/W9)** | **Não acionado nesta rodada.** A troca do mock pelo banco depende da W5 (entrou agora) e, para aparecer no ar, de um banco na Vercel: sem a Neon, as telas trocadas ficariam vazias na demonstração | Começar pelos cadastros, gateways, tags e console mínimo, contra o Postgres local |
| **Design** | **Não acionado:** pela tabela acima, só depois da troca do mock | — |
| **Pesquisa e docs (Sofia)** | Esta seção, `docs/00` e os READMEs atualizados | ~~Guias por papel e notas de versão (L15)~~ (feitos em seguida, ver L15) |

**Ao juntar:** as migrações de três especialistas tinham a mesma numeração; ficaram 0007–0008 (W2b), 0009–0010 (W6), 0011–0012 (W5) e 0013 (partições, sempre a última, porque o teste a aplica sobre um banco que já tem dados). O padrão do `AUTH_ENFORCED` mudou para "exigir login em produção quando o `BETTER_AUTH_SECRET` existe": assim a demonstração no ar continua aberta até a Engemase configurar o login na Vercel.

### 8.2 Rodada de 25/11/2026: pendências de código fechadas

Pedido do Pablo pela Central: finalizar todas as pendências. Seis especialistas trabalharam em paralelo; tudo foi juntado num branch só, conferido (typecheck, lint, testes de todos os pacotes, build, Playwright, testes Go com `-race`, prints 390/1280) e publicado na `main`.

| Frente | Entregue | Ainda falta (e por quê) |
|---|---|---|
| **W7 (Back-end)** | Fechamento de turno e recálculo dos turnos sujos (`/api/cron/turnos`, golden 78,4% no teste); partições na limpeza diária por `DATABASE_MAINTENANCE_URL`; retenção da auditoria (0014/0015, `AUDITORIA_RETENCAO_DIAS`); alerta offline suprimido para gateway "Em trânsito" (L23); regras de turno sem sobreposição e prazo de lançamento atrasado (L2, L3, L19) | No plano Hobby da Vercel a tarefa `turnos` não é agendada (roda à mão); paradas planejadas recorrentes; produção em feriado fora do `oee_shift` |
| **W5 (Segurança)** | Convite e "definir senha" (pessoa achada pelo e-mail no servidor), senha esquecida, aviso de bloqueio por e-mail (Resend opcional, senão log), reinício do 2FA de outra pessoa, limpeza do login no cron, seed da Engemase Lab (`db:seed:plataforma`), escopo nos agregados, testes de isolamento de nível 3 e 4 | Configurar Resend e domínio remetente; rodar o seed de plataforma na Neon (N1) |
| **W8 (Frontend)** | Console Engemase e cadastros lendo e gravando no banco (0018: `app.platform_create_client`/`platform_update_client`); máquina colocada no ar pela web de ponta a ponta com o agente real e o plc-sim | Turnos, produtos, motivos, usuários, terminais e aparência ainda no mock; editar estado do cliente pela tela |
| **W9 (Frontend)** | Visão geral, máquinas, linhas, relatórios, notificações, ajuda, andon e operador lendo do banco (oee-core; usa `oee_shift` quando existe) | Ações do operador (classificar parada, refugo, produto) ainda simuladas; terminal pareado sem token de aparelho |
| **Gateway (G4b)** | `oee-updater` (assinatura Ed25519, saúde, rollback, regra da L25); operações reais do `oee-helper`; `oee-localui` com login e telas de status | Conferência na bancada (§5.7 do roteiro); par de chaves do OTA de produção; ~~comando de atualização pela nuvem~~ feito em 27/11/2026 (§8.4) |
| **L15 (Docs)** | Guias por papel em [`guias/`](guias/README.md) e [notas de versão](notas-de-versao.md) | — |

**Sobra só o que não depende de código:** contas (Vercel Pro, Neon, Sentry, Resend), hardware de bancada, proteção da `main` e Firewall da Vercel (administrador), minutas jurídicas e a escolha do piloto.

**Atenção na implantação (N1):** o usuário do `DATABASE_URL` deve ser `NOINHERIT` com `SET app_user` (revisão W11), e o do `AUTH_DATABASE_URL` precisa herdar `auth_service`. ~~Antes disso, conferir que a API dos gateways funciona com o login `NOINHERIT`~~ **Conferido e corrigido em 27/11/2026:** a busca do token e do código, o limitador e o registro das tarefas agendadas falhavam com `permission denied for schema app`; agora rodam em `withAppRole` (`@engemase/db`), com o teste `apps/web/test/server/login-producao.test.ts`. As tarefas que rodam mais de uma vez por dia são chamadas pelo cron-job.org (ver apps/web/README.md, "Tarefas agendadas").

**W5, pendências fechadas (25/11/2026):** convite e "definir senha" (pessoa achada pelo e-mail no servidor, token próprio de uso único de 72 h no fragmento do link, só o hash no banco), "esqueci minha senha" (resposta igual exista ou não a conta, 3 pedidos/h por e-mail e 10/h por IP, link de 30 min), aviso por e-mail de conta bloqueada, reinício do 2FA de outra pessoa (admin do cliente para membros comuns só desse cliente; super admin para qualquer membro; auditado), e-mail por Resend opcional (`RESEND_API_KEY` + `EMAIL_FROM`; sem eles, só log), limpeza de `auth_login_throttle`, verificações e tokens no job `limpeza`, seed de plataforma "Engemase Lab" + primeiro super admin (`db:seed:plataforma`, com confirmação extra em produção), resumos com escopo (totais de produção, CSV, alertas, auditoria) e os testes de isolamento de **nível 3** (convite, reenvio e 2FA com ids de outro cliente) e **nível 4** (agregados e CSV com escopo por unidade e por máquina). Sem migração nova. Falta: ligar as Server Actions de usuários à tela (W8), configurar o Resend/domínio remetente (N1) e rodar o seed de plataforma na Neon (N1). Ver apps/web/README.md, "Login e acesso por cliente".

### 8.3 Acesso remoto (VPN): deixado para depois (27/11/2026)

O programa da VPN está pronto e testado sem hardware: plataforma (pedido, aprovação, aprovação assinada, chave do Tailscale criada só na entrega) e gateway (`oee-remote-access`, só a porta 22, nada em disco). Ver [`docs/12`](12-acesso-remoto-vpn.md). A VPN segue **desligada** na plataforma: **não criar `VPN_HABILITADA`** até fechar os itens abaixo. Decisão do Pablo: fica para quando houver gateway na bancada.

| # | Falta | Depende de | Pronto quando |
|---|---|---|---|
| V1 | **SSH do gateway:** OpenSSH escutando só em `127.0.0.1`, só certificados de curta duração, usuário `suporte` com registro do `sudo` | Decidir onde fica a chave que emite os certificados (CA SSH; sugestão no `docs/12`: KMS, com cópia no cofre da L14) | Técnico entra pela VPN com certificado de poucas horas e o acesso aparece na auditoria |
| V2 | ~~**Empacotamento**~~ **Feito em 27/11/2026:** pacote próprio `oee-gateway-remote-access` (programa, socket, usuário `oee-ra`, chave da aprovação em `/usr/share/oee-remote-access/keys`, nunca na pasta do OTA), TCP 443 liberado ao `oee-ra` no firewall; conferido pelo `deploy/gateway/validate.sh` (148 ok). Instala só à mão na bancada até o V3 | — | Feito |
| V3 | **Teste na bancada** com gateway na internet e o Tailscale de verdade (instalar o `oee-gateway-remote-access` à mão): ligar, entrar por SSH, encerrar por prazo, inatividade, pedido e trava local; nó apagado no fim | Hardware (G0) e V1, V2 | Roteiro conferido; só então criar `VPN_HABILITADA=1` na Vercel |
| V4 | Conferir na aba Actions do GitHub o job `go-remote-access` do CI | — | Job verde |

### 8.4 Atualização do agente pela nuvem (27/11/2026)

Decisão: os pacotes ficam no **GitHub Releases** do repositório (público). Feito:

- `.github/workflows/gateway-release.yml`: tag `gateway-v<semver>` num commit da `main` → testes, `.deb` de arm64 e amd64 (agente, atualizador e VPN), manifestos assinados com o segredo `OTA_SIGNING_KEY` e conferidos contra `deploy/gateway/keys/*.pub` antes de publicar, release com `SHA256SUMS`.
- Contrato: comando `agent.update` (versão + manifesto de cada arquitetura, só https), resultado `downloaded`/`current`, erros `update_busy` e `update_failed`.
- Gateway: baixa e confere; **só pede a instalação depois que a nuvem confirma o resultado** (o reinício do `oee-updater` não perde a resposta). Teste de ponta a ponta com TLS e CA corporativa.
- Plataforma: botão "Atualizar agente" no detalhe do gateway (equipe Engemase), versões lidas do GitHub e histórico na aba Comandos.
- Ficha de TI: `github.com`, `release-assets.githubusercontent.com` e `objects.githubusercontent.com` (TCP 443) no lugar do Blob.

| # | Falta | Quem |
|---|---|---|
| U1 | **Par de chaves do OTA de produção:** a pública em `deploy/gateway/keys/ota-2026.pub` e a privada no segredo `OTA_SIGNING_KEY` do GitHub e no cofre (2 pessoas). Sem ela, o workflow para com erro e o gateway recusa tudo | Pablo + equipe |
| U2 | Proteger as tags `gateway-v*` no GitHub (só administradores criam) | Administrador do repositório |
| U3 | Primeira release de teste e atualização de um gateway na bancada (com `oee-updater seed` antes) | Bancada |
| U4 | Atualizar vários gateways de uma vez (ondas/canais) | Depois do piloto |
