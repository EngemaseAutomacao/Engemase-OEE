#!/usr/bin/env node
// Prints do site no celular e no computador, procurando problemas.
//
//   node prints.mjs <endereço-base> [caminho ...] [--saida pasta] [--larguras 390,1280]
//
// Para cada página e largura: print da página inteira em <saida>/ (padrão .prints/), e acusa rolagem para o
// lado (com os elementos que passam da tela), erros no console, bloqueios da CSP e arquivos que não carregaram.
// Sai com código 1 se achou problema, 2 se não conseguiu rodar.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opc = (nome, padrao) => {
  const i = args.indexOf(nome);
  if (i < 0) return padrao;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const saida = resolve(opc('--saida', '.prints'));
const larguras = String(opc('--larguras', '390,1280'))
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => x > 0);
const [base, ...caminhos] = args;
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Uso: node prints.mjs <endereço-base> [caminho ...] [--saida pasta] [--larguras 390,1280]');
  process.exit(2);
}
if (!caminhos.length) caminhos.push('/');

function carregarPlaywright() {
  for (const de of [join(process.cwd(), 'x.js'), import.meta.url]) {
    try {
      return createRequire(de)('playwright');
    } catch {}
  }
  return null;
}
const pw = carregarPlaywright();
if (!pw) {
  console.error('Playwright não encontrado. Instale com: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

mkdirSync(saida, { recursive: true });
// Os prints não vão para o Git.
const ignorar = join(process.cwd(), '.gitignore');
if (saida === resolve('.prints') && existsSync(ignorar) && !/^\/?\.prints\/?$/m.test(readFileSync(ignorar, 'utf8'))) {
  appendFileSync(ignorar, '\n.prints/\n');
}

const nomeArq = (caminho, largura) =>
  `${(caminho.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'inicio').slice(0, 60)}-${largura}.png`;

const navegador = await pw.chromium.launch();
let problemas = 0;
const origem = new URL(base).origin;

for (const caminho of caminhos) {
  for (const largura of larguras) {
    const ctx = await navegador.newContext({ viewport: { width: largura, height: largura < 700 ? 844 : 800 } });
    const pagina = await ctx.newPage();
    const erros = [];
    pagina.on('console', (m) => {
      if (m.type() === 'error') erros.push(/Content Security Policy|CSP/i.test(m.text()) ? `CSP: ${m.text()}` : `console: ${m.text()}`);
    });
    pagina.on('pageerror', (e) => erros.push(`erro na página: ${e.message}`));
    pagina.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith(origem)) erros.push(`não carregou (${r.status()}): ${r.url().slice(origem.length)}`);
    });
    const url = new URL(caminho, base).toString();
    let status = 0;
    try {
      const resp = await pagina.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      status = resp?.status() ?? 0;
    } catch (e) {
      erros.push(`não abriu: ${e.message.split('\n')[0]}`);
    }
    await pagina.waitForTimeout(500);
    const lado = await pagina
      .evaluate(() => {
        const w = window.innerWidth;
        const total = document.documentElement.scrollWidth;
        if (total <= w + 1) return null;
        const fora = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > w + 1) {
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
            fora.push(`${el.tagName.toLowerCase()}${id}${cls} (até ${Math.round(r.right)} px)`);
            if (fora.length >= 3) break;
          }
        }
        return { total, fora };
      })
      .catch(() => null);
    if (lado) erros.push(`rolagem para o lado: página com ${lado.total} px numa tela de ${largura} px. Passam da tela: ${lado.fora.join(', ') || '?'}`);
    if (status >= 400) erros.push(`a página respondeu ${status}`);
    const arq = join(saida, nomeArq(caminho, largura));
    await pagina.screenshot({ path: arq, fullPage: true }).catch(() => {});
    console.log(`${erros.length ? '✗' : '✓'} ${caminho} @ ${largura}px → ${arq}`);
    for (const e of [...new Set(erros)]) console.log(`    - ${e}`);
    problemas += erros.length;
    await ctx.close();
  }
}
await navegador.close();
console.log(problemas ? `\n${problemas} problema(s) encontrado(s).` : '\nNenhum problema encontrado. Abra os prints e confira o visual.');
process.exit(problemas ? 1 : 0);
