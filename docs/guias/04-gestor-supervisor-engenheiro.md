# Guia do gestor, supervisor e engenheiro

**Para quem:** gerentes, supervisores, engenheiros e quem só consulta (visualizador). Todos veem os painéis e relatórios **do seu escopo** (a empresa inteira, algumas unidades ou algumas máquinas, conforme o admin da sua empresa definiu).

| Papel | Além de ver painéis e relatórios |
|---|---|
| Supervisor | Classifica paradas, lança refugo e troca de produto |
| Engenheiro | O mesmo do supervisor, e vê a saúde dos gateways, as conexões com os CLPs e os sinais lidos (sem editar) |
| Visualizador | Nada além: só consulta |

Antes de começar, leia [Entrar e minha conta](00-entrar-e-minha-conta.md).

## OEE em 1 minuto

**OEE = Disponibilidade × Performance × Qualidade.** Nas telas aparece como **D · P · Q**.

- **Disponibilidade:** quanto do tempo planejado a máquina ficou rodando. Cai com paradas não planejadas e setups.
- **Performance:** se rodou no ritmo ideal. Cai com ritmo lento e **micro-paradas** (paradas curtas, que não pedem motivo).
- **Qualidade:** quanto do que foi produzido saiu bom. Cai com o refugo.

O tempo planejado vem dos **turnos**. Paradas planejadas agendadas (preventiva, feriado) não pesam no OEE. O OEE de uma linha ou unidade é calculado somando o tempo e as peças das máquinas, não pela média dos percentuais.

## Visão geral

É a primeira tela depois de entrar. Mostra o **turno atual**:

- "OEE do turno", "Peças boas", "Máquinas produzindo" e "Meta de OEE".
- **"Paradas para classificar"**: paradas sem motivo. Clique em "Classificar" (veja abaixo).
- "Linha do tempo do turno": os principais acontecimentos de hoje.
- "Máquinas por estado", "Tempo do turno", "Previsão de produção" (quanto falta para a meta do turno), "Desempenho das máquinas" e "Meta de OEE do mês".

Use o seletor de unidade, no alto, para ver uma unidade só.

As cores dos estados são as mesmas em todas as telas: produzindo, parada, falha (alarme do CLP), parada planejada, setup e sem comunicação.

## Máquinas

Menu "Máquinas": todas as máquinas com o estado ao vivo, as contagens e o OEE do turno.

- Busque por nome, código ou produto; filtre por unidade, linha e estado; escolha ver em "Grade" ou "Tabela".
- Clique no nome da linha para abrir a **tela da linha**: OEE da linha, peças boas, a máquina que mais perde, tempo por estado, produção por hora contra a meta e os principais motivos de parada.
- Clique na máquina para abrir o **detalhe**:
  - estado agora, produto, contagens e OEE do turno (D · P · Q);
  - "Linha do tempo do turno": cada período rodando, parado, em falha;
  - "Produção por hora": peças boas e refugo contra a meta da hora;
  - "Paradas do turno": a lista de paradas, com o motivo;
  - "Tendência de OEE · 30 dias" e o histórico por turno.

**Dados atrasados:** se o gateway ficar sem internet, a tela avisa até que horas os números valem. Nada se perde: as leituras ficam guardadas no gateway, chegam quando a conexão volta, e o turno é recalculado.

## Classificar uma parada

(Supervisor, engenheiro e admin. O operador faz o mesmo no tablet: veja o [guia do operador](05-operador.md).)

1. Na "Visão geral", em "Paradas para classificar", clique em "Classificar". Ou, no detalhe da máquina, em "Paradas do turno", clique na parada.
2. Busque e escolha o **motivo**. Se quiser, escreva uma "Observação" (ex.: aguardando empilhadeira com resina).
3. Confirme. O OEE é recalculado na hora.

- Errou? Use "Reclassificar parada".
- Paradas menores que o limite de micro-parada não pedem motivo (contam na performance).
- Falhas que o CLP informa com código já chegam com o motivo.
- Não achou o motivo? Peça à Engemase pelo "Abrir chamado" para cadastrar.

Refugo e troca de produto são lançados na **tela do operador**: abra a máquina e clique em "Tela do operador", no alto da página (veja o [guia do operador](05-operador.md)).

## Relatórios

### "Relatório de OEE"

1. Escolha o "Período", a "Unidade", a "Linha", a "Máquina" e o "Turno".
2. Veja:
   - "Tendência do OEE": OEE por dia e seus componentes, com a meta de classe mundial;
   - "Cascata de perdas": para onde foi o tempo planejado, em horas-máquina;
   - "Ranking de máquinas por OEE": da melhor para a pior;
   - o detalhamento por "Dia", "Turno" ou "Máquina" ("Agrupar por").
3. "Exportar" baixa os dados com os filtros atuais em CSV ou Excel.

### "Paradas"

1. Escolha o período, a unidade, a linha, a máquina e a categoria (Não planejada, Planejada, Setup).
2. Veja o "Tempo parado por categoria" (clique numa categoria para filtrar), o "Pareto de motivos" e a tabela "Motivos de parada", ordenada pelo tempo parado.
3. "Exportar" baixa em CSV ou Excel.

**Por que o OEE de um turno fechado muda?** Ao fim de cada turno a plataforma fecha os números. Se depois chegarem dados atrasados (o gateway ficou sem internet) ou alguém reclassificar uma parada, o turno é recalculado e os relatórios se atualizam.

## Notificações

O sino avisa falha de máquina, máquina parada sem motivo, gateway offline e outros alertas, **só das máquinas que você pode ver**. Em "Notificações" você reconhece um alerta (os outros veem que você está cuidando). Para receber no celular e escolher o que receber, veja [Entrar e minha conta](00-entrar-e-minha-conta.md#notificações).

## Engenheiro: saúde dos gateways e dos CLPs

Em "Configurações" › "Gateways", veja de cada gateway: situação, último contato, fila de leituras guardadas, conexões com os CLPs e os sinais lidos. Você consulta, sem editar; mudanças e testes de leitura pela plataforma são feitos pela equipe Engemase. Para pedir, use "Abrir chamado" com o nome da máquina ou do gateway.

## Consultar a configuração

Em "Configurações" todos podem consultar, sem editar, o que está no seu escopo: unidades e linhas, máquinas, produtos (com o ciclo ideal), turnos e paradas planejadas, e motivos de parada.
