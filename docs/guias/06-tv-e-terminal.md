# Guia da TV e do terminal (tablet da máquina)

**O que é um terminal:** a TV da linha (Andon) ou o tablet da máquina. Terminal é um **aparelho, não uma pessoa**: ele entra na plataforma por um **código de pareamento**, sem e-mail nem senha. Nada de conta compartilhada do tipo "tv@empresa".

| Tipo | Onde fica | O que mostra |
|---|---|---|
| **TV Andon** | Na linha, de preferência TV de 43" ou maior (ou um mini-PC ligado à TV) | O painel da linha em tela cheia, só leitura |
| **Tablet do operador** | Na máquina | A tela do operador: classificar paradas, lançar refugo e trocar produto (veja o [guia do operador](05-operador.md)) |

Quem cadastra e pareia os terminais é a **equipe Engemase**. A empresa cliente vê a lista em "Configurações" › "Terminais (TV/tablet)".

## Parear um aparelho novo

**No aparelho (TV ou tablet):**

1. Abra o navegador e entre no endereço de terminal da plataforma (o endereço da plataforma seguido de `/terminal`).
2. Aparece "Este aparelho não está pareado". Toque em "Parear este aparelho".
3. A tela "Parear TV ou tablet" pede o código de 6 dígitos.

**Na plataforma (equipe Engemase):**

1. Abra "Configurações" › "Terminais (TV/tablet)" do cliente e clique em "Parear novo terminal".
2. Escolha o "Tipo de terminal" ("TV Andon" ou "Tablet do operador").
3. Dê um "Nome do terminal" que identifique o aparelho no chão de fábrica (ex.: TV Linha Injeção A, Tablet Injetoras 01–02).
4. Escolha a "Unidade" e o que ele mostra: as linhas da TV ou as máquinas do tablet.
5. Escolha o "Tema da tela". Para TV, o **escuro** cansa menos a vista e destaca os estados.
6. Clique em "Gerar código de pareamento".

**De volta ao aparelho:** digite o código em até **10 minutos**. O aparelho passa a abrir direto na tela da linha ou da máquina, e aparece como online na lista.

Se a Engemase não está no local, o cliente pode abrir a tela de pareamento no aparelho e passar o código pelo chamado, dizendo a unidade, a linha ou máquina e o tema.

## O que a TV mostra

O painel da linha, atualizado sozinho:

- "OEE da linha" e "Peças boas no turno".
- "Ritmo da meta": a barra mostra quanto já foi produzido, e o marcador mostra onde deveria estar para bater a meta.
- "Refugo".
- Um quadro por máquina, com a cor do estado: "Produzindo", "Parada planejada", "Aguardando motivo do operador", "Alarme ativo no CLP" (com o código da falha), "Sem comunicação". Cada quadro diz se a máquina está à frente ou atrás do ritmo.

Se o gateway ou o CLP pararem de responder, a TV avisa (por exemplo, "Gateway offline" com o último sinal). Os números voltam a atualizar quando a conexão voltar.

**Dica:** deixe o navegador da TV em tela cheia e desligue a proteção de tela e o modo de economia de energia do aparelho.

Quem tem login também pode abrir o painel da linha no computador: no detalhe da máquina ou da linha, clique em "Andon da linha".

## Cuidar dos terminais

Em "Configurações" › "Terminais (TV/tablet)" aparecem: "Online agora", "Aguardando pareamento" e "Sem contato", com o último contato e quem pareou cada aparelho.

- **Mudar o nome, o que o aparelho mostra ou o tema:** "Editar nome, escopo e tema" (equipe Engemase). O aparelho continua funcionando.
- **Código vencido antes de digitar:** gere um novo código, ou "Cancelar pareamento".
- **Aparelho perdido, roubado ou trocado:** "Revogar terminal". Ele para de mostrar dados **na hora** e volta para a tela de pareamento. Para usar de novo, gere um código novo.
- **Quem pareou saiu da empresa?** O terminal continua funcionando: ele não depende da conta de ninguém.

## Boas práticas

- O terminal roda no endereço `/terminal`, **nunca** no mesmo navegador em que uma pessoa está logada.
- Tablet: prefira **Android**. No iPad, a tela não fica acesa sozinha com o app instalado.
- O tema do terminal é dele: não muda o tema de nenhuma pessoa.
- Operadores do chão não precisam de usuário: o tablet pareado é suficiente.
