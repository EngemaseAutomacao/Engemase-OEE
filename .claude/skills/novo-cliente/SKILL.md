---
name: novo-cliente
description: Use para começar o site ou sistema de um cliente novo da PR Tech a partir da base (o site mais recente, hoje o Grupo VBG), ou para trocar a marca de um projeto copiado. Passo a passo da troca de marca e nicho, padrão PR Tech (crédito, privacidade, "Em breve", hook da central), configuração da Vercel e, no fim, a caça às sobras do cliente anterior.
---

# Cliente novo a partir da base

A versão completa deste passo a passo é o `docs/base-de-sites.md` do repositório `prtechsolutions-site`. Se ele
estiver acessível, leia antes; o resumo abaixo basta para trabalhar.

## 0. Antes de começar

Confirme com quem pediu: nome da empresa, nicho, cidade, WhatsApp, e-mail, CNPJ, Instagram, cores e logo (ou
"usar provisório"), e quais partes vão (Trabalhe conosco, área do cliente).

Grave esses dados em `.prtech/cliente.json` na raiz do projeto (ver o passo 1.1).

A base é o site mais recente (hoje **Grupo VBG**, `prtechsolutionsadm/grupo-VBG`). Para copiar, esta sessão
precisa conseguir ler esse repositório; se não conseguir, peça para adicioná-lo à sessão. Copie **sem o `.git`**.

## 1. Nomes internos

`package.json` (`name`), cookies (`xx_sessao`, `xx_cliente` — prefixo do cliente novo), `format` do backup,
nome do banco no `.env.example` e no comando do Docker, comentários do `schema.prisma`.

## 1.1. Dados do cliente para o painel da PR Tech

Crie `.prtech/cliente.json` (ou atualize, numa cópia: os dados são do cliente **novo**). A Central lê este
arquivo e o painel da PR Tech cadastra o cliente sozinho, com rascunho de orçamento e o plano mensal padrão.
Deixe vazio ("") o que não souber; dá para completar depois, no arquivo ou no painel.

```json
{
  "empresa": "Nome da empresa como vai no contrato",
  "representante": "Nome de quem assina pela empresa",
  "documento": "CNPJ (ou CPF)",
  "whatsapp": "(49) 99999-9999",
  "email": "contato@empresa.com.br",
  "endereco": "Rua, número, bairro",
  "cidade": "Caçador/SC",
  "tipoProjeto": "institucional"
}
```

`tipoProjeto`: `landing`, `institucional`, `loja`, `sistema` ou `melhoria`. O repositório do cliente deve ser
**privado** (o arquivo tem dados do cliente). O painel só preenche campos vazios: o que for digitado lá não é
trocado por este arquivo.

## 2. Marca

Cores e fontes em `src/app/globals.css` (`@theme`) e `layout.tsx`; logo em `public/`, `src/app/icon.*`,
`apple-icon.png`, `public/og.png` (1200×630). Depois de trocar as cores, confira os avisos e barras amarelas
(no VBG a barra de prévia ficou ilegível).

## 3. Nicho

Textos padrão (`src/lib/settings.ts`, `DEFAULT_SETTINGS`), conteúdo inicial (`prisma/seed.ts`), ícones
(`src/components/Icon.tsx`) e rótulos ("Obras" → "Trabalhos", "Cardápio"...). O modelo no banco continua o
mesmo; mude só os textos.

## 4. Layout

Seções da página inicial (`src/components/site/sections.tsx`), `Header`, `Footer`, `ComingSoon`. O que o
cliente não usa desliga pelo painel, sem apagar código.

## 5. Padrão PR Tech (não tirar)

- Crédito "Desenvolvido por PR Tech Solutions" no rodapé e na página "Em breve".
- Política de privacidade (LGPD) e cabeçalhos de segurança do `next.config.ts`.
- Modo "Em breve" ligado até o cliente aprovar.
- `CLAUDE.md`, hook da central e skills: rode o instalador da Central PR Tech na pasta do projeto
  (`curl -fsSL https://central.prtechsolutions.com.br/api/instalador | node --input-type=module - .`).

## 6. Caça às sobras do cliente anterior (obrigatório)

Liste tudo o que identifica o cliente de onde veio a cópia e procure no projeto inteiro, inclusive README e
manual:

```bash
grep -rniE "nome-antigo|cidade-antiga|ddd-e-telefone|cnpj-antigo|dominio-antigo|instagram-antigo|prefixo_cookie" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .
```

Inclua as variações (com e sem acento, sigla, `wa.me/55DD...`). Na cópia AM → VBG sobraram "Curitiba", o
WhatsApp com DDD 41 no manual e o cookie `am_session`. Só termine com a busca vazia.

## 7. Conferir e publicar

`npm run typecheck`, `npm run lint`, build e prints (skill **publicar**).

## 8. Vercel (quem tem acesso faz; a sessão orienta)

- Importar o repositório; Node 24.x; build Standard; "On-Demand Concurrent Builds" desligado.
- Storage: Prisma Postgres, Blob **público** (fotos, `BLOB_READ_WRITE_TOKEN`) e Blob **privado** (arquivos de
  clientes, `BLOB_STORE_ID`). Não ativar OIDC no Blob público.
- Variáveis (segredos como **Sensitive**): `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`,
  `NEXT_PUBLIC_SITE_URL`; opcionais do Resend. Depois de mudar variável: **Redeploy**.
- Domínio no CNPJ do cliente (registro.br), DNS apontando para a Vercel.

## 9. Entrega

Manual do cliente (skill **docs-e-manual**) em PDF, senha inicial trocada pelo cliente, primeiro backup baixado,
cliente e domínio no painel da PR Tech (entram sozinhos pela Central; confira os dados e o orçamento).
