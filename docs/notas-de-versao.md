# Notas de versão

O que mudou na plataforma Engemase OEE, entrega por entrega, em linguagem de quem usa. A mais nova fica no topo.

> A plataforma está em implantação, antes do piloto. Até a ligação com as máquinas de verdade, parte das telas ainda mostra dados de demonstração. Os guias de uso de cada papel estão em [Guias por papel](guias/README.md).

## Próximas entregas (em andamento)

- **Convite por e-mail para definir a senha** e **"Esqueci minha senha"** com link por e-mail.
- **Telas com os dados de verdade** das máquinas, no lugar dos dados de demonstração, começando pelos cadastros, gateways e sinais.
- **Fechamento de turno automático:** os números de cada turno são fechados no fim do turno e recalculados se chegarem dados atrasados ou se uma parada for reclassificada.
- **Atualização do programa do gateway à distância**, enviada pela Engemase.

## 27/11/2026 · Paradas planejadas que se repetem

**Para a equipe Engemase**
- **Em "Configurações" › "Turnos", a parada planejada pode repetir "Toda semana" ou "Todo mês"** até uma data (no máximo 1 ano). Cada data vira uma parada própria: dá para alterar ou cancelar só uma, ou cancelar "esta e as próximas" da série.

## 27/11/2026 · Aparência do cliente de verdade

**Para quem usa**
- **As cores do cliente valem no sistema real:** botões, links e menu lateral aparecem na cor da marca do cliente para todos os usuários, no tema claro e no escuro. As cores de estado das máquinas e as faixas de OEE nunca mudam.

**Para a equipe Engemase**
- **"Configurações" › "Aparência" grava de verdade:** cor da marca (paleta pronta ou livre), menu lateral, nome exibido e nome curto. A plataforma recalcula as cores para passar no contraste e recusa cor parecida demais com as de estado. "Restaurar padrão Engemase" volta ao visual original. Tudo na auditoria.
- Ainda não tem: envio dos logotipos (fica o da Engemase).

## 27/11/2026 · Mapa de falhas do CLP de verdade

**Para quem usa**
- **Falha do CLP com código conhecido já chega classificada.** Na tela do operador e na TV aparece o texto do alarme (ex.: "F47 · Falta de material no funil"), não só o número.
- O operador continua podendo corrigir o motivo.

**Para a equipe Engemase**
- **"Configurações" › "Motivos de parada" › "Mapa de códigos de falha" funciona no sistema real:** código, texto do alarme, motivo automático (ou "Perguntar ao operador") e para quais máquinas vale (todas ou uma). "Salvar mapa" grava tudo de uma vez e registra na auditoria.
- Excluir um motivo não apaga mais o código do mapa: ele fica, só sem motivo automático.

## 27/11/2026 · Auditoria do cliente de verdade

**Para quem usa (admin do cliente)**
- **"Configurações" › "Auditoria" funciona no sistema real:** mostra os últimos 90 dias do que mudou no cliente, quem fez e quando: cadastros, usuários, terminais, operadores do chão, paradas classificadas, refugo e troca de produto.
- **Ações da equipe Engemase ficam destacadas**; as feitas por chamado de suporte mostram o número do chamado. Apontamentos feitos pelo tablet aparecem com o nome do terminal.
- **"Exportar CSV" baixa de verdade** o que está na tela, com os filtros aplicados (abre no Excel).
- O item "Auditoria" só aparece no menu para quem pode ver (admin do cliente e equipe Engemase).

## 27/11/2026 · Quem está operando no tablet

**Para quem usa**
- **O tablet pergunta "Quem está operando?"** e mostra a lista de operadores da unidade em botões grandes. É só tocar no próprio nome: paradas classificadas, refugo e troca de produto ficam registrados com ele.
- A escolha vale até a troca de turno; no turno seguinte o tablet pergunta de novo. Para trocar antes, toque no nome no alto da tela.
- Sem operadores cadastrados na unidade, o tablet continua apontando sem pedir o nome (como antes).

**Para a equipe Engemase**
- **"Configurações" › "Terminais" tem a seção "Operadores do chão"**: cadastrar nome e matrícula (opcional) por unidade, editar e desativar. Desativado sai da lista do tablet; os apontamentos antigos continuam com o nome. Tudo na auditoria.

## 27/11/2026 · TV e tablets pareados de verdade

**Para quem usa**
- **TV da linha e tablet da máquina funcionam no sistema real.** O aparelho é pareado com um **código de 8 dígitos** (vale 10 minutos e uma vez só) e passa a abrir direto na tela da linha (TV) ou da máquina (tablet), sem login de pessoa.
- **No tablet, classificar parada, lançar refugo e trocar produto gravam de verdade**, só nas máquinas do tablet. Na auditoria aparece o nome do terminal.
- A TV só mostra; não faz apontamentos.

**Para a equipe Engemase**
- **"Configurações" › "Terminais" funciona no sistema real**: cadastrar TV ou tablet com as linhas ou máquinas, gerar código, editar e revogar. Revogar corta o aparelho na hora.
- O pareamento vale 12 meses. Cliente suspenso: os terminais param de abrir.
- Ainda não tem: o tema próprio de cada terminal.

## 27/11/2026 · Cadastro de turnos e paradas planejadas de verdade

**Para a equipe Engemase**
- **"Configurações" › "Turnos" funciona no sistema real**: criar, alterar e excluir turnos com pausas (sem turnos que se sobreponham na mesma unidade) e agendar, alterar e cancelar paradas planejadas da unidade inteira ou de máquinas escolhidas.
- **"Duplicar" turno** abre um turno novo já preenchido, para ajustar o dia ou o horário antes de salvar.
- Mudar ou cancelar uma parada planejada de um período já fechado faz o OEE daquele turno ser recalculado.
- O cliente vê a tela só para consulta. **A repetição** (semanal ou mensal) das paradas planejadas ainda não entra no cálculo e não aparece no sistema real: cadastre cada ocorrência.

## 27/11/2026 · Cadastro de motivos de parada de verdade

**Para a equipe Engemase**
- **"Configurações" › "Motivos de parada" funciona no sistema real**: criar e editar grupos (com categoria e cor) e motivos, mostrar ou ocultar para o operador e excluir. Os motivos herdam a categoria e a cor do grupo.
- Motivo já usado em alguma parada não é apagado: fica oculto, e o histórico e os relatórios continuam com ele. Motivos do sistema (como "Sem comunicação") não podem ser ocultados nem excluídos.
- O cliente vê a tela só para consulta. O **mapa de códigos de falha** ainda não existe no sistema real (aparece como "em breve").

## 27/11/2026 · Cadastro de produtos de verdade

**Para a equipe Engemase**
- **"Configurações" › "Produtos" funciona no sistema real** (antes aparecia "Em breve"): cadastrar, alterar e excluir produtos, com o ciclo ideal de cada um em cada máquina, e salvar a matriz de ciclos de uma vez. Tudo na auditoria.
- O cliente vê a tela só para consulta.
- A importação por planilha (CSV) ainda não existe no sistema real e fica escondida lá.

## 27/11/2026 · Tela do operador grava de verdade

**Para quem usa**
- Na tela do operador, **classificar parada, lançar refugo e trocar produto agora gravam no sistema** (antes só apareciam na tela). O "Desfazer" também vale de verdade: tira o motivo, estorna o refugo ou volta ao produto anterior.
- O **tipo de defeito** do refugo vem da lista cadastrada para a sua empresa.
- A **troca de produto** pela tela entra no cálculo do OEE nas máquinas em que o CLP não informa o produto.
- Prazo: paradas e refugos podem ser lançados até o fim do turno seguinte; depois, só o supervisor ou o admin da empresa.
- Tudo fica na auditoria, e o turno já fechado é recalculado quando uma parada ou um refugo dele muda.

## 27/11/2026 · Usuários da empresa de verdade

**Para quem usa**
- **"Configurações" › "Usuários" funciona no sistema real** (antes aparecia "Em breve"). O admin da empresa vê a equipe com papel, escopo, situação, verificação em duas etapas e último acesso.
- **Convidar, mudar papel e escopo, desativar e reativar** gravam de verdade e ficam na auditoria, com como era antes e depois.
- **Reenviar o convite, mandar a redefinição de senha e reiniciar a verificação em duas etapas** de quem trocou de celular, pelo menu de cada pessoa.
- Proteções: a empresa nunca fica sem admin ativo, ninguém altera o próprio acesso e desativar tira o acesso só à sua empresa.
- O quadro "Acesso da equipe Engemase" mostra os acessos reais: super admins, atendimentos de suporte e técnicos atribuídos.

**Para a equipe Engemase**
- As rotinas automáticas (alerta de gateway offline, vencimentos, VPN e fechamento de turno) passaram a rodar pelo cron-job.org e foram corrigidas: falhavam por falta de permissão no banco. A mesma correção vale para a ativação e o envio de dados dos gateways.

## 24/11/2026 · Entrar com segurança e preparação para o piloto

**Para quem usa**
- **Entrar com e-mail e senha de verdade.** Senha com pelo menos 12 caracteres. Várias tentativas erradas seguidas bloqueiam a entrada por alguns minutos, para proteger a conta.
- **Verificação em duas etapas** (código do aplicativo autenticador no celular), ativada em "Minha conta" › "Senha e 2 etapas". **Opcional** para todos: quem ativa escaneia um QR code com o aplicativo e pode desativar depois. Vem com códigos de recuperação para quando o celular não estiver à mão.
- **Cada empresa vê só os seus dados**, e cada pessoa só as unidades ou máquinas do seu acesso. Quem tenta abrir uma página de outra empresa recebe "página não encontrada".
- **Mensagens de erro em português**, com o botão "Tentar de novo", e página própria para endereço que não existe.
- **Nome da tela na aba do navegador** em todas as telas, para achar a aba certa.
- **Menos movimento na tela** para quem desligou as animações no computador ou no celular.

**Para a equipe Engemase**
- O gateway passa a aceitar **comandos de diagnóstico** pela plataforma: ler um sinal agora, testar a conexão com o CLP, recarregar a configuração, reiniciar o programa, aumentar o detalhe dos registros por um tempo e enviar os registros recentes.
- **Configuração em versões:** cada mudança no cadastro de máquinas e sinais vira uma versão nova, enviada ao gateway; dá para ver qual versão está em uso.
- **Código de ativação do gateway** de uso único, válido por 24 horas.
- **Alerta de gateway offline** e resumo diário por e-mail para a equipe Engemase (rotinas automáticas preparadas; parte delas é ligada quando o plano de hospedagem for ampliado).
- **Proteções extras** contra uso indevido: limite de pedidos por gateway, bloqueio da plataforma dentro de páginas de outros sites e outras proteções do navegador.
- **Teste de carga** com 100 gateways simulados enviando dados ao mesmo tempo.
- Começo da **página local do gateway** (para o técnico no local) e do ajudante que fará ajustes de rede e relógio no equipamento.

## 13/11/2026 · Apresentação do produto

- **Página de apresentação** da plataforma, com as telas do sistema, vira a página inicial do endereço. Traz os contatos e as redes da Engemase.
- Proposta comercial atualizada com a metodologia atual (documento interno).

## 12/11/2026 · Protótipo completo e base do sistema

**Telas**
- **Terminal pareado:** TV e tablet entram na plataforma com um código de 6 dígitos, sem e-mail nem senha. A TV abre direto no painel da linha; o tablet, na tela da máquina.
- **Tela da linha:** OEE da linha, peças boas, a máquina que mais perde, produção por hora contra a meta e os principais motivos de parada.
- **OEE da linha e da unidade** calculado somando o tempo e as peças das máquinas (nunca pela média dos percentuais), também quando a pessoa vê só parte das máquinas.
- **Celular sem rolagem para o lado** em todas as telas.
- **Regras de acesso decididas com a Engemase aplicadas nas telas:**
  - o admin do cliente cuida das pessoas da empresa; a configuração (unidades, máquinas, turnos, produtos, motivos, TV e tablets, aparência) é feita pela Engemase e o cliente consulta;
  - acesso de uma pessoa a máquinas específicas;
  - o acesso da Engemase aos dados é sempre registrado e visível ao cliente;
  - o acesso remoto ao gateway depende da aprovação do admin do cliente;
  - a assinatura é por máquina, com o limite de máquinas contratadas visível.

**Gateway (equipamento na fábrica)**
- Lê os CLPs por **Modbus TCP** (rede) e **Modbus RTU** (RS-485), inclusive conversores RS-485 para rede.
- **Nenhum dado se perde se a internet cair:** as leituras ficam guardadas no gateway e são enviadas quando a conexão volta.
- Se o programa travar, o próprio gateway percebe e se recupera.
- **Pacote de instalação** e imagem do sistema do gateway prontos para a bancada.

**Documentação para a equipe Engemase**
- Roteiros de atendimento (gateway offline, CLP sem comunicação, dados atrasados, relógio fora de sincronia, contagem divergente, troca de hardware e outros), ficha técnica para a TI do cliente, roteiro de bancada e guia por fabricante de CLP, em [Operação](operacao/README.md).
- Bloco OEE padrão Engemase para o programa do CLP.

## 11/11/2026 · Início do projeto

- Planejamento da plataforma: requisitos, arquitetura, cálculo do OEE, segurança, gateway e plano de entregas.
- **Primeiras telas do protótipo:** visão geral, máquinas, relatórios de OEE e de paradas, tela do operador, TV Andon, configurações e console da Engemase, em tema claro e escuro.
