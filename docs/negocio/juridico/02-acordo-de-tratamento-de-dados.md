# Acordo de Tratamento de Dados Pessoais (DPA)

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Anexo C do [Contrato de assinatura](01-contrato-de-assinatura.md). Marcações e o que falta: [README desta pasta](README.md).

**Para que serve.** Este acordo regula os dados pessoais que a Engemase trata **em nome do Cliente** na plataforma Engemase OEE. O Cliente é o **controlador**; a Engemase é a **operadora** (LGPD, art. 5º, VI e VII). Os dados que a Engemase trata para fins próprios ficam na [Política de Privacidade](04-politica-de-privacidade.md).

**Prevalência.** Em proteção de dados, este acordo prevalece sobre o Contrato, o SLA e os Termos de Uso.

---

## 1. Definições

Valem as definições da LGPD (art. 5º) e do Contrato. Além delas:

| Termo | Significado |
|---|---|
| **Suboperador** | Empresa contratada pela Engemase que trata Dados Pessoais do Cliente para a Engemase prestar o serviço (Apêndice 3) |
| **Incidente de segurança** | Evento adverso confirmado que comprometa a confidencialidade, a integridade, a disponibilidade ou a autenticidade de Dados Pessoais (Resolução CD/ANPD nº 15/2024) |
| **Transferência internacional** | Transferência de Dados Pessoais para país estrangeiro ou organismo internacional (LGPD, art. 5º, XV), inclusive o acesso a partir do exterior por empresa estrangeira (ver cláusula 9) |
| **Equipe Engemase** | Super admin, suporte e engenheiro de campo da Engemase ([docs/15 §3](../../15-multi-cliente-e-acesso.md#3-equipe-engemase-acesso-controlado-e-visível-ao-cliente)) |

## 2. Papéis

2.1. **O Cliente é o controlador** dos Dados Pessoais tratados na Plataforma em seu nome: vínculos dos Usuários com o Cliente (papel, escopo, situação), o que eles fazem dentro do Cliente, Operadores de Chão, notificações, contatos informados pelo Cliente e registros de auditoria do Cliente.

2.2. **A Engemase é a operadora** desses dados. Trata-os só para cumprir o Contrato e as instruções do Cliente (LGPD, art. 39).

2.3. **A Engemase é a controladora** dos dados que trata para fins próprios:
- (a) a **conta de acesso** de cada pessoa (nome, e-mail, senha guardada só como hash, segundo fator, sessões). A conta é da Plataforma, não de um cliente: a mesma pessoa pode ter vínculo com mais de um cliente ([docs/15 §1](../../15-multi-cliente-e-acesso.md#1-hierarquia-e-identidades)). Ao convidar alguém, o Cliente informa nome e e-mail, e a Engemase cria ou reaproveita a conta;
- (b) segurança da Plataforma e prevenção a fraude;
- (c) registros de acesso exigidos pelo Marco Civil da Internet (Lei 12.965/2014, art. 15);
- (d) cobrança e relacionamento com o Cliente;
- (e) dados da própria Equipe Engemase (inclusive quando aparecem na auditoria do Cliente).

Esses tratamentos estão na Política de Privacidade e no [registro de operações](07-registro-das-operacoes-de-tratamento.md). **[ADVOGADO: confirmar a divisão da conta de acesso (Engemase) e do vínculo (Cliente).]**

2.4. **Dados de produção** (estados, contagens, refugo) **não são dados pessoais em si**. Passam a ser quando ligados a uma pessoa: por exemplo, quem classificou uma parada. Nesses casos, este acordo se aplica.

## 3. Descrição do tratamento

3.1. Categorias de titulares, dados, finalidades e prazos: **Apêndice 1**.

3.2. **Não são esperados dados sensíveis** (LGPD, art. 5º, II). O Cliente não deve inserir dados sensíveis em campos de texto (observações, nomes de motivos) nem usar biometria para identificar Operadores de Chão. A futura identificação por PIN ou crachá (Fase 2) também não usa biometria.

3.3. Se o Cliente incluir **adolescentes** (ex.: jovens aprendizes) na lista de Operadores de Chão, deve tratar esses dados no melhor interesse deles (LGPD, art. 14). A recomendação é identificar só pela matrícula ([nota do operador de chão](05-operador-de-chao.md)).

## 4. Instruções do Cliente

4.1. As instruções do Cliente são: o Contrato; este acordo; a configuração da Plataforma feita a pedido do Cliente; e os pedidos registrados no canal de suporte.

4.2. **O Admin do Cliente gerencia os Usuários** diretamente na Plataforma (convidar, papéis, escopos, desativar). Essas ações são instruções do Cliente.

4.3. **Lista de Operadores de Chão:** a Engemase cadastra a lista que o Cliente enviar, com os dados mínimos que o Cliente escolher (nome ou apelido e, se quiser, matrícula).

4.4. Se a Engemase entender que uma instrução viola a LGPD, avisa o Cliente e pode suspender aquela instrução até o Cliente se manifestar.

## 5. Acesso da Equipe Engemase (D5)

5.1. **O Cliente instrui e autoriza** que a Equipe Engemase acesse os Dados do Cliente, inclusive os Dados Pessoais, a qualquer tempo e **sem aprovação prévia caso a caso**, só para as finalidades da cláusula 9 do Contrato (configurar, dar suporte, monitorar, responder a incidentes e cumprir a lei).

5.2. Cada acesso:
- (a) exige papel de plataforma, concessão de suporte (com motivo, chamado e prazo de até 4 horas) ou atribuição de campo (com validade);
- (b) usa autenticação de dois fatores;
- (c) mostra **faixa na tela**;
- (d) fica na **auditoria visível ao Cliente** (nome, papel, motivo, chamado, início e fim).

5.3. A Equipe Engemase não altera Usuários, papéis nem escopos do Cliente, salvo as exceções do Contrato (cláusula 9.4).

5.4. **Acesso remoto aos Gateways** (VPN de manutenção, opcional, Fase 2) segue regra própria: cada sessão aprovada pelo Admin do Cliente (Contrato, cláusula 9.6). Nessas sessões não se acessam Dados Pessoais do Cliente além dos registros técnicos do Gateway.

5.5. A Engemase não usa os Dados Pessoais do Cliente para finalidade própria, não os vende e não os usa para publicidade.

## 6. Sigilo do pessoal

6.1. Todas as pessoas da Engemase com acesso aos Dados do Cliente assinam termo de sigilo e recebem orientação de proteção de dados.

6.2. O acesso é pelo mínimo necessário e é revogado quando a pessoa muda de função ou sai da Engemase.

## 7. Segurança

7.1. A Engemase adota as medidas técnicas e administrativas do **Apêndice 2** (LGPD, arts. 46 e 47) e as mantém atualizadas.

7.2. **Limite conhecido (D38).** O isolamento entre clientes no banco usa Row-Level Security por uma variável de sessão (`app.org_id`). Ele protege contra erro de programação (consulta sem filtro), mas não contra um invasor que consiga executar SQL com o papel da aplicação. Por isso todo SQL da aplicação é parametrizado e há outras camadas de proteção (Apêndice 2). O Cliente declara ciência desse limite.

7.3. A Engemase pode melhorar as medidas sem aviso. Não pode reduzir o nível de proteção.

## 8. Suboperadores

8.1. **Autorização geral.** O Cliente autoriza os suboperadores do **Apêndice 3**.

8.2. **Novos suboperadores.** A Engemase avisa o Cliente com pelo menos **30 dias** de antecedência, por e-mail ao contato de privacidade e na Plataforma, antes de incluir ou trocar um suboperador que trate Dados Pessoais do Cliente.

8.3. **Objeção.** O Cliente pode se opor, com motivo ligado à proteção de dados, em até 15 dias do aviso. As partes procuram uma solução. Se não houver, o Cliente pode rescindir a parte afetada do Contrato, sem multa.

8.4. A Engemase contrata cada suboperador com obrigações de proteção de dados equivalentes às deste acordo e **responde perante o Cliente** pelo que o suboperador fizer.

8.5. Em emergência de segurança ou continuidade, a Engemase pode trocar um suboperador antes do prazo, avisando o Cliente assim que possível.

## 9. Transferência internacional

9.1. **Onde os dados ficam (D7).** O banco de dados de produção fica na AWS `sa-east-1` (São Paulo), pela Neon. A aplicação roda nas funções da Vercel em `gru1` (São Paulo).

9.2. **Por que ainda assim há transferência internacional.** Os suboperadores são empresas estrangeiras. Suas equipes podem acessar os dados a partir do exterior (suporte, operação, segurança), e alguns guardam metadados, registros e cópias fora do Brasil (Apêndice 3). Por cautela, a Engemase trata esses casos como transferência internacional (LGPD, art. 33).

9.3. **Mecanismos:**
- (a) **destinos na União Europeia:** decisão de adequação da ANPD (Resolução CD/ANPD nº 32/2026) **[CONFIRMAR o texto oficial]**;
- (b) **demais destinos (Estados Unidos, Canadá, Reino Unido):** **cláusulas-padrão contratuais da ANPD** (Resolução CD/ANPD nº 19/2024, Anexo II), adotadas **na íntegra e sem alteração**, entre a Engemase (exportadora) e cada suboperador (importador). O prazo de adaptação de contratos antigos terminou em 23/08/2025.

9.4. **[CONFIRMAR com cada fornecedor]** se o acordo de tratamento dele já inclui as cláusulas-padrão da ANPD. Se não incluir, a Engemase assina as cláusulas em instrumento separado ou troca o fornecedor (ex.: NetBird hospedado no Brasil no lugar da Tailscale, [docs/12](../../12-acesso-remoto-vpn.md)).

9.5. O Cliente autoriza as transferências do Apêndice 3. A Engemase fornece ao Cliente as informações de que ele precisa para cumprir os deveres de transparência da Resolução CD/ANPD nº 19/2024 perante os titulares.

## 10. Direitos dos titulares

10.1. A Engemase ajuda o Cliente a atender os direitos do art. 18 da LGPD (confirmação, acesso, correção, anonimização, bloqueio, eliminação, portabilidade e informação sobre compartilhamento).

10.2. Pedido recebido diretamente pela Engemase sobre dados de que o Cliente é controlador: a Engemase encaminha ao Cliente em até **2 dias úteis** e avisa o titular que o pedido foi encaminhado. Não responde o mérito sem instrução do Cliente.

10.3. A Engemase atende pedidos de apoio do Cliente em até **5 dias úteis** **[PROPOSTA]**, para o Cliente cumprir o prazo legal (LGPD, art. 19: até 15 dias para a declaração completa).

10.4. **Ferramentas disponíveis ao Cliente:** o Admin do Cliente desativa vínculos de Usuários e corrige papéis e escopos; pede à Engemase exportação de registros de uma pessoa, correção e anonimização da identificação de um Operador de Chão. **[CONFIRMAR: anonimização de operador e exportação por pessoa ainda não estão implementadas.]**

## 11. Incidentes de segurança

11.1. A Engemase avisa o Cliente **sem demora indevida e em até 24 horas** depois de confirmar um incidente que afete Dados Pessoais do Cliente. **[PROPOSTA: prazo pensado para o Cliente conseguir comunicar a ANPD em 3 dias úteis.]**

11.2. O aviso traz o que se souber até o momento (o restante vem em atualizações):
- (a) o que aconteceu, quando aconteceu e quando foi descoberto;
- (b) categorias e quantidade aproximada de titulares e de dados;
- (c) consequências prováveis;
- (d) medidas tomadas e propostas;
- (e) contato do responsável na Engemase.

11.3. A Engemase manda atualizações pelo menos a cada 24 horas enquanto o incidente estiver aberto e um relatório final em até 10 dias úteis do encerramento.

11.4. **Quem comunica a ANPD e os titulares é o Cliente**, como controlador (LGPD, art. 48; Resolução CD/ANPD nº 15/2024: 3 dias úteis do conhecimento). A Engemase não comunica em nome do Cliente sem instrução escrita.

11.5. **Quando o incidente também atinge dados de que a Engemase é controladora** (ex.: senhas ou segundo fator das contas de acesso), a Engemase faz a própria comunicação à ANPD e aos titulares, avisa o Cliente antes e combina com ele mensagens coerentes.

11.6. A Engemase ajuda o Cliente com as informações técnicas para a comunicação e guarda o registro do incidente por pelo menos 5 anos.

11.7. O procedimento interno está no [plano de resposta a incidentes](06-plano-de-resposta-a-incidentes.md).

## 12. Auditoria e comprovação

12.1. A Engemase disponibiliza ao Cliente: este acordo; a descrição das medidas de segurança; a lista de suboperadores; e, na Plataforma, a **auditoria dos acessos da Equipe Engemase**.

12.2. A Engemase responde a questionários de segurança razoáveis do Cliente em até [PREENCHER: 15] dias úteis, até 1 vez por ano, sem custo.

12.3. O Cliente pode auditar o cumprimento deste acordo **1 vez por ano**, com aviso de 30 dias, em horário comercial, por conta própria, diretamente ou por auditor independente com dever de sigilo. A auditoria não acessa dados de outros clientes nem informações protegidas por segredo de negócio. Auditoria extra só após incidente que afete o Cliente ou por ordem de autoridade.

12.4. Para os suboperadores, valem os relatórios e certificações que eles publicam. [CONFIRMAR quais relatórios (ex.: SOC 2, ISO 27001) cada fornecedor oferece.]

## 13. Relatório de impacto

A Engemase fornece ao Cliente as informações de que ele precisar para elaborar relatório de impacto à proteção de dados (LGPD, art. 38) sobre os tratamentos da Plataforma.

## 14. Retenção, devolução e eliminação

14.1. **Durante o Contrato:** prazos do Apêndice 1, com as decisões D6 (dados por minuto: 2 anos; auditoria: 5 anos).

14.2. **No fim do Contrato** **[PADRÃO PROPOSTO — D4 em aberto]:** exportação completa em CSV disponível por 30 dias; eliminação definitiva no banco de produção no dia 60; cópias de segurança expiram no fim da janela de restauração do banco; termo de eliminação ao Cliente (Contrato, cláusula 16).

14.3. **Conservação permitida (LGPD, art. 16):** a Engemase pode guardar, isolados e sem outro uso, os registros de auditoria do Cliente até completar 5 anos, os registros de acesso do Marco Civil da Internet por 6 meses e os documentos fiscais e contratuais pelo prazo legal. **[ADVOGADO]**

14.4. **Gateways:** dados apagados antes de reuso, devolução ou descarte, com termo de eliminação (Anexo H, cláusula H.6).

## 15. Responsabilidade

15.1. A Engemase responde quando descumprir a LGPD ou não seguir as instruções lícitas do Cliente (LGPD, art. 42, § 1º, I). Nos demais casos, quem responde perante os titulares é o controlador, com direito de regresso contra quem causou o dano.

15.2. O limite de responsabilidade do Contrato (cláusula 17) se aplica a este acordo, salvo o que o advogado definir para danos de proteção de dados. **[ADVOGADO]**

## 16. Vigência

Este acordo vale enquanto a Engemase tratar Dados Pessoais do Cliente, inclusive depois do fim do Contrato, até a eliminação final. As obrigações de sigilo e segurança continuam depois disso (LGPD, art. 47).

---

## Apêndice 1 — Descrição do tratamento

**Finalidade geral:** medir e mostrar o OEE das máquinas do Cliente, com dashboards, relatórios, alertas e apontamentos no chão de fábrica, e permitir que a Engemase configure e opere o serviço.

**Operações:** coleta, recepção, armazenamento, consulta, exibição, cálculo, envio de notificações, exportação, cópia de segurança e eliminação.

| Titulares | Dados | Para quê | Retenção durante o Contrato |
|---|---|---|---|
| **Usuários do Cliente** (gerentes, engenheiros, supervisores, líderes, visualizadores) | Vínculo com o Cliente: papel, escopo (cliente inteiro, unidades ou máquinas), situação, quem convidou e quando | Permissões e escopo de dados | Enquanto o vínculo estiver ativo; desativado, fica na auditoria (5 anos). A **conta de acesso** (nome, e-mail, senha, 2FA, sessões) é tratada pela Engemase como controladora (cláusula 2.3) |
| **Usuários do Cliente** | Ações na Plataforma (quem classificou, lançou refugo, trocou produto, mudou o quê), com IP e horário | Auditoria e rastreabilidade | **5 anos** (D6) |
| **Operadores de Chão** (sem login) | Nome ou apelido, matrícula (opcional), unidade; marca de quem apontou parada, refugo ou troca de produto, com máquina e horário | Saber quem informou cada dado; corrigir apontamentos | Enquanto durar o Contrato, junto dos eventos de produção. [PROPOSTA: identificação anonimizada após 2 anos, alinhada a D6] |
| **Usuários e Terminais** | Inscrição de notificação (endereço do serviço de push, chaves, aparelho, data), preferências e notificações recebidas | Entregar alertas no app, no navegador e por e-mail | Inscrição: até remover, expirar ou desativar a conta. Notificações: [PROPOSTA: 12 meses] |
| **Usuários do Cliente** | Nome, e-mail, conteúdo do e-mail | Alertas e resumos por e-mail (Fase 2). E-mails de conta (definir e redefinir senha) e de contrato (suspensão) são da Engemase como controladora | Registros de envio pelo prazo do fornecedor [CONFIRMAR] |
| **Quem pareou um Terminal** | Nome do Usuário ou da pessoa da Engemase que pareou, data | Revogação e segurança do Terminal | Enquanto o Terminal existir; depois, na auditoria (5 anos) |
| **Aprovadores do acesso remoto** (Fase 2) | Nome do Admin do Cliente, decisão, horário | Governança do acesso aos Gateways | **5 anos** ([docs/12](../../12-acesso-remoto-vpn.md)) |
| **Contatos do Cliente** (TI, manutenção) | Nome, e-mail, telefone, cargo | Instalação e suporte dos Gateways | Enquanto durar o Contrato |
| **Pessoas citadas em exportações** | Os mesmos dados acima, quando fazem parte do arquivo | Relatórios e exportações pedidos pelo Cliente | [PROPOSTA: link válido por 7 dias; arquivo apagado em 30 dias] |

**Dados de produção (não pessoais), para referência:** dados por minuto **2 anos** (D6); consolidados por turno e por hora enquanto durar o Contrato; amostras de tags de 30 a 90 dias; buffer do Gateway até 30 dias ou 1 GB, rotativo.

**Local:** banco na AWS `sa-east-1` (São Paulo); aplicação na Vercel `gru1` (São Paulo); demais locais no Apêndice 3.

## Apêndice 2 — Medidas de segurança

Resumo do desenho de [docs/08](../../08-seguranca-e-operacao.md) e [docs/15](../../15-multi-cliente-e-acesso.md). **O produto está em construção.** Em 12/11/2026 já existem no código: Row-Level Security forçada e chaves estrangeiras compostas no banco; API dos gateways com token guardado só como hash e isolamento entre clientes; gateway só de saída e somente leitura. O restante (login, 2FA, auditoria, terminais, limites de taxa, cópias de segurança) entra na Fase 1, antes do piloto ([docs/00](../../00-status.md)). **[CONFIRMAR, na assinatura, o que já está em produção.]**

| Tema | Medida |
|---|---|
| **Isolamento entre clientes** | Cliente vindo da URL e conferido em toda entrada do servidor; camada de acesso a dados obrigatória; Row-Level Security forçada em todas as tabelas de cliente, com o limite da cláusula 7.2; chaves estrangeiras compostas; testes automáticos de isolamento no CI; nenhum dado de cliente em cache compartilhado |
| **Escopo por pessoa** | Cliente inteiro, unidades ou máquinas (D11), fail-closed: nada listado = nenhum acesso. Agregados, relatórios e exportações somam só o permitido |
| **Autenticação** | **[PADRÃO PROPOSTO — L20]** Senha com 12 ou mais caracteres, recusada se aparecer em vazamentos conhecidos; bloqueio temporário após 5 erros; 2FA obrigatório para a Equipe Engemase e **[PADRÃO PROPOSTO — D14]** para o Admin do Cliente; links de definir senha de uso único, fora de logs |
| **Acesso da Engemase** | Concessão com prazo ou atribuição com validade; faixa na tela; auditoria visível ao Cliente |
| **Terminais** | Pareamento por código; token próprio guardado só como hash; revogação em um clique; nunca combinado com sessão de pessoa |
| **Gateways** | Só conexões de saída (HTTPS 443); somente leitura no CLP; sem roteamento entre a rede das máquinas e a da empresa; firewall local; token próprio guardado só como hash e revogável; atualizações assinadas com volta automática |
| **Transporte** | TLS 1.2 ou superior em todas as conexões |
| **Dados em repouso** | Criptografia em repouso pelos provedores (Neon/AWS, Vercel) [CONFIRMAR com cada fornecedor] |
| **Segredos** | Variáveis de ambiente da Vercel; nada no repositório; chaves de assinatura e CA SSH em cofre com 2 pessoas com acesso |
| **Ambientes** | Ambientes de teste (preview) com dados sintéticos, nunca cópia da produção; proteção de acesso aos previews |
| **Proteção da aplicação** | Limite de taxa por IP e por gateway; cabeçalhos de segurança (CSP, HSTS); SQL sempre parametrizado; validação de entrada |
| **Auditoria** | Toda mudança de configuração, comando a gateway, mudança de usuário ou papel e acesso da Engemase |
| **Cópias de segurança** | Restauração a um ponto no tempo (PITR) da Neon; teste de restauração a cada 3 meses |
| **Erros e logs** | Monitoramento de erros sem dados pessoais desnecessários (sem IP e sem corpo de requisição); tokens fora de URLs e logs |
| **Pessoas** | Termo de sigilo; mínimo necessário; revogação na saída; plano de resposta a incidentes testado a cada 6 meses **[PROPOSTA]** |
| **Descarte de hardware** | Apagamento por nível (remoto, limpeza, purga ou destruição) com termo de eliminação |

## Apêndice 3 — Suboperadores

Consultado em 12/11/2026. **Todos os itens [CONFIRMAR] precisam ser conferidos nos contratos e nas páginas de cada fornecedor antes da assinatura.**

| Suboperador | País da empresa | Finalidade | Onde ficam os dados | Dados pessoais | Mecanismo de transferência |
|---|---|---|---|---|---|
| **Vercel Inc.** | EUA | Hospedagem da aplicação web e da API dos gateways; rede de entrega e firewall; tarefas agendadas; armazenamento de arquivos (Blob: exportações e pacotes de atualização); logs de execução | Funções em `gru1` (São Paulo). Painel, logs e metadados podem ficar nos EUA [CONFIRMAR]. Região do Blob [CONFIRMAR] | Tudo o que passa pelas requisições (contas, IP, conteúdo das telas); logs (IP, endereço acessado, horário) | Cláusulas-padrão da ANPD [CONFIRMAR se o DPA da Vercel as inclui] |
| **Neon** (Neon Inc., grupo Databricks) | EUA | Banco de dados Postgres de produção, com cópias de segurança | AWS `sa-east-1` (São Paulo). Plano de controle e acesso de suporte a partir do exterior [CONFIRMAR] | Todos os dados do Apêndice 1 | Cláusulas-padrão da ANPD [CONFIRMAR] |
| **Sentry** (Functional Software, Inc.) | EUA | Monitoramento de erros da aplicação | Região de dados escolhida na criação da conta: **UE (Frankfurt) recomendada** ou EUA [DECIDIR] | Identificador técnico do usuário e mensagens de erro. Configurado para não enviar IP, e-mail nem corpo de requisição | UE: adequação (Res. 32/2026). Acesso a partir dos EUA: cláusulas-padrão [CONFIRMAR] |
| **Resend, Inc.** | EUA | Envio de e-mail transacional | Região de envio São Paulo (`sa-east-1`) disponível [CONFIRMAR plano]. Dados da conta, metadados e logs ficam nos EUA, qualquer que seja a região de envio (documentação do Resend) | Nome, e-mail, conteúdo e metadados de entrega | Cláusulas-padrão da ANPD [CONFIRMAR] |
| **Tailscale Inc.** — só se o Cliente contratar acesso remoto (Fase 2) | Canadá / EUA | Rede da VPN de manutenção sob demanda | Plano de controle e relays fora do Brasil (a política de privacidade cita Canadá, Alemanha, EUA e Reino Unido) [CONFIRMAR] | Identificação dos técnicos da Engemase, nome do Gateway, IPs e metadados de conexão. O tráfego da sessão é cifrado de ponta a ponta | Cláusulas-padrão da ANPD [CONFIRMAR]. Alternativa sem transferência: NetBird hospedado no Brasil ou Headscale ([docs/12](../../12-acesso-remoto-vpn.md)) |

**Infraestrutura por trás dos fornecedores:** Amazon Web Services e outros provedores de nuvem aparecem como suboperadores dos fornecedores acima, nas listas publicadas por eles.

**Não são suboperadores** (não tratam Dados Pessoais do Cliente): GitHub (código-fonte; proibido colocar dados de produção no repositório) e Telegram (alertas internos da Engemase sobre a frota de gateways, sem dados pessoais) **[CONFIRMAR quando implementado]**.

**Serviços de notificação dos navegadores** (Google, Apple, Mozilla): entregam as notificações push ao aparelho. O conteúdo vai cifrado e eles não conseguem lê-lo; veem só o endereço da inscrição e metadados de entrega. Não são contratados pela Engemase. **[ADVOGADO: confirmar o enquadramento.]**

**Previstos, a incluir com aviso de 30 dias quando entrarem:**

| Serviço | Quando | Dados |
|---|---|---|
| Ferramenta de chamados do suporte (definida no SLA, lacuna L11) | Antes do piloto | Nome, e-mail e telefone de quem abre o chamado; conteúdo do chamado |
| Cópia lógica externa do banco ([docs/06](../../06-banco-de-dados.md#backup-e-recuperação)) | Fase 1 | Todos os dados do Apêndice 1 |
| WhatsApp Cloud API (Meta Platforms) | Fase 2b | Telefone e nome de quem recebe alertas |

## Apêndice 4 — Contatos

| | Engemase | Cliente |
|---|---|---|
| Encarregado (DPO) ou canal de privacidade | [PREENCHER: nome e e-mail; a nomear] | [PREENCHER] |
| Contato para incidentes (24 h) | [PREENCHER] | [PREENCHER] |
| Contato técnico | Canal do SLA | [PREENCHER] |

---

## Fontes

- LGPD (Lei 13.709/2018), arts. 5º, 14, 16, 18, 19, 33, 37 a 39, 42, 46 a 48: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Resolução CD/ANPD nº 15/2024 (incidentes): ver [README](README.md#fontes).
- Resolução CD/ANPD nº 19/2024 (transferência internacional e cláusulas-padrão) e Resolução CD/ANPD nº 32/2026 (adequação da União Europeia): ver [README](README.md#fontes).
- Neon, regiões (São Paulo `aws-sa-east-1`): <https://neon.com/docs/introduction/regions>
- Vercel, regiões das funções: <https://vercel.com/docs/functions/configuring-functions/region> · DPA: <https://vercel.com/legal/dpa>
- Sentry, local de armazenamento (EUA ou UE): <https://docs.sentry.io/organization/data-storage-location/>
- Resend, regiões (dados da conta nos EUA): <https://resend.com/docs/dashboard/domains/regions>
- Tailscale, política de privacidade e DPA: <https://tailscale.com/privacy-policy> · <https://tailscale.com/dpa>
