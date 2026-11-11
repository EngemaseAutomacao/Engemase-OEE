# 01 — Visão e requisitos

## Objetivo

Medir e exibir o **OEE** (Disponibilidade × Performance × Qualidade) de máquinas industriais em tempo quase real, por máquina, linha, planta, turno e produto. A coleta deve funcionar **com qualquer CLP**, por meio de um gateway instalado na fábrica.

Três qualidades guiam o projeto:

1. **Independente da marca do CLP.** O gateway abstrai o protocolo. A plataforma só recebe sinais já normalizados ("rodando", "contagem total", "refugo", "código de falha").
2. **Autogerenciável.** O cliente (ou a equipe da Engemase) cadastra plantas, máquinas, gateways, tags, turnos e motivos de parada pela web, sem precisar de desenvolvedor nem de acesso SSH ao gateway.
3. **Escalável.** A mesma arquitetura atende de 1 máquina a centenas de máquinas em várias plantas e vários clientes.

## Perfis de usuário

| Perfil | O que faz |
|---|---|
| **Super admin (Engemase)** | Gerencia clientes (organizações), planos, suporte e visão geral da frota de gateways |
| **Admin do cliente** | Usuários, plantas, linhas, turnos, configurações gerais |
| **Engenheiro / integrador** | Provisiona gateways, cadastra conexões de CLP e tags, testa leituras |
| **Supervisor / gestor** | Dashboards, relatórios, análise de paradas, metas |
| **Operador** | No tablet da máquina: aponta motivo de parada, refugo e troca de produto |
| **Visualizador / TV Andon** | Tela somente leitura, em tela cheia, no chão de fábrica |

## Requisitos funcionais

Legenda: **MVP** = Fase 1 · **F2** = Fase 2 · **F3** = Fase 3 (ver [roadmap](09-roadmap.md)).

| ID | Requisito | Fase |
|---|---|---|
| RF01 | Hierarquia de ativos: organização → planta → área → linha → máquina | MVP |
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
| RF14 | Modo TV/Andon por linha | F2 |
| RF15 | Alertas (máquina parada > X min, gateway offline, OEE abaixo da meta) | F2 |
| RF16 | Atualização remota do gateway (OTA) | F2 |
| RF17 | Templates de máquina (reaproveitar o mapeamento de tags) e importação de tags por CSV | F2 |
| RF18 | Navegação (browse) de tags OPC UA pela web | F2 |
| RF19 | API pública e webhooks para ERP/MES; ordens de produção | F3 |
| RF20 | Escrita controlada no CLP (ex.: enviar ordem/receita) | F3+ |

## Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF01 | **Nenhuma perda de dados** em quedas de internet: o gateway guarda pelo menos 7 dias de dados (meta: 30) e reenvia depois |
| RNF02 | Latência ao vivo: mudança de estado visível na web em ≤ 5 s; contagens em ≤ 15 s |
| RNF03 | O gateway faz **somente conexões de saída** (HTTPS 443). Nenhuma porta aberta na rede da fábrica |
| RNF04 | O gateway faz **somente leitura** nos CLPs na versão 1 |
| RNF05 | Multi-tenant com isolamento rígido entre organizações |
| RNF06 | Horários armazenados em UTC; exibição e cálculo de turnos no fuso horário da planta |
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
| Q1 | Quais marcas e modelos de CLP aparecem primeiro nos clientes? | Define a ordem dos drivers (MVP: Modbus, OPC UA e S7) |
| Q2 | Há hardware de gateway preferido (IOT2050, Revolution Pi, Moxa, PC industrial x86)? | Define a arquitetura de build (ARM64 vs x86) e o tamanho do buffer |
| Q3 | Quantas máquinas e plantas no primeiro ano? | Dimensiona o plano Neon/Vercel e a necessidade de MQTT |
| Q4 | O operador terá tablet na máquina para apontar paradas? | Peso da tela do operador no MVP |
| Q5 | Há requisito de retenção (ex.: 5 anos de histórico)? | Política de partições e custo de armazenamento |
| Q6 | É preciso escrever no CLP (ordens, receitas, metas)? | Muda o modelo de segurança. A recomendação é não fazer no v1 |
| Q7 | Algum cliente exige rodar on-premises (sem nuvem)? | Manter tudo em Postgres padrão permite uma versão self-hosted no futuro |
| Q8 | Modelo comercial: cobrança por máquina, por planta, por gateway? | Billing e limites por organização (F3) |
| Q9 | Integração com ERP/MES específico (TOTVS, SAP, Senior...)? | Formato da API pública (F3) |
