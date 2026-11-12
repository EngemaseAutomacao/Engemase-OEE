# Status do projeto e próximos passos

> Nota de passagem, atualizada em 11/11/2026, para retomar o trabalho em outra sessão ou máquina.

## Pronto

- **Arquitetura documentada** (docs 01–15): requisitos, gateway, protocolo, plataforma web, banco (Neon + Drizzle), cálculo de OEE, segurança, roadmap, ADRs 001–016, integração Modbus, acesso remoto (VPN), notificações, identidade visual e plataforma multi-cliente.
- **Protótipo da interface** em `apps/web`, com dados simulados e rodando localmente:
  - layout novo (menu em degradê, busca Ctrl+K, cartões com ícones) e barras de rolagem ocultas;
  - Visão geral no estilo da referência;
  - máquinas (lista e detalhe), relatórios de OEE e de paradas, TV Andon e tela do operador;
  - seletor de cliente, login, unidades e linhas, cadastro de máquinas;
  - marca Engemase, tema Claro/Escuro/Automático, sino de notificações e cor por cliente (exemplo: Serra Azul).

## Concluído nesta retomada

- **Projeto do gateway:** [`docs/16`](16-projeto-do-gateway.md), com as definições canônicas. Os 4 rascunhos detalhados estão em `docs/rascunhos/`.
- **Levantamento do que falta:** [`docs/17`](17-backlog-e-pendencias.md), com backlog, decisões, lacunas e próximos passos. Os relatórios completos estão em `docs/rascunhos/`.
- **18 contradições da documentação corrigidas.**
- **Fase 0, parte de código** (detalhes na seção seguinte).

## Fase 0: o que já foi entregue

A parte de código de W1, X1, W2a, W4 e G0 (`docs/17`, seção 2). Tudo roda e é testado sem contas na nuvem e sem hardware. Cada pacote tem um `README.md` com decisões e pendências próprias.

| Entrega | Onde | O que faz | Testes |
|---|---|---|---|
| Contrato gateway ↔ nuvem v1 | `packages/contracts` (`@engemase/contracts`) | Schemas Zod 4 de `/enroll`, `/sync`, config, comandos e erros; 45 regras semânticas com id; JSON Schema gerado (tolerante e estrito); 75 fixtures válidas e inválidas com `manifest.json` | 240 (Vitest) |
| Cálculo de OEE | `packages/oee-core` (`@engemase/oee-core`) | Algoritmo do docs/07 puro em TS: turnos com fuso IANA e horário de verão, estados, micro-paradas, contagens, A × P × Q, agregação de linha | 52 (Vitest + fast-check), incluindo o caso de 78,4% |
| Banco | `packages/db` (`@engemase/db`) | Schema Drizzle (Postgres 18), 51 tabelas (46 de cliente), migrações SQL, RLS forçada por cliente, FKs compostas, papéis sem BYPASSRLS, `withTenant()` | 58 (Vitest + PGlite, sem servidor) |
| Simulador de CLP | `tools/plc-sim` (Go) | N máquinas Modbus TCP com o bloco OEE padrão; cenários `normal`, `overflow`, `counter-reset`, `offline` e `frozen`; determinístico por semente | 44 (`go test -race`) |
| Agente do gateway | `gateway/` (Go) | Esqueleto funcional: Modbus TCP/RTU/RTU sobre TCP (somente leitura), motor de estados e contadores, minutos, outbox SQLite, `/enroll`, `/sync` e `/config`, CLI (`run`, `enroll`, `modbus read`, `config validate`, `diag`) | 71 + 2 de integração contra o `plc-sim` |
| Integração e CI | raiz, `.github/workflows/ci.yml` | Scripts `pnpm test`, `typecheck`, `test:go`; CI com jobs paralelos `web`, `packages` e `go` | — |

**Amarração entre as partes:**
- O gateway valida a própria config com as fixtures de `packages/contracts` (mesmo `rule` e `path` esperados) e confere tudo o que envia contra o JSON Schema estrito.
- O teste de integração do gateway compila e sobe o `plc-sim` e lê o bloco OEE pela rede.
- O `packages/db` confere que os "enums" do banco são iguais aos do contrato.

**Como rodar:** ver "Como rodar" no [README](../README.md#como-rodar). Em resumo: `pnpm test`, `pnpm typecheck:packages` e `pnpm test:go`.

## Em andamento

- **Telas pendentes do protótipo**, no layout novo.
- **`deploy/`:** units systemd, nftables e pacote `.deb` do gateway (`deploy/gateway`) e imagem do sistema (`deploy/image`).

## Pendente no protótipo

Telas ainda como "em construção":
- **Configurações:** gateways (lista e detalhe), usuários, produtos, turnos, motivos, assistente de nova máquina, auditoria, terminais e aparência.
- **Console Engemase:** todas as telas.
- **Outras:** notificações, ajuda, acesso remoto e minha conta.
- **Alinhamento visual:** as telas antigas precisam seguir o novo layout (`components/dashboard`).

Há componentes parciais em `components/config` e `components/access`, de uma rodada interrompida.

## Pendente na implementação real (Fases 0 e 1 de `docs/09`)

**Fase 0, o que ainda falta:**
- Contas e ambientes (N1): Vercel, Neon, domínio. Depois, `db:migrate` na Neon e confirmar se o papel dono das tabelas tem BYPASSRLS.
- API mínima `/enroll` e `/sync` gravando na Neon (W3) e o teste do driver de banco com 100 gateways simulados.
- Ligar os pacotes ao `apps/web` (`transpilePackages`); o assistente de máquina ainda oferece 7 bits de dados e não tem `modbus-rtu-over-tcp`.
- PoC na bancada com o R1000 e CLPs reais (depende do hardware).
- Turborepo e lint/format comuns ao monorepo (hoje: scripts `pnpm -r` na raiz).
- `docs/04` e `docs/06` desatualizados em relação ao contrato e ao banco: `type` em `command_results`, `expires_at`/`issued_at` nos comandos, unit id 0–255 em TCP, `ack_samples_seq`, lista de eventos e de erros, e as seis tabelas novas.

**Fase 1:**
- Login e permissões (Better Auth), API completa dos gateways, ingestão e tarefas agendadas (cron).
- Gateway: handlers de `tag.read`, `device.test`, `config.reload` e `agent.restart`; API local por socket; aplicação de config por diferença com volta automática; retenção da outbox; `.deb` e OTA. A lista completa está no README do `gateway/`.
- Particionamento e retenção de `production_minute` e `tag_sample` (W2b).

## Fora do código

- Comprar o hardware de bancada.
- Criar as contas (Vercel, Neon, domínio, e-mail).
- Fazer a cotação e consultar o despachante sobre importação e ANATEL.
- Responder as decisões pendentes (`docs/15`, seção 10, e `docs/01`).

## Como rodar o protótipo

```bash
pnpm install
```

```bash
pnpm dev
```

Abrir http://localhost:3000.
