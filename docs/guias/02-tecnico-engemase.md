# Guia do técnico Engemase (engenheiro de campo e suporte)

**Quem é:**

- **Engenheiro de campo:** faz a implantação e a configuração **dos clientes atribuídos a ele** (a atribuição tem prazo e é criada por um super admin). Configura unidades, linhas, máquinas, gateways, conexões com os CLPs, sinais, terminais, turnos, produtos, motivos de parada e aparência. Não mexe em usuários.
- **Suporte:** atende chamados. Para olhar um cliente, abre uma **concessão de suporte** (com motivo, número do chamado e prazo de até 4 horas), que vale na hora. Durante a concessão: lê cadastros, configuração, saúde dos gateways e painéis, e envia comandos de diagnóstico. Não muda a configuração nem mexe em usuários.

Toda entrada sua num cliente aparece para ele numa **faixa na tela** e fica na **auditoria que o cliente vê** (por exemplo: nome, "suporte Engemase", chamado e duração).

Antes de começar, leia [Entrar e minha conta](00-entrar-e-minha-conta.md). Para você a **verificação em duas etapas é obrigatória**.

## Entrar num cliente

1. Depois de entrar, em "Escolha o cliente", clique no cliente. Ou, no "Console Engemase" › "Clientes", use "Entrar como cliente".
2. A área do cliente abre com a faixa "Engemase" no alto. No menu lateral, "Configurações" reúne os cadastros.

Suporte sem concessão ativa: abra a concessão na aba "Acesso Engemase" do detalhe do cliente ("Nova concessão": motivo, chamado e prazo).

## Implantação de um cliente novo (engenheiro de campo)

Ordem recomendada, depois que o super admin criou o cliente:

1. **Unidades e linhas** ("Configurações" › "Unidades e linhas"): "Nova unidade" (nome, cidade e fuso), "Nova área" (opcional, só agrupa) e "Nova linha" (nome e um código curto, que aparece na TV e nas exportações).
2. **Turnos** ("Configurações" › "Turnos"): horário, dias e pausas de cada turno da unidade. Sem turno não há tempo planejado. Agende aqui também as **paradas planejadas** (preventiva, feriado), para que não pesem no OEE. Mudança de turno vale a partir do próximo turno; os turnos encerrados não são recalculados.
3. **Gateway** ("Configurações" › "Gateways"): cadastre o gateway da unidade e gere o **código de ativação** (vale 24 horas e uma vez só). No local, instale o gateway no quadro e ative-o com o código, seguindo os passos mostrados na tela. Ele aparece "Online" depois do primeiro contato.
4. **Máquinas** ("Configurações" › "Máquinas" › "Nova máquina"). O assistente tem cinco etapas:
   1. "Identificação": nome, código curto, tipo, unidade e linha.
   2. "Conexão": o gateway e os dados do CLP (Modbus TCP ou RTU pela RS-485). Clique em "Testar conexão".
   3. "Sinais": use "Aplicar bloco OEE padrão Engemase" sempre que possível e confira cada sinal com "Ler agora".
   4. "Regras de OEE": modo de estado, ciclo ideal, tempo para considerar parada e limite de micro-parada.
   5. "Revisão": confira e clique em "Ativar máquina". Isso gera uma nova versão de configuração para o gateway.

   Dá para "Salvar rascunho" e continuar depois. O assistente avisa quando o limite de máquinas contratadas está perto.
5. **Produtos** ("Configurações" › "Produtos"): código, nome e o ciclo ideal em cada máquina.
6. **Motivos de parada** ("Configurações" › "Motivos de parada"): no máximo 2 níveis e até 8 motivos por grupo, para o operador decidir em 2 toques. Evite "Outros". Motivo já usado não é excluído: é ocultado do operador e continua nos relatórios.
7. **TV e tablets** ("Configurações" › "Terminais (TV/tablet)"): veja [TV e terminal](06-tv-e-terminal.md).
8. **Aparência** ("Configurações" › "Aparência"): cor da marca e logotipos do cliente (para fundo claro e escuro). "Restaurar padrão Engemase" volta ao visual original.
9. **Conferência no local** (antes de concluir): forçar uma parada e uma falha e ver o estado ao vivo; conferir os contadores com um valor conhecido; desligar a internet do gateway por alguns minutos e conferir que nenhuma contagem se perdeu.
10. Peça ao super admin para "Concluir implantação" e ao admin do cliente para cadastrar a equipe.

Toda alteração de configuração fica na auditoria do cliente, com o seu nome.

## Gateway: tela de detalhe

Em "Configurações" › "Gateways", clique no gateway. No alto: último contato, configuração aplicada × publicada, CLPs conectados e fila de leituras guardadas no gateway. As abas:

| Aba | O que mostra |
|---|---|
| Conexões Modbus | Cada CLP ligado ao gateway e se está respondendo |
| Tags | Os sinais lidos de cada máquina, com "Ler agora" para teste |
| Configuração | Versões publicadas e qual está em uso no gateway. Se demorar a aplicar, "Forçar recarga da configuração". Dá para voltar a uma versão anterior |
| Comandos | Histórico de testes de conexão, leituras, recargas e reinícios. Comandos vencem se o gateway não buscar a tempo (leitura de tag: 2 minutos) |
| Saúde | Contato, fila, relógio e versão do programa |
| Acesso remoto | Pedidos e sessões de acesso remoto deste gateway |

"Reiniciar agente" reinicia o programa do gateway (não desliga o equipamento).

**Gateway offline não perde dados:** as leituras ficam guardadas no gateway e são enviadas quando a conexão volta. Os números dos turnos afetados são recalculados.

## Acesso remoto a um gateway

Para manutenção à distância (por exemplo, olhar o barramento RS-485):

1. Na aba "Acesso remoto" do gateway, clique em "Solicitar acesso".
2. Informe o motivo (o cliente decide com base nele), o número do chamado, a duração e, se a política do cliente exigir, quem acompanha na planta.
3. Acesso ao CLP é opcional e libera **um único IP e porta** de um CLP cadastrado (só Modbus TCP).
4. Clique em "Enviar pedido". O **admin do cliente aprova** (com a verificação em duas etapas), aprova com alterações ou recusa. Dentro de uma janela pré-aprovada pelo cliente, a sessão começa sem nova aprovação.
5. A sessão termina sozinha no prazo e o resumo vai para a auditoria do cliente.

Quem pede nunca aprova. Problemas para conectar: veja o roteiro [acesso remoto não conecta](../operacao/runbooks/06-acesso-remoto-nao-conecta.md).

## Atendimento de suporte

- Os chamados do cliente chegam pela fila de suporte Engemase.
- Com a concessão ativa, use as telas do cliente para investigar: "Máquinas" (estado ao vivo e linha do tempo), "Paradas", a tela do gateway (saúde, comandos) e "Auditoria".
- Resolva seguindo os roteiros de [Operação](../operacao/README.md): gateway offline, CLP sem comunicação, dados atrasados, relógio fora de sincronia, contagem divergente.
- Mudança de configuração pedida no chamado é feita pelo engenheiro de campo ou por um super admin.
