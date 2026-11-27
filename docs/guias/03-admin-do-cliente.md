# Guia do admin do cliente

**Quem é:** a pessoa da empresa cliente responsável pela plataforma (por exemplo, o gerente de produção ou de engenharia). Vê **tudo da empresa** (todas as unidades e máquinas). Cuida de três coisas:

1. **As pessoas da empresa:** convidar, escolher papel e escopo, desativar.
2. **O acesso remoto da Engemase aos gateways:** aprovar, ajustar ou recusar cada pedido.
3. **O dia a dia:** tudo o que o supervisor faz (painéis, relatórios, classificar paradas). Veja o [guia do gestor](04-gestor-supervisor-engenheiro.md).

O resto da configuração (unidades, linhas, máquinas, gateways, turnos, produtos, motivos de parada, TV e tablets, aparência) é feito pela **equipe Engemase**. Você vê tudo isso em "Configurações", sem editar. Para pedir uma mudança, use "Abrir chamado".

Antes de começar, leia [Entrar e minha conta](00-entrar-e-minha-conta.md). A **verificação em duas etapas é opcional**, mas recomendada para o seu papel.

## Primeiro acesso

A Engemase cadastra você quando cria a empresa na plataforma. Você recebe um **convite por e-mail para definir a senha**. Depois de entrar, se quiser, ative a verificação em duas etapas em "Meu perfil" › "Senha e 2 etapas".

## Cadastrar a equipe

Menu "Configurações" › "Usuários" (ou "Adicionar usuário" nas ações rápidas do menu).

1. Clique em "Adicionar usuário".
2. Preencha o "Nome completo" e o "E-mail corporativo".
3. Escolha o **"Papel"**:

   | Papel | Para quem | O que faz |
   |---|---|---|
   | Admin do cliente | Quem cuida dos acessos (tenha **pelo menos 2**) | Tudo o que está neste guia. Sempre com a empresa inteira |
   | Engenheiro | Manutenção, automação | Painéis, relatórios e ações do chão. Vê a saúde dos gateways, as conexões com os CLPs e os sinais lidos, sem editar |
   | Supervisor | Supervisores e gerentes | Painéis, relatórios, classificar paradas, lançar refugo e trocar produto |
   | Operador | Quem aponta paradas **no próprio celular ou computador** (ex.: líder de linha) | Classificar paradas, lançar refugo e trocar produto |
   | Visualizador | Diretoria, qualidade, quem só consulta | Só leitura: painéis e relatórios |

   Operadores do chão de fábrica **não precisam de conta**: eles usam o tablet da máquina (veja [TV e terminal](06-tv-e-terminal.md)).

4. Escolha **"O que a pessoa vê (escopo)"**:
   - **"Todo o cliente"**: todas as unidades e máquinas, inclusive as criadas no futuro.
   - **"Só as unidades escolhidas"**: máquinas novas dessas unidades entram sozinhas.
   - **"Só as máquinas escolhidas"**: máquina nova **não entra sozinha**; você precisa incluí-la.

   Nenhuma unidade ou máquina marcada = nenhum acesso. Os números de linha e de unidade que a pessoa vê somam **só** o que está no escopo dela.

5. Clique em "Adicionar e enviar e-mail". A pessoa recebe o convite por e-mail para definir a senha (o link vale 72 horas) e aparece como "Aguardando definir senha" até lá. Se ela já tem conta na plataforma (por outra empresa), recebe só um aviso e entra com a senha que já usa.

Se aparecer "o e-mail não saiu", a pessoa já foi adicionada: use "Reenviar e-mail de acesso" no menu dela daqui a pouco.

Se aparecer "Limite de usuários do plano atingido", desative quem não usa mais ou fale com a Engemase para ampliar o plano.

## Mudar ou tirar um acesso

Na lista "Pessoas com acesso", abra o menu da pessoa:

| Opção | O que faz |
|---|---|
| "Alterar papel e escopo" | Muda o papel e o que a pessoa vê. Vale na hora |
| "Reenviar e-mail de acesso" | Para quem ainda não definiu a senha (o link anterior venceu ou se perdeu) |
| "Enviar redefinição de senha" | Manda um link (vale 30 minutos) para a pessoa criar uma senha nova. A senha atual continua valendo até ela trocar |
| "Reiniciar verificação em duas etapas" | Para quem trocou ou perdeu o celular do aplicativo autenticador: desliga o 2FA dela e encerra as sessões abertas. Ela entra só com a senha e pode ativar de novo em "Minha conta" |
| "Desativar acesso" | A pessoa perde o acesso **à sua empresa na hora** (se ela também tiver acesso a outra empresa, esse continua). **Nada é apagado**: apontamentos, classificações e histórico continuam |
| "Reativar acesso" | Devolve o acesso, sem novo convite |

Regras:
- O **último admin do cliente** não pode ser desativado nem rebaixado (promova outra pessoa antes).
- **Ninguém altera o próprio acesso**: na sua linha aparece "Você". Peça a outro admin.
- Tudo fica registrado em "Configurações" › "Auditoria", com quem fez, quando e o que mudou.

Use a busca e os filtros de papel e situação para achar alguém. No alto, os números mostram quantas pessoas têm acesso, convites pendentes, admins e quem tem a verificação em duas etapas ativa.

## Acompanhar o acesso da Engemase

A Engemase **sempre** pode ver os dados da sua empresa, para dar suporte, mas **tudo fica registrado**:

- Uma faixa na tela mostra quando alguém da Engemase está dentro da área da sua empresa.
- Em "Configurações" › "Usuários", o quadro "Acesso da equipe Engemase" lista quem tem acesso agora (super admin, atendimento de suporte com chamado e prazo, engenheiro de campo atribuído) e os encerrados recentemente.
- Em "Configurações" › "Auditoria" ficam todas as entradas da Engemase, com motivo e chamado, além das mudanças de configuração, usuários e terminais e dos apontamentos do chão (paradas, refugo, troca de produto). A tela mostra os últimos 90 dias; use os filtros e "Exportar CSV" (baixa o que está na tela, com os filtros aplicados). Ações da Engemase aparecem destacadas, e as feitas por chamado de suporte mostram o número do chamado.

## Aprovar o acesso remoto aos gateways

Às vezes a Engemase precisa entrar **no gateway** à distância para manutenção. **Nada abre sem a sua aprovação.**

1. O pedido chega no sino, por push e por e-mail: técnico, motivo, chamado, gateway, duração e escopo.
2. Abra "Acesso remoto" no menu. Em "Pedidos aguardando sua aprovação":
   - **"Aprovar"**: pede o código de 6 dígitos do seu aplicativo autenticador.
   - **"Aprovar com alterações"**: reduza a duração, tire o acesso ao CLP, informe o "Contato na planta" e deixe uma observação para o técnico.
   - **"Recusar"**: o pedido é encerrado.
3. Em "Sessões ativas" você acompanha o tempo restante e pode clicar em **"Encerrar agora"** a qualquer momento.
4. No fim, o resumo da sessão vai para a "Auditoria" e por e-mail.

**Hoje no sistema real:** o pedido, a aprovação (com a duração que você escolher, até o máximo da política), a recusa com motivo, o "Encerrar agora" e a política ("Com aprovação" ou "Desativado", duração máxima e inatividade) já funcionam e ficam na Auditoria. Desativar a política recusa os pedidos em aberto. A ligação da VPN no gateway, o acesso ao CLP, o contato na planta e as janelas pré-aprovadas entram com a integração do provedor de VPN.

Quem pede nunca aprova. Fora de uma sessão aprovada, nenhum gateway fica acessível pela rede. A "Política de acesso remoto" mostra as regras da sua empresa (duração máxima, acesso ao CLP, contato na planta, janelas pré-aprovadas); o modo de acesso segue o contrato com a Engemase.

## Ver a configuração e a saúde dos gateways

Em "Configurações" você consulta, sem editar:

- "Unidades e linhas", "Máquinas", "Produtos", "Turnos", "Motivos de parada", "Terminais (TV/tablet)" e "Aparência".
- "Gateways": situação de cada gateway (online, com alertas, offline), último contato e, no detalhe, as conexões com os CLPs, os sinais lidos e o histórico.

Para mudar qualquer item, use "Abrir chamado" e descreva o que precisa.
