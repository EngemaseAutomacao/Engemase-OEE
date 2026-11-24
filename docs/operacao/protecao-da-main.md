# Proteção da `main` no GitHub

| | |
|---|---|
| **Para quê** | Item N1 do [docs/17](../17-backlog-e-pendencias.md#2-backlog-até-o-piloto) (W1): ninguém, pessoa ou agente, consegue apagar a `main`, reescrever o histórico ou levar para a produção um commit com o CI vermelho. A Vercel publica sozinha a cada push na `main` |
| **Repositório** | `EngemaseAutomacao/Engemase-OEE` |
| **Quem aplica** | Um administrador do repositório (Engemase ou PR Tech). Leva 10 minutos |
| **Depende de** | O CI (`.github/workflows/ci.yml`) já ter rodado pelo menos uma vez no repositório: o GitHub só oferece na lista os checks que já viu |

## 1. Checks do CI

Os nomes abaixo são os que o GitHub mostra (o `name:` de cada job no `ci.yml`). Copie exatamente, com espaços, parênteses e setas.

| Check | O que confere | Obrigatório? |
|---|---|---|
| `web (typecheck, lint, build)` | Tipos, lint e build do Next.js | **Sim** |
| `packages (typecheck, testes)` | Tipos e testes dos pacotes e da API dos gateways (Vitest + PGlite) | **Sim** |
| `go (gateway, plc-sim)` | gofmt, go vet, testes com `-race`, integração com o simulador, build arm64 | **Sim** |
| `e2e (plc-sim → agente → API → banco)` | Ponta a ponta: CLP simulado → agente Go → API → banco | **Sim** |
| `navegador (Playwright, celular e computador)` | Telas principais no celular e no computador, sem erro no console e sem rolagem horizontal | **Ainda não.** Tornar obrigatório depois de 2 semanas sem falha intermitente (seção 4) |

Origem dos checks: **GitHub Actions** (não aceite o mesmo nome vindo de outro app).

## 2. Passo a passo (Rulesets, recomendado)

1. GitHub → repositório **Engemase-OEE** → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `main protegida`. **Enforcement status:** `Active`.
3. **Bypass list:** deixe **vazia**. (Se a equipe quiser uma saída de emergência, adicione só o papel `Repository admin` com a opção *For pull requests only* e registre cada uso no chamado.)
4. **Target branches** → **Add target** → **Include default branch** (a `main`).
5. Em **Rules**, marque:
   - [x] **Restrict deletions** — ninguém apaga a `main`.
   - [x] **Block force pushes** — ninguém reescreve o histórico.
   - [x] **Require status checks to pass**:
     - [x] **Require branches to be up to date before merging**;
     - **Add checks** → adicione os quatro checks obrigatórios da seção 1, um por um, escolhendo **GitHub Actions** como origem.
   - [x] **Require a pull request before merging** (ver seção 3 antes de marcar):
     - **Required approvals:** `1`;
     - [x] **Dismiss stale pull request approvals when new commits are pushed**;
     - [x] **Require conversation resolution before merging**;
     - **Allowed merge methods:** `Merge` e `Squash`.
   - [ ] *Require signed commits*, *Require deployments to succeed* e *Require linear history*: deixe **desmarcados** por enquanto.
6. **Create**.
7. Confira: **Settings** → **Rules** → **Rulesets** mostra `main protegida` como `Active`, com *1 target* e as regras acima.

### 2.1 Pela linha de comando (mesmo resultado)

Com o `gh` autenticado como administrador do repositório, salve como `main-protegida.json`:

```json
{
  "name": "main protegida",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "web (typecheck, lint, build)", "integration_id": 15368 },
          { "context": "packages (typecheck, testes)", "integration_id": 15368 },
          { "context": "go (gateway, plc-sim)", "integration_id": 15368 },
          { "context": "e2e (plc-sim → agente → API → banco)", "integration_id": 15368 }
        ]
      }
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash"]
      }
    }
  ]
}
```

```bash
gh api -X POST repos/EngemaseAutomacao/Engemase-OEE/rulesets --input main-protegida.json
gh api repos/EngemaseAutomacao/Engemase-OEE/rulesets   # confere: "main protegida", enforcement "active"
```

`15368` é o id do app **GitHub Actions**. Sem o bloco `pull_request`, fica só a proteção mínima (seção 3, opção B).

### 2.2 Se o plano não tiver Rulesets

Em repositório privado, Rulesets e proteção de branch exigem GitHub **Team** (ou repositório público). No Free privado, o GitHub não aplica nada disso: a Engemase precisa do plano Team (ou equivalente) para o item N1. A alternativa clássica, no mesmo plano, é **Settings** → **Branches** → **Add classic branch protection rule** → *Branch name pattern* `main`, com as mesmas opções (*Require a pull request before merging*, *Require status checks to pass before merging* + *Require branches to be up to date* + os quatro checks, *Require conversation resolution*, e **sem** *Allow force pushes* e *Allow deletions*). Marque também **Do not allow bypassing the above settings**.

## 3. Pull request obrigatório ou não

A regra da PR Tech (`CLAUDE.md` da raiz) manda mesclar cada entrega na `main` e dar push. Os dois jeitos de proteger:

| | **A. Com PR obrigatório** (recomendado pelo docs/17) | **B. Sem PR obrigatório** |
|---|---|---|
| Regras | As da seção 2 completas | Seção 2 sem o *Require a pull request before merging* |
| Como uma entrega chega à `main` | Push do branch → PR → CI verde + 1 aprovação → *Merge* no GitHub | Push do branch → CI verde no branch → `git merge --ff-only` na `main` local → push da `main` |
| O que o GitHub barra | Push direto na `main`; PR com CI vermelho ou sem aprovação | Push na `main` de um commit cujo CI não passou (inclusive commit de merge novo, criado só na máquina) |
| Quando usar | Com duas pessoas revisando (a partir da Fase 1) | Enquanto o time é de uma pessoa mais agentes |

Na opção B, o push da `main` só é aceito se aquele mesmo commit já passou nos checks: por isso o merge tem de ser **fast-forward** (`--ff-only`) de um branch já testado e atualizado com a `main`. Se a `main` andou, atualize o branch, espere o CI e tente de novo.

Os agentes da PR Tech seguem a opção escolhida: na A, abrem o PR em vez de dar push na `main`; na B, só dão push da `main` com o CI verde no commit.

## 4. Manutenção

- **Renomeou um job no `ci.yml`?** Atualize o ruleset no mesmo PR. Um check obrigatório que não existe mais deixa todo PR esperando para sempre ("Expected — Waiting for status to be reported").
- **Job novo** entra como não obrigatório; vira obrigatório depois de 2 semanas sem falha intermitente (caso do `navegador`).
- **Check com falha intermitente:** corrija o teste, não tire o check. Tirar só com registro no PR e data para voltar.
- **Revisão trimestral:** conferir em **Settings** → **Rules** → **Insights** se houve bypass e por quê.
- **Vercel:** em *Settings* → *Git* do projeto, a *Production Branch* é `main`. Não ligue *Ignored Build Step* que pule a produção.
