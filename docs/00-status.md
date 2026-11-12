# Status do projeto e próximos passos

> Nota de passagem, atualizada em 12/11/2026, para retomar o trabalho em outra sessão ou máquina. O backlog completo, as decisões e as lacunas estão no [`docs/17`](17-backlog-e-pendencias.md).

## Resumo

- **Documentação:** arquitetura (docs 01–16), backlog (17) e operação (`docs/operacao/`), conferida contra o código.
- **Protótipo da interface** (`apps/web`, dados simulados): completo para validação com clientes.
- **Fase 0 de código:** pronta e testada sem contas na nuvem e sem hardware. Contrato, cálculo de OEE, banco com RLS, API real dos gateways, agente Go revisado, simulador de CLP, pacote `.deb`, receita da imagem e CI. Um teste de ponta a ponta liga tudo: simulador → agente → API → banco.
- **Bloqueios para seguir:** contas (Vercel, Neon, domínio), hardware de bancada e as decisões D2, D7, D26, D28, D29, D36, D37 e D38.

## Protótipo da interface

Telas no layout novo (menu em degradê, busca Ctrl+K, cartões com ícones, barras de rolagem ocultas), tema Claro/Escuro/Automático e cor por cliente:

- **Cliente:** visão geral, máquinas (lista e detalhe), **tela de linha**, relatórios de OEE e de paradas, notificações, ajuda, acesso remoto e minha conta.
- **Configurações:** unidades e linhas, máquinas e assistente de nova máquina (Modbus TCP, RTU e RTU sobre TCP), gateways, produtos, turnos, motivos, usuários, terminais, aparência e auditoria.
- **Chão de fábrica:** TV Andon, tela do operador e o **terminal pareado** (`/terminal`, `/terminal/parear`), separado da sessão de pessoa.
- **Console Engemase:** visão geral, clientes (lista, detalhe, novo), gateways, usuários, auditoria e acesso remoto.
- **Conferido:** todas as rotas respondem sem erro de console, sem "NaN" e sem rolagem horizontal, em desktop (1440 px) e celular (390 px). O OEE agregado soma as bases (docs/07), nunca faz média de OEEs.

## Fase 0: o que está pronto

| Entrega | Onde | O que faz | Testes |
|---|---|---|---|
| Contrato gateway ↔ nuvem v1 | `packages/contracts` | Zod 4 de `/enroll`, `/sync`, config, comandos e erros; JSON Schema; 78 fixtures compartilhadas com o Go | 243 |
| Cálculo de OEE | `packages/oee-core` | Algoritmo do docs/07 (turnos com fuso, micro-paradas, A × P × Q, agregação Σ/Σ) | 52 |
| Banco | `packages/db` | Drizzle + Postgres 18, 51 tabelas, migrações 0000–0004, RLS forçada por cliente (inclusive `organization`), FKs compostas, funções de consulta com estado (código usado/vencido, token revogado) | 92 (PGlite) |
| API dos gateways | `apps/web/lib/server/gateway`, `app/api/gateway/v1/*` | `/enroll`, `/sync` e `/config` reais: idempotência, isolamento entre clientes, ETag/304, erros do contrato, token rechecado na transação | 80 (+1 de ponta a ponta) |
| Agente do gateway | `gateway/` (Go) | Modbus TCP/RTU/RTU sobre TCP, estados e contadores, minutos, outbox SQLite, uplink com retentativas, CLI. Watchdog com checagem real (motor, gravação, leitores e prazo de parada), um leitor por linha física, marcador de token recusado. Quatro rodadas de revisão independente, todos os achados corrigidos com teste | 198 com `-race` (480 com subtestes), 2 de integração |
| Simulador de CLP | `tools/plc-sim` | Máquinas Modbus TCP com o bloco OEE padrão e cenários | 45 |
| Implantação | `deploy/gateway`, `deploy/image` | `.deb` da Fase 0 (units endurecidas, firewall, sudo do técnico, udev das 3 RS-485), imagem Debian Trixie (rpi-image-gen), gravação do eMMC com a rede do cliente | `validate.sh`: 136 checagens no pacote (com nfpm) e 72 na imagem (com o rpi-image-gen) |
| Operação | `docs/operacao/` | 6 runbooks, ficha de TI, roteiro de bancada, bloco OEE v1, `FB_OEE_ENGEMASE.st`, guia por fabricante | Mermaid, links e ST validados |
| CI | `.github/workflows/ci.yml` | Pacotes, web (typecheck, lint, build, testes), Go (gofmt, vet, `-race`, integração, build arm64) e ponta a ponta | — |

**Como rodar os testes:**

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm test:go
```

```bash
pnpm --filter web test:e2e
```

## O que falta

**Depende de contas (N1):** criar Vercel, Neon e domínio; aplicar as migrações num branch de preview; deploy com `DATABASE_URL`; PoC com 100 gateways simulados (W3). O papel de login do banco precisa ser membro de `app_user`.

**Depende de hardware:** bancada com o R1000 (roteiro em `docs/operacao/verificacao-bancada-r1000.md`), pacote de suporte ao R1000 (overlay e RTC, sem o qual as RS-485 não têm alimentação) e a primeira imagem gravada.

**Código da Fase 1 (resumo; lista completa no docs/17 e nos READMEs):**
- Web: login e permissões (Better Auth), publicador de config e gerador de códigos de ativação, troca do mock pelo banco, tarefas agendadas, alertas.
- Gateway: handlers de `tag.read`, `device.test`, `config.reload` e `agent.restart`; página local reduzida (`oee-localui`) e ajudante privilegiado (`oee-helper`); OTA mínimo.
- Pendências conhecidas da API: alerta de minuto reescrito, `409 config_outdated`, histórico de saúde.

**Limite aceito por enquanto (D38):** a RLS usa uma variável de sessão (`app.org_id`) que qualquer SQL rodando como a aplicação pode trocar. Ver `packages/db/README.md`.

## Como rodar o protótipo

```bash
pnpm install
```

```bash
pnpm dev
```

Abrir http://localhost:3000.
