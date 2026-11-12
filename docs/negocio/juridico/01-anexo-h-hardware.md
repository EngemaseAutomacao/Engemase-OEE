# Anexo H — Hardware do gateway (três alternativas)

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Anexo do [Contrato de assinatura](01-contrato-de-assinatura.md). **D2 (hardware: venda, comodato ou locação) está em aberto.** Use **uma** das alternativas abaixo e apague as outras. A equipe técnica propôs o **comodato** como escolha provisória ([docs/17 §3](../../17-backlog-e-pendencias.md#3-decisões)).

## Comparação rápida

| | A. Comodato **[PADRÃO PROPOSTO]** | B. Venda | C. Locação |
|---|---|---|---|
| Dono do hardware | Engemase | Cliente, depois de pago | Engemase |
| Quanto o Cliente paga pelo hardware | Parte na taxa de implantação | Preço de venda | Aluguel mensal por gateway |
| Troca por defeito | Engemase, sem custo (salvo mau uso) | Garantia do fabricante; depois, paga | Engemase, sem custo (salvo mau uso) |
| No fim do contrato | Devolve em 30 dias | Fica com o Cliente, sem software ativo | Devolve em 30 dias |
| Lei de referência | Código Civil, arts. 579 a 585 | Código Civil, arts. 481 e seguintes | Código Civil, arts. 565 a 578 |
| Ponto de atenção | Prazo mínimo de 12 meses | Gateway sem assinatura não coleta | Tributação diferente (ver C.6) |

## Cláusulas comuns às três alternativas

H.1. **Equipamento.** Gateway Engemase: computador industrial Seeed reComputer R1000, **sem rádio** (sem Wi-Fi, Bluetooth ou 4G), em caixa pré-montada pela Engemase, com fonte e módulo de energia de reserva, identificado por número de série `EGW-NNNNN` [CONFIRMAR: kit padrão, D27 provisória]. Switch para a rede das máquinas só se a planta não tiver, cobrado à parte.

H.2. **Software.** O Software do Gateway é **licenciado** pelo Contrato de assinatura, nunca vendido, em qualquer alternativa. Sem assinatura ativa, o Gateway não envia dados à Plataforma.

H.3. **Instalação.** Feita ou acompanhada pela Engemase, conforme a [ficha técnica de TI](../../operacao/ficha-tecnica-ti-cliente.md). O Cliente fornece 24 VDC do painel com proteção (fusível ou disjuntor e DPS), local no trilho DIN até 50 °C, rede e liberação de saída.

H.4. **Administração.** Só a Engemase configura e atualiza o Gateway (D13). O Cliente não altera o software, a imagem do sistema nem os lacres. Alterações feitas pelo Cliente tiram a garantia de funcionamento.

H.5. **Somente leitura.** O Gateway só lê os CLPs (versão 1). Não escreve, não roteia entre a rede das máquinas e a rede da empresa e não recebe conexões de entrada.

H.6. **Dados no equipamento.** O Gateway guarda dados de produção (até 30 dias ou 1 GB), a configuração de rede do Cliente (que pode incluir senha de proxy) e registros técnicos. Antes de reuso, devolução ao fabricante ou descarte, a Engemase apaga esses dados pelo nível adequado e emite **termo de eliminação** por unidade (número de série, método, data, responsável) ([rascunho do ciclo de vida, §7.5](../../rascunhos/gateway-preparacao-e-ciclo-de-vida.md#75-apagamento-seguro-e-lgpd)).

H.7. **Conformidade.** [CONFIRMAR: consulta a um OCD sobre a necessidade de homologação na ANATEL para equipamento sem rádio, e NCM com o despachante (docs/17 §6).]

H.8. **Descarte ambiental.** Equipamento da Engemase no fim da vida útil vai para recicladora licenciada, com certificado de destinação final (Lei 12.305/2010). [CONFIRMAR com consultoria ambiental.]

---

## Alternativa A — Comodato **[PADRÃO PROPOSTO — D2 em aberto]**

A.1. **Objeto.** A Engemase empresta ao Cliente, de graça e pelo prazo do Contrato de assinatura, os Gateways listados no Pedido (Código Civil, art. 579). Os Gateways continuam sendo da Engemase.

A.2. **Custo.** A taxa de implantação do Pedido cobre parte do hardware. Não há aluguel. **[ADVOGADO: o comodato é gratuito (Código Civil, art. 579). Conferir se a taxa de implantação cobrindo parte do hardware não o descaracteriza; se preciso, descrever no Pedido a taxa só como serviço de implantação.]**

A.3. **Prazo mínimo.** O Contrato de assinatura tem prazo mínimo de 12 meses (cláusula 15.1).

A.4. **Deveres do Cliente:**
- (a) guardar e conservar os Gateways como se fossem seus (Código Civil, art. 582);
- (b) usar só para a Plataforma, só no local da instalação;
- (c) não abrir, não remover lacres, não emprestar, não vender, não dar em garantia;
- (d) avisar a Engemase em até [PREENCHER: 2] dias úteis sobre dano, furto, perda ou mudança de local;
- (e) não deixar terceiros penhorarem ou retirarem o equipamento; se acontecer, avisar na hora e informar que o bem é da Engemase.

A.5. **Defeito.** A Engemase troca o Gateway com defeito sem custo, no prazo do SLA. O novo Gateway herda a configuração. Dano por mau uso, descarga elétrica sem a proteção da cláusula H.3, umidade ou violação de lacre é cobrado pelo valor de reposição de [PREENCHER: R$].

A.6. **Seguro.** [OPCIONAL] O Cliente inclui os Gateways no seguro patrimonial da planta.

A.7. **Devolução.** No fim do Contrato, o Cliente devolve os Gateways em até **30 dias**. A Engemase agenda a coleta; **o frete é do Cliente** **[PADRÃO PROPOSTO — D4]**. Gateway não devolvido no prazo é cobrado pelo valor de reposição de [PREENCHER: R$], corrigido.

A.8. **Dados.** Antes da coleta, se o Gateway estiver online, a Engemase apaga os dados remotamente (quando disponível, Fase 2). Senão, apaga na bancada, na chegada. Termo de eliminação conforme H.6.

---

## Alternativa B — Venda

B.1. **Objeto.** A Engemase vende ao Cliente os Gateways listados no Pedido, pelo preço do Pedido. A propriedade passa ao Cliente com o pagamento integral.

B.2. **Nota fiscal e entrega.** [PREENCHER: prazo de entrega, frete, local.]

B.3. **Garantia.** [PREENCHER: prazo] contra defeito de fabricação, conforme a garantia do fabricante repassada pela Engemase. Fora da garantia, troca e conserto são cobrados.

B.4. **Software e administração.** Mesmo sendo dono do hardware, o Cliente aceita que só a Engemase administra o software durante a assinatura (H.2 e H.4).

B.5. **Fim da assinatura.** O Gateway deixa de enviar dados (a Engemase revoga a credencial). O hardware fica com o Cliente. A Engemase recomenda apagar os dados antes de reuso ou descarte e pode fazer isso como serviço, com termo de eliminação.

B.6. **Quando faz sentido.** Por pedido do Cliente, em geral no Plano Enterprise **[PADRÃO PROPOSTO — D2]**.

---

## Alternativa C — Locação

C.1. **Objeto.** A Engemase aluga ao Cliente os Gateways listados no Pedido, pelo prazo do Contrato de assinatura (Código Civil, art. 565). Os Gateways continuam sendo da Engemase.

C.2. **Aluguel.** [PREENCHER: R$ por Gateway por mês], cobrado na mesma fatura ou em fatura separada [ADVOGADO e contador].

C.3. **Manutenção.** A Engemase troca o Gateway com defeito sem custo, no prazo do SLA. Mau uso é cobrado como em A.5.

C.4. **Deveres do Cliente.** Os mesmos de A.4.

C.5. **Devolução e dados.** Como em A.7 e A.8.

C.6. **Tributação.** Locação de bem móvel não é serviço: não incide ISS (Supremo Tribunal Federal, Súmula Vinculante 31). Por isso o aluguel deve ficar separado da assinatura. [CONFIRMAR com o contador o regime e a nota correta.]

---

## Fontes

- Código Civil (Lei 10.406/2002): comodato (arts. 579 a 585), compra e venda (arts. 481 e seguintes), locação de coisas (arts. 565 a 578): <https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm>
- Lei 12.305/2010 (Política Nacional de Resíduos Sólidos): <https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12305.htm>
- Supremo Tribunal Federal, Súmula Vinculante 31 (ISS sobre locação de bens móveis).
