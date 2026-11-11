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

## Em andamento (análises rodando na sessão)

- **Projeto do gateway** → vai virar `docs/16-projeto-do-gateway.md`. Cobre software, rede e instalação, comissionamento local, preparação e ciclo de vida.
- **Levantamento do que falta** → auditoria da documentação, do protótipo e da implementação, com backlog priorizado.

## Pendente no protótipo

Telas ainda como "em construção":
- **Configurações:** gateways (lista e detalhe), usuários, produtos, turnos, motivos, assistente de nova máquina, auditoria, terminais e aparência.
- **Console Engemase:** todas as telas.
- **Outras:** notificações, ajuda, acesso remoto e minha conta.
- **Alinhamento visual:** as telas antigas precisam seguir o novo layout (`components/dashboard`).

Há componentes parciais em `components/config` e `components/access`, de uma rodada interrompida.

## Pendente na implementação real (Fases 0 e 1 de `docs/09`)

- Banco com RLS, login e permissões, API dos gateways e ingestão.
- Cálculo de OEE e tarefas agendadas (cron).
- Agente do gateway em Go e simulador de CLP.
- CI, ambientes na Vercel e Neon, e testes.

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
