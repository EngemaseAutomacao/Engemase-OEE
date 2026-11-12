# Registro das operações de tratamento (ROPA)

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Marcações e o que falta: [README desta pasta](README.md).

**O que é.** O registro que a LGPD exige do controlador e do operador (art. 37). Mostra o que a Engemase trata, de quem, para quê, com qual base, com quem compartilha, onde guarda e por quanto tempo.

**Como manter.** Revisar a cada nova funcionalidade que trate dados pessoais, a cada novo fornecedor e, no mínimo, uma vez por ano. Responsável: encarregado ou canal de privacidade [PREENCHER].

**Agente de pequeno porte.** Se a Engemase se enquadrar (Resolução CD/ANPD nº 2/2022), pode manter o registro de forma simplificada. Este formato já é curto e serve aos dois casos.

**Referências de sistema.** Os nomes de tabela são os do [docs/06](../../06-banco-de-dados.md#tabelas-por-domínio) e do [docs/15 §9](../../15-multi-cliente-e-acesso.md#9-modelo-de-dados-acréscimos).

## Parte A — Engemase como operadora (em nome de cada cliente)

**Controlador:** cada cliente. Um registro igual a este vale para todos os clientes; o que muda por cliente fica na tabela A.0.

**Locais comuns:** banco na Neon, AWS `sa-east-1` (São Paulo); aplicação na Vercel `gru1` (São Paulo). Transferência internacional por acesso remoto e metadados dos fornecedores: ver o [DPA, cláusula 9 e Apêndice 3](02-acordo-de-tratamento-de-dados.md#apêndice-3--suboperadores).

**Segurança:** [DPA, Apêndice 2](02-acordo-de-tratamento-de-dados.md#apêndice-2--medidas-de-segurança).

### A.0 O que muda por cliente

| Campo | Exemplo |
|---|---|
| Cliente (controlador), CNPJ, encarregado | [PREENCHER] |
| Unidades e quantidade de usuários | [PREENCHER] |
| Usa terminais com lista de operadores? Formato (nome, apelido, matrícula) | [PREENCHER] |
| Tem adolescentes na lista (aprendizes)? | [PREENCHER] |
| Contratou acesso remoto aos gateways (Fase 2)? | [PREENCHER] |
| Data do DPA assinado | [PREENCHER] |

### A.1 Resumo

| ID | Atividade | Titulares | Retenção |
|---|---|---|---|
| OP-01 | Vínculos dos usuários com o cliente (papel e escopo) | Usuários do cliente | Enquanto ativo; depois, na auditoria (OP-03) |
| OP-02 | Identificação do operador de chão e apontamentos | Operadores de chão | Contrato; [PROPOSTA: anonimizar após 2 anos] |
| OP-03 | Auditoria do cliente | Usuários, operadores, equipe Engemase | 5 anos (D6) |
| OP-04 | Notificações e alertas | Usuários; terminais | Inscrição até remover; notificações [PROPOSTA: 12 meses] |
| OP-05 | E-mails de alertas e resumos (Fase 2) | Usuários | Prazo do fornecedor [CONFIRMAR] |
| OP-06 | Terminais pareados | Quem pareou | Enquanto existir o terminal; depois, na auditoria |
| OP-07 | Relatórios e exportações | Pessoas citadas nos arquivos | [PROPOSTA: 30 dias] |
| OP-08 | Contatos de TI e manutenção do cliente | Contatos do cliente | Contrato |
| OP-09 | Aprovação de acesso remoto (Fase 2) | Admin do cliente | 5 anos |

### A.2 Detalhe

**OP-01 · Vínculos dos usuários com o cliente**
- **Finalidade:** permissões e escopo de dados (cliente inteiro, unidades ou máquinas, D11).
- **Dados:** papel, escopo, unidades ou máquinas listadas, situação, quem convidou e quando.
- **Origem:** admin do cliente.
- **Sistema:** `member`, `member_access`, `member_unit`, `member_machine`.
- **Compartilhamento:** Vercel, Neon.
- **Observação:** a **conta de acesso** (nome, e-mail, senha, 2FA, sessões) é da Engemase como controladora (CT-01), porque a mesma pessoa pode ter vínculo com mais de um cliente.

**OP-02 · Operador de chão e apontamentos**
- **Finalidade:** saber quem informou cada classificação de parada, refugo e troca de produto ([nota do operador de chão](05-operador-de-chao.md)).
- **Dados:** nome ou apelido, matrícula (opcional), unidade; quem apontou, máquina, terminal, horário.
- **Origem:** lista enviada pelo cliente e cadastrada pela Engemase; escolha no tablet.
- **Sistema:** lista de operadores (tabela a criar, L19); `machine_state_event` (`classificado_por`), `quality_entry`, `production_run`.
- **Compartilhamento:** Vercel, Neon.
- **Observação:** pode haver adolescentes (aprendizes): LGPD, art. 14. Hoje `machine_state_event` tem retenção indefinida: precisa da rotina de anonimização proposta.

**OP-03 · Auditoria do cliente**
- **Finalidade:** rastrear mudanças, ações do chão, acessos da Engemase (D5) e comandos a gateways.
- **Dados:** ator (nome, tipo: pessoa, Engemase, terminal, gateway, sistema), ação, entidade, antes e depois, IP, horário.
- **Sistema:** `audit_log`, `support_access_grant`, `platform_assignment`.
- **Compartilhamento:** Vercel, Neon.
- **Retenção:** 5 anos (D6), inclusive depois do fim do contrato **[ADVOGADO]**.

**OP-04 · Notificações e alertas**
- **Finalidade:** avisar as pessoas certas sobre máquinas paradas, falhas, gateway offline e outros eventos.
- **Dados:** notificações (destinatário, título, texto, lida em), preferências, inscrições de push (endereço do serviço, chaves, aparelho), tentativas de entrega.
- **Sistema:** `notification`, `notification_delivery`, `notification_preference`, `push_subscription`, `alert_event`.
- **Compartilhamento:** Vercel, Neon; serviços de push dos navegadores (conteúdo cifrado); Resend (e-mail, Fase 2); WhatsApp (Fase 2b, a incluir).

**OP-05 · E-mails de alertas e resumos (Fase 2)**
- **Finalidade:** alertas, escalonamentos e resumos por e-mail. Os e-mails de conta (definir e redefinir senha) e de contrato são da Engemase (CT-01 e CT-04).
- **Dados:** nome, e-mail, conteúdo, metadados de entrega.
- **Compartilhamento:** Resend (dados da conta e logs nos EUA).

**OP-06 · Terminais pareados**
- **Finalidade:** segurança e revogação de TVs e tablets.
- **Dados:** quem pareou e quando; último contato do aparelho.
- **Sistema:** `terminal`.

**OP-07 · Relatórios e exportações**
- **Finalidade:** entregar ao cliente os arquivos que ele pede, inclusive a exportação completa no encerramento.
- **Dados:** os de OP-01 a OP-03 que entram no arquivo.
- **Sistema:** Vercel Blob (região [CONFIRMAR]).
- **Eliminação:** **[PROPOSTA]** link válido por 7 dias; arquivo apagado em 30 dias.

**OP-08 · Contatos de TI e manutenção do cliente**
- **Finalidade:** instalar e manter os gateways ([ficha técnica de TI](../../operacao/ficha-tecnica-ti-cliente.md)).
- **Dados:** nome, e-mail, telefone, cargo.
- **Onde:** ficha técnica (arquivo do cliente) e cadastro do cliente.

**OP-09 · Aprovação de acesso remoto aos gateways (Fase 2)**
- **Finalidade:** governança das sessões de VPN de manutenção (D20).
- **Dados:** admin que aprovou ou recusou, decisão, horário.
- **Sistema:** `remote_access_session`, `remote_access_forward`, `remote_access_event`.
- **Compartilhamento:** Vercel, Neon.

## Parte B — Engemase como controladora

**Controlador:** [PREENCHER: razão social e CNPJ da Engemase]. **Encarregado:** [PREENCHER: a nomear].

### B.1 Resumo

| ID | Atividade | Titulares | Base legal (LGPD, art. 7º) | Retenção |
|---|---|---|---|---|
| CT-01 | Contas de acesso à plataforma | Usuários de todos os clientes e da Engemase | Legítimo interesse (IX) | Enquanto houver vínculo ativo; [PROPOSTA: 6 meses] sem vínculo |
| CT-02 | Segurança da plataforma e prevenção a fraude | Usuários; visitantes da tela de login | Legítimo interesse (IX) | [PROPOSTA: 6 meses] |
| CT-03 | Registros de acesso à aplicação | Usuários | Obrigação legal (II): Marco Civil, art. 15 | 6 meses |
| CT-04 | Contrato, cobrança e faturamento | Representantes e contatos de cobrança do cliente | Execução de contrato (V); obrigação legal fiscal (II) | Prazo fiscal [CONFIRMAR: em regra 5 anos] |
| CT-05 | Suporte e relacionamento | Contatos do cliente que abrem chamados | Legítimo interesse (IX) | [PROPOSTA: contrato + 5 anos] |
| CT-06 | Equipe Engemase na plataforma | Pessoas da Engemase | Execução do contrato de trabalho (V); legítimo interesse (IX) | Conta: enquanto ativa; auditoria: 5 anos |
| CT-07 | Propostas e contatos comerciais | Contatos de clientes em prospecção | Legítimo interesse (IX) | [PROPOSTA: 2 anos sem negócio] |
| CT-08 | Monitoramento de erros | Usuários (identificador técnico) | Legítimo interesse (IX) | [CONFIRMAR: prazo do Sentry] |
| CT-09 | Pedidos de titulares e registro de incidentes | Quem pede; titulares afetados | Obrigação legal (II) | Incidentes: 5 anos (Res. 15/2024); pedidos: [PROPOSTA: 5 anos] |
| CT-10 | Ciclo de vida do hardware | Técnicos da Engemase | Legítimo interesse (IX) | Enquanto existir o equipamento + 5 anos |

### B.2 Detalhe

**CT-01 · Contas de acesso à plataforma**
- **Finalidade:** dar o acesso que o cliente contratou e manter a segurança do login. A conta é da plataforma: a mesma pessoa pode ter vínculo com mais de um cliente ([docs/15 §1](../../15-multi-cliente-e-acesso.md#1-hierarquia-e-identidades)).
- **Dados:** nome, e-mail, hash da senha, segredo e códigos de recuperação do 2FA, sessões (IP, navegador, horário), último acesso, tokens de uso único (só hash).
- **Origem:** admin do cliente (convite com nome e e-mail); o próprio usuário (senha e 2FA).
- **Sistema:** `user`, `account`, `session`, `verification`, `account_token`.
- **Compartilhamento:** Vercel, Neon; Resend (e-mails de definir e redefinir senha e de segurança).
- **Eliminação:** **[PROPOSTA]** eliminada ou anonimizada 6 meses depois de perder o último vínculo; o nome continua nas auditorias (5 anos).
- **Teste de legítimo interesse:** necessário para o serviço que a empresa do titular contratou; dado mínimo; esperado. [ADVOGADO: documentar o teste e confirmar a divisão conta (Engemase) × vínculo (cliente).]

**CT-02 · Segurança da plataforma e prevenção a fraude**
- **Finalidade:** limitar tentativas de login (5 erros, espera de 15 min), bloquear ataques, investigar abuso.
- **Dados:** IP, navegador, horário, conta tentada, resultado.
- **Teste de legítimo interesse:** necessário para proteger todos os clientes; dado mínimo; esperado por quem usa um sistema com login. [ADVOGADO: documentar o teste.]
- **Compartilhamento:** Vercel (firewall e logs).

**CT-03 · Registros de acesso à aplicação (Marco Civil da Internet)**
- **Finalidade:** cumprir o art. 15 da Lei 12.965/2014: guardar, em sigilo e ambiente seguro, os registros de acesso (IP, data e hora) por 6 meses.
- **Lacuna do projeto:** as sessões do Better Auth são apagadas quando expiram, e os logs da Vercel podem ter retenção curta. **É preciso guardar os eventos de login (IP, data e hora) por 6 meses** numa tabela própria ou num destino de logs. [CONFIRMAR]

**CT-04 · Contrato, cobrança e faturamento**
- **Dados:** nome, cargo, e-mail e telefone dos representantes e dos contatos de cobrança; dados da empresa; plano e máquinas contratadas (`client_account`).
- **Compartilhamento:** contador e sistema de emissão de notas [PREENCHER]; banco ou meio de pagamento [PREENCHER].

**CT-05 · Suporte e relacionamento**
- **Dados:** nome, e-mail e telefone de quem abre o chamado; conteúdo do chamado.
- **Compartilhamento:** ferramenta de chamados (definida no SLA, L11) [PREENCHER]; e-mail corporativo da Engemase [PREENCHER].

**CT-06 · Equipe Engemase na plataforma**
- **Finalidade:** conta de plataforma, 2FA, concessões de suporte, atribuições de campo; transparência ao cliente (o nome da pessoa aparece na auditoria e na faixa da tela, D5); identificação nas sessões de acesso remoto e log de comandos no gateway (Fase 2).
- **Dados:** nome, e-mail, papel, 2FA, motivo e chamado de cada acesso, IP; na VPN: identificação, IPs, comandos executados.
- **Sistema:** `user` (papel de plataforma), `support_access_grant`, `platform_assignment`, `remote_access_*`, `audit_log`.
- **Compartilhamento:** clientes (nome, papel, motivo, chamado); Vercel, Neon; Tailscale (Fase 2).
- **Observação:** informar a equipe, no contrato de trabalho ou em política interna, que seus acessos ficam visíveis aos clientes.

**CT-07 · Propostas e contatos comerciais**
- **Dados:** nome, empresa, cargo, e-mail, telefone; questionário e ficha técnica antes do contrato.
- **Compartilhamento:** e-mail corporativo e CRM [PREENCHER].

**CT-08 · Monitoramento de erros**
- **Finalidade:** encontrar e corrigir falhas.
- **Dados:** identificador técnico do usuário, rota, mensagem de erro. Configurado para não enviar IP, e-mail nem corpo de requisição.
- **Compartilhamento:** Sentry (região [DECIDIR: UE recomendada]).

**CT-09 · Pedidos de titulares e registro de incidentes**
- **Finalidade:** atender o art. 18 da LGPD e guardar o registro dos incidentes (Resolução CD/ANPD nº 15/2024).
- **Dados:** quem pediu, o que pediu, resposta; dados do incidente ([plano de resposta](06-plano-de-resposta-a-incidentes.md#e-registro-interno-do-incidente)).

**CT-10 · Ciclo de vida do hardware**
- **Finalidade:** inventário, bancada e termo de eliminação de cada gateway.
- **Dados:** nome do técnico, data, método.
- **Onde:** planilha controlada até existir a tabela `gateway_unit` ([docs/16](../../16-projeto-do-gateway.md)).

## Fontes

- LGPD (Lei 13.709/2018), arts. 7º, 10, 14, 37: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Marco Civil da Internet (Lei 12.965/2014), art. 15: <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm>
- Resoluções CD/ANPD nº 2/2022 e 15/2024: ver [README](README.md#fontes).
