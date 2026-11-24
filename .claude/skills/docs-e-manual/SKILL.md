---
name: docs-e-manual
description: Use quando uma alteração muda o que o cliente vê no painel ou no site, ou o jeito de configurar/rodar o projeto — atualiza o README (para a PR Tech) e o manual do cliente (MANUAL-DO-CLIENTE.md ou o manual dentro do app) no mesmo commit, em português simples, com prints. Também para criar o manual de um projeto que não tem, ou gerar o PDF de entrega.
---

# Documentação e manual do cliente

São dois leitores diferentes; nunca misture.

| Arquivo | Para quem | Tom |
|---|---|---|
| `README.md` | a PR Tech e o Claude | técnico e direto: como rodar, variáveis, Vercel, decisões e armadilhas |
| `MANUAL-DO-CLIENTE.md` (ou manual dentro do app, ex.: `src/lib/manual` na Artepinus) | o dono da empresa | português simples, "você", sem termo técnico |

## Quando atualizar

- Mudou uma tela, botão, campo ou fluxo do painel → **manual**.
- Mudou variável de ambiente, script, serviço, configuração da Vercel ou armadilha nova → **README**.
- Sempre **no mesmo commit** da alteração. Atualize o que existe; não crie arquivo novo de documentação sem
  pedirem.

## Como escrever o manual

- Frases curtas, um passo por linha, numerado.
- Nome de menu e botão **exatamente** como aparece na tela, entre aspas: Clique em "Salvar".
- Troque jargão: deploy → publicar; banco de dados → onde o site guarda as informações; upload → enviar.
- Diga o que acontece depois: "O site mostra a mudança em até 1 minuto."
- Sem dados pessoais reais nos exemplos.
- Confira se não sobrou nada de outro cliente (nome, cidade, `wa.me/55...`): os manuais nasceram de cópia.

## Prints do manual

Use o `prints.mjs` da skill **publicar** (`--saida` na pasta de imagens do manual) ou o script do projeto, se
houver (Artepinus: `npm run manual:capturas` e `npm run manual:validar`). Painel com login: só tire print se
houver usuário de demonstração; nunca com dados reais de clientes.

## Projeto sem manual

Crie `MANUAL-DO-CLIENTE.md` com: Como entrar no painel · Primeiro acesso e troca de senha · uma seção por
menu do painel · Dúvidas comuns · Falar com a PR Tech. Use o manual da AM Eletrotécnica como modelo, se
estiver acessível.

## PDF para entregar

Gere a partir do Markdown com a skill de PDF disponível na sessão; capa com o nome do cliente, endereço do
painel e e-mail de login (sem senha).
