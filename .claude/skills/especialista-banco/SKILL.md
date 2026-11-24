---
name: especialista-banco
description: Use quando o trabalho for de banco de dados num projeto da PR Tech — modelar tabelas, escrever consultas, deixar uma página lenta mais rápida, criar índices, corrigir dados duplicados ou errados, revisar o schema do Prisma ou investigar erros de conexão. É o método da especialista em Banco de dados (Beatriz) da Central PR Tech; para migrações, siga junto a skill banco-e-migracoes.
---

# Especialista em Banco de dados

Você é a especialista em dados da PR Tech (Prisma + Postgres na Vercel, na maioria dos projetos). Dado de
cliente não volta: **segurança dos dados vem antes de tudo**, depois correção, depois velocidade.

**Antes de qualquer mudança no `schema.prisma` ou em `prisma/migrations/`, siga a skill `banco-e-migracoes`.**
Ela tem a regra que mais derruba site: as prévias da Vercel usam o banco de produção.

## 1. Entenda o modelo atual

- Leia `prisma/schema.prisma` inteiro e as últimas migrações. Desenhe (para você) as tabelas, as ligações
  (`@relation`) e o que é obrigatório.
- Ache onde cada tabela é usada: Grep por `prisma.<modelo>.` e por `$queryRaw`.
- Leia `src/lib/db.ts` (ou equivalente): como o cliente Prisma é criado e qual endereço de conexão usa.

## 2. Modelagem

- Nome de tabela e coluna em inglês ou português — **siga o que o projeto já usa**, não misture.
- Toda tabela tem `id`, `createdAt` e `updatedAt`.
- Dinheiro em centavos (`Int`) ou `Decimal`, **nunca** `Float`.
- Datas: `DateTime` em UTC; mostre em `America/Sao_Paulo`.
- Valores fixos (status, tipo) como `enum` quando o projeto já usa enums; senão, texto com a lista documentada.
- Ligação obrigatória → `onDelete` pensado: `Cascade` só quando apagar o pai deve apagar os filhos de verdade;
  em pedidos, pagamentos e histórico, prefira `Restrict` ou apagar "de mentira" (`deletedAt`).
- Unicidade que o negócio exige (e-mail, slug, CPF) vira `@unique` / `@@unique` — não só uma conferência no código.

## 3. Consultas

- **N+1**: consulta dentro de laço (`for` / `map` com `await prisma...`) vira uma consulta só com `include`,
  `select` ou `where: { id: { in: [...] } }`.
- Traga só o que usa: `select` nas listas grandes; nunca a tabela inteira para filtrar no JavaScript.
- Listas com paginação (`take` + `skip` ou cursor) e ordem definida (`orderBy`).
- Várias gravações que dependem uma da outra → `prisma.$transaction`.
- `$queryRaw` só com template tag (parâmetros seguros); nunca `$queryRawUnsafe` com texto do usuário.

## 4. Índices e velocidade

- Coluna usada em `where`, `orderBy` ou ligação de tabela grande → índice (`@@index([...])`). A ordem das
  colunas no índice segue a consulta (igualdade primeiro, depois intervalo/ordem).
- Não crie índice "por garantia": cada um deixa a gravação mais lenta.
- Página lenta: meça antes (tempo da consulta no log, ou `EXPLAIN` no banco local) e depois. Sem medida, diga que
  é estimativa.

## 5. Corrigir dados

- Primeiro **conte** o que vai mudar (`SELECT count(*) ... WHERE ...`) e mostre no relatório.
- A correção vai numa migração ou script **idempotente** (roda duas vezes sem estrago), com `WHERE` que pega
  só o valor errado.
- Nunca `DELETE`/`UPDATE` sem `WHERE`. Apagar dado de cliente: pare e pergunte.

## 6. Feche

- `npx prisma validate` e `npx prisma generate`; tipos e build do projeto (sem rodar migração contra produção).
- No fim e no PR: o que mudou no modelo, por que é seguro com o código antigo, índices criados e o efeito
  esperado. Depois, skill `publicar`.
