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
3. A tela "Parear TV ou tablet" pede o código de 8 dígitos.

**Na plataforma (equipe Engemase):**

1. Abra "Configurações" › "Terminais (TV/tablet)" do cliente e clique em "Parear novo terminal".
2. Escolha o "Tipo de terminal" ("TV Andon" ou "Tablet do operador").
3. Dê um "Nome do terminal" que identifique o aparelho no chão de fábrica (ex.: TV Linha Injeção A, Tablet Injetoras 01–02).
4. Escolha a "Unidade" e o que ele mostra: as linhas da TV ou as máquinas do tablet.
5. (Só na demonstração) Escolha o "Tema da tela". No sistema real a TV abre no tema escuro, que cansa menos a vista e destaca os estados, e o tablet segue o tema do aparelho.
6. Clique em "Gerar código de pareamento".

**De volta ao aparelho:** digite o código em até **10 minutos**. O código vale **uma vez só**. O aparelho passa a abrir direto na tela da linha ou da máquina, e aparece como online na lista. O pareamento vale **12 meses**; depois disso, gere um código novo.

Por segurança, o código errado várias vezes seguidas no mesmo lugar bloqueia novas tentativas por alguns minutos. O código fica guardado só de forma cifrada: se precisar ver de novo, use "Ver código de pareamento", que gera um novo (o anterior deixa de valer).

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

- **Mudar o nome ou o que o aparelho mostra:** "Editar nome, escopo e tema" (equipe Engemase). O aparelho continua funcionando e mostra o novo conteúdo na próxima atualização da tela.
- **Código vencido antes de digitar:** gere um novo código, ou "Cancelar pareamento".
- **Aparelho perdido, roubado ou trocado:** "Revogar terminal". Ele para de mostrar dados **na hora** e volta para a tela de pareamento. Para usar de novo, gere um código novo.
- **Quem pareou saiu da empresa?** O terminal continua funcionando: ele não depende da conta de ninguém.

## Boas práticas

- O terminal roda no endereço `/terminal`, **nunca** no mesmo navegador em que uma pessoa está logada.
- Tablet: prefira **Android**. No iPad, a tela não fica acesa sozinha com o app instalado.
- O tema do terminal é dele: não muda o tema de nenhuma pessoa.
- Operadores do chão não precisam de usuário: o tablet pareado é suficiente.

## Operadores do chão (lista do tablet)

Em "Configurações" › "Terminais", seção "Operadores do chão" (equipe Engemase):

- **"Novo operador":** unidade, nome (como aparece no tablet) e matrícula, se quiser. A matrícula não pode repetir na mesma unidade.
- **Editar** (lápis) muda nome e matrícula. Para mudar de unidade, cadastre de novo na unidade nova e desative o antigo.
- **Desativar:** o operador sai da lista do tablet na próxima atualização da tela. O que ele já apontou continua com o nome dele. Dá para reativar.

Com pelo menos um operador cadastrado na unidade, o tablet pergunta **"Quem está operando?"** antes do primeiro apontamento e a cada troca de turno. Sem nenhum, o tablet aponta sem pedir o nome.
