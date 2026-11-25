# Guia do super admin Engemase

**Quem é:** 2 a 3 pessoas da direção técnica da Engemase. Acessa **todos os clientes**, sempre com registro. Cria clientes e o primeiro admin de cada um, cuida da equipe Engemase e pode fazer toda a configuração de um cliente.

Antes de começar, leia [Entrar e minha conta](00-entrar-e-minha-conta.md). Para você a **verificação em duas etapas é obrigatória**.

## O que você vê

Depois de entrar, aparece "Escolha o cliente" com um resumo da plataforma (clientes, máquinas monitoradas, gateways com problema, clientes em implantação). Dali você abre um cliente ou o **console da plataforma**: clique no seu nome e em "Console Engemase".

Menu do console:

| Menu | Para que serve |
|---|---|
| "Visão geral" | O que precisa de atenção agora: clientes, frota de gateways, alertas e atividade recente |
| "Clientes" | Lista de clientes com status, plano, máquinas em uso × contratadas, gateways e usuários |
| "Frota de gateways" | Todos os gateways de todos os clientes: situação, versão do programa, fila de dados e relógio |
| "Acesso remoto" | Pedidos e sessões de acesso remoto aos gateways, de todos os clientes |
| "Equipe Engemase" | Pessoas da Engemase, papéis, concessões de suporte e atribuições de campo |
| "Auditoria" | Tudo o que foi feito na plataforma e nos clientes |

Ações rápidas no menu: "Novo cliente", "Provisionar gateway" e "Adicionar membro".

## Criar um cliente

1. Clique em "Novo cliente".
2. **Empresa, slug e plano:** dados da empresa, o **identificador na URL** (sai do nome; pode ser editado só agora e nunca é reaproveitado), o plano e as **máquinas contratadas** (a assinatura é cobrada por máquina). Um grupo com vários CNPJs é um único cliente com várias unidades.
3. **Primeira unidade, fuso e turnos:** a fábrica onde ficam as primeiras linhas e o gateway. O fuso vale para os turnos e os relatórios. Escolha um modelo de turnos; pausas e dias da semana se ajustam depois em "Turnos".
4. **Primeiro admin:** nome e e-mail corporativo de quem vai cuidar dos usuários na empresa. Deixe marcado "Enviar o e-mail “Definir senha” ao criar" (ou envie depois). Se a pessoa já tem conta em outro cliente, ela é vinculada sem senha nova.
5. Confira e clique em "Criar cliente". O cliente nasce no estado **Implantação**.

Os próximos passos da implantação (gateway, máquinas, sinais do CLP, TV e tablets) são feitos por você ou pelo engenheiro de campo; veja o [guia do técnico](02-tecnico-engemase.md).

## Detalhe do cliente

Em "Clientes", clique no cliente (ou em "Abrir detalhe" no menu da linha). As abas:

- "Visão geral", "Unidades", "Máquinas", "Gateways", "Usuários" e "Aparência": o cadastro do cliente.
- "Acesso Engemase": quem da Engemase tem acesso a este cliente.
  - **"Nova atribuição"**: libera um engenheiro de campo para este cliente, com motivo, unidades e prazo.
  - **Concessões de suporte**: o suporte abre a própria concessão (até 4 h, com motivo e número do chamado). Você vê e pode encerrar.
- "Ciclo de vida": estado do cliente e linha do tempo.

Para trabalhar dentro da área do cliente, use "Entrar como cliente". Uma faixa "Engemase" aparece na tela e a entrada fica na auditoria do cliente.

## Ciclo de vida do cliente

Pelo menu de cada cliente, ou na aba "Ciclo de vida". Toda mudança pede confirmação e um motivo, e fica na auditoria.

| Ação | Quando usar | O que acontece |
|---|---|---|
| "Concluir implantação" | Gateway online, máquinas com sinais conferidos e equipe treinada | O cliente passa a **Ativo** |
| "Suspender" | Inadimplência, pedido do cliente, segurança | As pessoas do cliente não entram e veem "Acesso suspenso". **Os gateways continuam enviando dados**: nada se perde |
| "Reativar" | Depois de resolver a suspensão | Tudo volta como estava: usuários, papéis e escopos |
| "Encerrar" | Fim de contrato | Começa o encerramento: exportação completa dos dados entregue ao cliente, prazo de carência, revogação de gateways e terminais e exclusão definitiva. Segue um roteiro manual da equipe e **não pode ser desfeito pela tela** |

## Equipe Engemase

Em "Equipe Engemase":

1. "Adicionar membro": nome, e-mail corporativo da Engemase e papel (**Super admin**, **Engenheiro de campo** ou **Suporte**). A pessoa recebe um convite por e-mail para definir a senha e precisa ativar a verificação em duas etapas.
2. Para cada membro: "Alterar papel", reenviar o convite, mandar um link para cadastrar um celular novo na verificação em duas etapas, desativar ou reativar.

Regras: ninguém muda o próprio papel, e o último super admin não pode ser rebaixado. Desativar alguém encerra as sessões e suspende concessões e atribuições; o histórico fica na auditoria. Membros da Engemase **não viram membros** dos clientes.

## Frota de gateways

Em "Frota de gateways":

- Filtre por cliente e situação: "Aguardando ativação", "Nunca conectou", "Agente desatualizado", "Configuração pendente", "Fila acumulada", "Relógio com desvio".
- **"Provisionar gateway"**: escolha o cliente, a unidade, o nome e o hardware e clique em "Gerar código de ativação". Entregue o código ao técnico em campo: ele vale **24 horas** e uma vez só. O gateway aparece online depois do primeiro contato.
- **Atualização do programa do gateway** ("Atualização do agente (OTA)"): mostra as versões em campo e organiza a atualização por canal, versão e seleção de gateways, em ondas. **Em breve:** a atualização remota dos gateways no campo está em preparação.

Problemas de gateway seguem os roteiros de [Operação](../operacao/README.md) (gateway offline, CLP sem comunicação, relógio fora de sincronia, troca de hardware).

## Acesso remoto

Em "Acesso remoto" você vê os pedidos e as sessões de todos os clientes e a política de cada um. Cada sessão precisa da **aprovação do admin do cliente**. Em emergência de segurança, o **"Kill switch global"** bloqueia todo acesso remoto de uma vez (pede motivo, que vai para a auditoria de todos os clientes afetados).

## Auditoria

Em "Auditoria": filtre por cliente, pessoa e tipo de ação e use "Exportar CSV". Cada evento mostra se é "Visível ao cliente" ou "Só no console". O registro só recebe inclusões: nada é apagado nem alterado.
