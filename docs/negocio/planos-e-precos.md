# Planos e preços

> Versão 0.1 · 12/11/2026 · Lacuna **L9** ([docs/17 §4](../17-backlog-e-pendencias.md#4-lacunas-de-especificação)).
>
> **Nenhum preço aqui é final.** Os valores ficam como **R$ ___**. Onde há faixa, ela é uma **[HIPÓTESE]** para validar com clientes e com o piloto, nunca um preço para mostrar a cliente.

**Para quem:** direção e comercial da Engemase (montar o Pedido, o Anexo A do [contrato](juridico/01-contrato-de-assinatura.md)) e equipe técnica (limites do plano no console).

**Decisões usadas:** D1 (assinatura do software cobrada por máquina, com planos), D6 (minuto por 2 anos, auditoria por 5 anos), D7 (São Paulo), D11 (escopo por máquina), D12 e D13 (configuração só pela Engemase), D26 (Siemens, Schneider, Rockwell e ABB). **Em aberto:** D2 (hardware), D3 (inadimplência), D4 (encerramento). Ver [docs/17 §3](../17-backlog-e-pendencias.md#3-decisões).

## 1. Resumo

| Item | Como cobra | Seção |
|---|---|---|
| **Assinatura do software** | Por máquina contratada, por mês, conforme o plano (Starter, Pro, Enterprise) | 2 e 3 |
| **Taxa de implantação** | Uma vez: valor fixo por cliente + valor por máquina | 5 |
| **Serviços avulsos** | Por item: bloco OEE no CLP (por marca), máquina nova, visita, treinamento | 6 |
| **Hardware do gateway** | Conforme a D2 (aberta): comodato, venda ou locação. **Por gateway**, não por máquina | 7 |

**Por que o hardware é por gateway e o software por máquina:** um gateway atende de 1 a dezenas de máquinas. Se o hardware entrasse no preço por máquina, um cliente com poucas máquinas por painel daria prejuízo, e um com muitas pagaria demais.

## 2. Planos

Os três planos já existem no protótipo (`PLAN_LABEL` em `apps/web/lib/roles.ts`). O plano e os limites ficam em `client_account` e só a plataforma grava ([docs/15 §9](../15-multi-cliente-e-acesso.md#9-modelo-de-dados-acréscimos)).

Legenda de fase: **(MVP)** já no piloto · **(F2)** e **(F3)** depois ([docs/09](../09-roadmap.md)). Recurso de F2 ou F3 entra no plano quando existir; até lá, não se vende.

### 2.1 Para quem é cada plano **[PROPOSTA]**

| | Starter | Pro | Enterprise |
|---|---|---|---|
| Cliente típico | Uma planta pequena, poucas linhas | Várias linhas, relatórios e alertas completos | Várias plantas, suporte prioritário |
| Máquinas | 5 a 20 | 10 ou mais | 40 ou mais |
| Mínimo de máquinas no Pedido | **5** | **10** | **40** |
| Unidades (plantas) | 1 | Até 3 | Sem limite |
| Prazo mínimo do contrato | 12 meses | 12 meses | 12 meses (24 ou 36 com desconto) |

O mínimo de 5 máquinas segue o mercado (a FourJaw exige 5 em todos os planos) e dilui o custo fixo de cada cliente (implantação, suporte, conta). O prazo de 12 meses acompanha o comodato provisório da D2.

### 2.2 Matriz de recursos **[PROPOSTA]**

| Recurso | Starter | Pro | Enterprise |
|---|:-:|:-:|:-:|
| **Dados e telas** | | | |
| Dashboard ao vivo: visão geral, linha, máquina e linha do tempo de estados (MVP) | ✓ | ✓ | ✓ |
| Relatório de OEE por período, turno, máquina e produto (MVP) | ✓ | ✓ | ✓ |
| Metas de OEE por máquina, faixas fixas 85/60 (MVP, D25) | ✓ | ✓ | ✓ |
| Pareto de paradas, MTBF/MTTR e tendências (F2) | — | ✓ | ✓ |
| Classificação automática por código de falha (F2) | — | ✓ | ✓ |
| Exportação CSV (F2) | ✓ | ✓ | ✓ |
| Relatórios agendados por e-mail (F2) | — | ✓ | ✓ |
| **Chão de fábrica** | | | |
| Classificar paradas, lançar refugo e trocar produto (MVP) | ✓ | ✓ | ✓ |
| Terminais pareados (TV Andon e tablet) incluídos (MVP) | 2 | 1 por linha, até 10 | Conforme o Pedido |
| Terminal adicional | R$ ___/mês | R$ ___/mês | R$ ___/mês |
| **Alertas** ([docs/13](../13-notificacoes-e-alertas.md)) | | | |
| Central de notificações no app (MVP) | ✓ | ✓ | ✓ |
| Web Push no celular e no computador (F2a) | ✓ | ✓ | ✓ |
| Escalonamento e resumos por e-mail (F2a) | — | ✓ | ✓ |
| WhatsApp para crítico sem reconhecimento (F2b) | — | Adicional | ✓ até ___ mensagens/mês |
| **Pessoas e acesso** | | | |
| Usuários incluídos (padrão do console) | 15 | 30 | 100 |
| Escopo por cliente, unidades ou máquinas (MVP, D11) | ✓ | ✓ | ✓ |
| 2FA (MVP; obrigatório para o admin, D14 provisória) | ✓ | ✓ | ✓ |
| **Histórico** | | | |
| Dados por minuto: 2 anos (D6) | ✓ | ✓ | ✓ |
| Consolidados por hora e turno: enquanto durar o contrato | ✓ | ✓ | ✓ |
| Auditoria: 5 anos (D6) | ✓ | ✓ | ✓ |
| Retenção estendida ou arquivo frio (F3) | — | — | Sob consulta |
| **Operação e suporte** ([SLA](sla-e-suporte.md)) | | | |
| Disponibilidade mensal | Meta de 99,0% (sem crédito) | 99,5% com crédito | 99,5% com crédito maior |
| Atendimento | Seg. a sex., 7h30–18h | + plantão para crítico, seg. a sáb., 6h–22h | + plantão 24×7 para crítico |
| Pedidos de configuração (D12): prazo da mudança simples | 2 dias úteis | 1 dia útil | 4 horas úteis |
| Acesso remoto aos gateways, com aprovação do cliente (F2, D20) | ✓ opcional | ✓ opcional | ✓ opcional |
| Reunião de resultados com a Engemase | — | Trimestral | Mensal |
| Treinamento de reciclagem | — | 1 por ano | 2 por ano |
| Gateway reserva no local | — | — | Opcional (R$ ___) |
| **Marca e integrações** | | | |
| Cores e logotipos do cliente (F2, [docs/14](../14-identidade-visual-e-temas.md)) | — | ✓ | ✓ |
| Endereço próprio e white label (F3, D34; depende do domínio, D28) | — | — | ✓ |
| API pública e webhooks (F3) | — | Adicional | ✓ |
| Integração com ERP/MES | Serviço sob orçamento | Serviço sob orçamento | Serviço sob orçamento |

**Fica igual em todos os planos, de propósito:**
- **Segurança e isolamento** (RLS, 2FA, escopo por máquina, auditoria): não se vende segurança como opcional.
- **Histórico (D6):** o contrato diz que não há retenção diferente por plano ([contrato, cl. 11.2](juridico/01-contrato-de-assinatura.md)).
- **Exportação CSV:** os dados são do cliente (contrato, cl. 8.1).
- **Acesso remoto:** reduz visitas, que são custo da Engemase. É opcional por segurança: o cliente escolhe se quer e aprova cada sessão.

### 2.3 Limites no console

O assistente "Novo cliente" já sugere limites por plano (`PLAN_DEFAULTS` em `apps/web/components/admin/labels.ts`). São sugestões que o super admin muda na criação.

| Limite (`client_account.limits`) | Starter | Pro | Enterprise | Observação |
|---|---|---|---|---|
| `machines` (máquinas contratadas) | 10 | 20 | 60 | **Base da cobrança.** No Pedido vale o número negociado, respeitado o mínimo da seção 2.1 |
| `gateways` | 2 | 4 | 12 | Controle de frota; o hardware é cobrado pela D2 |
| `users` | 15 | 30 | 100 | Mais usuários: R$ ___ por bloco de 10 **[PROPOSTA]** |
| `retentionMonths` | 24 | 24 | 24 | Fixo pela D6 |

**Bloqueio ou aviso:** a plataforma bloqueia o cadastro de máquina além das contratadas ([docs/15 §10, P5](../15-multi-cliente-e-acesso.md#10-perguntas-para-o-dono-do-produto)). Máquina nova exige pedido comercial antes.

## 3. Regras de cobrança **[PROPOSTA]**

### 3.1 O que é "máquina"

**Base da cobrança: o número de máquinas contratadas no Pedido** (`limits.machines`), não a contagem do mês. Como a plataforma não deixa passar do contratado, a fatura é previsível para os dois lados.

| Situação | Conta? |
|---|---|
| Máquina cadastrada e com coleta ativa | **Sim** |
| Máquina cadastrada e parada (manutenção, sem produção, sem demanda) | **Sim.** A vaga continua contratada; coleta e histórico seguem |
| Máquina em implantação (cadastrada, coleta ainda não conferida) | **Não**, até a ativação (seção 3.2) |
| Máquina **desligada do sistema** a pedido (coleta parada, histórico mantido só para leitura) | **Não**, a partir do mês seguinte ao pedido, respeitado o mínimo do Pedido. A vaga sai do contrato; religar é um novo aumento |
| Máquina física trocada no mesmo posto (mesmo cadastro) | Continua **uma** |
| Linha contínua medida como um só equipamento | **Uma** por cadastro de máquina |
| Máquina sem CLP, lida por módulo de I/O | **Sim**, como qualquer máquina |
| Gateway sem máquina | **Não** (hardware segue a D2) |
| Máquinas da Engemase Lab e de demonstração | **Não** |

**Ajuste no contrato:** a cláusula 1 define "Máquina Contratada" como "cada máquina cadastrada e ativa". Com a regra acima, a definição passa a ser "cada vaga de máquina do Pedido". **[ADVOGADO]**

### 3.2 Início, aumento, redução e troca de plano

| Evento | Regra |
|---|---|
| **Início da mensalidade** | Na data em que o cliente passa a **Ativo** ([onboarding, §8](onboarding-comercial.md#8-critérios-para-o-cliente-passar-a-ativo)) **ou 30 dias depois da instalação do primeiro gateway**, o que vier antes. O prazo evita um cliente parado em "Implantação" sem pagar |
| **Aumento** de máquinas | Por aditivo ou novo Pedido. Cobrança **proporcional aos dias**, a partir da ativação da máquina, ou 30 dias depois do aditivo, o que vier antes ([contrato, cl. 3.3](juridico/01-contrato-de-assinatura.md)) |
| **Redução** de máquinas | Vale no mês seguinte ao pedido, respeitado o mínimo do Pedido (contrato, cl. 3.4) |
| **Subir de plano** | Na data do aditivo, proporcional aos dias |
| **Descer de plano** | Na renovação |
| **Máquina temporária** (ex.: locada por 2 meses) | Aumento e, depois, redução: paga os dias de uso |

### 3.3 Faturamento e reajuste

- **Faturamento mensal antecipado:** emissão no dia 1 e vencimento no dia **[PREENCHER: 10]**. Ajustes proporcionais (aumentos no meio do mês) entram na fatura seguinte.
- **Forma:** boleto ou Pix. **Nota fiscal de serviço:** enquadramento do ISS para assinatura de software **[CONTADOR]**.
- **Reajuste anual pelo IPCA** (contrato, cl. 3.7).
- **Sem cláusula de câmbio.** Os custos em dólar (nuvem) ficam em torno de 10% do preço (seção 8.4). Uma alta de 20% no dólar mexe cerca de 2% no custo: o IPCA basta.
- **Descontos [PROPOSTA]:**

| Desconto | Valor |
|---|---|
| Volume: 50 a 99 máquinas | ___% (hipótese: 5%) |
| Volume: 100 a 199 máquinas | ___% (hipótese: 10%) |
| Volume: 200 máquinas ou mais | ___% (hipótese: 15%) |
| Contrato de 24 meses | ___% (hipótese: 5%) |
| Contrato de 36 meses | ___% (hipótese: 10%) |
| Pagamento anual antecipado | ___% (hipótese: 5%) |

### 3.4 Inadimplência **[PADRÃO PROPOSTO — D3 aberta]**

Segue a escolha provisória da [docs/17 §3](../17-backlog-e-pendencias.md#3-decisões) e o [contrato, cl. 14](juridico/01-contrato-de-assinatura.md).

| Dias de atraso | O que acontece |
|---|---|
| 1 | Lembrete automático ao contato de cobrança |
| 5 | Aviso ao contato de cobrança e ao admin do cliente |
| 15 | Segundo aviso, com a data da suspensão |
| 30 | **Suspenso:** usuários não entram (mensagem clara); **os gateways continuam enviando** e os dados ficam guardados; a Engemase continua com acesso, com registro. Suporte só para regularizar e para segurança. Sem máquinas novas |
| 90 | A Engemase pode rescindir e seguir o encerramento (contrato, cl. 16, D4) |
| Depois do pagamento | Acesso volta em até 1 dia útil |

Multa de **[PREENCHER: 2]%**, juros de **[PREENCHER: 1]%** ao mês e correção pelo IPCA. **[ADVOGADO]**

**Por que os gateways continuam enviando:** desligar a coleta perde dados que o cliente pagou para medir e obriga a um novo comissionamento na volta.

## 4. Preços **[HIPÓTESE — validar]**

Valores a definir pelo dono do produto. As faixas saem da base de custo (seção 8) e da referência de mercado (seção 9). **Não usar com cliente antes de validar.**

| Item | Starter | Pro | Enterprise | Faixa sugerida **[HIPÓTESE]** |
|---|---|---|---|---|
| Mensalidade por máquina | R$ ___ | R$ ___ | R$ ___ | Starter R$ 190–260 · Pro R$ 280–380 · Enterprise R$ 360–480 (antes do desconto por volume) |
| Terminal adicional, por mês | R$ ___ | R$ ___ | R$ ___ | R$ 40–80 (seção 8.2: a TV é o maior custo de nuvem) |
| Bloco de 10 usuários a mais, por mês | R$ ___ | R$ ___ | R$ ___ | R$ 50–100 |
| WhatsApp, por mês (F2b) | — | R$ ___ | Incluído até ___ | Custo da Meta ~R$ 0,035 por mensagem de utilidade ([docs/13](../13-notificacoes-e-alertas.md#canais)) |
| API pública e webhooks, por mês (F3) | — | R$ ___ | Incluído | — |
| Gateway reserva no local, por mês | — | — | R$ ___ | Custo do kit em 36 meses + margem (seção 7) |

**Exemplo de fatura (só para conferir a conta):** Pro com 20 máquinas a R$ ___ = 20 × R$ ___ = R$ ___ por mês, mais a taxa de implantação (seção 5), uma vez, e o hardware conforme a D2.

## 5. Taxa de implantação **[PROPOSTA]**

Cobrada uma vez. **Fórmula:** valor fixo por cliente + valor por máquina + (no comodato) parte do hardware por gateway.

| Parcela | Valor | Faixa **[HIPÓTESE]** |
|---|---|---|
| Fixo por cliente (primeira unidade) | R$ ___ | R$ 4.000–8.000 |
| Por unidade adicional | R$ ___ | R$ 2.000–4.000 |
| Por máquina | R$ ___ | R$ 300–700 |
| Por gateway, no comodato (parte do hardware) | R$ ___ | R$ 1.500–2.500 (cerca de 50% do kit, seção 8.3) |

**Inclui:**
- diagnóstico e **uma** visita técnica ([onboarding, §4](onboarding-comercial.md#4-visita-técnica));
- criação do cliente, unidades, linhas, turnos, produtos, motivos e metas (D12);
- instalação e ativação dos gateways;
- cadastro das máquinas e tags, usando o template do bloco OEE ou de sinais discretos;
- conferência das contagens com o CLP em 3 turnos (critério do [docs/09](../09-roadmap.md));
- pareamento dos terminais;
- treinamento por papel, até ___ turmas ([onboarding, §9](onboarding-comercial.md#9-treinamento-por-papel));
- **30 dias de acompanhamento** depois do Ativo.

**Não inclui:** programação do CLP (seção 6), infraestrutura elétrica e de rede, switch OT, módulo de I/O, deslocamento acima de **[PREENCHER: 150] km** da base da Engemase (km + diária) e visitas extras.

**Pagamento:** 50% no Pedido e 50% no Ativo.

## 6. Serviços avulsos **[PROPOSTA]**

| Serviço | Unidade | Preço | Faixa **[HIPÓTESE]** |
|---|---|---|---|
| Hora técnica de automação (base dos itens abaixo) | Hora | R$ ___ | R$ 150–250 |
| **Bloco OEE no CLP**, classe I1 (seção 6.1) | Máquina | R$ ___ | 4–8 h |
| Bloco OEE no CLP, classe I2 | Máquina | R$ ___ | 8–16 h |
| Bloco OEE no CLP, classe I3 (módulo ou gateway de protocolo) | Máquina | R$ ___ + material | 16–32 h + material |
| Máquina nova depois da implantação (cadastro, tags, conferência) | Máquina | R$ ___ | Igual à parcela por máquina da seção 5 |
| Módulo de I/O remoto Modbus TCP (máquina sem CLP acessível) | Máquina | R$ ___ + material | Material + 4–8 h |
| Switch OT no painel, quando a planta não tiver (D27 provisória) | Unidade | R$ ___ | Custo + margem |
| Roteador 4G industrial homologado (planta sem rede de saída) | Unidade | R$ ___ + chip | Custo + margem |
| Visita técnica extra | Diária | R$ ___ + deslocamento | R$ 1.200–2.000 |
| Treinamento extra | Turma (até 10 pessoas) | R$ ___ | R$ 800–1.500 |
| Integração com ERP/MES, relatório sob medida | Projeto | Sob orçamento | — |
| Migração de histórico de planilhas | Projeto | Sob orçamento | — |

### 6.1 Classe de integração por máquina (D26)

O preço do bloco OEE depende do CLP. A classe sai do [guia por fabricante](../operacao/adaptacoes-por-fabricante.md#2-marcas-prioritárias-resumo) e é definida na visita técnica.

| Classe | Quando | Exemplos (marcas prioritárias) |
|---|---|---|
| **I0** (sem serviço) | O CLP já expõe o bloco OEE ou os sinais por Modbus | Máquina já integrada por outro projeto |
| **I1** | Servidor Modbus nativo ou só configuração; software gratuito ou do cliente | Schneider M221 (sem ST: lógica em Ladder), Rockwell Micro820/850/870, ABB AC500-eCo V3 |
| **I2** | Servidor no programa ou configurável, com o FB em ST | Siemens S7-1200/S7-1500 (`MB_SERVER`, TIA Portal), Schneider M241/M251/M262/M340/M580, ABB AC500 V2 e V3 |
| **I3** | Sem servidor nativo, exige módulo, licença ou gateway de protocolo | Rockwell CompactLogix/ControlLogix, Siemens S7-300/400 (biblioteca paga), RTU por módulo serial |

**Condições do serviço:**
- O cliente fornece o programa atual do CLP, as senhas e a **autorização escrita do fabricante da máquina** quando ela estiver em garantia. Mexer no programa sem isso pode tirar a garantia da máquina.
- Licença do software do CLP (TIA Portal, Studio 5000, Control Expert): do cliente ou da Engemase **[DECIDIR]**.
- Só leitura: o bloco não muda a lógica da máquina, só acrescenta o FB e a cópia para os registradores ([bloco OEE v1](../operacao/bloco-oee-v1.md)).

## 7. Hardware do gateway: três opções (D2 aberta)

A equipe técnica propôs o **comodato** como escolha provisória ([docs/17 §3](../17-backlog-e-pendencias.md#3-decisões)). O texto contratual das três opções está no [Anexo H](juridico/01-anexo-h-hardware.md).

| | Comodato **[PADRÃO PROPOSTO]** | Venda | Locação |
|---|---|---|---|
| Dono do hardware | Engemase | Cliente, depois de pago | Engemase |
| Quanto o cliente paga | Parte do kit na taxa de implantação (seção 5) | Preço de venda: R$ ___ por gateway | Aluguel: R$ ___ por gateway por mês |
| Faixa **[HIPÓTESE]** | R$ 1.500–2.500 por gateway na implantação | R$ 5.000–6.500 por gateway | R$ 150–220 por gateway por mês |
| Investimento da Engemase | Alto: o kit inteiro, recuperado em ~36 meses | Nenhum (capital de giro até receber) | Alto, recuperado pelo aluguel |
| Troca por defeito | Engemase, sem custo, no prazo do [SLA](sla-e-suporte.md#11-troca-de-hardware-em-campo) | Garantia de ___ meses; depois, paga | Engemase, sem custo, no prazo do SLA |
| Fim do contrato | Devolve em 30 dias; não devolvido = valor de reposição R$ ___ | Fica com o cliente, sem coleta | Devolve em 30 dias |
| Prazo mínimo | 12 meses (o kit precisa se pagar) | Nenhum para o hardware | 12 meses |
| Multa de saída antecipada | Proporcional ao kit não amortizado **[ADVOGADO]** | — | Aluguéis restantes ou proporcional **[ADVOGADO]** |
| Nota fiscal **[CONTADOR]** | Remessa em comodato, sem venda | **Venda de mercadoria**: ICMS e, como a Engemase importa, possivelmente IPI (importador equiparado a industrial). Exige inscrição estadual | Locação de bem móvel: **sem ISS** (STF, Súmula Vinculante 31). Fatura separada da assinatura |
| Bom para | Frota padronizada sob controle da Engemase (D13, OTA, troca rápida); menor barreira de entrada | Cliente que exige ter o ativo (normalmente Enterprise) | Cliente que não quer pagar implantação alta, mas aceita mensalidade maior |

**Em todas as opções:** o software do gateway é licenciado, nunca vendido; só a Engemase configura e atualiza (D13); sem assinatura ativa, o gateway não envia dados.

## 8. Base de custo

> Preços públicos consultados em **12/11/2026** por busca na web. As páginas oficiais não puderam ser abertas diretamente nesta sessão: os números vêm dos trechos dessas páginas nos resultados de busca e de comparadores. **Conferir cada um antes de fechar preço.** Câmbio de referência: **US$ 1 = R$ 5,50** (fechamento de 09/11/2026: R$ 5,51).

### 8.1 Fornecedores

| Fornecedor | Plano | Preço público | Para nós | Fonte |
|---|---|---|---|---|
| **Vercel** | Pro | US$ 20/mês de plataforma, com **US$ 20 de crédito de uso**; assento extra que faz deploy, US$ 20/mês | 1 a 2 assentos | [1] [2] |
| Vercel, uso em São Paulo (`gru1`) | Pro | Edge Requests: 10 milhões inclusos, depois **US$ 3,20 por milhão**. Transferência: 1 TB incluso, depois US$ 0,22/GB. CPU ativa: **US$ 0,221/hora** (16 h inclusas). Memória: US$ 0,0183/GB-hora (1.440 GB-h inclusos). Invocações: 1 milhão inclusas, depois a partir de US$ 0,60 por milhão | Varia com gateways e, principalmente, **telas abertas** (8.2) | [3] [4] |
| **Neon** | Scale (recomendado) | Compute **US$ 0,222/CU-hora**; armazenamento US$ 0,35/GB-mês; histórico para restauração (PITR) US$ 0,20/GB-mês; **SLA de 99,95%**; restauração até **30 dias** | 0,25 a 1 CU ligado 24/7 ([docs/06](../06-banco-de-dados.md#custo-de-referência-estimativa-de-nov2026-confirmar-na-página-de-preços)) | [5] [6] [7] |
| Neon | Launch | Compute US$ 0,106/CU-hora; **sem SLA**; restauração até 7 dias | Só para dev e preview | [5] [6] |
| **Sentry** | Team | ~US$ 26/mês (anual) ou ~US$ 29/mês (mensal), 50 mil erros/mês | 1 conta | [8] |
| **Resend** | Pro | US$ 20/mês para 50 mil e-mails; US$ 0,90 por mil a mais | Gratuito no MVP; Pro quando entrarem os e-mails de alerta (F2a) | [9] |
| **Tailscale** | Standard | **US$ 8 por usuário/mês**; dispositivos marcados (gateways) além de 50 por ~US$ 1/mês cada [CONFIRMAR] | Técnicos da Engemase (F2, só se houver acesso remoto) | [10] |
| Página de status | Better Stack gratuito ou Instatus | US$ 0 a ~20/mês | Ver [SLA, §8](sla-e-suporte.md#8-página-de-status) | [SLA] |
| Ferramenta de chamados | Jira Service Management Free | US$ 0 até 3 agentes; ~US$ 20–24 por agente depois | Ver [SLA, §7](sla-e-suporte.md#7-ferramenta-de-chamados) | [SLA] |

**Impostos na compra:** pagamento em dólar no cartão tem IOF de compra internacional; remessa como importação de serviço pode ter IRRF, CIDE, PIS/COFINS-Importação e ISS. **[CONTADOR: alíquotas e a melhor forma de pagar cada fornecedor.]**

### 8.2 Custo de nuvem por cenário **[ESTIMATIVA]**

Premissas (de [docs/02](../02-arquitetura.md#números-de-referência) e [docs/05](../05-plataforma-web.md#dados-ao-vivo)):
- gateway faz `/sync` a cada 10 s: **~260 mil requisições por gateway por mês**;
- **TV e telas ao vivo consultam a cada 2 s:** uma TV ligada 24 horas faz **~1,3 milhão de requisições por mês**;
- tablet do operador: ~0,2 requisição por segundo; pessoa no navegador: ~2 h por dia útil;
- 15 ms de CPU ativa por requisição, em média (a medir no PoC W3).

| Cenário | Piloto | Primeiro ano (D35) | Meta (D35) |
|---|---|---|---|
| Máquinas / gateways / TVs / tablets / usuários | 10 / 2 / 2 / 2 / 10 | 100 / 20 / 20 / 10 / 30 | 500 / 100 / 100 / 50 / 150 |
| Requisições por mês | ~5 milhões | ~39 milhões | ~195 milhões |
| Vercel (plataforma + assento + uso) | US$ 20–40 | US$ 170–200 | US$ 950–1.050 |
| Neon Scale (compute 24/7 + armazenamento + histórico) | US$ 40–50 (0,25 CU) | US$ 50–175 (0,25–1 CU) | US$ 185–375 (1–2 CU) |
| Sentry, Resend, status, chamados, cópia externa, Tailscale (F2) | US$ 25–35 | US$ 30–145 | US$ 100–300 |
| **Total por mês** | **US$ 85–125 ≈ R$ 470–690** | **US$ 250–520 ≈ R$ 1.380–2.860** | **US$ 1.240–1.730 ≈ R$ 6.800–9.500** |
| **Por máquina por mês** | **R$ 47–69** | **R$ 14–29** | **R$ 14–19** |

**O que esta conta mostra:**
- **A TV é o maior custo variável.** Uma TV ligada 24 h custa ~US$ 6 por mês (~R$ 33) na Vercel em São Paulo, quase todo em Edge Requests. Um gateway custa ~US$ 1,20 por mês. Na meta de 500 máquinas, as 100 TVs são ~60% da conta da Vercel. Por isso o plano limita os terminais incluídos e cobra o adicional.
- **No começo, o custo fixo pesa.** Com só o piloto na plataforma, cada máquina custa R$ 50–70 de nuvem. A partir de ~100 máquinas fica abaixo de R$ 30.
- **A nuvem é pequena perto das pessoas** (8.4).

### 8.3 Hardware por gateway (comodato e locação) **[HIPÓTESE, exceto o R1000]**

| Item | Valor | Origem |
|---|---|---|
| Seeed reComputer R1000 sem rádio, nacionalizado por courier | **R$ 2.400–2.700** | [docs/03](../03-gateway.md#compra-impostos-e-anatel) (estimativa; pedir cotação formal) |
| Kit: fonte 24 V DIN, disjuntor, DPS, caixa, SuperCAP, bornes, terminação 120 Ω, cabos (D27 provisória) | R$ ___ (hipótese R$ 600–1.200) | A cotar |
| Montagem e teste de bancada B0–B6 (24 h de coleta, 30 cortes de energia) | R$ ___ (hipótese R$ 200–400) | [docs/16 §7](../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida) |
| Frete até o cliente | R$ ___ (hipótese R$ 50–150) | A cotar |
| **Total por gateway** | **R$ 3.250–4.450** | — |
| Estoque de reserva para trocas | +10% da frota (mínimo 2 unidades) | [SLA, §11](sla-e-suporte.md#11-troca-de-hardware-em-campo) |
| **Custo mensal no comodato (36 meses + reserva)** | **~R$ 100–140 por gateway** | Com ~5 máquinas por gateway: R$ 20–28 por máquina |

A importação formal (frota) deve baixar o custo do R1000. Até lá, vale o courier.

### 8.4 Custo direto por máquina (cenário de 100 máquinas) **[HIPÓTESE]**

| Parcela | R$ por máquina por mês | Como chegar ao número |
|---|---|---|
| Nuvem | 15–28 | Seção 8.2 |
| Hardware em comodato (se a D2 ficar assim) | 20–28 | Seção 8.3 |
| Suporte N1 e N2 | ___ (hipótese 40–80) | Custo total de cada analista ÷ máquinas que ele atende (hipótese: 1 analista para 300–500 máquinas) |
| Plantão (Pro e Enterprise) | ___ | Sobreaviso: 1/3 da hora normal por hora de escala (CLT, art. 244, § 2º; TST, Súmula 428) + horas acionadas |
| Pedidos de configuração (D12) | ___ | Horas por mês por cliente × custo da hora |
| **Custo direto total** | **~R$ 80–140** | Sem desenvolvimento, comercial e administração |

## 9. Referência de mercado

Preços **públicos** de soluções de OEE e monitoramento de máquinas. Quase todos são estrangeiros: **não achamos tabela pública em reais** de fornecedores brasileiros (LiveMES, Fábrica ao Vivo da Senior e Tractian vendem por cotação).

| Solução | País | Preço público por máquina por mês | Hardware | Fonte |
|---|---|---|---|---|
| Evocon | Estônia | US$ 219 (Basic), 289 (Professional), 379 (Enterprise) em contrato de 1 ano; US$ 189 a 319 em 3 anos (≈ R$ 1.040–2.080) | Dispositivo à parte: US$ 24/mês (1 ano) | [11] |
| FourJaw | Reino Unido | £ 45 (Essential), £ 90 (Standard), £ 180 (Pro), mensal; ~20% menos no anual. **Mínimo de 5 máquinas** | £ 200 por máquina, uma vez | [12] |
| Digit | EUA | US$ 149,99 (≈ R$ 825) | — | [13] |
| TrackMyMachines | Reino Unido | £ 55, tudo incluso | — | [14] |
| Scytec DataXchange | EUA | A partir de US$ 50 (≈ R$ 275) | — | [15] |
| Faixas de guias de compra 2026 | — | US$ 30–150 (TEEPTRAK); € 50–400 (Fabrico); entrada US$ 99–249, intermediário US$ 200–450 (Fabrico) | US$ 200–2.000 por máquina, uma vez (TEEPTRAK) | [16] [17] |
| LiveMES, Senior (Fábrica ao Vivo), Tractian | Brasil | Sob cotação; LiveMES cobra mensalidade por máquina monitorada | — | [18] [19] |

**Leitura:**
- O mercado cobra **por máquina por mês**, como a D1. Hardware costuma ser à parte.
- A faixa de entrada internacional (US$ 50–150 ≈ R$ 275–825) fica **acima** da hipótese Starter. É de propósito: preço em reais para pequena e média indústria brasileira, sem custo de dólar no hardware para o cliente (comodato).
- Valor de referência para a venda: **ganho de 1 ponto de OEE** numa máquina = 1% × horas planejadas × margem por hora. Ex.: 400 h/mês × R$ 200/h de margem = **R$ 800 por mês por ponto de OEE**. Com 3 a 5 pontos de ganho, a mensalidade se paga várias vezes.

## 10. Método de precificação

Três contas, e o preço fica onde as três concordam.

1. **Piso pelo custo:** `preço mínimo = custo direto ÷ (1 − impostos − margem)`.
   - Custo direto da seção 8.4. Impostos sobre a receita **[CONTADOR]** (hipótese: 15%). Margem de contribuição desejada **[DECIDIR]** (hipótese: 45%; SaaS maduro costuma ter margem bruta acima de 70%).
   - O custo muda por plano, porque o atendimento muda ([SLA](sla-e-suporte.md)):

| Plano | Custo direto **[HIPÓTESE]** | Piso: custo ÷ (1 − 0,15 − 0,45) |
|---|---|---|
| Starter (sem plantão, prazos maiores) | R$ 80 | **R$ 200** |
| Pro (plantão seg. a sáb.) | R$ 110 | **R$ 275** |
| Enterprise (plantão 24×7, reunião mensal) | R$ 140 | **R$ 350** |
2. **Teto pelo mercado:** seção 9. A Engemase compete com soluções estrangeiras de R$ 275 a R$ 2.000 por máquina e com planilha (custo zero, mas sem dado confiável).
3. **Valor para o cliente:** seção 9, ganho por ponto de OEE. A mensalidade deve ser menos de 1/5 do ganho esperado.

**Como validar a faixa (antes de fixar):**
- Mostrar a matriz de planos (sem preço) a 5–10 indústrias do perfil e perguntar quanto achariam barato, caro e caro demais por máquina por mês.
- Usar o piloto pago ([onboarding, §6](onboarding-comercial.md#6-piloto)) como primeira prova de preço.
- Revisar os preços depois dos 3 primeiros clientes pagantes, com o custo real de suporte e de configuração (D12).

## 11. Pendências do dono do produto

| # | Escolha | Proposta neste documento |
|---|---|---|
| 1 | Mensalidade por máquina de cada plano | Faixas da seção 4 |
| 2 | Taxa de implantação (fixo, por unidade, por máquina, por gateway) | Seção 5 |
| 3 | Preços dos serviços avulsos e da hora técnica | Seção 6 |
| 4 | **D2 (hardware):** comodato, venda ou locação, e os valores | Comodato provisório (seção 7) |
| 5 | Mínimo de máquinas por plano e prazo mínimo | 5 / 10 / 40 e 12 meses |
| 6 | Terminais incluídos por plano e preço do adicional | 2 / 1 por linha até 10 / conforme Pedido |
| 7 | Descontos por volume, prazo e pagamento anual | Seção 3.3 |
| 8 | Início da cobrança: Ativo ou 30 dias depois do primeiro gateway | Seção 3.2 |
| 9 | Margem desejada | Hipótese de 45% (seção 10) |
| 10 | Licença do software de CLP nos serviços: do cliente ou da Engemase | Seção 6.1 |
| 11 | **D3:** prazos de inadimplência | Seção 3.4 |

## Fontes

Consultadas em 12/11/2026 por busca na web. Conferir na página oficial antes de usar.

- [1] Vercel, plano Pro (US$ 20 de plataforma com US$ 20 de crédito; assentos): <https://vercel.com/docs/plans/pro-plan>
- [2] Vercel, preços: <https://vercel.com/pricing>
- [3] Vercel, preços regionais de São Paulo (`gru1`): <https://vercel.com/docs/pricing/regional-pricing/gru1>
- [4] Vercel, preços do Fluid compute: <https://vercel.com/docs/fluid-compute/pricing>
- [5] Neon, preços e planos: <https://neon.com/pricing> · <https://neon.com/docs/introduction/plans> · <https://neon.com/blog/new-usage-based-pricing>
- [6] Neon, janela de restauração (Launch até 7 dias, Scale até 30, padrão 1 dia): <https://neon.com/docs/introduction/restore-window>
- [7] Neon, SLA: <https://neon.com/sla>
- [8] Sentry, preços: <https://sentry.io/pricing/> · <https://docs.sentry.io/pricing> · comparação de 2026: <https://www.activepieces.com/blog/sentry-pricing-2026-developer-team-business-plans>
- [9] Resend, preços: <https://resend.com/pricing> · <https://resend.com/changelog/pay-as-you-go-pricing>
- [10] Tailscale, preços: <https://tailscale.com/pricing> · resumo de 2026: <https://www.activepieces.com/blog/tailscale-pricing-plans-costs-and-features-2026>
- [11] Evocon, preços: <https://evocon.com/pricing> · guia: <https://www.fabrico.io/blog/evocon-pricing-guide-2026/>
- [12] FourJaw, preços: <https://fourjaw.com/pricing>
- [13] Digit, preços: <https://monitoring.digit-software.com/pricing>
- [14] TrackMyMachines (Capterra): <https://www.capterra.com/p/10024919/TrackMyMachines/>
- [15] Shop Floor Automations / Scytec (Software Advice): <https://www.softwareadvice.com/iot/shop-floor-automations-profile/>
- [16] Fabrico, guia de preços de software de OEE 2026: <https://www.fabrico.io/blog/oee-software-pricing-guide-2026/>
- [17] TEEPTRAK, custo de software de OEE em 2026: <https://teeptrak.com/en/?p=125015>
- [18] LiveMES, planos: <https://www.livemes.com/plan/?lang=en>
- [19] Tractian, OEE: <https://tractian.com/solucoes/oee>
- Câmbio de 09/11/2026: <https://brasil61.com/n/dolar-hoje-fecha-em-leve-alta-a-r-5-51-apos-oscilar-entre-queda-e-valorizacao-bras2617447>
- Locação de bem móvel sem ISS: STF, Súmula Vinculante 31. Sobreaviso: CLT (Decreto-Lei 5.452/1943), art. 244, § 2º, <https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm>, e TST, Súmula 428.
