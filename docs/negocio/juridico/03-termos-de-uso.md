# Termos de Uso da plataforma Engemase OEE

> **Minuta para revisão por advogado; não usar sem revisão.**
>
> Versão 0.1 · 12/11/2026 · Anexo D do [Contrato de assinatura](01-contrato-de-assinatura.md). Marcações e o que falta: [README desta pasta](README.md).

**Para quem é.** Para cada pessoa que usa a plataforma com login (Usuário) e para quem opera um terminal pareado (TV ou tablet). É o texto que aparece no primeiro acesso, com o aceite.

**Nota de implementação (fora desta minuta):** mostrar no primeiro login, com caixa "Li e aceito os Termos de Uso" e link para a [Política de Privacidade](04-politica-de-privacidade.md); guardar versão, data e hora do aceite na auditoria; pedir novo aceite quando a versão mudar de forma relevante.

---

**Última atualização:** [PREENCHER] · **Versão:** [PREENCHER]

## 1. O que é a plataforma

1.1. A Engemase OEE mostra a eficiência das máquinas da sua empresa: estado de cada máquina, peças, paradas, refugo e o OEE por máquina, linha, unidade, turno e produto.

1.2. Quem contratou a plataforma foi a **empresa onde você trabalha ou presta serviço** (o "Cliente"). O contrato entre o Cliente e a Engemase prevalece sobre estes Termos.

1.3. Endereço atual: `https://engemase-oee.vercel.app`. Ele pode mudar para um domínio da Engemase; você será avisado na própria plataforma.

## 2. Sua conta

2.1. Você recebe acesso por convite do **administrador da sua empresa** (ou da Engemase, no caso do primeiro administrador). O convite chega por e-mail, com um link para definir a senha.

2.2. **A conta é pessoal e intransferível.** Não compartilhe senha nem códigos. Não existem contas compartilhadas (como "tv@empresa"): TVs e tablets usam terminais pareados.

2.3. **[PADRÃO PROPOSTO — L20]** Use senha com **12 ou mais caracteres** e que você não use em outros sites. A plataforma recusa senhas que já apareceram em vazamentos conhecidos.

2.4. **Verificação em duas etapas (2FA):** obrigatória para a equipe Engemase e para o administrador da empresa **[PADRÃO PROPOSTO — D14]**; opcional para os demais, salvo se sua empresa exigir.

2.5. **[PADRÃO PROPOSTO — L20]** Depois de 5 tentativas erradas, o acesso fica bloqueado por 15 minutos e você recebe um aviso por e-mail.

2.6. Avise o administrador da sua empresa se suspeitar que alguém usou sua conta.

## 3. O que você pode fazer

3.1. O que você vê e faz depende do seu **papel** e do seu **escopo** (a empresa inteira, algumas unidades ou algumas máquinas). Você nunca vê dados de máquinas fora do seu escopo, nem em totais e relatórios.

| Papel | O que faz |
|---|---|
| **Administrador da empresa** | Gerencia os usuários da empresa (convidar, papéis, escopos, desativar). Aprova sessões de acesso remoto aos gateways. Vê tudo, inclusive a configuração e a auditoria, sem editar a configuração |
| **Engenheiro** | Vê a saúde dos gateways, das conexões e das tags, sem editar. Dashboards, relatórios e ações do chão |
| **Supervisor** | Dashboards, relatórios e ações do chão |
| **Operador** (com login) | Ações do chão no próprio aparelho |
| **Visualizador** | Só leitura |

3.2. **Ações do chão:** classificar paradas, lançar refugo e trocar produto.

3.3. **A configuração é feita pela Engemase:** unidades, linhas, máquinas, gateways, conexões, tags, terminais, turnos, produtos, motivos de parada, aparência e políticas. Para pedir uma mudança, use o canal de suporte.

## 4. Terminais (TV e tablet)

4.1. TVs e tablets são **pareados por código** pela equipe Engemase. Um terminal é um aparelho, não uma conta de pessoa.

4.2. **No tablet, o operador escolhe o próprio nome numa lista** antes de apontar. Escolha sempre o seu nome. Nunca aponte em nome de outra pessoa.

4.3. O que fica registrado ao apontar no tablet está na [nota do operador de chão](05-operador-de-chao.md) e no aviso da própria tela.

4.4. Não faça login pessoal no navegador de um terminal.

## 5. Uso permitido

Você **não pode**:
- tentar acessar dados de outras empresas, de unidades ou de máquinas fora do seu escopo;
- testar a segurança da plataforma sem autorização escrita da Engemase;
- copiar, descompilar, fazer engenharia reversa ou extrair dados de forma automatizada (robôs, raspagem);
- compartilhar sua conta, seus códigos ou links de exportação;
- colocar em campos de texto dados pessoais sensíveis (saúde, religião, biometria e outros) ou informações sem relação com a produção;
- usar a plataforma para fim ilícito ou contra os direitos de outras pessoas.

Encontrou uma falha de segurança? Escreva para [PREENCHER: e-mail de segurança]. Não explore a falha.

## 6. Acesso da equipe Engemase

6.1. A Engemase administra a plataforma e a configuração da sua empresa e **pode acessar os dados da sua empresa** para configurar, dar suporte, manter a segurança e cumprir a lei. Esse acesso não depende de aprovação a cada vez.

6.2. Sempre que alguém da Engemase está dentro da sua empresa na plataforma, aparece uma **faixa na tela**, e o acesso fica na **auditoria**, com nome, motivo e chamado.

6.3. A equipe Engemase não cria nem altera usuários da sua empresa: isso é com o administrador da empresa.

## 7. Acesso remoto aos gateways (opcional, Fase 2)

Se a sua empresa contratar, a Engemase pode pedir uma sessão de acesso remoto a um gateway. **Cada sessão precisa da aprovação do administrador da empresa**, expira sozinha e fica registrada.

## 8. Notificações

8.1. Os alertas ficam sempre na **central de notificações** (o sino).

8.2. **Notificação no navegador ou no celular (push):** só depois de você ativar, em cada aparelho. Você pode desativar quando quiser, no perfil. No iPhone e no iPad, só funciona com o app instalado na Tela de Início.

8.3. No tablet compartilhado, a notificação é **do aparelho**, não da pessoa.

8.4. **E-mails** de serviço (definir e redefinir senha, avisos de segurança, avisos de acesso da Engemase e de suspensão) não podem ser desligados. Alertas e resumos por e-mail (Fase 2) podem, nas preferências.

## 9. Limites da plataforma

9.1. A plataforma **mostra indicadores**. Não comanda máquinas, não escreve no CLP e **não é sistema de segurança**. Nunca dependa de um alerta da plataforma para a segurança de pessoas ou equipamentos.

9.2. Os números dependem dos sinais das máquinas e dos cadastros. Se algo parecer errado, avise o suporte.

9.3. Quando a internet da fábrica cai, os dados chegam atrasados. A tela mostra o aviso "dados atrasados".

9.4. Disponibilidade e suporte seguem o contrato entre a sua empresa e a Engemase.

## 10. Propriedade

10.1. A plataforma, o software dos gateways e a documentação são da Engemase.

10.2. Os dados de produção e os cadastros da sua empresa são da sua empresa.

## 11. Privacidade

O tratamento dos seus dados pessoais está na [Política de Privacidade](04-politica-de-privacidade.md). Em resumo: a sua **conta de acesso** (login, senha e verificação em duas etapas) é mantida pela Engemase e pode servir para mais de uma empresa; o seu papel, o seu escopo e o que você faz dentro de cada empresa são decididos por ela, e a Engemase trata esses dados em nome dela.

## 12. Suspensão e fim do acesso

12.1. O administrador da sua empresa pode desativar sua conta a qualquer momento.

12.2. A Engemase pode suspender uma conta, um terminal ou um gateway que esteja pondo em risco a segurança da plataforma, avisando o administrador da empresa.

12.3. Se o contrato da sua empresa for suspenso ou encerrado, seu acesso também será.

## 13. Mudanças nestes Termos

A Engemase avisa mudanças relevantes na plataforma com antecedência de [PREENCHER: 30] dias, salvo exigência legal ou de segurança. Se a mudança for relevante, você terá de aceitar de novo para continuar usando.

## 14. Contato e lei aplicável

14.1. Dúvidas de uso: canal de suporte da sua empresa ou [PREENCHER: canal de suporte da Engemase].

14.2. Privacidade: [PREENCHER: e-mail do encarregado ou canal de privacidade da Engemase].

14.3. Vale a lei brasileira.

---

## Fontes

- LGPD (Lei 13.709/2018): <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Marco Civil da Internet (Lei 12.965/2014): <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm>
- Regras do produto: [docs/15](../../15-multi-cliente-e-acesso.md), [docs/13](../../13-notificacoes-e-alertas.md), [docs/12](../../12-acesso-remoto-vpn.md) e as escolhas provisórias L20 (senha e sessão) e D14 (2FA) em [docs/17](../../17-backlog-e-pendencias.md).
