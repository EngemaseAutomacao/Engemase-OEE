# Proposta original (08/10/2025)

> Transcrição fiel do PDF [`2025-10-08-proposta-original.pdf`](2025-10-08-proposta-original.pdf), guardada como registro histórico. **Não reflete o projeto atual:** a versão em vigor é a [proposta atualizada](proposta-atualizada.md), que traz no fim o que mudou e por quê.

---

**Proposta de Melhoria: Desenvolvimento de um Sistema de OEE (Overall Equipment Effectiveness) para Clientes da Engemase**

- **Data da Proposta:** 08/10/2025
- **Propositor:** Pablo Gonçalves Ribas
- **Área de Atuação:** Automação

## 1. Introdução e Justificativa

Prezados líderes da Engemase,

Em alinhamento ao Programa de Reconhecimento por Resultados de 2025, apresento esta proposta para desenvolver um Sistema de OEE personalizado, visando aumentar a eficiência dos equipamentos de nossos clientes por meio de uma Progressive Web App (PWA).

**Diferencial Competitivo:** A Engemase não possui uma ferramenta dedicada para monitoramento em tempo real e relatórios personalizados. Este sistema otimizará processos, reduzirá desperdícios e fortalecerá negociações comerciais. O lançamento será feito com 1 cliente-piloto inicial, gerando receita recorrente via mensalidade por máquina monitorada.

## 2. Descrição da Proposta

A plataforma engemaseoee.com.br será desenvolvida como uma Progressive Web App (PWA) com as seguintes características:

- **Instalação como aplicativo:** Funcionalidade de instalação em dispositivos móveis e desktops.
- **Acesso offline:** Permite operação sem conexão à internet.
- **Notificações push:** Alertas em tempo real para os usuários.

**Principais Funcionalidades:**

- **Monitoramento em tempo real:** Coleta de dados via sensores IoT para cálculo automático do OEE.
- **Dashboards personalizados:** Gráficos interativos, alertas de manutenção preditiva e relatórios exportáveis em PDF/Excel.
- **Outras funcionalidades:** Autenticação segura, integração com sistemas de automação, controle de qualidade e suporte remoto.
- **Monetização:** Modelo de mensalidade por máquina monitorada, com valor a ser definido após análises de custo-benefício.

## 3. Tecnologias e Arquitetura

**Stack Tecnológico Principal:**

- Lovable (R$ 133/mês)
- Supabase (R$ 133/mês)
- InfluxDB (tier gratuito inicial para telemetria)
- Domínio (R$ 4/mês)

**Fluxo de Dados:** CLP → Gateway IoT → MQTT → InfluxDB → Supabase → PWA

**Investimento Mensal:** R$ 270/mês

- Escalabilidade em nuvem com tiers gratuitos para prototipagem.
- Não requer infraestrutura pesada.

**Funcionalidades-Chave:**

- Cálculo automático de OEE (Disponibilidade × Performance × Qualidade).
- Manutenção preditiva com Machine Learning.
- Relatórios exportáveis em PDF/Excel.
- Suporte a multi-tenancy seguro.
- PWA com funcionamento offline e notificações push.
- Dashboards drag-and-drop customizáveis.

## 4. Plano de Implementação

A partir da aprovação, será criado um documento de acompanhamento semanal, atualizado toda sexta-feira, garantindo total transparência sobre o progresso do projeto. Como responsável único, com dedicação de 20 horas semanais, o cronograma foi ajustado para considerar a complexidade da integração de comunicação industrial:

| Fase | Descrição | Período Estimado | Recursos Necessários |
|---|---|---|---|
| 1. Planejamento e Prototipagem | Análise de requisitos com 1 cliente-piloto; setup no Lovable/Supabase/InfluxDB; protótipo de dashboard e PWA básico. | Out–Dez/2025 (10–12 semanas) | Dados de equipamentos; 1 reunião semanal; tiers gratuitos de Lovable/Supabase/InfluxDB. |
| 2. Desenvolvimento e Integração | Integração de comunicação industrial: CLP → Gateway IoT → MQTT → InfluxDB → Supabase; criação de logins, dashboards e PWA; testes com cliente-piloto; definição inicial da mensalidade. | Jan–Jun/2026 (26–30 semanas) | Assinaturas pagas de Lovable/Supabase; testes com dados simulados; domínio; hardware de teste (gateway/sensores). |
| 3. Testes e Lançamento Piloto | Validação com piloto; correções; configuração do PWA e domínio; finalização da mensalidade. | Jul–Set/2026 (8–10 semanas) | Feedback de cliente; monitoramento inicial. |
| 4. Manutenção e Expansão | Acompanhamento do piloto; adição de funcionalidades avançadas; planejamento para mais clientes e cobrança por máquina. | Out/2026 em diante (contínuo) | Relatórios mensais; manutenção das assinaturas. |

**Tempo Total Estimado:** 14–16 meses para o MVP funcional com 1 cliente-piloto, considerando 20 horas semanais de dedicação. A Fase 2 é a mais extensa devido à complexidade técnica da cadeia de comunicação industrial. O tempo é apenas estimado, pois não sabemos se as 20 horas semanais serão cumpridas, já que o desenvolvimento ocorrerá junto com outras demandas, o que pode alterar o prazo de entrega.

## 5. Conclusão e Solicitações

**Solicitações:**

- Ferramentas necessárias: Lovable, Supabase, InfluxDB e domínio (R$ 270/mês).
- Autonomia técnica para execução do projeto.

**Compromisso:** Comprometo-me a entregar o projeto no prazo estipulado, com total transparência por meio de relatórios semanais (atualizados às sextas-feiras) e assumindo total responsabilidade pelo sucesso do sistema.

Atenciosamente,

Pablo Gonçalves Ribas
Engemase Engenharia

*Nota: Elaborei essa proposta, com auxílio de ferramentas de inteligência artificial para organização e refinamento do conteúdo, garantindo clareza, precisão e alinhamento com os objetivos estratégicos da Engemase.*
