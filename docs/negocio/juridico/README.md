# Jurídico e LGPD — minutas

> **Minuta para revisão por advogado; não usar sem revisão.** Vale para todos os documentos desta pasta.
>
> Versão 0.1 · 12/11/2026 · Fecha a parte de texto da lacuna **L7** ([docs/17 §4](../../17-backlog-e-pendencias.md#4-lacunas-de-especificação)). Falta a revisão jurídica, a nomeação do encarregado e a assinatura (seção 6).

**Para quem:** direção da Engemase, advogado que vai revisar, comercial (contrato e anexos) e equipe técnica (o que o produto precisa ter para cumprir o que está escrito).

## 1. Índice

| Arquivo | O que é | Quem assina ou publica |
|---|---|---|
| [01-contrato-de-assinatura.md](01-contrato-de-assinatura.md) | Contrato SaaS: licença de uso, cobrança por máquina e planos (D1), níveis de serviço pelo SLA, suspensão e encerramento (30 + 30 dias, CSV), propriedade dos dados, acesso da Engemase (D5), retenção (D6), limitação de responsabilidade | Engemase e cliente |
| [01-anexo-h-hardware.md](01-anexo-h-hardware.md) | Anexo H do contrato: gateway em **comodato, venda ou locação** (D2 aberta; usar uma alternativa) | Engemase e cliente |
| [02-acordo-de-tratamento-de-dados.md](02-acordo-de-tratamento-de-dados.md) | DPA (Anexo C): cliente controlador, Engemase operadora; suboperadores com país e finalidade; transferência internacional; segurança; incidentes; auditoria; devolução e eliminação | Engemase e cliente |
| [03-termos-de-uso.md](03-termos-de-uso.md) | Termos de uso da plataforma (Anexo D), com aceite no primeiro login | Publicado na plataforma |
| [04-politica-de-privacidade.md](04-politica-de-privacidade.md) | Política de privacidade: os dois papéis da Engemase, dados, bases legais, cookies, retenção, direitos | Publicado na plataforma |
| [05-operador-de-chao.md](05-operador-de-chao.md) | Operador de chão: dados mínimos, base legal provável, aviso no terminal e comunicado aos empregados | Uso interno e modelo para o cliente |
| [06-plano-de-resposta-a-incidentes.md](06-plano-de-resposta-a-incidentes.md) | Papéis, severidade, prazos internos, comunicação ao cliente e à ANPD, modelos | Uso interno |
| [07-registro-das-operacoes-de-tratamento.md](07-registro-das-operacoes-de-tratamento.md) | ROPA da Engemase como operadora e como controladora | Uso interno (mostrar à ANPD se pedido) |

**Documentos de outras áreas citados:** SLA e suporte ([`../sla-e-suporte.md`](../sla-e-suporte.md), lacuna L11), planos e preços (L9), onboarding comercial (L10) e a [ficha técnica para o TI do cliente](../../operacao/ficha-tecnica-ti-cliente.md).

## 2. Marcações

| Marcação | Significa |
|---|---|
| **[PREENCHER: ...]** | Dado a completar (razão social, valores, contatos, prazos comerciais) |
| **[PADRÃO PROPOSTO — Dx]** | Texto baseado na escolha **provisória** da equipe técnica para uma decisão ainda aberta ([docs/17 §3](../../17-backlog-e-pendencias.md#3-decisões)). Muda se o dono do produto decidir diferente |
| **[PROPOSTA]** | Sugestão desta minuta, ainda sem decisão no projeto |
| **[OPCIONAL]** | Cláusula que pode sair |
| **[CONFIRMAR: ...]** | Fato a conferir: fornecedor, norma no Diário Oficial ou produto |
| **[ADVOGADO: ...]** | Ponto que precisa de opinião jurídica |
| **[DECIDIR]** | Escolha da Engemase ainda não feita (ex.: região do Sentry) |

## 3. Quem é quem (resumo)

| Dados | Controlador | Engemase |
|---|---|---|
| Vínculos dos usuários com o cliente (papel, escopo), o que fazem dentro do cliente, operadores de chão, apontamentos, auditoria do cliente, notificações | Cliente | **Operadora** (DPA) |
| **Contas de acesso** (nome, e-mail, senha, 2FA, sessões; a mesma pessoa pode ter vínculo com mais de um cliente), segurança da plataforma, registros de acesso do Marco Civil, cobrança, suporte, comercial, equipe Engemase | Engemase | **Controladora** (política de privacidade) |
| Dados de produção das máquinas | Não são dados pessoais em si; viram quando ligados a uma pessoa (quem apontou) | Trata como confidencial do cliente |

## 4. Decisões usadas

| Decisão | Situação | Onde |
|---|---|---|
| D1 Assinatura por máquina, com planos | Decidida | Contrato, cl. 3 |
| D5 Engemase sempre com acesso, com registro e faixa na tela | Decidida | Contrato, cl. 9; DPA, cl. 5; Termos, seção 6 |
| D6 Minuto 2 anos, auditoria 5 anos | Decidida | Contrato, cl. 11; DPA, Apêndice 1; Política, seção 9 |
| D7 São Paulo (Vercel `gru1`, Neon `sa-east-1`) | Decidida | Contrato, cl. 10.3 e 10.4 (contingência de região); DPA, cl. 9 e 9.6 |
| D11 Escopo por máquina | Decidida | Termos, seção 3; DPA, Apêndice 2 |
| D12 e D13 Configuração só pela Engemase; usuários pelo admin do cliente | Decididas | Contrato, cl. 4 e 5; Termos, seção 3 |
| D28 Endereço da Vercel por enquanto | Decidida | Contrato, cl. 1 e 19.3; Termos, 1.3 |
| D38 RLS por variável de sessão, com limite | Decidida | DPA, cl. 7.2 (limite declarado ao cliente) |
| D2 Hardware | **Aberta** (provisório: comodato) | Anexo H com as três alternativas |
| D3 Inadimplência | **Aberta** (provisório: aviso em 5 dias, suspensão em 30) | Contrato, cl. 14 |
| D4 Encerramento | **Aberta** (provisório: 30 + 30 dias, CSV, devolução do gateway em 30 dias) | Contrato, cl. 16; Anexo H |
| D14 2FA | **Aberta** (provisório: obrigatório para Engemase e admin do cliente) | Termos, 2.4 |
| D18 e L19 Operador escolhido numa lista; lista por unidade | **Abertas** (provisório) | Nota do operador de chão |
| D20 Aprovação de cada sessão de acesso remoto | **Aberta** (provisório: cada sessão aprovada pelo admin) | Contrato, cl. 9.6 |

**Endereço da plataforma:** `https://engemase-oee.vercel.app` aparece em um lugar por documento (contrato, cl. 1; termos, 1.3). Ao trocar para o domínio próprio, basta mudar esses dois pontos e a [ficha técnica de TI](../../operacao/ficha-tecnica-ti-cliente.md).

## 5. Regras consultadas (estado em 12/11/2026)

| Regra | O que importa aqui | Onde aparece |
|---|---|---|
| **LGPD** (Lei 13.709/2018) | Papéis de controlador e operador (art. 5º), bases legais (art. 7º e 10), adolescentes (art. 14), eliminação e conservação (art. 16), direitos (arts. 18 e 19), transferência internacional (art. 33), registro (art. 37), operador segue instruções (art. 39), encarregado (art. 41), responsabilidade (art. 42), segurança e incidentes (arts. 46 a 48) | Todos |
| **Resolução CD/ANPD nº 15/2024** (incidentes) | Controlador comunica a ANPD e os titulares em **3 dias úteis** do conhecimento; complemento em 20 dias úteis; comunicação obrigatória quando há risco ou dano relevante (afeta significativamente direitos **e** envolve dado sensível, de criança, adolescente ou idoso, financeiro, **de autenticação**, sigiloso ou em larga escala); registro de todo incidente por **5 anos**; prazo em dobro para agente de pequeno porte | Plano de incidentes; DPA, cl. 11 |
| **Resolução CD/ANPD nº 19/2024** (transferência internacional) | Cláusulas-padrão contratuais (Anexo II) adotadas **na íntegra e sem alteração**; servem para exportador e importador como controlador ou operador; prazo para adaptar contratos terminou em **23/08/2025** | DPA, cl. 9 e Apêndice 3 |
| **Resolução CD/ANPD nº 32/2026** (adequação da União Europeia) | A ANPD reconheceu a UE como destino com proteção adequada (janeiro de 2026), em decisão recíproca com a Comissão Europeia | DPA, cl. 9.3 (Sentry na UE) |
| **Resolução CD/ANPD nº 18/2024** (encarregado) | Controlador indica encarregado, com substituto, e divulga identidade e contato no site; para o **operador**, a indicação é **facultativa** (conta como boa prática); agente de pequeno porte dispensado deve manter canal de comunicação | Política, seção 1; seção 6 abaixo |
| **Resolução CD/ANPD nº 2/2022** (agentes de pequeno porte) | Microempresas, empresas de pequeno porte e startups, **exceto** se fizerem tratamento de alto risco, tiverem receita acima do limite legal (R$ 4,8 milhões por ano para empresa de pequeno porte; limite próprio para startups) ou pertencerem a grupo econômico acima desse limite: dispensa de encarregado (com canal de comunicação), registro simplificado, prazos em dobro [CONFIRMAR no texto oficial] | Seção 6 abaixo |
| **Marco Civil da Internet** (Lei 12.965/2014), art. 15 | Provedor de aplicação guarda os registros de acesso (IP, data e hora) por **6 meses**, em sigilo. O STJ incluiu a **porta lógica de origem** enquanto o IP for IPv4 (REsp 1.784.156/SP, 2019) | Política; ROPA CT-03 |
| **Guia da ANPD sobre legítimo interesse** (2024) | Teste de balanceamento documentado (art. 10). Base usada para contatos e representantes do cliente, que não são parte do contrato (art. 7º, V, não serve) | Política, seção 5; ROPA CT-04 |

## 6. O que falta

| # | Item | Quem | Antes de |
|---|---|---|---|
| 1 | **Revisão jurídica** de todas as minutas (proteção de dados e contratos). A nota do operador de chão também por advogado **trabalhista**; o Anexo H também pelo **contador** (venda × locação) | Direção da Engemase | Piloto |
| 2 | **Nomear o encarregado (DPO)** e um substituto, e publicar nome e contato na política. Mesmo se a Engemase puder ser dispensada como agente de pequeno porte, **a recomendação é nomear**: a Engemase acessa os dados de todos os clientes (D5) e os clientes vão pedir um contato formal. Pode ser pessoa da equipe sem conflito de interesse ou serviço externo | Direção | Piloto |
| 3 | **Confirmar o enquadramento** como agente de pequeno porte: receita bruta anual (até R$ 4,8 milhões para empresa de pequeno porte), grupo econômico e ausência de tratamento de alto risco. Muda os prazos (em dobro) e a dispensa de encarregado | Direção e contador | Piloto |
| 4 | **Cláusulas-padrão da ANPD com cada fornecedor:** conferir se os DPAs da Vercel, Neon, Sentry, Resend e Tailscale, da ferramenta de chamados (se externa), da Better Stack e do armazenamento da cópia lógica externa já as incluem; se não, assinar em instrumento separado ou trocar o fornecedor. Os termos do WhatsApp são de adesão: ver com o advogado | Direção e advogado | Primeiro dado real de cliente |
| 5 | **Confirmar onde cada fornecedor guarda os dados** (logs da Vercel, região do Blob, cópias da Neon, retenção do Resend e do Sentry, ferramenta de chamados, Better Stack) e decidir a região do Sentry (UE recomendada), a região reserva da Vercel (DPA, cl. 9.6) e o prazo máximo da cópia lógica externa (DPA, cl. 14.2) | Equipe técnica | Contas criadas (N1) |
| 6 | Preencher dados: razão social, CNPJ, endereços, foro, e-mails de privacidade, segurança e suporte, contatos 24 horas | Direção | Assinatura |
| 7 | Preços e limites dos planos (L9) e SLA (L11) para os Anexos A e B | Comercial | Venda |
| 8 | Decisões abertas que mudam o texto: D2, D3, D4, D14, D20 | Dono do produto | Assinatura |
| 9 | **Termo de piloto** (escopo, duração, critérios de saída do [docs/09](../../09-roadmap.md) e do [onboarding, seção 6](../onboarding-comercial.md)), que não está nesta pasta. No piloto, assinam-se só o termo, o DPA e os Termos de Uso. **O DPA foi escrito para valer sozinho** (definições, finalidades e regras do acesso da Engemase, encerramento e eliminação estão nele), mas o termo de piloto precisa **repetir ou incorporar por referência** as cláusulas do contrato sobre propriedade dos dados (8), confidencialidade (12) e responsabilidade (17, inclusive o limite próprio para incidentes da 17.6). Depois, a **assinatura** do contrato, do DPA e do Anexo H (eletrônica) | Direção, advogado e cliente | Piloto |
| 10 | Primeiro **exercício simulado** do plano de incidentes | Equipe Engemase | Piloto |

**O que o produto precisa ter para cumprir as minutas** (anotado aqui para a equipe técnica; nenhuma destas mudanças foi feita):

| # | Item | Documento que depende |
|---|---|---|
| P1 | Aceite dos Termos e da Política no primeiro login, com versão e data na auditoria | Termos |
| P2 | Links fixos para Termos e Política na tela de login e no rodapé | Política |
| P3 | Aviso curto no tablet, na tela de escolha do operador, com nome e canal do cliente | Nota do operador |
| P4 | Guardar eventos de login (IP, porta lógica de origem quando disponível, data e hora) por 6 meses (Marco Civil). [CONFIRMAR se a Vercel entrega a porta de origem às funções] | Política; ROPA CT-03 |
| P5 | Anonimizar a identificação do operador (por pessoa e após 2 anos); hoje `machine_state_event` tem retenção indefinida | Nota do operador; DPA |
| P6 | Exportar os registros de uma pessoa (pedido de titular) | DPA, cl. 10 |
| P7 | Eliminar ou anonimizar a conta de acesso sem vínculo depois do prazo | Política, seção 9; ROPA CT-01 |
| P8 | Validade do link e exclusão dos arquivos de exportação | DPA, Apêndice 1 |
| P9 | Sentry sem dados pessoais (sem IP, e-mail ou corpo de requisição) | DPA, Apêndice 3 |
| P10 | Exportação completa em CSV e roteiro de encerramento (dias 0, 30 e 60) com termo de eliminação, que lista as cópias de segurança e a data em que a última expira | Contrato, cl. 16 |
| P11 | Travar a retenção em 24 meses no console (hoje o campo "Retenção (meses)" de cada cliente é editável, com mínimo de 6) ou tirar o campo | Contrato, cl. 11.2 |
| P12 | Lista dos clientes já eliminados, para apagar os dados deles de novo depois de restaurar uma cópia de segurança (runbook RB-08) | Contrato, cl. 16.1; DPA, cl. 14.2 |
| P13 | Separar na auditoria os acessos da equipe Engemase, para guardar só eles depois do dia 60 | Contrato, cl. 16.3 |
| P14 | Aviso ao cliente e registro de início e fim quando as funções mudarem de região (contingência) | DPA, cl. 9.6 |

## Fontes

Consultadas em 12/11/2026. Os sites `gov.br` e `in.gov.br` não estavam acessíveis no ambiente em que estas minutas foram escritas: os pontos das resoluções foram conferidos em reproduções do Diário Oficial e em análises de escritórios. **O advogado deve conferir a redação exata no texto oficial**, em especial o art. 5º (critérios de risco) e o art. 6º (conteúdo da comunicação) da Resolução 15/2024 e o art. 17 (transparência) da Resolução 19/2024.

**Textos oficiais:**
- Lei 13.709/2018 (LGPD): <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Lei 12.965/2014 (Marco Civil da Internet): <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm>
- Resolução CD/ANPD nº 15/2024 (DOU de 26/04/2024), reprodução do Diário Oficial: <https://sintse.tse.jus.br/documentos/2024/Abr/26/diario-oficial-da-uniao-secao-1/autoridade-nacional-de-protecao-de-dados-resolucao-no-15-de-24-de-abril-de-2024-aprova-o-regulamento>
- Resolução CD/ANPD nº 18/2024 (DOU de 17/07/2024), reprodução do Diário Oficial: <https://sintse.tse.jus.br/documentos/2024/Jul/17/diario-oficial-da-uniao-secao-1/autoridade-nacional-de-protecao-de-dados-resolucao-no-18-de-16-de-julho-de-2024-aprova-o-regulamento>
- Resolução CD/ANPD nº 19/2024 (DOU de 23/08/2024), cópia em PDF: <https://arq.migalhas.com.br/arquivos/2026/2/DC8DD5485D6EBE_RESOLUCAOCD_ANPDNº19,DE23DEAGO.pdf>
- Site da ANPD (resoluções, formulário de incidente, guias): <https://www.gov.br/anpd/>

- STJ, REsp 1.784.156/SP (3ª Turma, 2019), porta lógica de origem, acórdão no site do MPF: <https://www.mpf.mp.br/atuacao/ccr2/coordenacao/comissoes-e-grupos-de-trabalho/combate-crimes-cirberneticos/pareceres-decisoes/resp-1-784-156-sp_acordao_indicacao-ipv4-1.pdf>
- ANPD, Guia orientativo: hipóteses legais de tratamento, legítimo interesse (versão 1.0, fevereiro de 2024): <https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia_legitimo_interesse.pdf>

**Análises consultadas:**
- Resolução 15/2024: Mattos Filho, <https://www.mattosfilho.com.br/unico/regulamento-incidente-seguranca/>; Machado Meyer, <https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/anpd-publica-regulamento-de-comunicacao-de-incidente-de-seguranca>; Serpro (papel do operador), <https://www.serpro.gov.br/menu/noticias/noticias-2025/incidentes-seguranca-dados-pessoais>
- Resolução 19/2024: Mattos Filho, <https://www.mattosfilho.com.br/unico/regulamentacao-transferencia-internacional-dados/>; Lefosse (fim do prazo em 23/08/2025), <https://lefosse.com/noticias/alerta/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/>; Mayer Brown, <https://www.mayerbrown.com/pt/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data>
- Resolução 32/2026 (adequação UE): Mattos Filho, <https://www.mattosfilho.com.br/unico/brasil-ue-protecao-dados-equivalentes/>; Lefosse, <https://lefosse.com/noticias/alerta/transferencia-internacional-de-dados-pessoais-anpd-anuncia-decisao-de-adequacao-mutua-entre-brasil-e-uniao-europeia/>
- Resolução 18/2024: Machado Meyer, <https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/encarregado-pelo-tratamento-de-dados-pessoais-ganha-novo-regulamento>; Migalhas, <https://www.migalhas.com.br/depeso/411933/anpd-regulamenta-atuacao-do-dpo>
- Resolução 2/2022: Demarest, <https://www.demarest.com.br/conselho-diretor-aprova-regulamento-de-aplicacao-da-lgpd-para-agentes-de-tratamento-de-pequeno-porte/>; Mayer Brown, <https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2022/02/regulation-for-the-application-of-the-general-data-protection-law-lgpd-for-small-business-data-processing-agents/legal-update--regulamento-agentes-de-pequeno-porte.pdf>

**Fornecedores:**
- Neon, regiões (São Paulo `aws-sa-east-1`, disponível desde fev/2025): <https://neon.com/docs/introduction/regions> · <https://neon.com/docs/changelog/2025-02-28>
- Vercel, regiões das funções: <https://vercel.com/docs/functions/configuring-functions/region> · DPA: <https://vercel.com/legal/dpa>
- Sentry, local de armazenamento (EUA ou UE/Frankfurt): <https://docs.sentry.io/organization/data-storage-location/>
- Resend, regiões (São Paulo disponível; dados da conta nos EUA): <https://resend.com/docs/dashboard/domains/regions>
- Tailscale, privacidade e DPA: <https://tailscale.com/privacy-policy> · <https://tailscale.com/dpa>
