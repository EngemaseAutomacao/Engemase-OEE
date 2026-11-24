---
name: banco-e-migracoes
description: Use antes de mexer no banco de dados de um projeto da PR Tech (Prisma + Postgres na Vercel) — criar ou mudar tabela/coluna, escrever migração, mudar o seed, carregar ou corrigir dados, ou resolver erro de conexão ("too many connections", banco travando no build). Regras para não derrubar o site no ar, já que as prévias da Vercel usam o banco de produção.
---

# Banco e migrações

## A regra que mais importa

Nos projetos da PR Tech **as prévias da Vercel usam o mesmo banco da produção**, e em vários deles o build da
prévia roda `prisma migrate deploy`. Ou seja: **só de enviar a branch, a migração já roda no banco de
produção**, enquanto o site no ar ainda está com o código antigo. Por isso toda migração precisa funcionar
**com o código antigo e com o novo**.

Antes de mexer, leia o `package.json` (scripts `build`/`vercel-build`) e o README do projeto para saber se as
migrações rodam na prévia.

## Antes de criar coluna, veja se precisa

- Texto novo que o cliente edita: nos sites da base (AM, VBG) as configurações ficam num JSON
  (`src/lib/settings.ts`) e **não precisam de migração**. Prefira isso.
- Na Doce Confeitaria as configurações são colunas: aí precisa de migração.

## Migrações seguras

- **Só acrescente**: tabela nova, coluna nova que aceita vazio (`NULL`) ou tem valor padrão, índice novo.
- **Renomear ou apagar** é em duas publicações: (1) o código para de usar a coluna e é publicado; (2) depois,
  outra migração remove. Nunca as duas juntas.
- Dados: `INSERT ... ON CONFLICT DO NOTHING`; `UPDATE ... WHERE` o valor ainda é o antigo (veja a skill
  **alterar-conteudo**). Tudo precisa poder rodar duas vezes.
- Seed: idempotente (`upsert`), nunca apaga nem duplica o que já existe — o seed também roda no build.
- Nome da pasta: `prisma/migrations/<AAAAMMDDHHMMSS>_<nome-curto>` com a hora UTC atual
  (`date -u +%Y%m%d%H%M%S`), depois da última que existe.
- Sem banco local, escreva o `migration.sql` à mão, coerente com a mudança no `schema.prisma`, e rode
  `npx prisma validate` e `npx prisma generate`.

## Nunca

- Rodar `prisma migrate dev`, `migrate reset` ou `db push` contra o banco de produção.
- Colocar a `DATABASE_URL` de produção no ambiente da sessão ou num arquivo do repositório.
- Apagar dados para "resolver" um erro de migração. Pare e pergunte.

Banco local para testar: `npm run db:local` (Artepinus) ou o comando com Docker que o README do projeto mostra.

## Conexões na Vercel

O mesmo problema ("too many connections", build travando no banco) já foi resolvido de jeitos diferentes em
cada projeto. **Não invente um jeito novo**: abra `src/lib/db.ts` (e `database-url.ts`, se existir) e siga o
que o projeto já faz. Em geral: um cliente Prisma só (guardado em `globalThis`), endereço com pool
(`pooled.db.prisma.io` ou `-pooler` no Neon), poucas conexões por função e no build.

## Horários

Guarde em UTC; mostre em `America/Sao_Paulo`. Datas fixas no código com `-03:00`.

## Feche

No corpo do commit, explique em uma frase o que a migração faz e por que é segura com o código antigo. Depois,
skill **publicar**.
