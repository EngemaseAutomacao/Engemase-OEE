# Engemase-OEE

<!-- kit PR Tech: início (o instalador da central atualiza este trecho) -->
## Git e publicação (regra da PR Tech)

- A `main` é o único branch de produção. A Vercel publica sozinha a cada push na `main`.
- Se a sessão trabalhar em outro branch, ao concluir cada entrega faça merge na `main` e push da `main`.
  Não deixe trabalho parado em outros branches.
- **Antes de mesclar na `main`, siga a skill `publicar`** (verificações, prints no celular e no computador,
  commit no padrão da casa e conferência do deploy). Não há testes automáticos: ela é a conferência.
- Nunca publique em produção a partir de outro branch (nada de `vercel --prod` fora da `main`).
- Não apague nem altere `.claude/hooks/painel.mjs` e os hooks dele em `.claude/settings.json`: eles avisam a
  Central PR Tech (central.prtechsolutions.com.br) o que cada sessão está fazendo.
- As skills em `.claude/skills/` com o nome listado em `.claude/skills/.kit-prtech.json` vêm do kit da central:
  para mudá-las, mude na central (`kit/`) e rode o instalador de novo.

## Especialistas (regra da PR Tech)

- Cada área tem uma skill com o método do especialista: `especialista-design`, `especialista-frontend`,
  `especialista-backend`, `especialista-banco`, `especialista-seguranca`, `especialista-devops` e
  `especialista-pesquisa`. Ao trabalhar numa dessas áreas, carregue a skill dela antes de começar e siga os
  passos, mesmo quando o pedido não vier pela central.
- No fim, diga quais verificações da área você fez e o resultado de cada uma.
<!-- kit PR Tech: fim -->
