# 09 — Roadmap

As estimativas consideram um time de **2 desenvolvedores** (um focado no gateway, outro na web, revezando). São para planejamento e devem ser revisadas ao fim da Fase 0.

```mermaid
gantt
  dateFormat YYYY-MM-DD
  axisFormat %b
  section Fase 0
  Fundação e PoCs            :f0, 2026-11-16, 3w
  section Fase 1 (MVP)
  Gateway MVP                :f1a, after f0, 7w
  Web MVP                    :f1b, after f0, 7w
  Piloto em cliente          :f1c, after f1a, 2w
  section Fase 2
  Produto                    :f2, after f1c, 8w
  section Fase 3
  Escala e integrações       :f3, after f2, 10w
```

## Fase 0: fundação e provas de conceito (~3 semanas)

**Objetivo:** eliminar os maiores riscos técnicos antes de escrever o produto.

- [ ] Monorepo: pnpm + Turborepo, módulo Go, lint/format, CI básico.
- [ ] Projeto na Vercel + **Neon via integração nativa**, com branch por preview ativado.
- [ ] Next.js com Better Auth (organizações), layout base, tela de login.
- [ ] `packages/db`: schema inicial (organização, ativos, gateway, device, tag, eventos, minutos) e primeira migração.
- [ ] `packages/contracts`: schemas Zod do `/enroll` e do `/sync`, exportação para JSON Schema e fixtures.
- [ ] **PoC de drivers** contra CLPs reais ou simuladores confiáveis:
  - [ ] Modbus TCP (`simonvetter/modbus`)
  - [ ] OPC UA (`gopcua/opcua`), incluindo subscription
  - [ ] Siemens S7 (`robinson/gos7`), num S7-1200 com PUT/GET
- [ ] `tools/plc-sim`: uma máquina simulada via Modbus, com ciclos e paradas.
- [ ] Teste do driver de banco (serverless HTTP vs `pg` + pool) com carga simulada de 100 gateways.
- [ ] Escolher o hardware de gateway padrão (responder Q2 em [01](01-visao-e-requisitos.md#perguntas-em-aberto)).

**Critério de saída:** um gateway de bancada lê o simulador e um CLP real, envia `/sync` e os dados aparecem gravados na Neon. Bibliotecas de driver aprovadas ou substituídas.

## Fase 1: MVP (~7 semanas + 2 de piloto)

**Gateway**
- [ ] Drivers Modbus TCP/RTU, OPC UA e S7.
- [ ] Scheduler com leitura em bloco, máquina de estados (modos `signals`, `state_code` e `count_derived`), contadores com overflow/reset, agregados por minuto.
- [ ] Outbox SQLite com reenvio ordenado e limite de taxa.
- [ ] Uplink HTTPS (`/enroll`, `/sync`, `/config`) com retentativas.
- [ ] Comandos: `tag.read`, `device.test`, `config.reload`, `agent.restart`.
- [ ] Pacote `.deb`, unit systemd e script de instalação.

**Web**
- [ ] Cadastros: plantas, áreas, linhas, máquinas, produtos e ciclo ideal, turnos, paradas planejadas, motivos.
- [ ] Gateways: provisionamento por código, status, conexões de CLP, tags por papel, **teste de leitura**, publicação de config versionada.
- [ ] API dos gateways com validação, idempotência e escopo por tenant.
- [ ] Dashboard ao vivo (visão geral + linha + máquina) com polling.
- [ ] Linha do tempo de estados (ECharts).
- [ ] `@engemase/oee-core` com testes golden. OEE do turno ao vivo.
- [ ] Tela do operador: classificar paradas.
- [ ] Relatório de OEE por período, turno, máquina e produto.
- [ ] Cron: `close-shifts`, `recompute-dirty`, `gateway-watchdog`, `expire-commands`.
- [ ] Usuários, convites, papéis e auditoria básica.

**Critério de saída (piloto):** uma linha real de um cliente rodando **2 semanas** com:
- zero perda de contagem comparando com o contador do CLP, inclusive após derrubar a internet propositalmente por algumas horas;
- máquina colocada no ar pela equipe de campo **sem ajuda do desenvolvimento**;
- OEE batendo com o cálculo manual de pelo menos 3 turnos.

## Fase 2: produto (~8 semanas)

- Drivers **EtherNet/IP** (Rockwell, Omron NJ/NX), **MC/SLMP** (Mitsubishi), **FINS** (Omron).
- **OTA** com assinatura, canais e rollback. Página local de diagnóstico. `logs.upload`.
- **Templates de máquina**, importação de tags por CSV, **browse OPC UA**.
- Classificação automática por código de falha.
- Relatórios: Pareto, MTBF/MTTR, tendências, exportação CSV/Excel. **Modo TV/Andon**.
- **Alertas** (e-mail; avaliar WhatsApp/Telegram): máquina parada > X min, gateway offline, OEE abaixo da meta.
- 2FA obrigatório para perfis administrativos. Avaliar RLS.
- Painel de super admin: frota de gateways de todos os clientes.

## Fase 3: escala e integrações (~10 semanas)

- API pública REST + webhooks (ERP/MES), **ordens de produção**.
- Push em tempo real (WebSockets da Vercel ou serviço gerenciado), se o polling não bastar.
- Uplink **MQTT / Sparkplug B** + worker consumidor, para frotas grandes ou clientes que já têm broker.
- Billing por máquina ou por planta, com limites por plano.
- Retenção por plano e arquivamento frio (Parquet).
- Módulos adicionais candidatos: manutenção (ordens de serviço a partir de paradas), qualidade/SPC, metas e gamificação por turno.
- Escrita controlada no CLP, só com allowlist, papel específico, confirmação e auditoria.

## Primeiros passos práticos (próxima semana)

1. Responder as **perguntas em aberto** ([01](01-visao-e-requisitos.md#perguntas-em-aberto)), principalmente Q1 (marcas de CLP), Q2 (hardware) e Q3 (escala).
2. Criar o projeto na Vercel e instalar a integração **Neon** pelo Marketplace.
3. Separar um CLP de cada marca prioritária para a bancada (S7-1200, um Modbus TCP qualquer, um servidor OPC UA).
4. Abrir as issues da Fase 0 a partir do checklist acima.
