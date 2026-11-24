---
name: alterar-conteudo
description: Use quando o cliente pedir para trocar conteúdo do site — texto, preço, data, horário, cardápio, nome, telefone, endereço, foto, item de lista. Descobre de onde o conteúdo vem de verdade (painel/banco, Blob, arquivo padrão ou fixo no código), troca sem apagar o que o cliente já editou no painel e caça as cópias espalhadas (metadados, imagem de compartilhamento, artes, manual).
---

# Alterar conteúdo do cliente

É o pedido mais comum e o mais traiçoeiro: nos sites da PR Tech, **o que está salvo no painel vale mais que o
código**. Trocar só o texto padrão no código muitas vezes não muda nada no ar.

## 1. Descubra de onde o conteúdo vem

Procure o valor atual (`grep -rn "valor antigo" --exclude-dir=node_modules --exclude-dir=.next .`) e veja em
qual destes lugares ele vive:

| Onde | Exemplos nos projetos | Como muda |
|---|---|---|
| **Banco, editável no painel** | `Settings`/configurações em JSON (`src/lib/settings.ts`), tabelas de serviços, cardápio, eventos | O cliente muda no painel (passo 2) ou migração de dados protegida (passo 4) |
| **Blob da Vercel** | catálogo da Bonafé (`data/catalogo.js` é só o padrão) | Só pelo painel; o arquivo padrão vale para instalação nova |
| **Arquivo padrão** | `DEFAULT_SETTINGS`, `default-content.ts`, `content.js`, `seed.ts` | Troque o padrão **e** veja se o banco já tem uma cópia salva |
| **Fixo no código/HTML** | metadados, `ld+json`, rodapé, páginas estáticas | Troque direto (passo 3) |

## 2. Se o cliente consegue mudar pelo painel

Diga isso para quem pediu, com o caminho exato no painel (nome do menu e do botão como aparecem na tela). Só
mude por fora se pedirem mesmo assim, ou se o campo não existir no painel.

## 3. Troque e cace as cópias

O mesmo dado costuma estar em vários lugares (no Louvorzão, o "14h" estava em 4). Procure o valor antigo e
variações (com e sem acento, "14h", "14:00", "T14:00:00-03:00") em:
- metadados (`layout.tsx`, `generateMetadata`, `<meta>` de cada HTML), título e descrição;
- imagem de compartilhamento e artes geradas (`next/og`, folders, `opengraph-image`);
- `ld+json` (endereço, telefone, CNPJ, horário);
- links de WhatsApp (`wa.me/55...`) e mensagens prontas;
- `README.md`, `MANUAL-DO-CLIENTE.md` e manual dentro do app;
- imagens com o texto escrito (PNG/JPG): não dá para editar aqui — **avise** no resumo.

Datas e horas: o servidor da Vercel roda em UTC. Horário de Brasília é UTC−3 (`-03:00`); use
`America/Sao_Paulo` para mostrar.

## 4. Valor que está no banco e precisa mudar sem o painel

Escreva uma **migração de dados protegida**, que só troca se o valor ainda for o antigo (assim não apaga o que
o cliente editou depois) e que pode rodar duas vezes sem estragar nada:

```sql
-- coluna comum
UPDATE "Evento" SET "horario" = '15h' WHERE "horario" = '14h';
-- dentro de JSON
UPDATE "Settings" SET "dados" = jsonb_set("dados", '{horario}', '"15h"')
WHERE "dados"->>'horario' = '14h';
```

Pasta `prisma/migrations/<AAAAMMDDHHMMSS>_<nome-curto>/migration.sql`, com a data e hora UTC de agora
(`date -u +%Y%m%d%H%M%S`). Troque também o padrão/seed, para instalação nova já nascer certa. Siga as regras
da skill **banco-e-migracoes**.

## 5. Fotos

- Formato WebP ou JPEG, no máximo ~1600 px no lado maior e ~300 KB.
- Imagem de compartilhamento: JPEG 1200×630, endereço absoluto (`https://...`).
- Se o projeto tem `sharp`: `node -e "require('sharp')('in.jpg').resize({width:1600,withoutEnlargement:true}).webp({quality:80}).toFile('out.webp')"`.
- Não suba foto com dados pessoais de terceiros sem o cliente ter enviado.

## 6. Feche

Use a skill **publicar**. No resumo, diga onde o conteúdo vive agora e se o cliente consegue mudar sozinho da
próxima vez.
