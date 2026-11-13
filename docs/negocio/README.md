# Negócio — contratos, comercial e suporte

Documentos de negócio da plataforma Engemase OEE: o que se assina com o cliente, como se vende, como se atende e como se cumpre a LGPD. A parte técnica fica em [`docs/`](../) e a operação em [`docs/operacao/`](../operacao/README.md).

Cada área tem uma seção abaixo, com a lacuna correspondente do [docs/17 §4](../17-backlog-e-pendencias.md#4-lacunas-de-especificação).

## Proposta do projeto

| Documento | O que é |
|---|---|
| [Proposta atualizada](proposta/proposta-atualizada.md) | Versão em vigor (13/11/2026): o que o sistema entrega, arquitetura, investimento, modelo comercial, cronograma, riscos e o que mudou desde a original |
| [Proposta original](proposta/2025-10-08-proposta-original.md) ([PDF](proposta/2025-10-08-proposta-original.pdf)) | Registro histórico de 08/10/2025 |

## Jurídico e LGPD (L7)

> **Minutas para revisão por advogado; não usar sem revisão.**

Pasta [`juridico/`](juridico/README.md): índice, marcações, decisões usadas, regras da ANPD consultadas e o que falta.

| Documento | Para quê |
|---|---|
| [Contrato de assinatura](juridico/01-contrato-de-assinatura.md) | Licença de uso, cobrança por máquina e planos, SLA, suspensão, encerramento, dados, acesso da Engemase, responsabilidade |
| [Anexo H — Hardware](juridico/01-anexo-h-hardware.md) | Gateway em comodato, venda ou locação (D2 aberta) |
| [Acordo de tratamento de dados (DPA)](juridico/02-acordo-de-tratamento-de-dados.md) | Cliente controlador, Engemase operadora, suboperadores, transferência internacional, incidentes |
| [Termos de uso](juridico/03-termos-de-uso.md) | Regras de uso da plataforma, com aceite no primeiro login |
| [Política de privacidade](juridico/04-politica-de-privacidade.md) | Dados, bases legais, retenção e direitos |
| [Operador de chão](juridico/05-operador-de-chao.md) | Dados mínimos, base legal, aviso no tablet |
| [Plano de resposta a incidentes](juridico/06-plano-de-resposta-a-incidentes.md) | Papéis, prazos, comunicação ao cliente e à ANPD |
| [Registro das operações de tratamento](juridico/07-registro-das-operacoes-de-tratamento.md) | ROPA como operadora e como controladora |

**Falta:** revisão jurídica, nomear o encarregado (DPO), confirmar as cláusulas-padrão da ANPD com cada fornecedor, escrever o termo de piloto (que precisa repetir ou incorporar cláusulas do contrato) e assinar ([detalhe](juridico/README.md#6-o-que-falta)).

## Comercial e suporte (L9, L10, L11)

> **Propostas.** Nenhum preço está definido: os valores ficam como **R$ ___**, e as faixas são hipóteses a validar.

| Documento | Lacuna | Para quê |
|---|---|---|
| [Planos e preços](planos-e-precos.md) | L9 | Planos Starter, Pro e Enterprise (D1); o que é "máquina" na cobrança; implantação; serviços (bloco OEE por marca, D26); hardware nas três opções da D2; base de custo com fontes; método de preço |
| [Onboarding comercial](onboarding-comercial.md) | L10 | Funil do contato ao cliente ativo; questionário de pré-venda; visita técnica; modelo de proposta; piloto e aceite; critérios de Ativo; treinamento por papel (D12) |
| [SLA e suporte](sla-e-suporte.md) | L11 | Anexo B do contrato: disponibilidade por plano, RPO e RTO, prioridades e prazos, pedidos de configuração, ferramenta de chamados, página de status, manutenção, troca de hardware, créditos |

**Marcações usadas nestes três documentos:**

| Marcação | Significa |
|---|---|
| **R$ ___** | Valor que o dono do produto define |
| **[HIPÓTESE]** | Faixa de valor sugerida, ainda sem validação com clientes. Não mostrar a cliente |
| **[PROPOSTA]** | Regra, prazo ou número sugerido, ainda sem decisão |
| **[ESTIMATIVA]** | Conta feita com premissas declaradas; medir no piloto |
| **[PREENCHER]** | Dado a completar (contatos, cidade-base, prazos comerciais) |
| **[CONFIRMAR]** | Fato a conferir na página do fornecedor |
| **[DECIDIR]** | Escolha da Engemase ainda não feita |
| **[CONTADOR]** / **[ADVOGADO]** | Ponto que precisa de opinião do contador ou do advogado |

**Falta:** o dono do produto escolher valores, horários e ferramentas (lista no fim de cada documento), conferir os preços dos fornecedores nas páginas oficiais e validar as faixas com clientes e com o piloto.
