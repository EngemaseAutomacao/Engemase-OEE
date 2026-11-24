#!/usr/bin/env node
// Hook da Central PR Tech: manda um resumo de cada evento do Claude Code para a central e, quando a central
// responde, leva a resposta de volta para a sessão. Roda no PC e nas sessões da nuvem. Nunca trava nem atrapalha
// o Claude: sem configuração, sem rede ou com erro, sai em silêncio (código 0) sem escrever nada.
//
// Três jeitos de rodar (o .claude/settings.json que o instalador grava já chama cada um no evento certo):
//   node painel.mjs              eventos comuns (async): só avisa a central.
//   node painel.mjs              no PermissionRequest (síncrono): avisa e, se alguém estiver olhando a central,
//                                espera a resposta (permitir, recusar, responder a pergunta) por até 5 min. O
//                                diálogo do terminal continua valendo; sem resposta da central, vale o terminal.
//   node painel.mjs --escutar    no Stop (async + asyncRewake): depois que o Claude termina, fica ouvindo a central
//                                por um tempo; uma mensagem digitada lá acorda o Claude com ela.
//   node painel.mjs --statusline [-- <comando>]
//                                linha de status: manda à central o uso do plano (5 h e semanal) e mostra a linha de
//                                status que você já usava (o comando depois de `--` ou o do ~/.claude/settings.json).
//   node painel.mjs --testar     testa a conexão com a central (rode na pasta do projeto).
//   node painel.mjs --uso        no PC: lê o uso do plano com o login do Claude Code e manda à central.
//   node painel.mjs --agendar-uso [min]
//                                no PC: agenda o --uso a cada N min (padrão 15), para o uso ficar em dia mesmo
//                                trabalhando só pela nuvem. --desagendar-uso tira a tarefa.
//   no SessionStart (síncrono, curto): recebe as tarefas do quadro do projeto e as põe no contexto do agente.
//
// O mesmo arquivo serve ao Codex: `instalar-hook --codex` grava uma cópia em ~/.codex com o provedor marcado.
//
// PAINEL_CONVERSA=0 manda só o começo dos prompts e respostas (sem a vista "Conversa" completa na central).
// PAINEL_DIFF=0 (ou PAINEL_CONVERSA=0) não manda o conteúdo das edições: a vista "Mudanças" mostra só arquivo e linhas.
//
// Configuração (a primeira que existir):
//   1. variáveis PAINEL_URL e PAINEL_TOKEN (na nuvem: nas variáveis do ambiente)
//   2. arquivo ~/.painel-agentes.json  {"url": "...", "token": "..."}  (nos PCs)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Versão do hook: a central avisa os projetos com um hook mais antigo que o atual. */
export const VERSAO = 9;
/** Codex: o instalador grava uma cópia deste arquivo com `globalThis.__PROVEDOR__ = 'codex'` na primeira linha. */
export const PROVEDOR = globalThis.__PROVEDOR__ === 'codex' ? 'codex' : 'claude';
/** Tamanho de prompts e respostas mandados (a vista "Conversa" usa o texto inteiro até aqui). */
const TEXTO_MAX = process.env.PAINEL_CONVERSA === '0' ? 300 : 4000;

function config() {
  if (process.env.PAINEL_URL) return { url: process.env.PAINEL_URL, token: process.env.PAINEL_TOKEN };
  try {
    const c = JSON.parse(readFileSync(join(homedir(), '.painel-agentes.json'), 'utf8'));
    if (c && c.url) return { url: c.url, token: c.token };
  } catch {}
  return null;
}

function lerEntrada() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A pasta do projeto do evento. Normalmente é a do projeto da sessão (CLAUDE_PROJECT_DIR). Numa sessão com vários
 * repositórios (a tarefa coringa da central), ela começa na pasta que reúne os repositórios, que não é um repositório:
 * aí vale o repositório em que o agente está agora (h.cwd, ou uma pasta acima dele). Enquanto ele não entrou em nenhum,
 * devolve null e o evento não vai (senão a central mostraria um projeto com o nome da pasta de cima).
 */
export function pastaDoProjeto(h, env = process.env, existe = existsSync, listar = readdirSync) {
  const proj = env.CLAUDE_PROJECT_DIR;
  const ehRepo = (d) => !!d && existe(join(d, '.git'));
  if (!proj || ehRepo(proj)) return proj || h.cwd || process.cwd();
  const raiz = resolve(proj);
  let d = h.cwd ? resolve(h.cwd) : null;
  while (d && d.startsWith(raiz) && d !== raiz) {
    if (ehRepo(d)) return d;
    d = dirname(d);
  }
  // A pasta do projeto não é um repositório: se ela reúne repositórios, espera o agente entrar num; senão, vale ela.
  let reune = false;
  try {
    reune = listar(raiz).some((x) => ehRepo(join(raiz, x)));
  } catch {}
  return reune ? null : proj;
}

function git(dir) {
  const out = {};
  try {
    const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    out.branch = m ? m[1] : head.slice(0, 8);
  } catch {}
  try {
    const cfg = readFileSync(join(dir, '.git', 'config'), 'utf8');
    const bloco = cfg.split(/\n(?=\[)/).find((b) => b.startsWith('[remote "origin"]'));
    const url = bloco && bloco.match(/^\s*url\s*=\s*(.+)$/m);
    if (url) out.repo = url[1].trim().replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop();
  } catch {}
  return out;
}

export const curto = (s, n = 160) => {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const corta = (s, n) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : undefined);
const linhas = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);

function dentro(p, dir) {
  if (typeof p !== 'string') return false;
  if (!isAbsolute(p)) return !p.split(/[\\/]/).includes('..');
  if (!dir) return false;
  const r = relative(dir, p);
  return !!r && !r.startsWith('..') && !isAbsolute(r);
}

/** Arquivos que podem ter senhas ou chaves: deles a central nunca recebe o conteúdo, só o nome. */
const SENSIVEL = /(^|\/)(\.env(\..*)?|\.envrc|\.dev\.vars|.*\.(pem|key|p12|pfx|keystore|jks|tfvars)|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.npmrc|\.netrc|\.pypirc|\.pgpass|\.git-credentials|\.?credentials(\.json)?|secrets?(\.[a-z]+)?|\.painel-agentes\.json)$/i;
/** Sem conteúdo do arquivo para a central: desligado pelo ambiente (PAINEL_DIFF=0 / PAINEL_CONVERSA=0) ou arquivo sensível. */
export const semConteudo = (arq, env = process.env) => env.PAINEL_DIFF === '0' || env.PAINEL_CONVERSA === '0' || SENSIVEL.test(arq);
/** Tamanho de cada trecho de edição mandado (antes e depois). */
const TRECHO_MAX = 1500;

/**
 * O que uma edição mudou (Edit, MultiEdit, Write, NotebookEdit), para a vista "Mudanças" da central: o arquivo, as
 * linhas e os trechos antes/depois (cortados). Sem conteúdo com PAINEL_DIFF=0 ou em arquivos sensíveis.
 */
export function mudanca(h, dir, env = process.env) {
  const i = h.tool_input || {};
  const caminho = i.file_path || i.notebook_path;
  if (typeof caminho !== 'string') return undefined;
  const arq = dentro(caminho, dir) ? arquivo(caminho, dir) : String(caminho).replace(/\\/g, '/');
  const oculto = semConteudo(arq, env);
  const r = h.tool_response && typeof h.tool_response === 'object' ? h.tool_response : {};
  let trechos = [];
  let tipo = 'editar';
  if (h.tool_name === 'Edit') trechos = [{ antes: i.old_string, depois: i.new_string }];
  else if (h.tool_name === 'MultiEdit' && Array.isArray(i.edits)) trechos = i.edits.map((e) => ({ antes: e && e.old_string, depois: e && e.new_string }));
  else if (h.tool_name === 'Write') {
    tipo = r.type === 'update' ? 'reescrever' : 'criar';
    trechos = [{ antes: '', depois: i.content }];
  } else if (h.tool_name === 'NotebookEdit') {
    trechos = [{ antes: '', depois: i.new_source }];
  } else return undefined;
  const mais = trechos.reduce((a, t) => a + linhas(t.depois), 0);
  const menos = trechos.reduce((a, t) => a + linhas(t.antes), 0);
  const m = { arquivo: arq, tipo, linhas: { mais, menos } };
  if (oculto) m.oculto = true;
  else
    m.trechos = trechos.slice(0, 8).map((t) => ({
      antes: corta(typeof t.antes === 'string' ? t.antes : '', TRECHO_MAX) || '',
      depois: corta(typeof t.depois === 'string' ? t.depois : '', TRECHO_MAX) || '',
    }));
  return m;
}

function arquivo(p, dir) {
  if (typeof p !== 'string') return '';
  const r = isAbsolute(p) && dir ? relative(dir, p) : p;
  return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : basename(p);
}

export function resumo(ferramenta, input, dir) {
  const i = input || {};
  switch (ferramenta) {
    case 'Read':
      return `Lendo ${arquivo(i.file_path, dir)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editando ${arquivo(i.file_path, dir)}`;
    case 'Write':
      return `Escrevendo ${arquivo(i.file_path, dir)}`;
    case 'NotebookEdit':
      return `Editando ${arquivo(i.notebook_path, dir)}`;
    case 'Bash':
      return `${i.run_in_background ? 'Em segundo plano' : 'Rodando'}: ${curto(i.description || i.command, 120)}`;
    case 'Grep':
      return `Procurando "${curto(i.pattern, 60)}"`;
    case 'Glob':
      return `Procurando arquivos ${curto(i.pattern, 60)}`;
    case 'WebFetch':
      try {
        return `Abrindo ${new URL(i.url).host}`;
      } catch {
        return 'Abrindo página';
      }
    case 'WebSearch':
      return `Pesquisando "${curto(i.query, 80)}"`;
    case 'Task':
    case 'Agent':
      return `Subagente: ${curto(i.description || i.subagent_type || 'tarefa', 100)}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Atualizando a lista de tarefas';
    case 'AskUserQuestion':
      return 'Fazendo uma pergunta';
    case 'ExitPlanMode':
      return 'Apresentando o plano';
    default:
      if (ferramenta && ferramenta.startsWith('mcp__')) {
        const [, srv, tool] = ferramenta.split('__');
        return `Usando ${srv}: ${tool || ''}`.trim();
      }
      return `Usando ${ferramenta || 'ferramenta'}`;
  }
}

const STATUS = { pending: 'pendente', in_progress: 'andamento', completed: 'feita', deleted: 'feita' };

/** Rótulo legível de uma regra "sempre permitir" sugerida pelo Claude Code. */
export function rotuloSugestao(s) {
  if (!s || typeof s !== 'object') return 'Sugestão';
  const onde = { session: 'nesta sessão', localSettings: 'neste projeto (só você)', projectSettings: 'neste projeto', userSettings: 'em todos os projetos' }[s.destination] || '';
  if (s.type === 'addRules' && Array.isArray(s.rules)) {
    const r = s.rules.map((x) => (x.ruleContent ? `${x.toolName}(${x.ruleContent})` : x.toolName)).join(', ');
    return `Não perguntar de novo: ${r} ${onde}`.trim();
  }
  if (s.type === 'setMode') return `Mudar para o modo ${s.mode} ${onde}`.trim();
  if (s.type === 'addDirectories') return `Liberar ${(s.directories || []).join(', ')} ${onde}`.trim();
  return `${s.type} ${onde}`.trim();
}

/**
 * O que o pedido de permissão quer fazer, para mostrar na central. De arquivos sensíveis (ou com PAINEL_DIFF=0), vai
 * só o caminho: o conteúdo que seria escrito nunca sai do computador.
 */
export function pedido(h, dir, env = process.env) {
  const i = h.tool_input || {};
  const p = {};
  if (h.tool_name === 'Bash') p.alvo = corta(i.command, 600);
  // Fora do projeto vai o caminho inteiro: assim uma regra "*.json" não libera ~/.claude/settings.json.
  else if (i.file_path) p.alvo = dentro(i.file_path, dir) ? arquivo(i.file_path, dir) : String(i.file_path).replace(/\\/g, '/');
  else if (i.url) p.alvo = corta(i.url, 300);
  else if (i.plan) p.alvo = corta(i.plan, 600);
  const caminho = i.file_path || i.notebook_path;
  const oculto = typeof caminho === 'string' && semConteudo(dentro(caminho, dir) ? arquivo(caminho, dir) : String(caminho).replace(/\\/g, '/'), env);
  if (oculto) p.oculto = true;
  else if (h.tool_name === 'Edit') {
    p.antes = corta(i.old_string, 1500);
    p.depois = corta(i.new_string, 1500);
  } else if (h.tool_name === 'Write') p.depois = corta(i.content, 1500);
  if (Array.isArray(h.permission_suggestions) && h.permission_suggestions.length) {
    p.sugestoes = h.permission_suggestions.slice(0, 4).map(rotuloSugestao);
  }
  if (h.tool_name === 'AskUserQuestion' && Array.isArray(i.questions)) {
    p.perguntas = i.questions.slice(0, 6).map((q) => ({
      pergunta: String(q.question ?? ''),
      titulo: q.header,
      multipla: q.multiSelect === true,
      opcoes: (Array.isArray(q.options) ? q.options : []).map((o) => ({ rotulo: String(o.label ?? ''), descricao: o.description })),
    }));
  }
  return p;
}

/**
 * Transcripts dos subagentes (ferramenta Agent/Task) da sessão: o Claude Code grava cada um à parte, em
 * `<id-da-sessão>/subagents/agent-*.jsonl`, ao lado do transcript principal. Sem eles, uma sessão que divide o
 * trabalho em subagentes parece bem mais barata do que é.
 */
export function transcriptsSubagentes(caminho) {
  try {
    const pasta = join(dirname(caminho), basename(caminho).replace(/\.jsonl$/, ''), 'subagents');
    return readdirSync(pasta)
      .filter((f) => /^agent-.*\.jsonl$/.test(f))
      .map((f) => join(pasta, f));
  } catch {
    return [];
  }
}

/**
 * Tokens somados do transcript da sessão e dos subagentes dela (cada mensagem uma vez) e o modelo da última resposta
 * da sessão principal. `subagentes` é a parte que veio deles (já incluída em `tokens`).
 */
export function tokens(caminho) {
  if (!caminho) return {};
  const vistos = new Set();
  const somar = (arquivo, t) => {
    let modelo;
    try {
      if (statSync(arquivo).size > 60 * 1024 * 1024) return undefined;
      for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
        if (!linha.includes('"usage"')) continue;
        let o;
        try {
          o = JSON.parse(linha);
        } catch {
          continue;
        }
        const m = o && o.message;
        if (!m || !m.usage) continue;
        const id = m.id || o.uuid;
        if (vistos.has(id)) continue;
        vistos.add(id);
        t.entrada += m.usage.input_tokens || 0;
        t.saida += m.usage.output_tokens || 0;
        t.cacheLeitura += m.usage.cache_read_input_tokens || 0;
        t.cacheEscrita += m.usage.cache_creation_input_tokens || 0;
        if (m.model) modelo = m.model;
      }
    } catch {}
    return modelo;
  };
  const zero = () => ({ entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });
  const t = zero();
  const modelo = somar(caminho, t);
  if (!vistos.size) return {};
  const sub = zero();
  const arquivos = transcriptsSubagentes(caminho);
  for (const f of arquivos) somar(f, sub);
  for (const k of Object.keys(t)) t[k] += sub[k];
  return { tokens: t, modelo, ...(arquivos.length ? { subagentes: { quantos: arquivos.length, tokens: sub } } : {}) };
}

/**
 * CI: o resultado de `gh pr checks`, `gh run watch` ou `gh run view` que o agente rodou. Falha = sirene na sala até um
 * CI verde (ou 10 min); sucesso depois de uma falha = festa.
 */
export function marcoCI(comando, saida) {
  if (!/\bgh\s+(pr\s+checks|run\s+(watch|view)|workflow\s+view)\b/.test(comando)) return undefined;
  const ramo = (comando.match(/--branch[= ]([\w./-]+)/) || [])[1];
  const onde = ramo ? ` (${ramo})` : '';
  if (/\b(fail|failed|failing|failure)\b|✗|\bX\s|conclusion:\s*failure|exit code [1-9]/i.test(saida)) return { tipo: 'ci-falhou', texto: `CI falhou${onde}` };
  if (/All checks were successful|conclusion:\s*success|completed\s+success|✓\s.*(success|completed)|\bpassed\b/i.test(saida)) return { tipo: 'ci-ok', texto: `CI verde${onde}` };
  return undefined;
}

/** PR aberto/mesclado, push, release: viram festa no feed (e aviso no celular). */
export function marco(h) {
  const i = h.tool_input || {};
  let saida = '';
  try {
    saida = typeof h.tool_response === 'string' ? h.tool_response : JSON.stringify(h.tool_response ?? '');
  } catch {}
  const urlPr = (saida.match(/https:\/\/github\.com\/[^\s"'\\]+\/pull\/\d+/) || [])[0];
  const num = urlPr ? ` #${urlPr.split('/').pop()}` : '';
  if (h.tool_name === 'Bash' && typeof i.command === 'string') {
    const c = i.command;
    const ci = marcoCI(c, saida);
    if (ci) return ci;
    if (/\bgh\s+pr\s+create\b/.test(c) && urlPr) return { tipo: 'pr-aberto', texto: `PR${num} aberto`, url: urlPr };
    if (/\bgh\s+pr\s+merge\b/.test(c) && !/error|failed|falh/i.test(saida)) return { tipo: 'pr-mesclado', texto: `PR${num} mesclado`, url: urlPr };
    if (/\bgh\s+release\s+create\b/.test(c)) return { tipo: 'release', texto: 'Release publicada' };
    if (/\bgit\s+push\b/.test(c) && !/rejected|error|fatal/i.test(saida)) return { tipo: 'push', texto: 'Push feito' };
  }
  if (h.tool_name === 'mcp__github__create_pull_request') {
    const n = (saida.match(/"number"\s*:\s*(\d+)/) || [])[1];
    return { tipo: 'pr-aberto', texto: `PR${n ? ` #${n}` : num} aberto`, url: urlPr };
  }
  if (h.tool_name === 'mcp__github__merge_pull_request') return { tipo: 'pr-mesclado', texto: 'PR mesclado' };
  return undefined;
}

function base(h, dir) {
  const g = git(dir);
  const nuvem = PROVEDOR === 'claude' && process.env.CLAUDE_CODE_REMOTE === 'true';
  const idNuvem = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
  return {
    v: 1,
    sessao: h.session_id,
    projeto: g.repo || basename(dir),
    pasta: dir,
    origem: nuvem ? 'nuvem' : 'pc',
    maquina: nuvem ? 'nuvem' : hostname(),
    branch: g.branch,
    link: nuvem && idNuvem ? `https://claude.ai/code/${idNuvem.replace(/^cse_/, 'session_')}` : undefined,
    ...(PROVEDOR === 'codex' ? { provedor: 'codex' } : {}),
    em: new Date().toISOString(),
  };
}

/** Comandos em segundo plano que o Claude Code lista no Stop (`background_tasks`): o formato varia, então lê com cuidado. */
export function tarefasFundo(lista) {
  if (!Array.isArray(lista)) return undefined;
  return lista
    .filter((t) => t && typeof t === 'object' && (!t.status || /run|pend|start/i.test(String(t.status))))
    .slice(0, 10)
    .map((t) => ({
      id: String(t.id ?? t.task_id ?? t.taskId ?? t.shell_id ?? t.shellId ?? t.bash_id ?? ''),
      rotulo: curto(t.description || t.command || t.label || t.name || 'Comando em segundo plano', 120),
    }))
    .filter((t) => t.id);
}

function montar(h, dir) {
  const ev = { ...base(h, dir), evento: h.hook_event_name, hv: VERSAO };
  const i = h.tool_input || {};
  if (h.tool_name) {
    ev.ferramenta = h.tool_name;
    ev.detalhe = resumo(h.tool_name, i, dir);
    if (h.tool_use_id) ev.usoId = h.tool_use_id;
  }
  switch (h.hook_event_name) {
    case 'SessionStart':
      if (h.model) ev.modelo = String(h.model);
      break;
    case 'UserPromptSubmit':
      ev.prompt = corta(h.prompt, TEXTO_MAX);
      break;
    case 'Notification':
      ev.mensagem = curto(h.message, 200);
      break;
    case 'PreToolUse':
      if (h.tool_name === 'Task' || h.tool_name === 'Agent') {
        ev.subagente = { descricao: curto(i.description || i.subagent_type || 'tarefa', 140), tipo: i.subagent_type, fundo: i.run_in_background === true };
      }
      if (h.tool_name === 'Bash' && !i.run_in_background && h.tool_use_id) {
        ev.shell = { op: 'inicio', id: h.tool_use_id, rotulo: curto(i.description || i.command, 120), fundo: false };
      }
      if (h.tool_name === 'TodoWrite' && Array.isArray(i.todos)) {
        ev.tarefas = i.todos.slice(0, 60).map((t) => ({ texto: curto(t.content || t.activeForm, 180), status: STATUS[t.status] || 'pendente' }));
      }
      break;
    case 'PostToolUse': {
      if (h.tool_name === 'Edit') ev.linhas = { mais: linhas(i.new_string), menos: linhas(i.old_string) };
      else if (h.tool_name === 'MultiEdit' && Array.isArray(i.edits)) {
        ev.linhas = i.edits.reduce((a, e) => ({ mais: a.mais + linhas(e.new_string), menos: a.menos + linhas(e.old_string) }), { mais: 0, menos: 0 });
      } else if (h.tool_name === 'Write') ev.linhas = { mais: linhas(i.content), menos: 0 };
      if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(h.tool_name)) {
        const mud = mudanca(h, dir);
        if (mud) ev.mudanca = mud;
      }
      if (h.tool_name === 'TaskCreate') {
        const r = h.tool_response || {};
        const id = r.task?.id ?? r.id ?? r.taskId;
        ev.tarefa = { op: 'criar', id: id != null ? String(id) : undefined, texto: curto(i.subject || i.description, 180), status: 'pendente' };
      }
      if (h.tool_name === 'TaskUpdate') {
        ev.tarefa = { op: 'atualizar', id: i.taskId != null ? String(i.taskId) : undefined, texto: i.subject ? curto(i.subject, 180) : undefined, status: STATUS[i.status] };
      }
      if (h.tool_name === 'Bash') {
        const r = h.tool_response && typeof h.tool_response === 'object' ? h.tool_response : {};
        const idFundo = r.backgroundTaskId ?? r.background_task_id ?? r.shellId ?? r.shell_id ?? r.bash_id;
        if (i.run_in_background) {
          ev.shell = { op: 'inicio', id: String(idFundo ?? h.tool_use_id ?? Date.now()), rotulo: curto(i.description || i.command, 120), fundo: true };
        } else if (h.tool_use_id) ev.shell = { op: 'fim', id: h.tool_use_id };
      }
      if (h.tool_name === 'KillShell' || h.tool_name === 'TaskStop') {
        const id = i.shell_id ?? i.task_id ?? i.id;
        if (id != null) ev.shell = { op: 'fim', id: String(id) };
      }
      const m = marco(h);
      if (m) ev.marco = m;
      break;
    }
    case 'TaskCreated':
      ev.tarefa = { op: 'criar', id: h.task_id != null ? String(h.task_id) : undefined, texto: curto(h.task_subject, 180), status: 'pendente' };
      break;
    case 'TaskCompleted':
      ev.tarefa = { op: 'atualizar', id: h.task_id != null ? String(h.task_id) : undefined, texto: curto(h.task_subject, 180), status: 'feita' };
      break;
    case 'PermissionRequest':
      ev.pedido = pedido(h, dir);
      break;
    case 'Stop': {
      if (h.last_assistant_message) ev.resposta = corta(String(h.last_assistant_message), TEXTO_MAX);
      const fundo = tarefasFundo(h.background_tasks);
      if (fundo) ev.fundo = fundo;
      const t = tokens(h.transcript_path);
      if (t.tokens) ev.tokens = t.tokens;
      if (t.modelo) ev.modelo = t.modelo;
      break;
    }
  }
  return ev;
}
export { montar };

function cliente(cfg) {
  const raiz = cfg.url.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  return {
    async enviar(ev, ms = 4000) {
      const r = await fetch(`${raiz}/api/eventos`, { method: 'POST', headers, body: JSON.stringify(ev), signal: AbortSignal.timeout(ms) });
      return r.ok ? r.json() : null;
    },
    async consultar(caminho) {
      const r = await fetch(`${raiz}${caminho}`, { headers, signal: AbortSignal.timeout(40_000) });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    /** Baixa um arquivo da central (as imagens anexadas às mensagens). */
    async baixar(caminho) {
      const r = await fetch(`${raiz}${caminho}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(String(r.status));
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** Transforma a decisão da central na saída que o Claude Code entende (undefined = vale o terminal). */
export function saidaDecisao(d, h, provedor = PROVEDOR) {
  const decisao = (x) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: x } });
  // O Codex só aceita allow/deny com mensagem (sem regras, interrupt nem updatedInput).
  const codex = provedor === 'codex';
  if (d.acao === 'permitir') {
    const x = { behavior: 'allow' };
    const sug = Array.isArray(h.permission_suggestions) ? h.permission_suggestions[d.sugestao] : undefined;
    if (!codex && Number.isInteger(d.sugestao) && sug) x.updatedPermissions = [sug];
    return decisao(x);
  }
  if (d.acao === 'negar') {
    const x = { behavior: 'deny', message: d.motivo ? `Recusado pelo usuário na Central PR Tech: ${d.motivo}` : 'Recusado pelo usuário na Central PR Tech.' };
    if (d.interromper && !codex) x.interrupt = true;
    return decisao(x);
  }
  if (d.acao === 'responder') {
    if (codex) return undefined;
    const qs = h.tool_input && Array.isArray(h.tool_input.questions) ? h.tool_input.questions : [];
    const answers = {};
    for (const r of d.respostas || []) {
      const q = qs[r.pergunta];
      if (!q) return undefined;
      const partes = (r.opcoes || []).map((i) => q.options?.[i]?.label).filter(Boolean);
      if (r.outro) partes.push(r.outro);
      if (!partes.length) return undefined;
      answers[q.question] = partes.join(', ');
    }
    if (Object.keys(answers).length !== qs.length) return undefined;
    return decisao({ behavior: 'allow', updatedInput: { ...h.tool_input, answers } });
  }
  return undefined; // 'terminal'
}

/** PermissionRequest: avisa e espera a resposta da central. */
async function esperarDecisao(api, h, ev) {
  const r = await api.enviar(ev, 8000);
  // Uma regra automática da central já decidiu.
  if (r && r.decisao) {
    const out = saidaDecisao(r.decisao, h);
    if (out) process.stdout.write(JSON.stringify(out));
    return;
  }
  if (!r || !r.pedido || !r.espera) return;
  const fim = Date.now() + r.espera * 1000;
  const q = `/api/eventos/decisao?pedido=${encodeURIComponent(r.pedido)}&sessao=${encodeURIComponent(h.session_id)}`;
  while (Date.now() < fim) {
    let x;
    try {
      x = await api.consultar(q);
    } catch {
      await dorme(3000);
      continue;
    }
    if (x.cancelado) return;
    if (x.decisao) {
      const out = saidaDecisao(x.decisao, h);
      if (out) process.stdout.write(JSON.stringify(out));
      return;
    }
  }
  // Tempo esgotado: a central tira o pedido da tela e vale o terminal.
  await api.enviar({ ...base(h, ev.pasta), evento: 'PedidoEncerrado' }).catch(() => {});
}

/** Stop (asyncRewake): ouve a central; uma mensagem acorda o Claude (código 2, texto no stderr). */
async function escutar(api, h, dir) {
  const desde = Date.now();
  let erros = 0;
  for (;;) {
    let x;
    try {
      x = await api.consultar(`/api/eventos/mensagens?sessao=${encodeURIComponent(h.session_id)}&desde=${desde}`);
      erros = 0;
    } catch {
      if (++erros > 20) return 0;
      await dorme(5000);
      continue;
    }
    if (x.parar) return 0;
    if (Array.isArray(x.mensagens) && x.mensagens.length) {
      const autores = [...new Set(x.mensagens.map((m) => m.autor).filter(Boolean))];
      const caminhos = await baixarImagens(api, x.mensagens);
      const texto = textoMensagens(x.mensagens, caminhos);
      await api.enviar({ ...base(h, dir), evento: 'MensagemEntregue', prompt: corta(texto, TEXTO_MAX), hv: VERSAO }).catch(() => {});
      process.stderr.write(
        `${autores.length ? `${autores.join(', ')} (da equipe) mandou` : 'O usuário mandou'} esta mensagem pela Central PR Tech (é como se tivesse digitado no terminal; trate como o próximo pedido):\n\n${texto}\n`,
      );
      return 2;
    }
  }
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Baixa as imagens anexadas às mensagens para uma pasta temporária: id → caminho (as que falharem ficam de fora). */
async function baixarImagens(api, mensagens, pasta = join(tmpdir(), 'central-anexos')) {
  const caminhos = {};
  for (const img of mensagens.flatMap((m) => (Array.isArray(m.imagens) ? m.imagens : []))) {
    if (!/^[a-f0-9]{16}$/.test(String(img.id))) continue;
    try {
      const dados = await api.baixar(`/api/eventos/anexo?id=${img.id}`);
      mkdirSync(pasta, { recursive: true });
      const arq = join(pasta, `${img.id}.${EXT[img.tipo] || 'jpg'}`);
      writeFileSync(arq, dados);
      caminhos[img.id] = arq;
    } catch {}
  }
  return caminhos;
}

/** O texto entregue ao Claude: as mensagens e, para cada imagem, onde ela está (ele a abre com a ferramenta Read). */
export function textoMensagens(mensagens, caminhos = {}) {
  return mensagens
    .map((m) => {
      const imgs = Array.isArray(m.imagens) ? m.imagens : [];
      const linhas = imgs.map((img) =>
        caminhos[img.id]
          ? `[Imagem anexada: ${caminhos[img.id]} — abra com a ferramenta Read para ver]`
          : '[Uma imagem foi anexada, mas não deu para baixar: peça para mandar de novo]',
      );
      return [m.texto, ...linhas].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

/** Pasta de configuração da conta (o trecho antes de "/projects/" no transcript, CLAUDE_CONFIG_DIR ou ~/.claude). */
export function pastaConta(h, env = process.env) {
  const tp = typeof h?.transcript_path === 'string' ? h.transcript_path.replace(/\\/g, '/') : '';
  const at = tp.lastIndexOf('/projects/');
  if (at > 0) return tp.slice(0, at);
  const doEnv = (env.CLAUDE_CONFIG_DIR ?? '').split(',')[0].trim();
  return doEnv || join(homedir(), '.claude');
}

function janela(w) {
  if (!w || typeof w !== 'object') return undefined;
  const bruto = w.used_percentage ?? w.utilization ?? w.used_percent;
  const pct = typeof bruto === 'string' && bruto.trim() ? Number(bruto) : bruto;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined;
  const r = w.resets_at;
  const reset = typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : typeof r === 'string' ? Date.parse(r) || undefined : undefined;
  return { pct: Math.min(100, Math.max(0, pct)), reset };
}

/** Uso do plano a partir do JSON da linha de status (`rate_limits`), ou undefined sem os números. */
export function usoDe(h, env = process.env) {
  const rl = h && typeof h === 'object' ? h.rate_limits : undefined;
  if (!rl || typeof rl !== 'object') return undefined;
  const cincoH = janela(rl.five_hour);
  const semana = janela(rl.seven_day);
  if (!cincoH && !semana) return undefined;
  const nuvem = env.CLAUDE_CODE_REMOTE === 'true';
  return { ...(nuvem ? { conta: 'nuvem', nome: 'Nuvem' } : contaPc(pastaConta(h, env))), cincoH, semana };
}

/** A linha de status que a pessoa já usava: o comando depois de `--` ou o do ~/.claude/settings.json (se não for o nosso). */
function linhaOriginal(argv) {
  const i = argv.indexOf('--');
  if (i >= 0) return argv.slice(i + 1).join(' ').trim();
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
    const c = s && s.statusLine && s.statusLine.command;
    if (typeof c === 'string' && !c.includes('painel.mjs')) return c;
  } catch {}
  return '';
}

/** Linha de status: manda o uso (no máximo uma vez por minuto por conta) e mostra a linha original. */
async function statusline(cfg, entrada, argv) {
  let h = null;
  try {
    h = JSON.parse(entrada);
  } catch {}
  const original = linhaOriginal(argv);
  const filho = original
    ? new Promise((ok) => {
        const p = spawn(original, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
        p.on('exit', (c) => ok(c ?? 0));
        p.on('error', () => ok(0));
        // A linha original pode nem ler a entrada (ex.: `echo`): fechar o cano cedo não é erro.
        p.stdin.on('error', () => {});
        p.stdin.end(entrada);
      })
    : null;
  const uso = h && cfg ? usoDe(h) : undefined;
  if (uso && h.session_id) {
    const marca = join(tmpdir(), `painel-uso-${uso.conta.replace(/[^\w.-]/g, '_')}`);
    let ultimo = 0;
    try {
      ultimo = Number(readFileSync(marca, 'utf8')) || 0;
    } catch {}
    if (Date.now() - ultimo > 60_000) {
      try {
        writeFileSync(marca, String(Date.now()));
      } catch {}
      const dir = pastaDoProjeto(h) || h.cwd || process.cwd();
      await cliente(cfg)
        .enviar({ ...base(h, dir), evento: 'Uso', hv: VERSAO, uso }, 2500)
        .catch(() => {});
    }
  }
  if (filho) return filho;
  // Sem linha original: uma curtinha nossa.
  const fmt = (w, n) => (w ? `${n} ${Math.round(w.pct)}%` : '');
  const partes = [h?.model?.display_name, uso && fmt(uso.cincoH, '5h'), uso && fmt(uso.semana, 'sem')].filter(Boolean);
  process.stdout.write(partes.join(' · ') || 'Central PR Tech');
  return 0;
}

// ---------- Uso do plano sem a linha de status (tarefa agendada no PC) ----------
// As sessões da nuvem não têm linha de status, então o uso só chegava quando alguém usava o terminal de um PC.
// `--uso` pergunta o uso à Anthropic com o login do Claude Code deste PC e manda à central; `--agendar-uso` faz isso
// sozinho a cada N minutos (Agendador de Tarefas no Windows, crontab no Linux/macOS). O caminho da Anthropic não é
// documentado e pode mudar: aí a tarefa só falha em silêncio e o uso volta a depender da linha de status.
const URL_USO = 'https://api.anthropic.com/api/oauth/usage';
const TAREFA_USO = 'Central PR Tech - uso do plano';

/** Conta de um PC na central (a mesma da linha de status, para as duas fontes caírem no mesmo lugar). */
function contaPc(pasta) {
  const p = basename(pasta);
  return { conta: `${hostname()}:${p}`, nome: `${hostname()}${p !== '.claude' ? ` (${p})` : ''}` };
}

/**
 * Login do Claude Code deste PC: `<pasta>/.credentials.json` (Windows e Linux) ou o Keychain (macOS). Só lê: nunca
 * renova o token, para não mexer no login do próprio Claude Code. O token só vai para a Anthropic, nunca à central.
 */
export function tokenClaude(pasta, plataforma = process.platform, ler = readFileSync, rodar = execFileSync) {
  let bruto;
  try {
    bruto = ler(join(pasta, '.credentials.json'), 'utf8');
  } catch {}
  if (!bruto && plataforma === 'darwin') {
    try {
      bruto = String(rodar('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }));
    } catch {}
  }
  try {
    const o = JSON.parse(bruto).claudeAiOauth;
    if (o && typeof o.accessToken === 'string' && o.accessToken) return { token: o.accessToken, expira: typeof o.expiresAt === 'number' ? o.expiresAt : undefined };
  } catch {}
  return null;
}

/** Uso do plano a partir da resposta da Anthropic (`five_hour`, `seven_day`), ou undefined sem os números. */
export function usoDaApi(r, pasta) {
  const cincoH = janela(r && r.five_hour);
  const semana = janela(r && r.seven_day);
  if (!cincoH && !semana) return undefined;
  return { ...contaPc(pasta), cincoH, semana };
}

/** --uso: lê o uso agora e manda à central. Devolve 0 se a central recebeu. */
async function usoAgora(cfg) {
  const diz = (s) => process.stdout.write(`${s}\n`);
  if (!cfg) {
    diz('✗ Sem configuração: rode o instalador com --pc <url-da-central> <token> neste PC.');
    return 1;
  }
  const pasta = pastaConta(null);
  const cred = tokenClaude(pasta);
  if (!cred) {
    diz(`✗ Não achei o login do Claude Code em ${pasta}: entre uma vez no Claude Code neste PC.`);
    return 1;
  }
  if (cred.expira && cred.expira < Date.now()) {
    diz('✗ O login do Claude Code deste PC expirou: abra o Claude Code uma vez para ele renovar.');
    return 1;
  }
  let r;
  try {
    const res = await fetch(URL_USO, {
      headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'central-pr-tech' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      diz(`✗ A Anthropic respondeu ${res.status} ao pedir o uso${res.status === 401 ? ' (abra o Claude Code uma vez para renovar o login)' : ''}.`);
      return 1;
    }
    r = await res.json();
  } catch (e) {
    diz(`✗ Não deu para pedir o uso à Anthropic: ${e && e.message ? e.message : e}`);
    return 1;
  }
  const uso = usoDaApi(r, pasta);
  if (!uso) {
    diz('✗ A resposta da Anthropic veio sem os números do plano (o formato pode ter mudado).');
    return 1;
  }
  try {
    await cliente(cfg).enviar({ ...base({ session_id: `uso:${hostname()}` }, homedir()), evento: 'Uso', hv: VERSAO, uso }, 8000);
  } catch (e) {
    diz(`✗ Não deu para mandar à central: ${e && e.message ? e.message : e}`);
    return 1;
  }
  const pct = (w) => (w ? `${Math.round(w.pct)}%` : '—');
  diz(`✓ Uso enviado à central (${uso.nome}): 5 h ${pct(uso.cincoH)} · semana ${pct(uso.semana)}`);
  return 0;
}

/** Linha do crontab da tarefa (com a marca que a acha de novo para trocar ou tirar). */
export function linhaCron(min, node, alvo) {
  return `*/${min} * * * * "${node}" "${alvo}" --uso >/dev/null 2>&1 # ${TAREFA_USO}`;
}

/** Crontab sem a nossa linha (e com a nova, se vier). */
export function trocarCron(atual, nova) {
  const linhas = String(atual || '').split('\n').filter((l) => l.trim() && !l.includes(TAREFA_USO));
  if (nova) linhas.push(nova);
  return linhas.length ? `${linhas.join('\n')}\n` : '';
}

/** --agendar-uso [minutos]: testa o --uso e agenda neste PC (padrão 15 min, entre 5 e 60). */
async function agendarUso(cfg, argv) {
  const diz = (s) => process.stdout.write(`${s}\n`);
  const n = Number(argv[argv.indexOf('--agendar-uso') + 1]);
  const min = Number.isFinite(n) && n > 0 ? Math.min(60, Math.max(5, Math.round(n))) : 15;
  if ((await usoAgora(cfg)) !== 0) {
    diz('✗ Não agendei: resolva o erro acima e rode de novo.');
    return 1;
  }
  // Cópia num lugar fixo: a tarefa não quebra se a pasta do projeto mudar ou sumir.
  const pasta = join(homedir(), '.painel-agentes');
  mkdirSync(pasta, { recursive: true });
  const alvo = join(pasta, 'painel.mjs');
  writeFileSync(alvo, readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  try {
    if (process.platform === 'win32') {
      // Pelo wscript, para não piscar uma janela do Node a cada vez.
      const vbs = join(pasta, 'uso.vbs');
      writeFileSync(vbs, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${alvo}"" --uso", 0, False\r\n`);
      execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(min), '/TN', TAREFA_USO, '/TR', `wscript.exe "${vbs}"`], { stdio: 'ignore' });
    } else {
      let atual = '';
      try {
        atual = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {}
      execFileSync('crontab', ['-'], { input: trocarCron(atual, linhaCron(min, process.execPath, alvo)), stdio: ['pipe', 'ignore', 'ignore'] });
    }
  } catch (e) {
    diz(`✗ Não deu para criar a tarefa agendada: ${e && e.message ? e.message : e}`);
    return 1;
  }
  diz(`✓ Agendado: a cada ${min} min este PC manda o uso do plano à central (tarefa "${TAREFA_USO}"). Para tirar: --desagendar-uso`);
  return 0;
}

/** --desagendar-uso: tira a tarefa deste PC. */
function desagendarUso() {
  try {
    if (process.platform === 'win32') execFileSync('schtasks', ['/Delete', '/F', '/TN', TAREFA_USO], { stdio: 'ignore' });
    else {
      let atual = '';
      try {
        atual = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {}
      execFileSync('crontab', ['-'], { input: trocarCron(atual), stdio: ['pipe', 'ignore', 'ignore'] });
    }
  } catch {
    process.stdout.write('Nenhuma tarefa para tirar.\n');
    return 0;
  }
  process.stdout.write(`✓ Tarefa "${TAREFA_USO}" tirada deste PC.\n`);
  return 0;
}

/** --testar: manda um evento de teste e diz se a central recebeu. */
async function testar(cfg) {
  if (!cfg) {
    process.stdout.write('✗ Sem configuração: defina PAINEL_URL e PAINEL_TOKEN ou rode o instalador com --pc.\n');
    return 1;
  }
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ev = { ...base({ session_id: `teste:${hostname()}` }, dir), evento: 'Teste', hv: VERSAO };
  try {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/eventos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401) {
      process.stdout.write('✗ A central recusou o token (confira PAINEL_TOKEN).\n');
      return 1;
    }
    if (!r.ok) {
      process.stdout.write(`✗ A central respondeu ${r.status}.\n`);
      return 1;
    }
    process.stdout.write(`✓ A central recebeu o teste de ${ev.projeto} (${ev.origem === 'nuvem' ? 'nuvem' : ev.maquina}). Hook versão ${VERSAO}.\n`);
    return 0;
  } catch (e) {
    process.stdout.write(`✗ Não deu para falar com ${cfg.url}: ${e && e.message ? e.message : e}\n`);
    return 1;
  }
}

async function main() {
  const cfg = config();
  if (process.argv.includes('--testar')) return testar(cfg);
  if (process.argv.includes('--uso')) return usoAgora(cfg);
  if (process.argv.includes('--agendar-uso')) return agendarUso(cfg, process.argv);
  if (process.argv.includes('--desagendar-uso')) return desagendarUso();
  if (process.argv.includes('--statusline')) {
    let entrada = '';
    try {
      entrada = readFileSync(0, 'utf8');
    } catch {}
    return statusline(cfg, entrada, process.argv);
  }
  if (!cfg) return 0;
  const h = lerEntrada();
  if (!h || !h.hook_event_name || !h.session_id) return 0;
  const dir = pastaDoProjeto(h);
  if (!dir) return 0;
  const api = cliente(cfg);

  if (process.argv.includes('--escutar')) return PROVEDOR === 'codex' ? 0 : escutar(api, h, dir);
  const ev = montar(h, dir);
  if (h.hook_event_name === 'PermissionRequest') await esperarDecisao(api, h, ev);
  else if (h.hook_event_name === 'SessionStart') {
    // Começo de sessão (síncrono): as tarefas do quadro do projeto entram no contexto do agente.
    const r = await api.enviar(ev, 8000).catch(() => null);
    if (r && typeof r.contexto === 'string' && r.contexto) {
      if (PROVEDOR === 'codex') process.stdout.write(`${r.contexto}\n`);
      else process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: r.contexto } }));
    }
  } else await api.enviar(ev);
  return 0;
}

// Só roda quando é executado (os testes importam as funções sem disparar nada).
const executado = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executado) {
  main()
    .catch(() => 0)
    .then((codigo) => process.exit(codigo || 0));
}
