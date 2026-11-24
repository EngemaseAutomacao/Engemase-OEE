---
name: publicar
description: Use ao terminar qualquer alteração num projeto da PR Tech, antes de mesclar na main, e quando pedirem "publica", "sobe", "manda pro ar" ou "entrega". Verifica o projeto (tipos, lint, build), sobe o ?v= dos arquivos nos sites sem framework, tira prints no celular e no computador procurando rolagem para o lado e erros, confere migrações e documentação, faz o commit no padrão da casa, mescla na main e confere o deploy na Vercel.
---

# Publicar uma alteração

Nos projetos da PR Tech não há testes automáticos nem CI: cada push na `main` vai direto para o ar. Esta lista
é a única coisa entre a alteração e o cliente. Siga na ordem e **não pule etapa que falhou**: corrija e rode de
novo. Se algo não puder ser verificado (ex.: página que precisa do banco), diga isso no resumo final.

## 1. Descubra o tipo do projeto

- **Next.js**: `package.json` tem `next`. Pastas `src/app` ou `app`.
- **Site sem framework**: HTML na raiz ou em `public/`, funções em `api/` (Vercel) ou um `server.js`.

Leia também o `CLAUDE.md` do projeto: verificações a mais que ele pedir valem aqui (ex.: na Artepinus,
`npm run manual:validar` e a versão nova em `src/lib/versao.ts`).

## 2. Verificações

**Next.js** — rode os que existirem no `package.json`, nesta ordem:

1. `npm run typecheck` (ou `npx tsc --noEmit`)
2. `npm run lint`
3. O build **sem mexer no banco**: se o script `build`/`vercel-build` roda `prisma migrate deploy` ou o seed,
   **não rode o script**. Rode só `npx prisma generate && npx next build`. Nunca aponte a sessão para o banco
   de produção.

**Site sem framework**

1. `node --check` em cada `.js` alterado.
2. Suba o número de versão dos arquivos alterados (o `?v=N` que obriga o navegador a baixar o arquivo novo):
   `node "${CLAUDE_SKILL_DIR}/scripts/subir-versao-arquivos.mjs"` (sem argumentos ele pega os arquivos
   alterados no Git; ou passe os caminhos). Ele só mexe em referências `arquivo?v=N` que já existem.

## 3. Prints no celular e no computador

Suba o site localmente:
- Next.js: depois do build, `npx next start -p 3000` (em segundo plano).
- Sem framework: `npm run dev` se existir; senão `npx --yes serve -l 3000 <pasta-dos-html>`.

Depois rode, com as páginas que a alteração toca (e sempre a inicial):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/prints.mjs" http://localhost:3000 / /contato
```

Ele tira prints com 390 px (celular) e 1280 px (computador) em `.prints/` (fora do Git) e acusa **rolagem para
o lado**, **erros no console**, **bloqueios da CSP** e **arquivos que não carregaram**. Abra (Read) os prints
das páginas que você mudou e olhe de verdade: texto cortado, botão fora da tela, sobreposição. Problema
encontrado → corrija e repita.

Páginas que precisam do banco e não abrem sem ele: não invente banco, não use o de produção. Registre
"não conferido sem banco" no resumo.

## 4. Banco e documentação

- Mudou `prisma/schema.prisma` ou `prisma/migrations/`? Siga a skill **banco-e-migracoes** antes de seguir.
  Atenção: em vários projetos a prévia da Vercel roda as migrações **no banco de produção** assim que a branch
  é enviada.
- Mudou algo que o cliente vê no painel ou o jeito de configurar o projeto? Siga a skill **docs-e-manual** e
  atualize no mesmo commit.

## 5. Commit no padrão da casa

- Em português. Assunto no formato `Área: o que mudou` (até ~72 caracteres), ex.: `Cardápio: inclui arroz`.
- Corpo: o porquê e o que o cliente vai notar, em frases curtas.
- Última linha: `Verificado: ...` com o que rodou (ex.: `Verificado: typecheck, lint, build e prints 390/1280 de / e /contato`).

## 6. Mesclar na main (regra da PR Tech)

A `main` é o único branch de produção. Se você trabalhou em outra branch:

```bash
git push -u origin <sua-branch>
git fetch origin main
git checkout main
git pull --ff-only origin main
git merge --no-edit <sua-branch>
git push origin main
```

Se o merge der conflito: resolva, **rode as verificações de novo** e só então envie. Nunca `git push --force`
na `main`, nunca `vercel --prod`, nunca apague ou altere `.claude/hooks/painel.mjs`.

## 7. Conferir o deploy

O push na `main` publica sozinho. Confira que o deploy ficou pronto:
- Com as ferramentas da Vercel disponíveis (MCP): liste os deploys do projeto e veja o mais recente da `main`
  (`READY` = no ar). Com `ERROR`, leia o log do build, corrija e publique de novo.
- Sem elas: peça para olharem a página **Deploys** da Central PR Tech.

Se o endereço de produção abrir sem login, rode o `prints.mjs` nele também, só na página alterada.

## 8. Resumo final (para quem pediu)

Em português simples, sem termos técnicos:
- o que mudou e onde ver (link);
- o que foi conferido;
- o que **não** deu para conferir e por quê;
- se o cliente precisa fazer algo no painel.
