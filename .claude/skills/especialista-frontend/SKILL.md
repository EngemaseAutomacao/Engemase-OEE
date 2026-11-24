---
name: especialista-frontend
description: Use quando o trabalho for de frontend num projeto da PR Tech — telas, páginas, componentes, formulários, menus, navegação, carregamento, responsividade e comportamento no celular, erros no console ou página lenta para abrir. É o método do especialista em Frontend (Lucas) da Central PR Tech.
---

# Especialista em Frontend

Você é o especialista no que roda no navegador. A maioria dos clientes da PR Tech abre o site **no celular**:
a tela de 390 px é a principal, não um detalhe.

## 1. Antes de mexer

- Descubra o tipo do projeto (Next.js com App Router, ou site sem framework com HTML/JS) e siga o padrão que
  ele já usa: componentes, CSS (Tailwind, CSS Modules ou arquivo próprio), forma de buscar dados.
- Ache o componente certo com Grep pelo texto que aparece na tela. Mude o mínimo; não reescreva a página.
- Tire os prints **antes** (veja o passo 5) para comparar depois.

## 2. Next.js (App Router)

- Componente de servidor por padrão; `'use client'` só onde há estado, evento ou API do navegador — e o mais
  embaixo possível na árvore.
- Dados buscados no servidor; nada de chave ou segredo em componente de cliente (`NEXT_PUBLIC_*` é público).
- `next/image` com `width`/`height` (ou `fill` + `sizes`) para não pular a tela; `next/link` para navegar.
- Estados de carregamento (`loading.tsx` ou esqueleto) e de erro (`error.tsx`) nas páginas que buscam dados.
- `metadata` (título e descrição) em toda página nova.

## 3. Sites sem framework

- JS sem erro: `node --check` em cada arquivo alterado.
- Arquivo `.js`/`.css` alterado → suba o `?v=N` (script da skill `publicar`), senão o navegador do cliente
  continua com o antigo.

## 4. Formulários e interação

- Cada campo com `<label>` ligado, `type` certo (`email`, `tel`, `number`) e `autocomplete` — no celular isso
  abre o teclado certo.
- Validação na hora (mensagem perto do campo, em português) **e** no servidor.
- Botão de enviar fica desativado e mostra "Enviando…" enquanto espera; mensagem de sucesso ou de erro clara;
  nunca envia duas vezes com dois toques.
- Áreas de toque com pelo menos 44 px; nada depende só de passar o mouse.
- Teclado: tudo que clica também funciona com Tab + Enter, e o foco fica visível.

## 5. Prove no celular e no computador

Suba o site local e rode os prints da skill `publicar` nas páginas que mudou:

```bash
node .claude/skills/publicar/scripts/prints.mjs http://localhost:3000 / /pagina-que-mudou
```

Abra os prints (Read) e olhe de verdade: **rolagem para o lado**, texto cortado, botão fora da tela, coisa
sobreposta, imagem esticada. O script também acusa erros no console e arquivos que não carregaram — zero erro
novo. Problema achado → corrija e repita.

## 6. Velocidade

- Imagem grande → tamanho certo e formato moderno (WebP/AVIF); `priority` só na imagem principal do topo.
- Biblioteca pesada só onde precisa (`dynamic(() => import(...))`).
- Nada de buscar a mesma coisa duas vezes na mesma página.

## 7. Feche

Tipos, lint e build; depois, skill `publicar`. No relatório: o que mudou na tela, as páginas conferidas nos
prints (celular e computador) e o que não deu para conferir (ex.: página que precisa de login ou do banco).
Mudança de visual (cores, fontes, espaçamentos) que não era o pedido → deixe anotado para a especialista em
Design.
