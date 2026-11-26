# Guia do operador

**Para quem:**

- **Operador do chão de fábrica:** usa o **tablet da máquina** (ou da linha). **Não precisa de conta, e-mail nem senha:** o tablet já vem pareado pela Engemase e abre direto na tela da máquina.
- **Líder de linha ou quem aponta no próprio celular ou computador:** tem conta com o papel **Operador** e entra com e-mail e senha (veja [Entrar e minha conta](00-entrar-e-minha-conta.md)). A tela é a mesma.

**Em breve:** identificação do operador no tablet (escolher o nome numa lista e, depois, crachá ou PIN).

## O que você faz

Três coisas, com botões grandes, pensados para usar com luva:

1. **Dizer por que a máquina parou** (classificar a parada).
2. **Lançar refugo** que o CLP não contou.
3. **Trocar o produto** que a máquina está fazendo.

Cada apontamento entra no OEE do turno na hora.

## A tela da máquina

No alto aparecem o nome da máquina, o estado agora (produzindo, parada, falha, parada planejada, setup, sem comunicação) e o turno.

Os quadros do turno:

| Quadro | O que mostra |
|---|---|
| "OEE do turno" | A eficiência da máquina neste turno |
| "Produção do turno" | Peças produzidas e se você está "À frente do ritmo" ou "Atrás do ritmo" da meta |
| "Refugo" | Peças descartadas no turno |
| "Produto" | O que a máquina está fazendo agora, com o código e o ciclo ideal |

Mensagens que podem aparecer:
- **"Alarme ativo no CLP"** com um código (ex.: F12): a máquina está em falha. A falha com código já chega com motivo.
- **"Sem leitura do CLP"** ou **"Gateway offline"**: a plataforma não está recebendo os dados da máquina. Avise o supervisor ou a manutenção. Nada se perde: os dados chegam quando a conexão voltar.
- **"Fora do horário de turno"**: não há turno agora.

## Classificar uma parada

1. Na lista de paradas a classificar, **toque na parada**. A mais recente aparece primeiro; a que ainda está acontecendo mostra "agora" no lugar da hora de fim.
2. Aparece "Qual foi o motivo da parada?". Escolha o **grupo** (as cores indicam a categoria: parada não planejada, paradas planejadas, setup).
3. Toque no **motivo**.
4. Pronto: aparece "Parada classificada". Errou? Toque em **"Desfazer"** logo em seguida.

Dicas:
- Paradas curtas (micro-paradas) **não pedem motivo**: elas aparecem só quando a máquina para por mais tempo que o limite combinado.
- Dá para corrigir o motivo depois, enquanto o turno estiver aberto.
- Não achou o motivo certo? Avise o supervisor: ele pede à Engemase para cadastrar.
- Quando não há nada pendente, aparece "Tudo classificado".

## Lançar refugo

Use para peças descartadas que o CLP **não contou** como refugo.

1. Toque em **"Lançar refugo"**.
2. Digite a quantidade no teclado da tela.
3. Escolha o "Tipo de defeito" (opcional, mas ajuda a qualidade a achar a causa): dimensional fora, mancha ou risco, peça incompleta, trinca ou quebra.
4. Toque em "Lançar" (o botão mostra a quantidade de peças).

## Trocar produto

1. Toque em **"Trocar produto"**.
2. Escolha em "Produtos desta máquina" ou busque pelo código ou nome.
3. Toque em "Trocar para" o produto escolhido.

A partir daí, a meta e o ritmo da máquina seguem o ciclo ideal do produto novo. Produto que não aparece na lista: avise o supervisor.

## Histórico do turno

Na parte de baixo, a lista mostra o que foi lançado neste aparelho no turno: classificações, refugos e trocas de produto. No começo do turno aparece "Nada lançado ainda".

## Tablet com várias máquinas

Se o tablet atende mais de uma máquina, ele abre em "Escolha a máquina". Toque na máquina em que vai apontar. Para mudar, toque em "Trocar de máquina".

## Problemas comuns

| O que acontece | O que fazer |
|---|---|
| O tablet mostra "Este aparelho não está pareado" | Chame o supervisor: o tablet precisa ser pareado de novo pela Engemase (veja [TV e terminal](06-tv-e-terminal.md)) |
| A tela não atualiza | Confira o Wi-Fi do tablet. Se continuar, avise o supervisor |
| Classifiquei errado | Toque em "Desfazer" na hora, ou peça ao supervisor para reclassificar |
