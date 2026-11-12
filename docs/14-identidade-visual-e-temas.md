# 14 — Identidade visual, cores por cliente e tema claro/escuro

Ver [ADR-015](10-decisoes-arquiteturais.md#adr-015--cores-por-cliente-calculadas-no-servidor-com-cores-de-estado-travadas).

## Identidade Engemase (padrão da plataforma)

Paleta extraída do logotipo oficial:

| Token | Cor | Uso |
|---|---|---|
| `--brand-blue` | `#257BB4` | Cor da marca (logo, detalhes decorativos) |
| `--brand-blue-dark` | `#275993` | Variação escura |
| `--brand-navy` | `#2C4E73` | **Menu lateral** (fundo do selo) |
| `--brand-orange` | `#CF5539` | **Só na marca** (logo, ilustrações) |
| `--brand-orange-light` | `#E96549` | Só na marca |
| `--primary` (claro) | ~`#2272AB` | Botões, links, foco: o azul Engemase **levemente escurecido** para garantir contraste AA (≥ 4,5:1) também como texto sobre o fundo |
| `--primary` (escuro) | `#4A9FD6` | Versão clara do azul para o modo escuro |

Arquivos em `apps/web/public/brand/`: logotipo completo, selo redondo (com e sem anel), símbolo, marca d'água e o **ícone redondo** do app (favicon e ícone de atalho no celular).

**Por que o laranja não vira cor de interface:** no chão de fábrica, laranja/âmbar e vermelho **significam parada e falha**. Usar o laranja da marca em botões ou destaques confundiria a leitura dos estados.

## Cores de estado: travadas

`--state-running` (verde), `--state-stopped` (âmbar), `--state-fault` (vermelho), `--state-setup` (violeta), `--state-planned` (cinza-azulado), `--state-nocomm` (cinza com listras), `--destructive` e as faixas de OEE **não mudam com a marca de nenhum cliente**. Seguem as boas práticas de IHM (ISA-101: fundo neutro, cor forte só para o anormal) e a WCAG 1.4.1 (cor nunca é o único sinal: sempre com ícone e texto).

## Tema do usuário: claro, escuro ou automático

- **Padrão: Automático** (segue o sistema operacional). Seletor com as três opções no menu do usuário e no cabeçalho.
- Persistência: `localStorage` + preferência salva no perfil + **cookie** que leva a escolha para outro aparelho sem "piscar" (padrão do guia `preventing-flash-before-hydration.md` do Next.js 16).
- **TV/Andon e tablet do operador têm tema próprio**, que não muda o tema pessoal de ninguém. O `next-themes` ignora providers aninhados; por isso o provider sai do layout raiz e vai para os layouts de cada grupo de rotas (usuário vs. quiosque, com chave de armazenamento separada). A URL da TV pode fixar o tema (`?tema=escuro`).

## Cores por cliente

### O que cada cliente pode personalizar

| Item | Detalhe |
|---|---|
| **Cor primária** | Paletas prontas ou cor livre (com validação) |
| **Menu lateral** | Padrão (azul-marinho Engemase) · escuro no tom da marca · claro · cor sólida da marca (avançado, só se o contraste passar) |
| **Logotipos** | Horizontal para fundo claro, horizontal para fundo escuro (o menu é escuro), símbolo quadrado ≥ 512 px (favicon/app) |
| **Nome exibido** | Até 40 caracteres; nome curto do app até 12 |

Não pode: cores de estado, faixas de OEE, cor de erro.

### Como a cor é aplicada

1. O cliente escolhe a cor. Um **algoritmo no servidor** (OKLCH + contraste WCAG) calcula os tokens para claro e escuro:
   - primário com **≥ 4,5:1** contra o fundo (ajustando só a luminosidade, mantendo o matiz);
   - texto sobre o primário: branco se passar, senão escuro;
   - versão do modo escuro com luminosidade mais alta;
   - **distância de cor (ΔE) para cada cor de estado**: cor quase igual a "produzindo", "parada", "falha" ou "setup" **é bloqueada** como primária; parecida demais gera aviso.
2. Os tokens ficam salvos (`client_branding.tokens`) e o layout do cliente injeta um `<style>` com `--primary`, `--ring` e `--sidebar-*`. **Sem rebuild.**
3. Gráficos (ECharts) recebem as cores em hexadecimal calculadas no mesmo passo.

Exemplos do algoritmo: um azul `#0055A4` é mantido; um amarelo `#FACC15` vira oliva nos botões (a cor original fica só como detalhe de marca); um verde `#00A859`, um vermelho `#E30613` ou um laranja `#F28C28` são **bloqueados** por ficarem colados nas cores de estado.

### Editor de identidade visual

Em `/[cliente]/config/aparencia` e numa aba do cliente no console Engemase. **Só a equipe Engemase altera a aparência (D12, 12/11/2026);** o admin do cliente vê a tela só como leitura e pede mudanças pelo suporte ([15](15-multi-cliente-e-acesso.md)):
- grade de paletas + cor personalizada (seletor e campo hex);
- **prévia lado a lado em claro e escuro** (botão, link, badge, menu, barra de progresso e um card de máquina com os estados);
- selos de contraste "AA ok" / "ajustado" e a explicação quando houver ajuste ou bloqueio;
- upload dos logotipos (com recorte e prévia no menu);
- "Restaurar padrão Engemase";
- toda alteração vai para a auditoria.

### Dados

Tabela `client_branding` (uma linha por cliente): nome exibido, nome curto, paleta ou cor livre, modo do menu, **tokens calculados** (jsonb), relatório de contraste, versão do algoritmo, URLs dos logos e ícones, quem alterou e quando. Separada da tabela de organização do Better Auth para não brigar com o schema do plugin.

- Logos no **Vercel Blob** (store pública, caminho com hash do conteúdo), processados no servidor para gerar favicon e ícones do app.
- Leitura com cache por tag (`use cache` + `cacheTag`), invalidada ao salvar.

### App instalável (PWA) por cliente

O manifest do app pode ser gerado por cliente (nome, ícone, cor). Vários PWAs no mesmo domínio separados só por caminho é prática desencorajada; o **subdomínio por cliente** (ex.: `cliente.<domínio próprio>`) resolve isso e prepara o **white label** com domínio próprio do cliente (fase 3, via domínios da Vercel). Isso pesa para o **push no iPhone**, que exige o app instalado ([13](13-notificacoes-e-alertas.md)).

**Hoje (D28, 12/11/2026):** só o domínio da Vercel, `engemase-oee.vercel.app`, o mesmo para todos os clientes. O domínio próprio fica para depois, e o subdomínio por cliente depende dele (F3, D34). Trocar de endereço também troca a origem do app instalado: sessões, app instalado e inscrições de push são por endereço e precisam ser refeitos no novo.

## Fases

- **MVP:** identidade Engemase aplicada, seletor Claro/Escuro/Automático com padrão Automático, tema próprio da TV/Andon.
- **F2:** cores e logotipos por cliente (editor + algoritmo + Blob), manifest por cliente.
- **F3:** subdomínio por cliente e domínio próprio (white label). Os dois dependem do domínio próprio da Engemase (D28).
