#!/usr/bin/env node
// Sobe o ?v=N dos arquivos .css/.js alterados em todos os HTML que os referenciam, para o navegador baixar a
// versão nova (sites sem framework).
//
//   node subir-versao-arquivos.mjs [arquivo ...]
//
// Sem argumentos, usa os arquivos alterados no Git (ainda não enviados e os que estão na branch atual e não
// estão na main). Só mexe em referências que já têm ?v=N.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

let alterados = process.argv.slice(2);
if (!alterados.length) {
  const linhas = [
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('diff', '--name-only', '--cached').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ...git('diff', '--name-only', 'origin/main...HEAD').split('\n'),
  ];
  alterados = linhas;
}
const nomes = [...new Set(alterados.map((x) => x.trim()).filter((x) => /\.(css|js|mjs)$/.test(x)).map((x) => basename(x)))];
if (!nomes.length) {
  console.log('Nenhum .css/.js alterado: nada para subir.');
  process.exit(0);
}

const htmls = git('ls-files', '*.html', '**/*.html')
  .split('\n')
  .filter((x) => x && !x.includes('node_modules/'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let total = 0;
for (const arq of [...new Set(htmls)]) {
  const antes = readFileSync(arq, 'utf8');
  let depois = antes;
  for (const nome of nomes) {
    depois = depois.replace(new RegExp(`((?:^|[\\/"'=\\s])${esc(nome)})\\?v=(\\d+)`, 'g'), (_, ref, n) => {
      total++;
      console.log(`  ${arq}: ${nome}?v=${n} → ?v=${Number(n) + 1}`);
      return `${ref}?v=${Number(n) + 1}`;
    });
  }
  if (depois !== antes) writeFileSync(arq, depois);
}
console.log(total ? `✓ ${total} referência(s) atualizada(s).` : `Nenhuma referência com ?v= para: ${nomes.join(', ')}.`);
