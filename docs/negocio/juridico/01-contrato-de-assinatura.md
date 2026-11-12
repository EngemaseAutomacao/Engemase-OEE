# Contrato de assinatura da plataforma Engemase OEE

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Lacuna L7 ([docs/17](../../17-backlog-e-pendencias.md#4-lacunas-de-especificação)). Marcações e o que falta: [README desta pasta](README.md).

**Como esta minuta foi feita.** Ela descreve o produto como ele é hoje no projeto ([docs/15](../../15-multi-cliente-e-acesso.md), [docs/08](../../08-seguranca-e-operacao.md), [docs/12](../../12-acesso-remoto-vpn.md), [docs/13](../../13-notificacoes-e-alertas.md)) e aplica as decisões do dono do produto de 12/11/2026 ([docs/17 §3](../../17-backlog-e-pendencias.md#3-decisões)). Onde a decisão ainda está aberta, o texto usa a escolha provisória da equipe técnica e marca **[PADRÃO PROPOSTO]**.

**Decisões usadas aqui:**

| Decisão | Onde entra |
|---|---|
| D1 Assinatura cobrada por máquina, com planos | Cláusula 3 |
| D5 Acesso da Engemase sempre liberado, com registro | Cláusula 9 |
| D6 Retenção: minuto 2 anos, auditoria 5 anos | Cláusula 11 |
| D7 Dados em São Paulo | Cláusula 10 |
| D12 e D13 Configuração só pela Engemase; usuários pelo admin do cliente | Cláusulas 4 e 5 |
| D28 Endereço da Vercel por enquanto | Cláusula 1 (Endereço da Plataforma) e 19 |
| D2 Hardware (aberta) | Anexo H, com três alternativas |
| D3 Inadimplência (aberta) | Cláusula 14 **[PADRÃO PROPOSTO]** |
| D4 Encerramento 30 + 30 dias, CSV (aberta) | Cláusula 16 **[PADRÃO PROPOSTO]** |
| D20 Aprovação de cada sessão de acesso remoto ao gateway (aberta) | Cláusula 9.6 **[PADRÃO PROPOSTO]** |

---

## Partes

**CONTRATADA:** [PREENCHER: razão social da Engemase], CNPJ [PREENCHER], com sede em [PREENCHER], neste ato representada por [PREENCHER] ("**Engemase**").

**CONTRATANTE:** [PREENCHER: razão social do cliente], CNPJ [PREENCHER], com sede em [PREENCHER], neste ato representada por [PREENCHER] ("**Cliente**").

As partes celebram este Contrato de Assinatura ("**Contrato**"), que se rege pelas cláusulas a seguir.

## 1. Definições

| Termo | Significado |
|---|---|
| **Plataforma** | O software Engemase OEE, acessado pela internet, que mede e mostra o OEE (disponibilidade × performance × qualidade) das máquinas do Cliente, com dashboards, relatórios, alertas, terminais de chão e a API dos gateways |
| **Endereço da Plataforma** | Hoje, `https://engemase-oee.vercel.app`. Pode mudar para um domínio próprio da Engemase, com aviso prévio (cláusula 19.3) |
| **Gateway** | Computador industrial instalado na planta que lê os CLPs **somente para leitura** e envia os dados à Plataforma **só por conexões de saída** ([ficha técnica de TI](../../operacao/ficha-tecnica-ti-cliente.md)) |
| **Software do Gateway** | O programa de coleta, o sistema operacional preparado pela Engemase e as atualizações. É licenciado, nunca vendido, mesmo quando o hardware for vendido (Anexo H) |
| **Terminal** | TV (Andon) ou tablet pareado à Plataforma por código. É um aparelho, não uma conta de pessoa |
| **Máquina Contratada** | Cada máquina contratada no Pedido. A quantidade é o limite de máquinas do Cliente na Plataforma e a base da cobrança (D1) |
| **Plano** | Starter, Pro ou Enterprise, com os limites e recursos do Pedido |
| **Pedido** | Documento comercial assinado pelas partes com o Plano, a quantidade de Máquinas Contratadas, os preços, a taxa de implantação e os prazos |
| **Usuário** | Pessoa com login na Plataforma, convidada pelo admin do Cliente (ou, só o primeiro admin, pela Engemase) |
| **Admin do Cliente** | Usuário com o papel de administrador do Cliente. Gerencia os Usuários do Cliente |
| **Operador de Chão** | Pessoa que usa o Terminal e se identifica escolhendo o próprio nome numa lista. Não tem login |
| **Equipe Engemase** | Pessoas da Engemase com papel de plataforma: super admin, suporte e engenheiro de campo ([docs/15 §3](../../15-multi-cliente-e-acesso.md#3-equipe-engemase-acesso-controlado-e-visível-ao-cliente)) |
| **Dados do Cliente** | Tudo o que o Cliente, seus Usuários, Terminais e Gateways colocam na Plataforma: dados de produção, cadastros, apontamentos, configurações e registros de auditoria do Cliente |
| **Dados de Produção** | Estados das máquinas, contagens, refugo, códigos de produto e de alarme, eventos e indicadores calculados |
| **Dados Pessoais** | Como define a Lei 13.709/2018 (LGPD), art. 5º, I |
| **DPA** | Acordo de Tratamento de Dados (Anexo C) |
| **SLA** | Níveis de serviço e regras de suporte (Anexo B) |
| **Dia útil** | Segunda a sexta-feira, exceto feriados nacionais |

## 2. Objeto

2.1. A Engemase concede ao Cliente, durante a vigência, uma **licença de uso** da Plataforma: não exclusiva, intransferível e sem direito de sublicenciar, para as Máquinas Contratadas e dentro dos limites do Plano.

2.2. O Contrato inclui:
- (a) acesso à Plataforma pelo Endereço da Plataforma;
- (b) a licença do Software do Gateway, enquanto durar a assinatura;
- (c) a implantação e a configuração do Cliente pela Engemase (cláusula 4);
- (d) suporte e níveis de serviço do SLA;
- (e) atualizações da Plataforma e do Software do Gateway.

2.3. Não estão incluídos, salvo se constarem do Pedido: o hardware (Anexo H); serviços de automação no CLP do Cliente (ex.: programar o bloco OEE padrão); integração com ERP ou MES; instalação elétrica e de rede; visitas extras à planta.

2.4. A Plataforma roda em nuvem. Não há versão instalada nos servidores do Cliente.

## 3. Planos, Máquinas Contratadas e preço (D1)

3.1. O Cliente paga uma **assinatura mensal por Máquina Contratada**, conforme o Plano e os preços do Pedido. [PREENCHER no Pedido: os valores ainda não foram definidos (lacuna L9).]

3.2. Os limites de cada Plano (máquinas, gateways, usuários e recursos) estão no Pedido e no catálogo de planos da Engemase (lacuna L9). A Plataforma não deixa cadastrar máquinas além das contratadas.

3.3. **Aumento:** o Cliente pede novas máquinas pelo canal comercial, por aditivo ou novo Pedido. A cobrança das novas máquinas começa [PREENCHER: na data do aditivo ou na data em que a máquina é ativada na Plataforma], proporcional aos dias do mês.

3.4. **Redução:** vale a partir do mês seguinte ao pedido, respeitado o mínimo do Pedido. [ADVOGADO: definir se a redução só vale na renovação.]

3.5. **Taxa de implantação:** cobrada uma vez, no valor do Pedido. Cobre a implantação (cláusula 4) e, no comodato, parte do hardware (Anexo H). [PREENCHER]

3.6. **Faturamento:** mensal, com vencimento em [PREENCHER] dias da emissão. Tributos conforme a lei.

3.7. **Reajuste:** a cada 12 meses, pelo [PREENCHER: índice, ex.: IPCA].

3.8. **Mudança de Plano:** por aditivo ou novo Pedido. Recursos de um Plano superior só ficam disponíveis depois da assinatura.

## 4. Implantação e configuração (D12 e D13)

4.1. **A Engemase administra a configuração do Cliente.** Só a Equipe Engemase cria e altera: unidades, linhas, máquinas, gateways, conexões com CLPs, tags, terminais, turnos, produtos, motivos de parada, aparência e marca, e políticas.

4.2. O Cliente pede mudanças de configuração pelo canal de suporte. O prazo de atendimento segue o SLA.

4.3. **Na implantação, a Engemase:**
- (a) cria o Cliente na Plataforma e o primeiro Admin do Cliente;
- (b) instala e ativa os Gateways (conforme o Anexo H);
- (c) cadastra máquinas, tags, produtos, motivos e turnos;
- (d) pareia os Terminais;
- (e) cadastra a lista de Operadores de Chão que o Cliente enviar (cláusula 5.4).

4.4. **O Cliente, na implantação:**
- (a) indica o primeiro Admin do Cliente;
- (b) devolve preenchida a [ficha técnica de TI](../../operacao/ficha-tecnica-ti-cliente.md) e libera a rede como nela descrito;
- (c) dá acesso à planta e aos painéis, com acompanhamento de alguém da manutenção;
- (d) informa os CLPs, endereços e sinais disponíveis, e o que for preciso nos CLPs para expor os sinais;
- (e) informa turnos, produtos, ciclos ideais e motivos de parada.

4.5. O Cliente passa a "Ativo" quando os critérios do onboarding comercial forem atendidos (lacuna L10). [PREENCHER: referência ao documento de onboarding.]

## 5. Obrigações do Cliente

5.1. Usar a Plataforma conforme este Contrato e os Termos de Uso (Anexo D).

5.2. **Gerenciar os próprios Usuários** pelo Admin do Cliente: convidar, definir papéis e escopos (cliente inteiro, unidades ou máquinas) e desativar quem sair da empresa. Cada Usuário tem conta própria; contas compartilhadas não são permitidas.

5.3. Manter pelo menos um Admin do Cliente ativo e manter atualizados os contatos de cobrança, de TI e de privacidade.

5.4. **Operadores de Chão:** enviar à Engemase a lista com o mínimo de dados (nome ou apelido e, se quiser, matrícula) e **informar os Operadores** sobre o registro de quem aponta no Terminal, conforme a [nota do operador de chão](05-operador-de-chao.md). O Cliente é o controlador desses dados (DPA).

5.5. Manter energia, rede e o local dos Gateways nas condições da ficha técnica de TI.

5.6. Não colocar na Plataforma dados pessoais sensíveis (LGPD, art. 5º, II), nem dados que não tenham relação com a produção.

5.7. Não tentar acessar dados de outros clientes, testar a segurança sem autorização escrita, copiar, descompilar ou fazer engenharia reversa da Plataforma ou do Software do Gateway.

5.8. Pagar os valores do Pedido nos prazos.

## 6. Obrigações da Engemase

6.1. Manter a Plataforma funcionando conforme o SLA.

6.2. Proteger os Dados do Cliente com as medidas do DPA (Apêndice 2), entre elas: isolamento de dados por cliente em camadas, conexões cifradas, autenticação de dois fatores para a Equipe Engemase, Gateway só de saída e só leitura no CLP, atualizações assinadas e auditoria.

6.3. Guardar os dados na região de São Paulo (cláusula 10.3).

6.4. Avisar o Cliente sobre incidentes de segurança que afetem os Dados do Cliente, nos prazos do DPA.

6.5. Manter atualizada a lista de suboperadores (DPA, Apêndice 3) e avisar mudanças com antecedência.

6.6. Prestar o suporte do SLA e executar os pedidos de configuração do Cliente.

6.7. Manter a Equipe Engemase treinada, com dever de sigilo e com acesso pelo mínimo necessário.

## 7. Níveis de serviço e suporte

7.1. Disponibilidade, horários de atendimento, canais, prazos por severidade, janelas de manutenção, metas de recuperação (RPO e RTO) e eventuais créditos estão no **SLA (Anexo B)**: [`docs/negocio/sla-e-suporte.md`](../sla-e-suporte.md). [CONFIRMAR: o documento do SLA está sendo escrito em paralelo (lacuna L11).]

7.2. Não contam como indisponibilidade da Plataforma: falta de internet, energia ou rede na planta; bloqueios no firewall ou proxy do Cliente; falha do CLP ou da máquina; manutenção programada avisada; força maior (cláusula 18).

7.3. Quando a internet da planta cai, o Gateway guarda os dados por até 30 dias (ou 1 GB) e os reenvia quando a conexão volta. Os dados chegam atrasados, mas não se perdem nesse período.

7.4. **[ADVOGADO]** Se o SLA prever créditos de serviço, definir se eles são a única compensação pela indisponibilidade.

## 8. Propriedade dos dados

8.1. **Os Dados do Cliente pertencem ao Cliente.** A Engemase não os vende, não os aluga e não os cede a terceiros, salvo aos suboperadores do DPA, para prestar o serviço, ou por ordem de autoridade.

8.2. O Cliente dá à Engemase uma autorização limitada para tratar os Dados do Cliente **só para cumprir este Contrato**: prestar o serviço, configurar, dar suporte, manter a segurança, corrigir falhas e cumprir a lei.

8.3. **[OPCIONAL — depende de decisão do dono do produto; não incluído por padrão]** A Engemase pode usar estatísticas **agregadas e anonimizadas** (sem identificar o Cliente, suas unidades, máquinas ou pessoas) para melhorar o produto e criar referências de mercado.

8.4. Ficam com a Engemase: a Plataforma, o Software do Gateway, os modelos de máquina e de tags, o bloco OEE padrão (`FB_OEE_ENGEMASE`) e a documentação (cláusula 13). Os valores específicos do Cliente nessas configurações (nomes, endereços, ciclos) são Dados do Cliente.

## 9. Acesso da Engemase aos Dados do Cliente (D5)

9.1. **O Cliente instrui e autoriza a Engemase a acessar os Dados do Cliente a qualquer tempo, sem aprovação prévia caso a caso**, para:
- (a) implantar e manter a configuração (cláusula 4);
- (b) prestar suporte e atender chamados;
- (c) monitorar a saúde, a segurança e o funcionamento da Plataforma e dos Gateways;
- (d) investigar e responder a incidentes;
- (e) cumprir obrigação legal ou ordem de autoridade.

9.2. Esse acesso segue estas regras:
- (a) só a Equipe Engemase, com autenticação de dois fatores e dever de sigilo;
- (b) suporte só com **concessão de suporte** registrada (motivo, chamado e prazo de até 4 horas, renovável com novo registro); engenheiro de campo só nos clientes **atribuídos**, com validade;
- (c) **faixa na tela** sempre que alguém da Engemase estiver dentro do Cliente;
- (d) **registro na auditoria visível ao Cliente**: nome, papel, motivo, chamado, início e fim;
- (e) pelo mínimo necessário à finalidade.

9.3. Não existe a opção de o Cliente aprovar cada acesso. Ela foi retirada por decisão do produto: a Engemase administra a configuração e opera o serviço.

9.4. A Equipe Engemase **não cria, altera nem desativa Usuários do Cliente** e não muda papéis e escopos. Exceções: (a) criar o primeiro Admin do Cliente na implantação; (b) reiniciar o segundo fator do Admin do Cliente, depois de conferir a identidade de quem pede **[PADRÃO PROPOSTO — L20]**.

9.5. "Ver como usuário" (entrar com a visão de um Usuário) não existe hoje. Se vier a existir, será somente leitura, com prazo curto, motivo registrado e aviso ao Admin do Cliente.

9.6. **Acesso remoto aos Gateways (VPN de manutenção) é outra coisa** e não está coberto pela cláusula 9.1. **[PADRÃO PROPOSTO — D20 em aberto]**:
- (a) é opcional e só existe se constar do Pedido (previsto para a Fase 2);
- (b) fica desligado por padrão; cada sessão é pedida por alguém da Engemase (motivo, chamado e duração) e **aprovada pelo Admin do Cliente** com dois fatores; quem pede nunca aprova;
- (c) a sessão expira sozinha; o acesso a um CLP é só para um IP e uma porta, com aprovação própria; a manutenção do Cliente pode bloquear o acesso no local;
- (d) tudo fica registrado e visível ao Cliente ([docs/12](../../12-acesso-remoto-vpn.md));
- (e) **[OPCIONAL]** janela de manutenção pré-aprovada e acesso de emergência com aviso posterior só valem se descritos aqui: [PREENCHER ou excluir].

## 10. Proteção de dados pessoais

10.1. **Papéis:**
- nos Dados Pessoais tratados na Plataforma em nome do Cliente (vínculos, papéis e escopos dos Usuários, o que fazem dentro do Cliente, Operadores de Chão, notificações, contatos, auditoria), o **Cliente é o controlador** e a **Engemase é a operadora**;
- nos dados que a Engemase trata para fins próprios (a conta de acesso de cada pessoa, que pode ter vínculo com mais de um cliente; segurança da Plataforma; registros de acesso exigidos pelo Marco Civil da Internet; cobrança; relacionamento; a própria equipe), a **Engemase é a controladora**, conforme a [Política de Privacidade](04-politica-de-privacidade.md).

10.2. O tratamento em nome do Cliente segue o **DPA (Anexo C)**, que prevalece neste tema.

10.3. **Região (D7):** o banco de dados fica na AWS `sa-east-1` (São Paulo), pelo fornecedor Neon; a aplicação roda nas funções da Vercel em `gru1` (São Paulo). Os fornecedores são empresas estrangeiras e alguns guardam metadados e registros fora do Brasil. Por isso o DPA trata esse uso como **transferência internacional** (LGPD, art. 33) e define os mecanismos.

## 11. Retenção (D6)

11.1. Durante a vigência, a Engemase guarda:
- (a) **dados de produção por minuto: 2 anos**. Depois disso, ficam só os consolidados por hora e por turno;
- (b) **registros de auditoria: 5 anos**;
- (c) os demais dados pelos prazos do DPA (Apêndice 1).

11.2. Retenção diferente por Plano ou por Cliente não está disponível nesta versão. **[CONFIRMAR com L9.]**

11.3. Depois do fim do Contrato, vale a cláusula 16.

## 12. Confidencialidade

12.1. Cada parte mantém em sigilo as informações da outra marcadas como confidenciais ou que, pela natureza, devam ser. Os Dados do Cliente são sempre confidenciais.

12.2. Não são confidenciais as informações: públicas sem culpa de quem recebeu; já conhecidas antes; recebidas de terceiro sem dever de sigilo; ou que a lei ou uma autoridade obrigue a revelar (nesse caso, com aviso à outra parte, se a lei permitir).

12.3. O dever de sigilo vale durante o Contrato e por [PREENCHER: 5] anos depois.

## 13. Propriedade intelectual

13.1. A Plataforma, o Software do Gateway, o bloco OEE padrão, os modelos e a documentação são da Engemase ou de seus licenciantes. O Cliente recebe só a licença da cláusula 2.

13.2. Componentes de código aberto seguem as próprias licenças.

13.3. Sugestões do Cliente sobre o produto podem ser usadas pela Engemase sem custo, sem obrigação de uso e sem expor Dados do Cliente.

## 14. Inadimplência e suspensão **[PADRÃO PROPOSTO — D3 em aberto]**

14.1. Atraso no pagamento gera multa de [PREENCHER: 2]%, juros de [PREENCHER: 1]% ao mês e correção pelo índice da cláusula 3.7. [ADVOGADO]

14.2. **Com 5 dias de atraso:** a Engemase avisa o contato de cobrança e o Admin do Cliente.

14.3. **Com 30 dias de atraso:** a Engemase pode **suspender** o Cliente, com aviso. Na suspensão:
- os Usuários não entram e veem uma mensagem clara;
- **os Gateways continuam enviando dados** e os dados continuam guardados;
- a Engemase continua com acesso, com registro (cláusula 9);
- os Terminais param de mostrar dados. [CONFIRMAR com o produto]

14.4. O acesso volta em até [PREENCHER: 1] dia útil depois de confirmado o pagamento.

14.5. **[PROPOSTA]** Com [PREENCHER: 90] dias de suspensão, a Engemase pode rescindir o Contrato e seguir a cláusula 16.

14.6. **Suspensão por segurança:** a Engemase pode suspender na hora, só no necessário, uma conta, um Terminal ou um Gateway que esteja pondo em risco a Plataforma ou outros clientes (ex.: credencial vazada). Avisa o Admin do Cliente e restabelece assim que o risco acabar.

## 15. Vigência, renovação e rescisão

15.1. Vigência inicial de **12 meses** a partir de [PREENCHER: a assinatura ou o início da operação]. **[PADRÃO PROPOSTO — D2]**: o prazo mínimo de 12 meses acompanha o comodato do hardware.

15.2. Renovação automática por períodos de 12 meses, salvo aviso de qualquer parte com [PREENCHER: 60] dias de antecedência.

15.3. **Rescisão por descumprimento:** se uma parte descumprir obrigação relevante e não corrigir em 30 dias do aviso escrito.

15.4. **Rescisão antecipada sem motivo pelo Cliente:** [OPCIONAL] com aviso de [PREENCHER] dias e multa de [PREENCHER: % das mensalidades restantes do período]. [ADVOGADO]

15.5. **Objeção a novo suboperador:** o Cliente pode rescindir a parte afetada, sem multa, nos casos do DPA (cláusula 8).

15.6. [ADVOGADO: falência, recuperação judicial e mudança de controle.]

## 16. Encerramento: exportação e eliminação dos dados **[PADRÃO PROPOSTO — D4 em aberto]**

16.1. Encerrado o Contrato por qualquer motivo, vale este roteiro:

| Quando | O que acontece |
|---|---|
| **Dia 0** (fim do Contrato) | Cliente passa a "Encerrado". Gateways e Terminais são revogados e a coleta para. Os Usuários deixam de acessar, exceto o Admin do Cliente, que mantém acesso só para baixar a exportação **[PROPOSTA]**. A Engemase gera a **exportação completa em CSV** |
| **Até o dia 30** | O Cliente baixa os arquivos. Pode pedir uma nova geração, sem custo, uma vez **[PROPOSTA]** |
| **Dias 31 a 60** | Os dados ficam guardados sem acesso do Cliente, só para atender pedido sobre a exportação |
| **Dia 60** | **Eliminação definitiva** dos Dados do Cliente no banco de produção. A Engemase envia o **termo de eliminação** ao Admin do Cliente |
| **Depois do dia 60** | As cópias de segurança expiram sozinhas no fim da janela de restauração do banco: [PREENCHER: N dias, conforme o plano Neon contratado] |

16.2. **Formato da exportação:** arquivos CSV em UTF-8 com BOM, separador `;`, vírgula decimal e datas no fuso da unidade em ISO 8601 com o deslocamento (lacuna L6). Inclui: dados por minuto, eventos de estado e classificações, refugo, trocas de produto, consolidados por turno, cadastros, Usuários (nome, e-mail e papel) e auditoria.

16.3. **O que fica guardado depois do dia 60** (LGPD, art. 16), isolado e sem uso para outra finalidade:
- registros de auditoria do Cliente, inclusive os acessos da Equipe Engemase, até completar 5 anos (D6), para defesa das partes; **[ADVOGADO: confirmar a base legal (art. 7º, VI) e se o Cliente pode pedir a eliminação antecipada]**
- registros de acesso à Plataforma exigidos pelo Marco Civil da Internet (Lei 12.965/2014, art. 15), por 6 meses;
- documentos fiscais e contratuais, pelo prazo da lei.

16.4. **Gateways:** conforme a alternativa do Anexo H. Os dados guardados no Gateway são apagados antes de reuso ou descarte, com termo de eliminação.

## 17. Limitação de responsabilidade

17.1. **A Plataforma mede e mostra indicadores.** Ela não comanda máquinas, não escreve no CLP (versão 1) e não é sistema de segurança, de intertravamento ou de controle de processo. Alertas são auxiliares e podem atrasar ou não chegar (ex.: notificação no celular).

17.2. A exatidão dos indicadores depende dos sinais do CLP e dos cadastros (ciclo ideal, turnos, motivos). A Engemase confere a configuração na implantação e corrige erros de configuração que forem dela.

17.3. Nenhuma parte responde por lucros cessantes, perda de produção, perda de negócios ou danos indiretos.

17.4. A responsabilidade total de cada parte neste Contrato fica limitada ao **valor pago pelo Cliente nos 12 meses anteriores ao fato** que a originou. [ADVOGADO]

17.5. O limite da cláusula 17.4 não vale para: dolo ou culpa grave; violação de confidencialidade; violação de propriedade intelectual; valores devidos pelo Cliente. **[ADVOGADO: definir se danos por violação da LGPD por culpa da Engemase têm limite próprio, ex.: 2 vezes o valor anual.]**

17.6. Perante os titulares e a ANPD, cada parte responde nos termos da LGPD (arts. 42 a 45). Entre as partes, quem pagar por culpa da outra tem direito de regresso.

17.7. Este é um contrato entre empresas. As partes declaram que negociaram a divisão de riscos (Código Civil, art. 421-A). [ADVOGADO: confirmar que o Código de Defesa do Consumidor não se aplica ao Cliente.]

## 18. Força maior

Nenhuma parte responde por atraso ou falha causada por caso fortuito ou força maior (Código Civil, art. 393), inclusive falhas amplas de internet, energia ou de provedores de nuvem que fujam ao controle razoável da parte. A parte afetada avisa a outra e reduz os efeitos.

## 19. Mudanças no serviço e no Contrato

19.1. A Engemase pode evoluir a Plataforma. Não reduz de forma relevante, durante a vigência, os recursos do Plano contratado.

19.2. Mudanças nos Termos de Uso e na Política de Privacidade são avisadas na Plataforma com [PREENCHER: 30] dias de antecedência, salvo exigência legal ou de segurança.

19.3. **Mudança do Endereço da Plataforma (D28):** quando a Engemase passar a usar um domínio próprio, avisará o Cliente com pelo menos [PREENCHER: 30] dias e enviará o novo nome para o TI liberar **antes** da troca. Os Gateways só passam a usar o nome novo depois de o TI confirmar a liberação.

19.4. Mudanças neste Contrato só por aditivo assinado.

## 20. Anticorrupção **[OPCIONAL]**

As partes cumprem a Lei 12.846/2013 e não oferecem nem aceitam vantagem indevida ligada a este Contrato.

## 21. Comunicações

21.1. Avisos formais por e-mail aos endereços do Pedido. Avisos operacionais (manutenção, incidentes, suspensão) também na Plataforma.

21.2. Contatos da Engemase: comercial [PREENCHER], suporte (canal do SLA), privacidade e encarregado [PREENCHER].

## 22. Disposições gerais

22.1. **Ordem de prevalência:** (a) DPA, no que trata de dados pessoais; (b) Pedido, nas condições comerciais; (c) este Contrato; (d) SLA; (e) Termos de Uso.

22.2. Nenhuma parte cede o Contrato sem concordância escrita da outra, salvo a Engemase a empresa do mesmo grupo que assuma todas as obrigações, com aviso.

22.3. As partes são independentes. Este Contrato não cria vínculo de emprego, sociedade ou representação.

22.4. Tolerância não é renúncia. Cláusula inválida não invalida as demais.

22.5. **Assinatura eletrônica:** as partes aceitam assinatura eletrônica, com ou sem certificado ICP-Brasil (Medida Provisória 2.200-2/2001, art. 10, § 2º).

22.6. **Foro:** [PREENCHER: comarca] ou [OPCIONAL: arbitragem].

## Anexos

| Anexo | Documento |
|---|---|
| A | Pedido (plano, Máquinas Contratadas, preços, taxa de implantação, contatos). Preços pendentes (L9) |
| B | SLA e suporte: [`docs/negocio/sla-e-suporte.md`](../sla-e-suporte.md) (L11) |
| C | [Acordo de Tratamento de Dados (DPA)](02-acordo-de-tratamento-de-dados.md) |
| D | [Termos de Uso](03-termos-de-uso.md) |
| E | [Ficha técnica para o TI do cliente](../../operacao/ficha-tecnica-ti-cliente.md) |
| H | [Hardware: comodato, venda ou locação (escolher uma)](01-anexo-h-hardware.md) |

Local e data: [PREENCHER]

| Engemase | Cliente |
|---|---|
| ______________________ | ______________________ |
| Nome, cargo | Nome, cargo |

Testemunhas (se o advogado mantiver): ______________________ · ______________________

---

## Pontos para a revisão jurídica

| # | Ponto | Por quê |
|---|---|---|
| 1 | Cláusula 9 (acesso sempre liberado) × papel de operadora na LGPD | A operadora só trata dados segundo as instruções do controlador (LGPD, art. 39). A cláusula transforma o acesso em instrução documentada do Cliente. Conferir se basta |
| 2 | Cláusula 16.3 (auditoria guardada 5 anos depois do fim) | Conservação permitida pelo art. 16; confirmar base legal e prazo |
| 3 | Limite de responsabilidade e LGPD (17.4 e 17.5) | Definir se há limite próprio para danos de proteção de dados |
| 4 | Multa de rescisão antecipada (15.4) | Depende do comodato (Anexo H) e do mercado |
| 5 | Suspensão com Gateways enviando (14.3) | A Engemase segue tratando dados durante a suspensão. Confirmar que o Cliente concorda |
| 6 | Prazos do encerramento (16.1) | D4 em aberto. Conferir com o runbook de encerramento (manual no MVP) |

## Fontes

- Lei 13.709/2018 (LGPD), texto oficial: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Lei 12.965/2014 (Marco Civil da Internet), art. 15: <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm>
- Lei 10.406/2002 (Código Civil), arts. 393 e 421-A: <https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm>
- Medida Provisória 2.200-2/2001, art. 10: <https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm>
- Demais fontes de proteção de dados: [README desta pasta](README.md#fontes).
