# SLA e suporte

> Versão 0.1 · 12/11/2026 · Lacuna **L11** ([docs/17 §4](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)). Anexo B do [contrato de assinatura](juridico/01-contrato-de-assinatura.md).
>
> **Todos os números deste documento são proposta** ([PROPOSTA]) até o dono do produto aprovar. Nada aqui vale para cliente antes disso.

**Para quem:** direção, comercial e suporte da Engemase; cliente (como anexo do contrato).

**Base:** níveis de atendimento N1–N3 do [README de operação](../operacao/README.md#5-níveis-de-atendimento-proposta), runbooks em [`docs/operacao/runbooks/`](../operacao/README.md#1-índice), backup do [docs/06](../06-banco-de-dados.md#backup-e-recuperação), buffer do gateway do [docs/16](../16-projeto-do-gateway.md) e decisões D5, D7, D12, D13 e D28. **Em aberto:** D2 (hardware), D20 (acesso remoto), D29 (OTA mínimo).

## 1. Resumo por plano **[PROPOSTA]**

| | Starter | Pro | Enterprise |
|---|---|---|---|
| Disponibilidade mensal | **Meta** de 99,0%, sem crédito | **99,5%**, com crédito | **99,5%**, com crédito maior (99,8% só depois da Vercel Enterprise, seção 3.3) |
| Atendimento | Seg. a sex., 7h30–18h | Seg. a sex., 7h30–18h | Seg. a sex., 7h30–18h |
| Plantão para prioridade Crítica | — | Seg. a sáb., 6h–22h | **24×7** |
| Primeira resposta, prioridade Crítica | 4 h úteis | 2 h (no plantão) | 1 h (24×7) |
| Incidente de **segurança** (seção 6.3) | **24×7:** S1 imediato; S2 em até 1 h | Igual | Igual |
| Mudança simples de configuração (D12) | 2 dias úteis | 1 dia útil | 4 h úteis |
| Troca de gateway com defeito, região 1 | 3 dias úteis | 2 dias úteis | Próximo dia útil |
| Relatório pós-incidente (seção 6.8) | Só de incidente de segurança | Sim | Sim |
| Relatório mensal de disponibilidade | — | Sob pedido | Mensal |

## 2. O que o SLA cobre

| Coberto | Não coberto por este SLA |
|---|---|
| **Aplicação web** em `https://engemase-oee.vercel.app` (login, telas, relatórios, terminais) | O **hardware do gateway**: tem regra própria de troca (seção 11) |
| **API dos gateways** (`/api/gateway/v1/*`), que recebe os dados | Entrega de **push e e-mail**: dependem do celular, do navegador e do provedor de e-mail. O alerta fica sempre na central do app ([docs/13](../13-notificacoes-e-alertas.md#princípios)) |
| Suporte, pedidos de configuração e troca de hardware, nos prazos deste documento | Recursos em fase de testes (beta), marcados assim na tela |
| | Integrações e serviços sob orçamento (seção 6 de [planos e preços](planos-e-precos.md#6-serviços-avulsos-proposta)) |

**O endereço muda (D28):** hoje é o domínio da Vercel. Quando a Engemase passar ao domínio próprio, este SLA passa a valer para o endereço novo, com o aviso do [contrato, cl. 19.3](juridico/01-contrato-de-assinatura.md).

## 3. Disponibilidade

### 3.1 Metas por plano **[PROPOSTA]**

| Plano | Meta mensal | Parada máxima em um mês de 30 dias | Crédito |
|---|---|---|---|
| Starter | 99,0% | 7 h 12 min | Não (é meta, não compromisso) |
| Pro | 99,5% | 3 h 36 min | Sim (seção 12) |
| Enterprise | 99,5% | 3 h 36 min | Sim, maior (seção 12) |
| Enterprise com Vercel Enterprise contratada | 99,8% | 1 h 26 min | Sim |

Todos os clientes usam a **mesma infraestrutura**. A meta muda por plano no que a Engemase **promete e paga** (crédito), não na qualidade do serviço entregue.

### 3.2 Como medir

- **Monitor externo**, fora da Vercel (seção 8), de **2 locais**, a cada **1 minuto**, em duas verificações:
  1. **Aplicação:** a página de login e uma rota de saúde que consulta o banco.
  2. **API dos gateways:** o teste público `/api/gateway/v1/ping`, previsto na [ficha de TI](../operacao/ficha-tecnica-ti-cliente.md#8-teste-de-liberação-antes-da-visita).
- **Minuto indisponível:** qualquer das duas verificações falha (sem resposta, erro de conexão ou HTTP 5xx) **nos 2 locais** no mesmo minuto.
- **Disponibilidade do mês** = (minutos do mês − minutos excluídos − minutos indisponíveis) ÷ (minutos do mês − minutos excluídos) × 100. É a mesma fórmula do SLA da Vercel.
- As duas rotas de saúde ainda **não existem** no código: precisam existir antes do primeiro cliente pagante.
- **Verificar a cada 1 minuto exige o plano pago do monitor** (seção 8). O plano gratuito do Better Stack verifica a cada **3 minutos**: serve no piloto, que não tem crédito. Nesse caso, cada falha conta **3 minutos** indisponíveis.

### 3.3 Coerência com os fornecedores

A Engemase não pode prometer mais do que os fornecedores entregam, com margem.

| Fornecedor | SLA publicado | Crédito que ele dá | Fonte |
|---|---|---|---|
| **Vercel Pro** | **Sem SLA de disponibilidade** publicado para o Pro | Nenhum | [1] [2] |
| Vercel Enterprise | **99,99%** ("esforços comercialmente razoáveis") | Faixas sobre a fatura da Vercel (resumo de terceiros: 10% a 50%) [CONFIRMAR] | [1] |
| **Neon Scale** (recomendado) | **99,95%** para os endpoints de compute | 10% da fatura da Neon abaixo de 99,95%; faixas maiores abaixo disso [CONFIRMAR] | [3] [4] |
| Neon Launch | Sem SLA | Nenhum | [4] |

**Conta de composição:** a plataforma precisa da Vercel **e** da Neon ao mesmo tempo. Com 99,99% × 99,95%, o teto teórico é **~99,94%**, antes de qualquer erro nosso. Por isso:
- **99,5%** deixa **3 h 36 min por mês para tudo:** falhas da Vercel Pro (que não tem SLA), da Neon e nossas, inclusive uma restauração completa do banco (seção 5: até 2 h fora do ar). **É uma aposta, não uma folga garantida.** Uma falha longa de fornecedor, ou uma restauração somada a outra falha no mesmo mês, gera crédito. O teto de crédito (seção 12) limita a perda.
- **Não há número público confiável** da disponibilidade das funções da Vercel em `gru1`. As páginas de terceiros [5] listam incidentes de qualquer componente (builds, outras regiões, produtos que não usamos): não medem o que o nosso monitor mede. A base para rever a meta é o nosso monitor (seção 3.2) nos 6 primeiros meses.
- **99,8%** (1 h 26 min por mês) só faz sentido com a Vercel Enterprise (custo bem acima do Pro, sob cotação), com o histórico de 6 meses mostrando que a meta é real **e** com a restauração completa do banco medida abaixo de 1 h (uma só restauração de 2 h já passa da meta).
- **Não prometer 99,9%** nesta fase.
- **Créditos são risco da Engemase.** A Vercel Pro não devolve nada, e a Neon devolve 10% da fatura **dela**. Um crédito de 10% para 100 máquinas a R$ 300 é R$ 3.000, quase toda a conta de nuvem do mês ([planos e preços, §8.2](planos-e-precos.md#82-custo-de-nuvem-por-cenário-estimativa)). **Conte com crédito** no mês de uma restauração completa ou de uma falha de fornecedor acima de 3 h 36 min.
- **Neon Scale em produção é obrigatório** para este SLA: o Launch não tem SLA e restaura só até 7 dias.

### 3.4 O que fica fora da conta

Não contam como indisponibilidade ([contrato, cl. 7.2](juridico/01-contrato-de-assinatura.md)):

| Exclusão | Por quê |
|---|---|
| Falta de **internet**, **energia** ou **rede** na planta | Fora do controle da Engemase. O gateway guarda os dados (seção 4) |
| **Firewall, proxy ou inspeção SSL** do cliente bloqueando o endereço ([ficha de TI, §4](../operacao/ficha-tecnica-ti-cliente.md#4-tráfego-de-saída-necessário-porta-it)) | Configuração do cliente |
| Falha do **CLP**, da máquina, do barramento RS-485 ou de equipamento do cliente | O gateway só lê o que o CLP entrega |
| Gateway desligado, mudado de lugar ou alterado sem a Engemase | Contrato, Anexo H, H.4 |
| **Manutenção programada** avisada, dentro da janela (seção 9) | Limite de 4 h por mês |
| Cliente **suspenso** por inadimplência | [Planos e preços, §3.4](planos-e-precos.md#34-inadimplência-padrão-proposto--d3-aberta) |
| Força maior, inclusive falha ampla de um provedor de nuvem na região inteira ([contrato, cl. 18](juridico/01-contrato-de-assinatura.md)) | **[ADVOGADO]:** a falha comum da Vercel ou da Neon **conta** no SLA (o fornecedor é escolha nossa); só a falha ampla e regional entra como força maior |
| Problema num navegador, TV ou tablet fora da lista suportada (L12: Chrome e Edge atuais, Safari do iOS atual, TV com Chrome ou Android TV) | [docs/17 §4, L12](../17-backlog-e-pendencias.md#4-lacunas-de-especificação) |

## 4. Coleta, buffer e dados atrasados

- **Sem internet, nada se perde por até 30 dias ou 1 GB** de fila, o que vier primeiro ([docs/16](../16-projeto-do-gateway.md), [regras de ouro](../operacao/README.md#3-regras-de-ouro)). Quando a rede volta, o gateway reenvia tudo em ordem, e os turnos afetados são recalculados (cron a cada 5 min, [docs/05](../05-plataforma-web.md#jobs-agendados-vercel-cron)).
- Se a fila passar do limite, saem primeiro as amostras livres; o gateway registra um evento `data_loss`.
- **Dados atrasados não são indisponibilidade**, desde que cheguem e sejam recalculados. A tela mostra o selo "dados atrasados" a partir de 30 s.
- **Meta interna (não é crédito):** 99% dos `/sync` respondidos em menos de 1 s ([docs/17, L13](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)).
- **Monitoramento proativo:** gateway sem contato por 5 min gera alerta crítico para a engenharia do cliente e para o suporte da Engemase ([docs/13](../13-notificacoes-e-alertas.md#catálogo-inicial-de-alertas-presets-por-cliente)). No horário de atendimento (e no plantão), a Engemase abre o chamado sem esperar o cliente.

## 5. Recuperação: RPO e RTO **[PROPOSTA]**

**RPO** = quanto dado pode ser perdido. **RTO** = em quanto tempo o serviço volta. Valem para todos os planos (a infraestrutura é a mesma).

| Cenário | RPO | RTO | Como |
|---|---|---|---|
| Internet da planta ou plataforma fora do ar, gateway ligado | **Zero**, dentro de 30 dias ou 1 GB de fila | Automático quando a conexão volta | Buffer do gateway (seção 4) |
| Falta de energia na planta | Zero do que já estava no buffer. Sem energia não há coleta: o período vira "sem comunicação" | Automático quando a energia volta | [docs/16 §5](../16-projeto-do-gateway.md#5-rede-e-instalação) |
| Gateway com defeito | A fila não enviada da unidade com defeito. Normal: menos de ~10 s. Se ela estava sem internet antes do defeito, tudo desde a queda. Se a unidade ainda fala com a nuvem, a fila é esvaziada antes da troca. Se não fala, **no MVP essa fila se perde**: ainda não há ferramenta para recuperá-la ([RB-10 §5.2](../operacao/runbooks/10-troca-hardware-gateway.md#52-fila-da-unidade-antiga)). Mais o período da troca: nada é coletado até a unidade nova entrar | Prazo de troca (seção 11) | [RB-10](../operacao/runbooks/10-troca-hardware-gateway.md), [docs/16 §7](../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida) |
| Falha de infraestrutura do banco (disco, zona) | ~Zero (o Neon guarda o log do banco de forma redundante) [CONFIRMAR] | O do fornecedor; meta nossa: 4 h. Acima de 3 h 36 min no mês, gera crédito (seção 3.3) | Neon |
| **Erro lógico**, dano limitado (um cliente, uma tabela, poucas linhas) | **15 min** | **Plataforma no ar** o tempo todo; dados afetados de volta em até **4 h** | Recuperação parcial a partir de um ramo temporário no ponto anterior ao dano ([RB-08 §5.2](../operacao/runbooks/08-restauracao-banco-pitr.md#52-recuperação-parcial-preferível)) |
| **Erro lógico**, dano amplo (vários clientes, esquema) | **15 min** | **Até 2 h com a plataforma fora do ar** (meta, a medir no teste de restauração); período entre o ponto restaurado e a restauração copiado de volta e turnos recalculados em até **8 h**, com a plataforma no ar | Restauração do ramo de produção ([RB-08 §5.3 e §5.4](../operacao/runbooks/08-restauracao-banco-pitr.md#53-restauração-do-ramo-main-todos-os-clientes)). As horas fora do ar **contam no SLA** (não é manutenção programada) |
| Perda do projeto no fornecedor (desastre) | Até a última cópia lógica externa: **7 dias** com a cópia semanal do docs/06; **24 h** se ela passar a diária | 2 dias úteis | Novo Postgres, restaurar a cópia, apontar a aplicação |
| Região `gru1` da Vercel fora do ar por muito tempo | Zero (os dados estão no banco e nos gateways) | **1 h** para rodar as funções na região de contingência, **só depois** de o advogado aprovar a contingência do contrato e do DPA. Até lá, o da Vercel. Falha ampla e regional é força maior (seção 3.4) | Contingência de região do [contrato, cl. 10.4](juridico/01-contrato-de-assinatura.md#10-proteção-de-dados-pessoais) e do [DPA, cl. 9.6](juridico/02-acordo-de-tratamento-de-dados.md#9-transferência-internacional) (as duas **[PROPOSTA]**): por tempo limitado, banco em São Paulo, aviso ao cliente em até 24 h e volta a `gru1` assim que possível. Região reserva **[DECIDIR]** (ex.: `iad1`, EUA). A plataforma fica mais lenta: cada consulta ao banco cruza o continente. Sem essas cláusulas, a aplicação não sai de `gru1` (contrato, cl. 10.3) |

**Limite importante (L14):** quando o banco **inteiro** volta a um ponto anterior, o que chegou depois desse ponto sai do ramo de produção, porque **os gateways apagam o que já foi confirmado** e não reenviam. A única cópia desse período é o ramo de backup que a Neon cria na restauração, copiado de volta à mão ([RB-08 §5.4](../operacao/runbooks/08-restauracao-banco-pitr.md#54-recuperar-o-período-entre-t0-e-t1-l14)). Por isso a recuperação parcial vem sempre primeiro. Proposta para a engenharia: o gateway guardar o que já foi confirmado por alguns dias e aceitar um pedido de reenvio. Com isso, o RPO do erro lógico cai para perto de zero.

**Restauração e disponibilidade:** com 99,5% (3 h 36 min por mês), uma restauração completa de 2 h usa mais da metade da margem do mês; somada a outra falha, gera crédito (seção 3.3). É risco aceito: restaurar o ramo de produção é o último recurso ([RB-08 §1](../operacao/runbooks/08-restauracao-banco-pitr.md#1-quando-restaurar)).

**Configuração necessária no Neon:**
- **Plano Scale** em produção (SLA de 99,95% e restauração até 30 dias).
- **Janela de restauração de 14 dias**, ajustada à mão: o padrão do Neon nos planos pagos é **1 dia** [6]. O histórico custa US$ 0,20/GB-mês.
- Este número entra no [contrato, cl. 16.1](juridico/01-contrato-de-assinatura.md) ("as cópias de segurança expiram em N dias").
- **Teste de restauração a cada 3 meses**, com registro ([RB-08 §5.6](../operacao/runbooks/08-restauracao-banco-pitr.md#56-teste-de-restauração-a-cada-3-meses), [docs/17, L14](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)). O teste mede o tempo da restauração completa e confere se cabe nas 2 h acima.

## 6. Atendimento

### 6.1 Níveis

Do [README de operação, §5](../operacao/README.md#5-níveis-de-atendimento-proposta):

| Nível | Quem | Faz |
|---|---|---|
| **N1** | Suporte Engemase (papel `support`, com concessão de suporte aberta pelo próprio técnico, D5) | Triagem pela plataforma, contato com o cliente, roteiro dos runbooks |
| **N2** | Engenharia Engemase (desenvolvedores e `field_engineer`) | Logs, releases, hardware, configuração, visitas |
| **N3** | Direção técnica (`super_admin`) e fornecedores (Vercel, Neon, Seeed, Tailscale) | Incidentes de plataforma, segurança e contratos |

Toda entrada da Engemase nos dados do cliente fica na **auditoria visível ao cliente** e com **faixa na tela** (D5), com o número do chamado.

### 6.2 Horários **[PROPOSTA]**

| | Starter | Pro | Enterprise |
|---|---|---|---|
| Atendimento normal (todas as prioridades) | Seg. a sex., 7h30–18h | Seg. a sex., 7h30–18h | Seg. a sex., 7h30–18h |
| Plantão para prioridade **Crítica** | — | **Seg. a sáb., 6h–22h** | **24×7**, inclusive feriados |
| Incidente de **segurança** (seção 6.3) | **24×7** | **24×7** | **24×7** |

- Horário de Brasília. Fora do atendimento: feriados nacionais e do município da sede da Engemase **[PREENCHER]**.
- O horário normal é o que já aparece na central de ajuda do protótipo ("Seg. a sex., 7h30–18h · chamados críticos com plantão, conforme o contrato").
- **"Hora útil"** = hora dentro do horário de atendimento normal. **"Hora"** sem adjetivo = hora corrida, dentro do plantão do plano. Chamado Crítico aberto fora do plantão (ex.: domingo, no Pro) conta a partir do início do próximo período de plantão.
- **Sobreaviso de segurança 24×7, para todos os clientes, já é obrigatório:** o [plano de resposta a incidentes](juridico/06-plano-de-resposta-a-incidentes.md#4-severidade) exige acionamento imediato no S1 e em até 1 h no S2, 24 horas por dia, com um "super admin de plantão" como coordenador. Essa escala existe desde o piloto, qualquer que seja o plano vendido.
- **Custo do plantão:** sobreaviso por escala (CLT, art. 244, § 2º; TST, Súmula 428). Com uma equipe de até 5 pessoas (D17), a escala 24×7 de segurança precisa de **pelo menos 3 pessoas**. O plantão de P1 do Pro e o 24×7 do Enterprise **usam a mesma escala**: aumentam os acionamentos e as horas trabalhadas, não o número de pessoas de sobreaviso. **[DECIDIR]** quem forma a escala antes do piloto; sem ela, nem o plano de incidentes se cumpre. Custo em [planos e preços, §8.4](planos-e-precos.md#84-custo-direto-por-máquina-cenário-de-100-máquinas-hipótese).

### 6.3 Canais

| Canal | Para quê | Observação |
|---|---|---|
| **Chamado na plataforma** (`/[cliente]/ajuda`, "Abrir chamado") | **Canal oficial** de todas as prioridades | O protótipo já tem o formulário, a prioridade e a lista "Seus chamados". O relógio do prazo começa aqui |
| E-mail do suporte **[PREENCHER]** | Quem não consegue entrar na plataforma | Vira chamado |
| **Telefone** do suporte **[PREENCHER]** | **Prioridade Crítica**, sempre, inclusive no plantão | Registrar o chamado em seguida (o técnico pode abrir em nome do cliente) |
| WhatsApp **[PREENCHER]** | Contato rápido, fotos do painel, avisos | Não substitui o chamado; dados do cliente não ficam no WhatsApp |
| **Telefone de segurança 24×7** **[PREENCHER]** e e-mail de segurança **[PREENCHER]** | **Incidente de segurança**, em **qualquer plano**, a qualquer hora | Fora do sistema afetado (lista de contatos 24 horas do [plano de incidentes, §3](juridico/06-plano-de-resposta-a-incidentes.md#3-papéis)). Registrar o chamado em seguida |

**Incidente de segurança** (ex.: suspeita de acesso indevido, conta comprometida, token de gateway roubado) segue o [plano de resposta a incidentes](juridico/06-plano-de-resposta-a-incidentes.md), com severidades próprias (S1 a S4) e **prazos próprios, iguais em todos os planos**:

| Severidade do plano | Acionamento da Engemase | Vale para |
|---|---|---|
| **S1 Crítico** | Imediato, 24 horas por dia | Starter, Pro e Enterprise |
| **S2 Alto** | Em até 1 hora, 24 horas por dia | Starter, Pro e Enterprise |
| S3 e S4 | Horário de atendimento normal, como P2 a P4 (seção 6.5) | Todos |

Esses prazos **não dependem** dos prazos de P1 por plano da seção 6.5: um cliente Starter com suspeita de vazamento no domingo é atendido no domingo. O chamado fica com prioridade Crítica (P1) para o registro.

### 6.4 Prioridades

Os nomes e as dicas são os do formulário "Abrir chamado" do protótipo (`PRIORITY_META`). O cliente escolhe; o N1 confirma ou ajusta, com justificativa no chamado.

| Prioridade | Quando | Exemplos |
|---|---|---|
| **Crítica (P1)** | Máquinas ou unidade sem dados agora, ou plataforma fora do ar | Plataforma não abre; vários gateways offline sem causa no cliente; nenhum dado novo numa unidade; suspeita de incidente de segurança |
| **Alta (P2)** | Afeta a produção ou os dados de uma linha | Um gateway offline; OEE ou contagem errados numa linha; terminal do chão parado; alertas não chegam |
| **Normal (P3)** | Algo não funciona como esperado, com contorno | Relatório com erro de exibição; um usuário não consegue entrar; lentidão numa tela |
| **Baixa (P4)** | Dúvida ou sugestão | Como usar um relatório; ideia de melhoria |

### 6.5 Prazos por plano **[PROPOSTA]**

**Primeira resposta:** uma pessoa da Engemase responde com o diagnóstico inicial e o próximo passo (resposta automática não conta). **Contorno:** o cliente volta a trabalhar, mesmo sem a causa resolvida. **Solução definitiva:** pode sair numa versão seguinte; o chamado diz quando.

| Prioridade | | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **Crítica (P1)** | Resposta | 4 h úteis | **2 h** (plantão) | **1 h** (24×7) |
| | Contorno | 2 dias úteis | 1 dia útil | 8 h |
| | Atualização ao cliente | 1 vez por dia útil | A cada 4 h | A cada 2 h |
| **Alta (P2)** | Resposta | 8 h úteis | 4 h úteis | 2 h úteis |
| | Contorno | 5 dias úteis | 3 dias úteis | 2 dias úteis |
| **Normal (P3)** | Resposta | 2 dias úteis | 1 dia útil | 4 h úteis |
| | Solução | 15 dias úteis ou próxima versão | 10 dias úteis | 5 dias úteis |
| **Baixa (P4)** | Resposta | 5 dias úteis | 3 dias úteis | 2 dias úteis |
| | Solução | Sem prazo | Sem prazo | Sem prazo |

**O relógio para** quando o chamado fica em "Aguardando você" (status do protótipo): o cliente precisa responder, liberar acesso, ir ao painel ou religar algo.

### 6.6 Pedidos de configuração (D12)

Como **só a Engemase configura** (unidades, linhas, máquinas, gateways, tags, terminais, turnos, produtos, motivos, aparência e políticas), o prazo de configuração pesa tanto quanto o de suporte. Um produto novo não cadastrado deixa a performance errada até alguém da Engemase cadastrar.

| Tipo | Exemplos | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **Simples** | Produto novo e ciclo ideal; motivo de parada; ajuste de turno ou feriado; renomear; parear terminal (com o código); limite de micro-parada; meta de OEE | 2 dias úteis | 1 dia útil | **4 h úteis** |
| **Média** | Máquina nova num gateway e CLP já integrados (dentro das máquinas contratadas); linha nova; terminal novo; mapa de códigos de falha | 5 dias úteis | 3 dias úteis | 2 dias úteis |
| **Projeto** | Unidade nova, gateway novo, CLP sem bloco OEE, máquina além do contrato | Proposta e cronograma ([planos e preços, §6](planos-e-precos.md#6-serviços-avulsos-proposta)) | Idem | Idem |

- Pedidos simples e médios estão **incluídos** na assinatura, sem limite de quantidade **[PROPOSTA]**. Se um cliente passar de ___ pedidos por mês, a Engemase pode propor um ajuste **[DECIDIR]**.
- **Usuários não são pedido de configuração:** o admin do cliente faz sozinho (D12).
- **Sugestão para reduzir o volume:** treinar o cliente a pedir em lote (ex.: todos os produtos novos do mês num chamado só).

### 6.7 Escalonamento

| Situação | Para quem |
|---|---|
| P1 sem contorno na metade do prazo | N2, com aviso ao coordenador do suporte |
| P1 sem contorno no prazo | N3 (direção técnica) e contato do cliente com a direção da Engemase |
| Falha de fornecedor (Vercel, Neon) | N3 abre chamado no fornecedor e acompanha |
| Cliente insatisfeito com o atendimento | E-mail da direção **[PREENCHER]** |

### 6.8 Comunicação de incidentes da plataforma

| Quando | O quê | Onde |
|---|---|---|
| Até 30 min depois de confirmado um incidente P1 de plataforma | Aviso inicial | Página de status (seção 8) e faixa na plataforma |
| A cada 1 h, enquanto durar | Atualização | Página de status |
| Ao resolver | Aviso de resolução | Página de status e e-mail aos admins (Pro e Enterprise) |
| Até 10 dias úteis depois do encerramento | **Relatório pós-incidente**: o que houve, impacto, causa, correção e prevenção | E-mail aos admins (Pro e Enterprise) |

O prazo de 10 dias úteis é o mesmo do [plano de resposta a incidentes, §5](juridico/06-plano-de-resposta-a-incidentes.md#5-prazos) e do [RB-08 §7](../operacao/runbooks/08-restauracao-banco-pitr.md#7-ao-fechar-o-chamado), para todo tipo de incidente. Incidente de segurança gera relatório a **todo cliente afetado**, de qualquer plano, e segue também os prazos do [DPA](juridico/02-acordo-de-tratamento-de-dados.md) (aviso em até 24 horas da confirmação).

## 7. Ferramenta de chamados

**Requisitos:** número de chamado (a concessão de suporte da D5 exige um), prioridade, status "Aguardando você", relógio de prazo por plano, e-mail para chamado, portal ou integração com o formulário da plataforma, relatório de prazos cumpridos, em português.

| Opção | Custo | A favor | Contra |
|---|---|---|---|
| **A. Chamados na própria plataforma** (o formulário e a lista já existem no protótipo; falta a fila no console `/admin`) | Sem licença; **~1,5 a 2 semanas** de desenvolvimento web (estimativa) | Contexto automático (cliente, unidade, gateway, máquina); número ligado à concessão de suporte; dados no nosso banco em São Paulo; **sem novo suboperador** | Disputa tempo com o MVP; relatórios de prazo a construir; e-mail e telefone lançados à mão |
| **B. Jira Service Management** | **Gratuito até 3 agentes**; Standard ~US$ 20–24 por agente/mês | Relógio de SLA, portal, e-mail vira chamado, API para o formulário da plataforma | Novo suboperador (EUA) |
| C. Zoho Desk | Express ~US$ 7 por agente/mês (até 5 agentes); planos maiores sob consulta | Barato, em português, com SLA | Novo suboperador |
| D. Movidesk (brasileira) | Até 3 agentes grátis (segundo o G2); planos pagos sob cotação | Empresa brasileira; WhatsApp integrado | Preço não público; conferir onde guarda os dados |
| E. Freshdesk | Growth: US$ 15 a 49 por agente/mês, conforme a fonte | Maduro, com SLA | Novo suboperador; preço incerto |
| F. GLPI (código aberto, hospedado pela Engemase) | Sem licença; custo de um servidor | Dados sob controle | Operar e atualizar mais um servidor |

**Recomendação [PROPOSTA]:**
- **Piloto:** **Jira Service Management Free** (3 agentes cobrem a equipe inicial de suporte). O "Abrir chamado" da plataforma cria o chamado pela API, já com o contexto. Custo zero.
- **Depois do piloto:** avaliar a opção A (chamado dentro da plataforma) quando houver folga no time web, ou o plano Standard quando passar de 3 agentes.
- **Qualquer ferramenta externa entra como suboperador** no [DPA, Apêndice 3](juridico/02-acordo-de-tratamento-de-dados.md), com aviso de 30 dias aos clientes depois do primeiro contrato. Melhor escolher **antes** do piloto ([ROPA](juridico/07-registro-das-operacoes-de-tratamento.md) já prevê o campo).

## 8. Página de status

**Requisitos:** hospedada **fora da Vercel** (se a Vercel cair, a página continua no ar); monitor de 1 minuto de pelo menos 2 locais (base da seção 3.2); avisos de incidente e de manutenção; inscrição por e-mail.

**Componentes** (os mesmos do cartão de status da central de ajuda do protótipo):

| Componente | O que mede |
|---|---|
| Painel e relatórios | Aplicação web |
| Recebimento de dados | API dos gateways (HTTPS 443) |
| Notificações | Envio de e-mail e push |
| Acesso remoto (F2) | VPN de manutenção |

**A página não mostra gateways nem dados de clientes:** a saúde dos gateways de cada cliente fica dentro da plataforma, no escopo de cada pessoa.

| Opção | Custo | Observação |
|---|---|---|
| **Better Stack** | **Gratuito:** 10 monitores e 1 página de status, verificação a cada **3 min**. **Pago:** verificação até 30 s, de vários locais; ~US$ 29–34/mês [CONFIRMAR o plano exato]; página extra US$ 15/mês | O gratuito **não mede** o SLA da seção 3.2 (1 min) [7] |
| Instatus | Gratuito (1 página pública); Pro ~US$ 15–20/mês | — |
| Atlassian Statuspage | A partir de ~US$ 29/mês [CONFIRMAR] | Mais caro |
| openstatus | Código aberto | Hospedar e operar |

**Recomendação [PROPOSTA]:**
- **Piloto (sem crédito):** Better Stack **gratuito**, a cada 3 min; cada falha conta 3 minutos (seção 3.2).
- **A partir do primeiro contrato Pro ou Enterprise (com crédito):** Better Stack **pago**, com verificação de **1 minuto** de pelo menos 2 locais. Custo em [planos e preços, §8.1](planos-e-precos.md#81-fornecedores).
- Página no endereço do próprio fornecedor (sem domínio próprio, D28). Endereço em **um só lugar** (a central de ajuda e este documento), para trocar fácil quando houver domínio.

## 9. Janelas de manutenção **[PROPOSTA]**

| Tipo | Quando | Aviso | Conta no SLA? |
|---|---|---|---|
| **Deploy da aplicação** | A qualquer hora | Nenhum | Não se espera parada: a Vercel troca a versão sem derrubar o site, e as mudanças de banco são compatíveis com a versão anterior ([docs/06](../06-banco-de-dados.md#ambientes-e-migrações)) |
| **Manutenção com parada** (ex.: troca de versão maior do Postgres, mudança de plano que reinicia o banco) | **Domingo, 1h–5h** (Brasília) | 5 dias úteis (Starter e Pro); 10 dias úteis (Enterprise) | **Não**, até 4 h por mês. O que passar disso conta |
| **Atualização dos gateways** (OTA, quando existir: D29) | Em ondas: Engemase Lab → um cliente → o resto. Horário combinado com cada cliente na implantação (padrão: madrugada, fora da troca de turno) | Na página de notas de versão | Não: o agente reinicia em segundos; as contagens vêm do CLP e não se perdem; a tela pode ficar alguns segundos sem atualizar |
| **Emergencial** (correção de segurança) | A qualquer hora | Assim que possível | **Sim** |

Durante uma parada da nuvem, os gateways guardam os dados e reenviam depois (seção 4). A planta nunca para por causa da plataforma.

## 10. Responsabilidades do cliente

Para os prazos valerem, o cliente:
- mantém atualizados os contatos (admin, TI, manutenção, cobrança e privacidade);
- mantém energia, rede e liberação de saída conforme a [ficha de TI](../operacao/ficha-tecnica-ti-cliente.md), e **avisa antes** de mudar firewall, proxy, VLAN ou endereços;
- não desliga, não muda de lugar e não abre o gateway (Anexo H);
- dá acesso à planta e indica alguém da manutenção para acompanhar o técnico (com a permissão de trabalho e as regras de segurança da planta, inclusive NR-10 para trabalho em painel);
- responde aos chamados em "Aguardando você";
- cuida dos próprios usuários (D12).

## 11. Troca de hardware em campo

Vale para o gateway em **comodato ou locação** (D2 aberta). Na **venda**, vale a garantia; fora dela, a troca é paga, mas o prazo de configuração é o mesmo.

**O prazo conta da confirmação de que o defeito é do hardware** (runbook [RB-01](../operacao/runbooks/01-gateway-offline.md)), não da abertura do chamado.

| Região **[PROPOSTA]** | Distância da base da Engemase **[PREENCHER: cidade]** | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **R1** | Até 150 km | 3 dias úteis | 2 dias úteis | Próximo dia útil |
| **R2** | 150 a 600 km | 5 dias úteis | 3 dias úteis | 2 dias úteis |
| **R3** | Demais (transportadora ou aéreo) | 7 dias úteis | 5 dias úteis | 3 dias úteis |
| Com **gateway reserva no local** (opcional do Enterprise) | R1 | — | — | **Mesmo dia útil** |
| Com gateway reserva no local | R2 e R3 | — | — | Próximo dia útil |

**Os prazos de R2 e R3 supõem a unidade nova registrada na bancada** (instalação pelo eletricista do cliente, abaixo). Quando o registro precisa ser no local, vai um técnico da Engemase e esses prazos ganham **2 dias úteis** **[PROPOSTA]**. A ficha do cliente para o suporte ([onboarding, §10](onboarding-comercial.md#10-passagem-para-o-suporte-e-primeiros-30-dias)) diz, para cada gateway, qual é o caso.

**Como a troca é feita** (passo a passo técnico: [RB-10](../operacao/runbooks/10-troca-hardware-gateway.md)):
1. A unidade nova é gravada na bancada com a rede do cliente e registrada **no mesmo gateway da plataforma**: herda a configuração ([docs/16 §7](../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida)). A unidade nova começa sem base de contador: nada é contado em dobro, e o período da troca fica "sem dados".
2. **Onde registrar** ([RB-10 §5.1](../operacao/runbooks/10-troca-hardware-gateway.md#51-na-bancada-antes-da-visita)):
   - **Na bancada**, só quando a unidade antiga está morta (ou sem fila a recuperar) **e** a nova fala com a nuvem na bancada com a rede gravada (ex.: rede IT em DHCP, sem proxy). Aí ela sai registrada e o **eletricista do cliente** pode instalar, com apoio da Engemase por telefone: trilho DIN, 24 VDC, dois cabos de rede e os bornes RS-485. É o caminho mais rápido em R2 e R3.
   - **No local**, nos outros casos: proxy, IP fixo na rede IT, ou unidade antiga ainda falando com a nuvem (registrar a nova antes de desligar a antiga derruba a antiga). O registro é feito no console local (usuário `tecnico`) com um código de ativação, por um **técnico da Engemase** (D13: o cliente não configura o gateway). Não há acesso remoto ao console.
   - **Reserva no local (Enterprise):** fica gravada com a rede do cliente, mas **sem registro** (registrar antes derruba a unidade em uso). O registro é no local, na hora da troca: por isso "mesmo dia útil" só vale em R1.
3. O gateway com defeito volta para a Engemase. **No MVP, a fila não enviada de uma unidade que não fala com a nuvem se perde:** ainda não há ferramenta para recuperá-la ([RB-10 §5.2](../operacao/runbooks/10-troca-hardware-gateway.md#52-fila-da-unidade-antiga)). Os dados são apagados antes de reuso ou descarte, com termo de eliminação (Anexo H, H.6), depois de o N2 decidir o destino da fila.
4. **Unidade registrada na bancada, no transporte:** o estado **"Em trânsito"**, que suprime o alerta de offline, ainda não existe (**Fase 1**, [docs/17, L23](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)). Até lá, o alerta "Gateway offline" pode aparecer no cliente durante o transporte: o suporte avisa o cliente ao despachar.

**Estoque de reserva:** pelo menos **10% da frota, mínimo de 2 unidades**, já testadas na bancada. A importação do R1000 é o maior risco de prazo do projeto: sem estoque, nenhum prazo desta tabela se cumpre.

**Dano por mau uso** (descarga elétrica sem DPS, umidade, lacre violado) é cobrado pelo valor de reposição (Anexo H, A.5).

## 12. Créditos **[PROPOSTA]**

Crédito = desconto na fatura seguinte, em % da **mensalidade do mês afetado**.

| Disponibilidade medida no mês | Pro | Enterprise |
|---|---|---|
| Abaixo da meta e a partir de 99,0% | 5% | 10% |
| Abaixo de 99,0% e a partir de 98,0% | 10% | 20% |
| Abaixo de 98,0% | 20% | 30% |
| **Teto no mês** | 20% | 30% |

| Outros créditos (só Enterprise) | Valor | Teto |
|---|---|---|
| Troca de gateway fora do prazo da seção 11 | 2% por dia útil de atraso | 10% no mês |
| Primeira resposta de P1 fora do prazo | 2% por ocorrência | 10% no mês |

**Regras:**
- O cliente pede o crédito por chamado, em até **30 dias** do fim do mês. A Engemase responde com o relatório do monitor.
- Não há crédito para cliente com fatura vencida.
- O crédito não vira dinheiro e não passa para outro cliente.
- **[ADVOGADO]:** definir se o crédito é a **única** compensação pela indisponibilidade ([contrato, cl. 7.4](juridico/01-contrato-de-assinatura.md)).
- **Saída por descumprimento repetido:** 3 meses seguidos abaixo da meta (Pro e Enterprise) dão ao cliente o direito de rescindir sem multa **[ADVOGADO]**.

## 13. Pendências do dono do produto

| # | Escolha | Proposta |
|---|---|---|
| 1 | Metas de disponibilidade por plano | 99,0% meta / 99,5% / 99,5% (seção 3.1) |
| 2 | Contratar a Vercel Enterprise para oferecer 99,8% | Não agora (seção 3.3) |
| 3 | Horários de atendimento e de plantão | Seção 6.2 |
| 4 | **Escala de sobreaviso 24×7** (segurança para todos; P1 do Pro e do Enterprise) | Pelo menos 3 pessoas, antes do piloto (seção 6.2) |
| 5 | Prazos de resposta e de configuração | Seções 6.5 e 6.6 |
| 6 | Ferramenta de chamados | Jira Service Management Free no piloto (seção 7) |
| 7 | Monitor e página de status | Better Stack gratuito no piloto; pago (1 min) a partir do primeiro contrato com crédito (seção 8) |
| 8 | Janela de manutenção | Domingo, 1h–5h (seção 9) |
| 9 | Regiões e prazos de troca, cidade-base, estoque de reserva; prazo extra quando o registro é no local | Seção 11 (+2 dias úteis em R2 e R3) |
| 10 | Créditos e tetos | Seção 12 |
| 11 | Janela de restauração do banco e cópia externa diária | 14 dias; diária (seção 5) |
| 12 | Telefone, e-mail e WhatsApp do suporte; telefone e e-mail de segurança 24×7 | **[PREENCHER]** (o protótipo usa valores de exemplo) |
| 13 | RTO da restauração completa do banco | Até 2 h fora do ar, medido no teste trimestral (seção 5) |
| 14 | Região de contingência fora de `gru1` | Escolher a região reserva (ex.: `iad1`); só usar depois de o advogado aprovar o contrato, cl. 10.4, e o DPA, cl. 9.6 (seção 5) |

## Fontes

Consultadas em 12/11/2026 por busca na web. As páginas oficiais não puderam ser abertas diretamente nesta sessão: conferir antes de assinar.

- [1] Vercel, SLA (Enterprise, 99,99%): <https://vercel.com/legal/sla> · preços (SLA listado como recurso do Enterprise): <https://vercel.com/pricing>
- [2] Comparação Vercel Pro × Enterprise (Pro sem SLA específico): <https://www.getfishtank.com/blog/vercel-pro-vs-enterprise-comparison-of-critical-features>
- [3] Neon, SLA (endpoints de compute; crédito de 10% abaixo de 99,95%): <https://neon.com/sla>
- [4] Neon, planos (SLA no Scale, não no Launch): <https://neon.com/docs/introduction/plans> · <https://neon.com/pricing>
- [5] Histórico de incidentes da Vercel por terceiros: <https://uptimerobot.com/is-it-down/vercel/2026/> · <https://statusgator.com/services/vercel/outage-history> · status oficial: <https://www.vercel-status.com>
- [6] Neon, janela de restauração (padrão de 1 dia; até 7 no Launch e 30 no Scale; US$ 0,20/GB-mês): <https://neon.com/docs/introduction/restore-window>
- [7] Better Stack, intervalo de verificação (3 min no gratuito, até 30 s nos pagos): <https://betterstack.com/docs/uptime/check-frequency/> · preço pago (resumo de terceiros, conferir): <https://hyperping.com/blog/betterstack-pricing>
- Jira Service Management (gratuito até 3 agentes): <https://www.desk365.io/blog/jira-service-management-pricing/> · comparação de preços de help desk 2026: <https://costbench.com/stats/help-desk-pricing-2026/>
- Zoho Desk: <https://www.desk365.io/blog/zoho-desk-pricing> · Freshdesk × Zoho Desk: <https://costbench.com/compare/freshdesk-vs-zohodesk/>
- Movidesk (G2): <https://www.g2.com/products/movidesk/pricing>
- Páginas de status (Better Stack, Instatus, Statuspage): <https://dupple.com/learn/best-status-page-services> · <https://hyperping.com/blog/best-status-page-software> · <https://costbench.com/software/network-monitoring/atlassian-statuspage/> · <https://toolradar.com/tools/instatus/pricing>
- Sobreaviso: CLT (Decreto-Lei 5.452/1943), art. 244, § 2º: <https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm>; TST, Súmula 428.
