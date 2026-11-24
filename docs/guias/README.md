# Guias por papel

Guias para quem usa a plataforma Engemase OEE no dia a dia. Cada guia diz **o que a pessoa vê e o que ela faz**, passo a passo, com os nomes dos menus e botões como aparecem na tela.

> **Situação (24/11/2026):** a plataforma está em implantação, antes do piloto. As telas descritas aqui já existem. Até a ligação com as máquinas de verdade, parte delas ainda mostra **dados de demonstração**. O que ainda não funciona está marcado como **em breve**.

## Qual guia ler

| Guia | Para quem | Em uma frase |
|---|---|---|
| [Entrar e minha conta](00-entrar-e-minha-conta.md) | **Todos** | Primeiro acesso, senha, verificação em duas etapas, notificações, ajuda e chamados |
| [Super admin Engemase](01-super-admin-engemase.md) | Direção técnica da Engemase (2 a 3 pessoas) | Cria clientes, cuida da equipe Engemase, da frota de gateways e da auditoria |
| [Técnico Engemase](02-tecnico-engemase.md) | Engenheiro de campo e suporte da Engemase | Coloca máquinas e gateways para funcionar e atende chamados |
| [Admin do cliente](03-admin-do-cliente.md) | Responsável pela plataforma na empresa cliente | Cuida das pessoas da empresa e aprova o acesso remoto da Engemase |
| [Gestor, supervisor e engenheiro](04-gestor-supervisor-engenheiro.md) | Gerentes, supervisores, engenheiros e quem só consulta | Acompanha o OEE, classifica paradas e tira relatórios |
| [Operador](05-operador.md) | Operador no tablet da máquina e líder de linha | Aponta o motivo das paradas, o refugo e a troca de produto |
| [TV e terminal](06-tv-e-terminal.md) | Quem instala e cuida da TV da linha e do tablet da máquina | Pareia o aparelho e explica o que a tela mostra |

## Papéis em resumo

**Na empresa cliente** (cada pessoa vê só o que está no seu **escopo**: a empresa inteira, algumas unidades ou algumas máquinas):

| O que a pessoa pode fazer | Admin | Engenheiro | Supervisor | Operador | Visualizador |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver painéis e relatórios | sim | sim | sim | sim | sim |
| Classificar paradas, lançar refugo e trocar produto | sim | sim | sim | sim | — |
| Ver a saúde dos gateways, as conexões com os CLPs e os sinais lidos | sim | sim | — | — | — |
| Convidar pessoas, mudar papel e escopo, desativar acesso | sim | — | — | — | — |
| Aprovar o acesso remoto da Engemase a um gateway | sim | — | — | — | — |
| Cadastrar unidades, linhas, máquinas, turnos, produtos, motivos, terminais e aparência | só a Engemase | só a Engemase | só a Engemase | só a Engemase | só a Engemase |

O cliente **vê** a configuração (unidades, máquinas, turnos, produtos, motivos de parada, terminais e aparência), mas quem muda é a equipe Engemase. Para pedir uma mudança, abra um chamado (veja [Entrar e minha conta](00-entrar-e-minha-conta.md#ajuda-e-chamados)).

**Na Engemase:** super admin (todos os clientes), engenheiro de campo (só os clientes atribuídos a ele) e suporte (com uma concessão de suporte por tempo limitado). Toda entrada da Engemase num cliente aparece numa faixa na tela e fica registrada na auditoria que o cliente vê.

**TV e tablet não são pessoas:** são **terminais pareados** com um código, sem e-mail nem senha. O operador do chão de fábrica usa o tablet da máquina e não precisa de conta.

## Veja também

- [Notas de versão](../notas-de-versao.md): o que mudou em cada entrega.
- [Operação](../operacao/README.md): roteiros da equipe Engemase para instalar e resolver problemas (gateway offline, CLP sem comunicação, troca de hardware).
- [Plataforma multi-cliente](../15-multi-cliente-e-acesso.md): a regra completa de papéis e escopos (documento técnico).
