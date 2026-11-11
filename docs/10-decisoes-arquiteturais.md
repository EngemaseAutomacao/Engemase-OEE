# 10 — Decisões arquiteturais (ADRs)

Registro curto das decisões. Para mudar uma decisão, adicione uma nova ADR que **substitua** a anterior, em vez de apagar o histórico.

| ADR | Decisão | Status |
|---|---|---|
| 001 | Monorepo com pnpm + Turborepo e módulo Go | Proposta |
| 002 | Agente de borda próprio em Go | Proposta |
| 003 | Uplink HTTPS somente de saída (MQTT depois) | Proposta |
| 004 | Neon como banco (Postgres padrão, sem TimescaleDB) | Proposta |
| 005 | Drizzle como ORM | Proposta |
| 006 | Borda calcula estados e agregados; nuvem calcula OEE | Proposta |
| 007 | Multi-tenant com schema compartilhado | Proposta |
| 008 | Somente leitura nos CLPs no v1 | Proposta |
| 009 | Tempo real por polling no MVP | Proposta |
| 010 | Better Auth para autenticação e organizações | Proposta |

---

## ADR-001 — Monorepo com pnpm + Turborepo e módulo Go

**Contexto.** Gateway, API, banco e cálculo de OEE compartilham um contrato que muda junto.

**Decisão.** Um repositório. A parte TypeScript usa pnpm workspaces + Turborepo (`apps/web`, `packages/*`). O agente fica em `gateway/`, com `go.mod` próprio.

**Alternativas.** Repositórios separados por componente: versionamento mais independente, mas mudanças de contrato viram PRs coordenados em vários repositórios.

**Consequências.** Um PR muda o contrato, o agente e a API de uma vez. O CI precisa de filtros por caminho para não rodar tudo sempre. O agente mantém um ciclo de release próprio, por tags.

---

## ADR-002 — Agente de borda próprio em Go

**Contexto.** O gateway precisa falar vários protocolos, rodar 24/7 em hardware modesto e ser gerenciado remotamente em escala.

**Decisão.** Agente próprio em Go, com interface de driver plugável. As bibliotecas de protocolo são validadas na Fase 0.

**Alternativas.**
- *Node.js/TypeScript:* mesma linguagem do web, mas exige runtime e `node_modules` no campo e consome mais memória.
- *Python:* melhor ecossistema industrial, mas distribuição e atualização mais frágeis.
- *Node-RED:* rápido para protótipo, ruim para configuração centralizada e versionada.
- *EMQX Neuron:* a edição open source só tem Modbus TCP e MQTT; S7 e OPC UA são comerciais.
- *Kepware / Ignition Edge:* excelentes, mas com licença por gateway. Continuam utilizáveis como fonte, via OPC UA.

**Consequências.** Binário único, ~20–50 MB de RAM, cross-compile trivial e OTA simples. Duas linguagens no monorepo. O EtherNet/IP pode exigir cgo (libplctag), o que complica o cross-compile; a mitigação é zig/goreleaser ou o pure-Go `gologix`.

---

## ADR-003 — Uplink HTTPS somente de saída (MQTT depois)

**Contexto.** As fábricas normalmente só permitem saída 443, às vezes via proxy. A plataforma roda em Vercel Functions, que não mantêm assinaturas persistentes em brokers.

**Decisão.** O gateway faz `POST /sync` em lote (a cada ~10 s, imediato em mudança de estado) e puxa config e comandos na resposta. O agente define uma interface `Uplink` para permitir MQTT no futuro.

**Alternativas.** MQTT desde o início: padrão em IIoT e com latência menor, mas exige um broker gerenciado e um worker sempre ligado fora das Functions, ou seja, mais infraestrutura, custo e operação já no MVP.

**Consequências.** Infraestrutura mínima (só Vercel + Neon), passa por proxies corporativos e não exige nenhuma porta aberta. A latência fica em segundos, o que basta para OEE. A partir de ~300 gateways, ou com exigência sub-segundo, reavaliar (ver [02](02-arquitetura.md#caminho-de-evolução)).

---

## ADR-004 — Neon como banco (Postgres padrão, sem TimescaleDB)

**Contexto.** Ingestão contínua 24/7, séries temporais crescentes e consultas por janela de tempo. As opções no Marketplace da Vercel consideradas foram Neon e Prisma Postgres.

**Decisão.** Neon, via integração nativa da Vercel. Particionamento com pg_partman. Agregados próprios (minuto → turno), sem depender de TimescaleDB.

**Alternativas.**
- *Prisma Postgres:* cobrança por operação, que penaliza escrita contínua. Catálogo de extensões menor. Sem branching copy-on-write equivalente.
- *Supabase:* bom, mas traz um pacote (auth, storage, realtime) que se sobrepõe ao que já teremos na Vercel e com Better Auth.
- *Tiger Cloud (TimescaleDB completo):* compressão e continuous aggregates, mas fora do Marketplace da Vercel e com agregações que não modelam bem calendário de turnos e reclassificação. Pode ser útil no futuro para histórico bruto de alto volume.
- *TimescaleDB na Neon:* só os recursos de licença Apache (sem compressão).

**Consequências.** O custo é previsível por compute-hora. Há branch por preview. O schema é portável para qualquer Postgres (inclusive on-premises). As rotinas de agregação e retenção ficam por nossa conta (cron + pg_partman).

---

## ADR-005 — Drizzle como ORM

**Contexto.** Muitas consultas analíticas (janelas de tempo, CTEs, funções de janela) e execução em Functions.

**Decisão.** Drizzle ORM com migrações SQL geradas e revisadas no PR.

**Alternativas.** *Prisma ORM:* boa experiência em CRUD, mas mais distante do SQL nas consultas analíticas. Continua viável se o time preferir. *Kysely:* ótimo query builder, com menos ferramentas de migração integradas.

**Consequências.** SQL explícito e tipado. O time precisa estar confortável com SQL.

---

## ADR-006 — Borda calcula estados e agregados; nuvem calcula OEE

**Contexto.** A leitura de sinais exige ms/s, a internet é instável e a classificação de paradas acontece depois do fato.

**Decisão.** O gateway produz eventos de estado (precisão de ms) e agregados por minuto (segundos por estado, contagens por produto). A nuvem aplica calendário, motivos, micro-paradas e ciclo ideal para calcular A, P, Q e OEE de qualquer janela.

**Alternativas.** *Enviar valores brutos de tags para a nuvem:* volume ~100× maior, latência e custo maiores e dependência total da rede. *Calcular o OEE na borda:* impede reclassificação e mudança de calendário sem reprocessar no campo.

**Consequências.** Volume baixo na nuvem e OEE recalculável a qualquer momento. A lógica de estado fica em Go (borda) e a de OEE em TS (nuvem), com contratos e testes bem definidos entre as duas.

---

## ADR-007 — Multi-tenant com schema compartilhado

**Contexto.** A Engemase deve atender vários clientes com a mesma plataforma.

**Decisão.** Um banco, um schema, `organization_id` em todas as tabelas de cadastro e camada de acesso a dados com escopo obrigatório. RLS a avaliar como segunda camada.

**Alternativas.** *Banco por cliente:* isolamento físico, mas operação, migrações e custo multiplicados. Fica reservado para clientes que exijam isso contratualmente.

**Consequências.** Operação simples e custo baixo. Exige disciplina e testes automatizados de isolamento.

---

## ADR-008 — Somente leitura nos CLPs no v1

**Contexto.** Escrever num CLP pode causar acidente ou parada de produção, e é um grande obstáculo na aprovação pelo cliente.

**Decisão.** Nenhum driver implementa escrita no v1.

**Consequências.** Aprovação mais fácil pelo TI/OT do cliente e menor superfície de risco. Funcionalidades como "enviar ordem para a máquina" ficam para depois, com controles específicos.

---

## ADR-009 — Tempo real por polling no MVP

**Contexto.** As telas precisam de atualização em segundos, não em milissegundos. Vercel Functions passou a suportar WebSockets recentemente, mas as conexões encerram no limite de duração da função e o fan-out exige pub/sub.

**Decisão.** Polling leve (3–5 s) com TanStack Query sobre `machine_live` e OEE do turno calculado sob demanda.

**Alternativas.** WebSockets da Vercel + pub/sub (Redis), ou serviço gerenciado (Ably/Pusher): menor latência, mas mais peças móveis.

**Consequências.** Simples e robusto, com custo proporcional ao número de telas abertas. Reavaliar com muitas TVs simultâneas ou exigência de latência menor que 2 s.

---

## ADR-010 — Better Auth para autenticação e organizações

**Contexto.** É preciso multi-tenant com organizações, papéis, convites e 2FA, com os dados no nosso banco.

**Decisão.** Better Auth com o plugin de organizações, tabelas no Neon via Drizzle.

**Alternativas.** *Clerk:* excelente experiência, organizações prontas, mas custo por usuário ativo e dados fora do nosso banco. *Auth.js:* não tem organizações nem papéis nativos.

**Consequências.** Sem custo por usuário, dados sob nosso controle e flexibilidade para o login por PIN do operador. A manutenção da segurança da autenticação fica mais por nossa conta (atualizar dependências e seguir as boas práticas da biblioteca).
