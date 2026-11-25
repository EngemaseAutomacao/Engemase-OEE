# Notas de versão

O que mudou na plataforma Engemase OEE, entrega por entrega, em linguagem de quem usa. A mais nova fica no topo.

> A plataforma está em implantação, antes do piloto. Até a ligação com as máquinas de verdade, parte das telas ainda mostra dados de demonstração. Os guias de uso de cada papel estão em [Guias por papel](guias/README.md).

## Próximas entregas (em andamento)

- **Convite por e-mail para definir a senha** e **"Esqueci minha senha"** com link por e-mail.
- **Telas com os dados de verdade** das máquinas, no lugar dos dados de demonstração, começando pelos cadastros, gateways e sinais.
- **Fechamento de turno automático:** os números de cada turno são fechados no fim do turno e recalculados se chegarem dados atrasados ou se uma parada for reclassificada.
- **Atualização do programa do gateway à distância**, enviada pela Engemase.

## 24/11/2026 · Entrar com segurança e preparação para o piloto

**Para quem usa**
- **Entrar com e-mail e senha de verdade.** Senha com pelo menos 12 caracteres. Várias tentativas erradas seguidas bloqueiam a entrada por alguns minutos, para proteger a conta.
- **Verificação em duas etapas** (código do aplicativo autenticador no celular), ativada em "Minha conta" › "Senha e 2 etapas". **Obrigatória** para o admin do cliente e para a equipe Engemase. Vem com códigos de recuperação para quando o celular não estiver à mão.
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
