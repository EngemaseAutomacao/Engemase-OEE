# Engemase OEE

Plataforma de monitoramento de **OEE (Overall Equipment Effectiveness)** para máquinas industriais, **independente da marca do CLP**.

> **Status:** fase de planejamento. Ainda não há código: este repositório contém só a arquitetura e o plano de execução, em [`docs/`](docs/).

## Em uma frase

Um **gateway Linux** instalado na fábrica conversa com os CLPs (Modbus, OPC UA, Siemens S7, EtherNet/IP...), calcula estados e contagens localmente e envia os dados por **HTTPS de saída** para uma **plataforma web em Next.js na Vercel**, com banco **Postgres na Neon**.

```mermaid
flowchart LR
  subgraph FAB["Fábrica (rede OT)"]
    CLP1["CLP Siemens"] --> GW
    CLP2["CLP Rockwell"] --> GW
    CLP3["CLP Modbus<br/>(WEG, Schneider, Delta...)"] --> GW
    IO["I/O remoto<br/>(máquinas legadas)"] --> GW
    GW["Gateway Linux<br/>oee-gateway (Go)"]
  end
  GW -->|"HTTPS 443 (somente saída)"| API
  subgraph VERCEL["Vercel"]
    API["API dos gateways"]
    WEB["App Next.js<br/>dashboards e cadastros"]
    CRON["Cron jobs<br/>fechamento de turno"]
  end
  API --> DB[("Neon Postgres")]
  WEB --> DB
  CRON --> DB
  USERS["Navegador / TV / Tablet"] --> WEB
```

## Stack proposta

| Camada | Escolha |
|---|---|
| Gateway (borda) | Agente próprio em **Go** (binário único, roda em ARM64/x86), Debian, systemd |
| Protocolos | Modbus TCP/RTU, OPC UA, Siemens S7, EtherNet/IP (Rockwell), MC/SLMP (Mitsubishi), FINS (Omron) |
| Buffer local | SQLite (store-and-forward: nenhum dado se perde se a internet cair) |
| Plataforma web | **Next.js** (App Router) + TypeScript na **Vercel** |
| Banco de dados | **Neon Postgres** (via integração nativa da Vercel) + **Drizzle ORM** |
| Autenticação | Better Auth (organizações multi-tenant e papéis) |
| UI | Tailwind CSS + shadcn/ui + Apache ECharts |
| Jobs | Vercel Cron |
| Monorepo | pnpm + Turborepo (TypeScript) e módulo Go em `gateway/` |

## Documentação

| # | Documento | Conteúdo |
|---|---|---|
| 01 | [Visão e requisitos](docs/01-visao-e-requisitos.md) | Objetivo, perfis, requisitos, premissas e **perguntas em aberto** |
| 02 | [Arquitetura geral](docs/02-arquitetura.md) | Componentes, fluxos, escalabilidade, estrutura do repositório |
| 03 | [Gateway (borda)](docs/03-gateway.md) | Hardware, agente Go, drivers por marca, buffer, OTA |
| 04 | [Protocolo gateway ↔ nuvem](docs/04-protocolo-gateway-nuvem.md) | Contrato da API, provisionamento, sincronização, comandos |
| 05 | [Plataforma web](docs/05-plataforma-web.md) | Módulos, telas, autogestão, tempo real, cron |
| 06 | [Banco de dados](docs/06-banco-de-dados.md) | **Neon vs Prisma Postgres**, modelo de dados, volume, retenção |
| 07 | [Cálculo de OEE](docs/07-calculo-oee.md) | Fórmulas, modelo de estados, borda vs nuvem, casos de borda |
| 08 | [Segurança e operação](docs/08-seguranca-e-operacao.md) | Segurança OT/IT, ambientes, CI/CD, observabilidade, custos |
| 09 | [Roadmap](docs/09-roadmap.md) | Fases, entregas e critérios de saída |
| 10 | [Decisões arquiteturais (ADRs)](docs/10-decisoes-arquiteturais.md) | Registro das decisões e alternativas avaliadas |

## Estrutura planejada do repositório

```
engemase-oee/
├── apps/
│   └── web/                  # Next.js (dashboards, cadastros, API dos gateways, cron)
├── packages/
│   ├── db/                   # Schema Drizzle, migrações SQL, seeds
│   ├── contracts/            # Contrato gateway↔nuvem (Zod → JSON Schema)
│   ├── oee-core/             # Cálculo de OEE puro (TS), 100% testado
│   └── ui/                   # Componentes compartilhados (opcional)
├── gateway/                  # Agente de borda em Go (módulo próprio)
│   ├── cmd/oee-gateway/
│   └── internal/{config,drivers,engine,buffer,uplink,commands,updater}
├── tools/
│   └── plc-sim/              # Simulador de máquinas/CLPs (Modbus + OPC UA)
├── deploy/
│   └── gateway/              # systemd, pacote .deb, script de instalação, Dockerfile
└── docs/                     # Esta documentação
```
