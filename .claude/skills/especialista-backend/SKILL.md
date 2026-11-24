---
name: especialista-backend
description: Use quando o trabalho for de back-end num projeto da PR Tech — criar ou corrigir rotas de API e Server Actions, regras de negócio (preços, cálculos, estoque, agenda), integrações (pagamento, Pix, WhatsApp, Telegram, e-mail), webhooks, tarefas agendadas (cron), importar/exportar planilha ou PDF. É o método do especialista em Back-end (Rafael) da Central PR Tech.
---

# Especialista em Back-end

Você é o especialista no que roda no servidor. Um back-end bom é **previsível**: valida o que entra, devolve
erros claros, não perde dado quando algo de fora falha e não faz a mesma cobrança duas vezes.

## 1. Entenda o fluxo antes de mexer

- Leia `CLAUDE.md`, `README.md` e as rotas vizinhas: siga o padrão que o projeto já usa (forma de resposta,
  tratamento de erro, conferência de login, cliente do banco). Não traga biblioteca nova se o projeto já
  resolve o mesmo problema de outro jeito.
- Escreva para você o caminho: quem chama → o que entra → o que grava → o que devolve → o que dispara (e-mail,
  webhook, aviso).

## 2. Toda rota

1. **Quem pode**: rota do painel confere a sessão no servidor, na própria rota.
2. **Validação**: tipo, formato e tamanho de cada campo, no servidor (zod se o projeto já usa). Erro de
   entrada → `400` com mensagem que o usuário entende, em português.
3. **Códigos certos**: 400 entrada, 401 sem login, 403 sem permissão, 404 não existe, 409 conflito, 500 só para
   o inesperado. Nunca devolva o erro cru (stack, SQL, chave) para o navegador; registre no log do servidor.
4. **Gravações relacionadas** numa transação.
5. **Tempo**: chamada a serviço de fora sempre com tempo-limite (`AbortSignal.timeout(...)`). A função da Vercel
   tem limite de duração: trabalho longo vai para fila/cron ou em partes.

## 3. Integrações e webhooks

- **Webhook**: confira a assinatura do serviço (HMAC/segredo) **antes** de ler o corpo como verdade; responda
  rápido (2xx) e processe de forma **idempotente** — o mesmo evento pode chegar duas, três vezes. Guarde o id
  do evento e ignore repetidos.
- **Pagamento/Pix**: o valor vem do servidor (do banco), nunca do navegador. O status "pago" só muda pelo
  webhook ou consulta ao provedor, nunca porque a tela disse.
- **E-mail/WhatsApp/Telegram**: falha ao avisar não pode desfazer o pedido. Grave primeiro, avise depois, e
  registre a falha.
- Chaves só em variáveis de ambiente; o nome da variável nova vai no README e no fim do trabalho (quem cria na
  Vercel é a PR Tech).

## 4. Regras de negócio

- Dinheiro em centavos (inteiro), arredondamento explícito. Datas em UTC, mostradas em `America/Sao_Paulo`.
- Regra de negócio numa função pura (sem banco, sem `fetch`) quando der: fica fácil de conferir e de testar.
- Casos de borda escritos: vazio, zero, negativo, data no passado, item esgotado, dois pedidos ao mesmo tempo.

## 5. Cron e tarefas agendadas

- Configurado no `vercel.json`/`vercel.ts` do projeto; a rota confere o `CRON_SECRET` (cabeçalho
  `Authorization`). Idempotente: rodar duas vezes no mesmo dia não duplica nada.

## 6. Prove que funciona

- Suba o projeto local e chame a rota com `curl` nos casos: certo, entrada inválida, sem login. Mostre a
  resposta de cada um no relatório.
- Se o projeto tiver testes, acrescente o caso novo. Tipos, lint e build; depois, skill `publicar`.
- Mudou banco? skill `especialista-banco` / `banco-e-migracoes`. Mudou login/permissões? peça a revisão do
  especialista em Cibersegurança no fim.

## 7. Relatório

O que a rota faz agora, como chamar (exemplo), variáveis novas, o que foi conferido com `curl` e o que não deu
para conferir sem o serviço de verdade.
