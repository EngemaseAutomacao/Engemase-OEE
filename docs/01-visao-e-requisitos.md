# 01 — Visão e requisitos

## Objetivo

Medir e exibir o **OEE** (Disponibilidade × Performance × Qualidade) de máquinas industriais em tempo quase real, por máquina, linha, unidade, turno e produto. A coleta deve funcionar **com qualquer CLP**, por meio de um gateway instalado na fábrica.

Três qualidades guiam o projeto:

1. **Independente da marca do CLP.** O gateway abstrai o protocolo. A plataforma só recebe sinais já normalizados ("rodando", "contagem total", "refugo", "código de falha").
2. **Autogerenciável.** O cliente (ou a equipe da Engemase) cadastra unidades, máquinas, gateways, tags, turnos e motivos de parada pela web, sem precisar de desenvolvedor nem de acesso SSH ao gateway.
3. **Escalável.** A mesma arquitetura atende de 1 máquina a centenas de máquinas em várias unidades e vários clientes.

## Perfis de usuário

Os papéis seguem o [15](15-multi-cliente-e-acesso.md) (seções 1 a 3), que tem o detalhe de escopo e de acesso.

| Perfil | O que faz |
|---|---|
| **Super admin (Engemase)** | Gerencia clientes (criação, ciclo de vida, limites), a equipe Engemase, concessões e atribuições, e a frota de gateways de todos os clientes. Acessa qualquer cliente, sempre auditado |
| **Suporte (Engemase)** | Só com **concessão de suporte** ativa e com prazo: lê cadastros, configs, saúde e dashboards do cliente e executa comandos de diagnóstico. Não mexe em usuários |
| **Engenheiro de campo (Engemase)** | Só nos **clientes atribuídos**: configura unidades, linhas, máquinas, gateways e tags (comissionamento). Não mexe em usuários |
| **Admin do cliente** | O cliente inteiro: unidades, linhas, máquinas, usuários e escopos, turnos, produtos, motivos, política de suporte e de acesso remoto |
| **Engenheiro** | Provisiona gateways, cadastra conexões Modbus, tags e máquinas e testa leituras (se o cliente não for "gerenciado pela Engemase") |
| **Supervisor** | Dashboards, relatórios, turnos, produtos, motivos, classificação de paradas |
| **Operador** | **Pessoa com login** que aponta no próprio aparelho (ex.: líder de linha): motivo de parada, refugo e troca de produto. Os operadores do chão usam o **terminal pareado** e não têm conta |
| **Visualizador** | Somente leitura (ex.: diretoria, consultor) |
| **Terminal (TV Andon / tablet)** | Dispositivo pareado por código, não é conta de pessoa. No tablet, o operador do chão se identifica dentro do terminal (lista no MVP; PIN/crachá na F2) |

Os papéis do cliente (exceto o admin, que tem sempre o cliente inteiro) valem para todas as unidades ou para uma lista de unidades.

## Requisitos funcionais

Legenda: **MVP** = Fase 1 · **F2** = Fase 2 · **F3** = Fase 3 (ver [roadmap](09-roadmap.md)).

| ID | Requisito | Fase |
|---|---|---|
| RF01 | Hierarquia: cliente → unidade → [área, opcional] → linha → máquina; cada cliente vê só os seus dados ([15](15-multi-cliente-e-acesso.md)) | MVP |
| RF02 | Cadastro de gateways com provisionamento por **código de ativação** (sem SSH) | MVP |
| RF03 | Cadastro de conexões de CLP (protocolo, IP, parâmetros) e tags (endereço, tipo, **papel**) | MVP |
| RF04 | **Teste de leitura** de uma tag pela web ("ler agora") | MVP |
| RF05 | Dashboard ao vivo: estado de cada máquina, contagem e OEE do turno atual | MVP |
| RF06 | Linha do tempo de estados por máquina (gráfico tipo Gantt) | MVP |
| RF07 | Apontamento de motivo de parada pelo operador | MVP |
| RF08 | Turnos, calendário e paradas planejadas | MVP |
| RF09 | Produtos com tempo de ciclo ideal por máquina | MVP |
| RF10 | Relatório de OEE por período, turno, máquina e produto | MVP |
| RF11 | Status dos gateways: online/offline, versão, conexões com CLPs, fila pendente | MVP |
| RF12 | Classificação automática de paradas por código de falha do CLP | F2 |
| RF13 | Pareto de paradas, MTBF/MTTR, tendências, exportação CSV/Excel | F2 |
| RF14 | Modo TV/Andon por linha, num terminal pareado ([15](15-multi-cliente-e-acesso.md)) | MVP |
| RF15a | Alertas na central do app (máquina parada > X min, gateway offline, OEE abaixo da meta), ver [13](13-notificacoes-e-alertas.md) | MVP |
| RF15b | Alertas em canais externos: push, e-mail, WhatsApp | F2 |
| RF16 | Atualização remota do gateway (OTA) | F2 |
| RF17 | Templates de máquina (reaproveitar o mapeamento de tags) e importação de tags por CSV | F2 |
| RF18 | Varredura de escravos/registradores Modbus pela web (ajuda no comissionamento) | F2 |
| RF19 | API pública e webhooks para ERP/MES; ordens de produção | F3 |
| RF20 | Escrita controlada no CLP (ex.: enviar ordem/receita) | F3+ |

## Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF01 | **Nenhuma perda de dados** em quedas de internet: o gateway guarda pelo menos 7 dias de dados (meta: 30) e reenvia depois |
| RNF02 | Latência ao vivo: mudança de estado visível na web em ≤ 5 s; contagens em ≤ 15 s (conta do pior caso em [02](02-arquitetura.md#d-visualização-ao-vivo)) |
| RNF03 | O gateway faz **somente conexões de saída** (HTTPS 443). Nenhuma porta aberta na rede da fábrica |
| RNF04 | O gateway faz **somente leitura** nos CLPs na versão 1 |
| RNF05 | Multi-tenant com isolamento rígido entre organizações |
| RNF06 | Horários armazenados em UTC; exibição e cálculo de turnos no fuso horário da unidade |
| RNF07 | Escala inicial: até ~500 máquinas e ~100 gateways sem mudar a arquitetura, com caminho de evolução documentado para além disso |
| RNF08 | Gateway roda em hardware modesto (ARM64, ≥ 1 GB de RAM) 24/7, com recuperação automática |
| RNF09 | Auditoria de todas as alterações de configuração (quem, quando, o quê) |
| RNF10 | Interface em pt-BR, com i18n preparado para outros idiomas |
| RNF11 | Aderência à LGPD: o mínimo de dados pessoais (usuários e operadores) |

## Premissas adotadas (validar)

Estas premissas moldam a arquitetura. Se alguma estiver errada, os documentos afetados estão indicados.

1. **O produto é multi-cliente.** A Engemase, como integradora, vai atender várias empresas. Por isso o sistema é **multi-tenant desde o início** (custa pouco agora e muito depois). → [06](06-banco-de-dados.md), [05](05-plataforma-web.md)
2. Toda fábrica tem **internet de saída** (talvez com proxy corporativo), ainda que instável. → [03](03-gateway.md)
3. Granularidade de **segundos** atende o OEE; não há requisito de dados de alta frequência (ms) na nuvem. → [07](07-calculo-oee.md)
4. Cada máquina tem, no mínimo, um sinal de "rodando" **ou** um contador de peças acessível (pelo CLP ou por um módulo de I/O). → [03](03-gateway.md)
5. O gateway é hardware fornecido e instalado pela Engemase (padronizado). → [03](03-gateway.md)

## Perguntas em aberto

| # | Pergunta | Por que importa |
|---|---|---|
| Q1 | Quais marcas e modelos de CLP aparecem primeiro nos clientes? A Engemase pode incluir o **bloco OEE padrão** nos programas? | O MVP é só Modbus TCP/RTU; isso define quantas máquinas dá para ligar sem mexer no CLP (ver [11](11-integracao-modbus.md)) |
| Q2 | ~~Hardware do gateway~~ → **proposto:** Seeed reComputer R1000 sem rádio ([03](03-gateway.md#hardware-recomendado)). Falta: cotação formal e compra de 2 unidades para bancada | Custo por planta e prazo de importação |
| Q3 | Quantas máquinas e plantas no primeiro ano? | Dimensiona o plano Neon/Vercel e a necessidade de MQTT |
| Q4 | O operador terá tablet na máquina para apontar paradas? | Peso da tela do operador no MVP |
| Q5 | Há requisito de retenção (ex.: 5 anos de histórico)? | Política de partições e custo de armazenamento |
| Q6 | É preciso escrever no CLP (ordens, receitas, metas)? | Muda o modelo de segurança. A recomendação é não fazer no v1 |
| Q7 | Algum cliente exige rodar on-premises (sem nuvem)? | Manter tudo em Postgres padrão permite uma versão self-hosted no futuro |
| Q8 | Modelo comercial: cobrança por máquina, por planta, por gateway? | Billing e limites por organização (F3) |
| Q9 | Integração com ERP/MES específico (TOTVS, SAP, Senior...)? | Formato da API pública (F3) |
