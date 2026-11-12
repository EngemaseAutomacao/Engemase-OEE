# Nota sobre o operador de chão (LGPD)

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Marcações e o que falta: [README desta pasta](README.md). Revisão recomendada também por advogado **trabalhista**.

**Para quem.** Equipe Engemase (implantação e produto), cliente (RH, jurídico e encarregado) e o advogado que revisar o contrato.

## 1. Como funciona hoje

| Item | Como é | Fonte |
|---|---|---|
| Quem é o operador de chão | Pessoa que opera a máquina e aponta no **tablet pareado** da máquina ou da linha. **Não tem login** | [docs/15 §1](../../15-multi-cliente-e-acesso.md#1-hierarquia-e-identidades) |
| Como se identifica | **Escolhe o próprio nome numa lista** no tablet (D18, escolha provisória). PIN ou crachá só na Fase 2 | [docs/17 §3](../../17-backlog-e-pendencias.md#3-decisões) |
| De onde vem a lista | O cliente envia; a Engemase cadastra por unidade: **nome e matrícula opcional** (L19, escolha provisória) | [docs/17 §4](../../17-backlog-e-pendencias.md#4-lacunas-de-especificação) |
| O que ele faz no tablet | Classifica paradas, lança refugo e troca de produto | [docs/05](../../05-plataforma-web.md#tela-do-operador) |
| Sem tablet | O supervisor classifica no computador, com o próprio login | D18 |

## 2. Quais dados pessoais

**Registrados:**
- nome ou apelido, e matrícula se o cliente usar;
- unidade a que pertence;
- **quem apontou** cada classificação de parada, refugo ou troca de produto, com máquina, terminal e horário;
- correções de apontamentos (quem corrigiu e quando), na auditoria.

**Não registrados:** foto, biometria, CPF, localização, tempo de tela, produtividade individual calculada. A plataforma **não gera ranking nem nota por operador**.

**Atenção:** os dados de produção (peças, paradas, refugo) não são dados pessoais em si. Mas, cruzados com quem estava apontando ou com o turno, **podem revelar o desempenho de uma pessoa**. Por isso o cuidado abaixo.

## 3. Quem responde por esses dados

| Papel | Quem | Por quê |
|---|---|---|
| **Controlador** | **O cliente** (empregador ou tomador do serviço) | Decide usar a identificação, escolhe quem entra na lista e para que usa os registros |
| **Operadora** | **Engemase** | Cadastra a lista e guarda os registros só por instrução do cliente ([DPA](02-acordo-de-tratamento-de-dados.md), cláusula 4.3) |

## 4. Finalidade

**Para que serve:** saber **quem informou cada dado**, para tirar dúvidas, corrigir apontamentos errados e dar confiabilidade aos motivos de parada.

**Para que não serve, sem nova análise do cliente:** avaliar desempenho individual, ranquear pessoas, punir ou decidir sobre promoção ou desligamento. Usar os registros para isso é **outra finalidade** (LGPD, art. 6º, I) e exige do cliente nova análise, transparência aos operadores e, provavelmente, relatório de impacto. A Engemase recomenda que o contrato e o aviso deixem isso claro.

## 5. Base legal provável

**[ADVOGADO]** Avaliação preliminar, para o cliente (controlador) decidir:

| Base (LGPD, art. 7º) | Avaliação |
|---|---|
| **Legítimo interesse** (IX), com os cuidados do art. 10 | **A mais provável.** Rastrear quem apontou é ligado à atividade do cliente (art. 10, I), usa dado mínimo e é esperado no ambiente de trabalho. Exige teste de balanceamento documentado pelo cliente, transparência ao operador (aviso abaixo) e dado estritamente necessário (art. 10, §§ 1º e 2º) |
| Execução do contrato de trabalho (V) | Possível como base complementar: apontar faz parte da função. Não cobre quem não é empregado (terceirizado, temporário) |
| **Consentimento** (I) | **Não recomendado.** Na relação de trabalho há desequilíbrio entre as partes, e o consentimento pode ser questionado. E, se o operador recusar, o apontamento ficaria sem dono |

**Adolescentes** (jovens aprendizes de 14 a 17 anos): o tratamento deve ser no melhor interesse deles (LGPD, art. 14). Recomendação: identificar só pela matrícula.

## 6. Minimização: o que recomendamos ao cliente

Em ordem de preferência:

1. **Matrícula ou apelido** no lugar do nome completo (ex.: "João S." ou "Mat. 4521").
2. Lista **só com quem opera** as máquinas com tablet, por unidade.
3. **Tirar da lista** quem sai da empresa ou muda de função, no mesmo mês. Pedir à Engemase pelo canal de suporte.
4. **Não usar** os registros para avaliação individual sem a análise da seção 4.

**[PROPOSTA de produto, fora desta área]:** opção por unidade de **apontamento sem identificação** (o registro guarda só o terminal), para clientes que não querem identificar operadores.

## 7. Retenção

| Registro | Prazo proposto |
|---|---|
| Lista de operadores | Enquanto a pessoa estiver ativa. Removida da lista: o nome sai da tela de escolha na hora |
| Identificação de quem apontou, nos eventos de produção | **[PROPOSTA]** Anonimizada após 2 anos (mesmo prazo dos dados por minuto, D6) ou [PREENCHER: 12] meses depois de a pessoa sair da lista, o que vier primeiro |
| Correções na auditoria | 5 anos (D6). **[ADVOGADO: avaliar se a auditoria pode guardar só o identificador interno, sem o nome]** |

**Lacuna do projeto:** hoje os eventos de estado (`machine_state_event`, com `classificado_por`) têm retenção "indefinida" no [docs/06](../../06-banco-de-dados.md#volume-particionamento-e-retenção). A proposta acima exige uma rotina de anonimização. Fica registrado no README desta pasta.

## 8. Direitos do operador

O operador exerce os direitos (LGPD, art. 18) **com o cliente** (RH ou encarregado do cliente). A Engemase ajuda o cliente a:
- exportar os apontamentos feitos por uma pessoa;
- corrigir o nome na lista;
- anonimizar a identificação de uma pessoa nos registros.

**[CONFIRMAR: essas três ferramentas ainda não existem no produto.]**

## 9. Aviso no terminal

**Onde:** na tela em que o operador escolhe o nome, como um texto curto fixo no rodapé, com um ícone "i" que abre o aviso completo (ou um QR code para o comunicado do cliente). Uso com luva e pouco tempo: o texto curto precisa caber em **até 3 linhas**.

**Texto curto (proposto):**

> Ao escolher seu nome, você fica registrado como quem apontou paradas, refugo e trocas de produto nesta máquina. Isso serve só para saber quem informou cada dado. Responsável: **[nome do cliente]**. Dúvidas: **[RH ou canal de privacidade do cliente]**.

**Texto completo (ao tocar no "i"):**

> **Seus dados neste tablet**
>
> **O que fica registrado:** seu nome (ou apelido/matrícula), a máquina, o horário e o que você apontou: motivo de parada, refugo ou troca de produto.
>
> **Para quê:** saber quem informou cada dado, tirar dúvidas e corrigir apontamentos.
>
> **O que não fazemos:** não guardamos foto, biometria nem localização. A plataforma não dá nota nem ranking por pessoa.
>
> **Quem é o responsável:** **[nome do cliente]**, sua empresa. A Engemase opera a plataforma em nome dela.
>
> **Por quanto tempo:** **[prazo definido pelo cliente; proposta: até 2 anos]**.
>
> **Seus direitos:** você pode pedir acesso, correção ou eliminação pelo **[canal do cliente]**.
>
> **Escolha sempre o seu próprio nome.**

**Nota de implementação (fora desta área):** o nome do cliente e o canal vêm do cadastro do cliente; o texto tem versão, e a versão em uso fica registrada. Sem campo de "aceite": o aviso informa, não pede consentimento (seção 5).

## 10. Comunicado aos empregados (modelo para o cliente)

O aviso do tablet não basta sozinho. O cliente deve informar os operadores **antes** de começar (LGPD, art. 9º), por comunicado interno, mural ou treinamento, e guardar a comprovação.

> **Assunto: Registro de apontamentos nos tablets das máquinas**
>
> A partir de **[data]**, as máquinas **[linhas/unidade]** passam a ter um tablet para apontar paradas, refugo e trocas de produto, na plataforma Engemase OEE.
>
> Antes de apontar, cada operador escolhe o próprio nome numa lista. O sistema registra quem apontou, a máquina e o horário. **Usamos esse registro para saber quem informou cada dado e corrigir apontamentos.** **[Se for o caso: não usamos esse registro para avaliação individual.]**
>
> Dados usados: **[nome ou apelido / matrícula]**. Não há foto, biometria nem localização. Os registros ficam guardados por **[prazo]**. A plataforma é operada pela Engemase, em nosso nome, com os dados guardados no Brasil (São Paulo).
>
> Dúvidas e pedidos sobre seus dados: **[canal do RH ou encarregado]**.

## 11. Checklist da implantação

| # | Item | Quem |
|---|---|---|
| 1 | Cliente escolheu o formato da identificação (nome, apelido ou matrícula) | Cliente |
| 2 | Cliente documentou a base legal (teste de legítimo interesse, se for o caso) | Cliente |
| 3 | Comunicado aos operadores enviado antes do início | Cliente |
| 4 | Lista recebida pelo canal de suporte e cadastrada | Engemase |
| 5 | Aviso do terminal com o nome e o canal do cliente | Engemase |
| 6 | Rotina para tirar da lista quem sai | Cliente pede; Engemase executa |

## Fontes

- LGPD (Lei 13.709/2018), arts. 6º, 7º, 9º, 10, 14 e 18: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Análises sobre bases legais na relação de trabalho (consentimento frágil pelo desequilíbrio entre as partes; legítimo interesse exige necessidade e proporcionalidade): Migalhas, "Impactos da LGPD no monitoramento de empregados", <https://www.migalhas.com.br/depeso/327743/impactos-da-lgpd-no-monitoramento-de-empregados>; Âmbito Jurídico, "Software que mede produtividade pode violar a privacidade?", <https://ambitojuridico.com.br/software-que-mede-produtividade-pode-violar-a-privacidade/>
- [ADVOGADO: conferir o guia orientativo da ANPD sobre legítimo interesse no site da ANPD.]
