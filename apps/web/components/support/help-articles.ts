/**
 * Conteúdo dos artigos da central de ajuda (texto real, baseado em docs/07, 11, 12, 13 e 15).
 * Os metadados (título, resumo, categoria) vêm de `getHelpArticles()` em `@/lib/mock`.
 */
import type { ArticleBlock } from "./help-types"

/** Ordem de popularidade exibida em "Artigos populares". */
export const POPULAR_ORDER = [
  "o-que-e-oee",
  "classificar-paradas",
  "ativar-push",
  "barramento-rs485",
  "gateway-offline",
  "bloco-oee-padrao",
  "micro-paradas",
  "acesso-remoto",
  "ligar-clp-modbus-tcp",
  "enderecos-modbus",
  "tour-da-plataforma",
  "andon-tv",
  "usuarios-e-escopo",
  "regras-de-alerta",
]

export const ARTICLE_BODY: Record<string, ArticleBlock[]> = {
  // -------------------------------------------------------------------------
  "o-que-e-oee": [
    {
      kind: "p",
      text: "**OEE** (Overall Equipment Effectiveness, ou Eficiência Global do Equipamento) mostra quanto do tempo planejado de produção virou **peça boa na velocidade ideal**. É o produto de três fatores, e cada um mede um tipo de perda.",
    },
    {
      kind: "table",
      head: ["Indicador", "Fórmula", "Perda que mede"],
      rows: [
        ["Disponibilidade (A)", "Tempo de operação ÷ Tempo planejado", "Paradas"],
        ["Performance (P)", "(Ciclo ideal × Contagem total) ÷ Tempo de operação", "Velocidade reduzida e micro-paradas"],
        ["Qualidade (Q)", "Peças boas ÷ Contagem total", "Refugo e retrabalho"],
        ["OEE", "A × P × Q = (Peças boas × Ciclo ideal) ÷ Tempo planejado", "Todas"],
      ],
    },
    { kind: "h", text: "Como o tempo do turno é dividido" },
    {
      kind: "list",
      items: [
        "**Tempo do turno** (calendário) menos as **paradas planejadas** (refeição, manutenção programada, sem programação) = **tempo planejado de produção**.",
        "**Tempo planejado** menos as **paradas não planejadas** (falhas, falta de material, setup não planejado…) = **tempo de operação**.",
      ],
    },
    { kind: "h", text: "Exemplo de um turno" },
    {
      kind: "p",
      text: "Turno de 8 h (480 min) com 30 min de refeição planejada → **tempo planejado = 450 min**. Houve 45 min de paradas não planejadas → **tempo de operação = 405 min**. Ciclo ideal de 6 s; 3.600 peças produzidas, das quais 72 refugadas (**3.528 boas**).",
    },
    {
      kind: "table",
      head: ["", "Cálculo", "Resultado"],
      rows: [
        ["A", "405 ÷ 450", "**90,0%**"],
        ["P", "(3.600 × 6 s = 360 min) ÷ 405 min", "**88,9%**"],
        ["Q", "3.528 ÷ 3.600", "**98,0%**"],
        ["**OEE**", "0,900 × 0,889 × 0,980", "**78,4%**"],
        ["Conferência", "(3.528 × 6 s = 352,8 min) ÷ 450 min", "78,4% ✓"],
      ],
    },
    {
      kind: "meters",
      items: [
        { label: "Disponibilidade", value: 0.9, note: "45 min de paradas", color: "#257bb4" },
        { label: "Performance", value: 0.889, note: "45 min abaixo do ritmo ideal", color: "#0e9384" },
        { label: "Qualidade", value: 0.98, note: "72 peças refugadas", color: "#e96549" },
        { label: "OEE", value: 0.784, note: "352,8 min de produção ideal em 450 min", color: "#2c4e73" },
      ],
    },
    { kind: "h", text: "Pontos de atenção" },
    {
      kind: "list",
      items: [
        "**Micro-paradas** (menores que o limite da máquina, ex.: 60 s) contam como tempo de operação: reduzem a **performance**, não a disponibilidade.",
        "Sem tempo planejado, o OEE aparece como **“—” (sem produção planejada)**, nunca 0%.",
        "Performance acima de 105% recebe o alerta **“verificar ciclo ideal”**: quase sempre o ciclo cadastrado está maior que o real.",
        "OEE de linha ou unidade = **Σ (boas × ciclo ideal) ÷ Σ tempo planejado**. A média simples dos OEEs das máquinas distorce o resultado.",
      ],
    },
    {
      kind: "callout",
      tone: "info",
      title: "Por que o OEE de um turno fechado muda?",
      text: "Paradas classificadas depois, refugo lançado manualmente ou dados que chegaram atrasados (gateway que ficou offline) marcam o turno para recálculo. Os relatórios passam a refletir os dados completos automaticamente.",
    },
  ],

  // -------------------------------------------------------------------------
  "micro-paradas": [
    {
      kind: "p",
      text: "Cada máquina tem um **limite de micro-parada** (ex.: 60 s). Paradas menores que esse limite **contam como tempo de operação** e **não pedem motivo** ao operador — como no modelo clássico das “seis grandes perdas”.",
    },
    {
      kind: "callout",
      tone: "tip",
      title: "Exemplo",
      text: "Uma injetora com limite de 60 s teve 40 paradas de 20 s no turno (13 min 20 s). A disponibilidade não cai, mas a performance sim: nesses 13 min nenhuma peça foi feita. O OEE final é o mesmo; muda só onde a perda aparece.",
    },
    { kind: "h", text: "Paradas planejadas" },
    {
      kind: "list",
      items: [
        "Refeição, manutenção programada e “sem programação” **saem do tempo planejado**: não derrubam o OEE.",
        "Se a máquina **produziu durante** uma parada planejada (ex.: rodou no almoço), esse tempo **volta a contar** como planejado. Sem essa regra a performance passaria de 100%.",
        "**Setup** pode contar como perda de disponibilidade (padrão) ou como planejado — a escolha é do cliente, em Configurações › Motivos.",
      ],
    },
    {
      kind: "p",
      text: "Ajuste o limite de micro-parada em **Configurações › Máquinas**. Limites muito altos escondem paradas reais; muito baixos enchem o tablet do operador de paradas para classificar.",
    },
  ],

  // -------------------------------------------------------------------------
  "tour-da-plataforma": [
    { kind: "p", text: "A plataforma mostra, em tempo real, o estado e o OEE de cada máquina ligada aos gateways da Engemase. Em 5 minutos você conhece as telas principais:" },
    {
      kind: "steps",
      items: [
        { title: "Visão geral", text: "OEE do turno, peças boas, máquinas por estado, meta do mês, paradas para classificar e a linha do tempo do turno." },
        { title: "Máquinas", text: "Lista com estado ao vivo; no detalhe de cada máquina, linha do tempo de estados, produção por hora, Pareto de paradas e histórico por turno." },
        { title: "Relatórios", text: "OEE por período, linha e máquina; paradas por motivo; exportação em CSV e PDF." },
        { title: "Notificações", text: "O sino reúne alertas de falha, máquina parada, gateway offline e pedidos de acesso remoto. Ative o push para receber no celular." },
        { title: "Configurações", text: "Unidades, linhas, máquinas, turnos, produtos, motivos de parada, usuários, terminais (TV e tablets) e aparência." },
      ],
    },
    {
      kind: "callout",
      tone: "tip",
      text: "Use a busca do cabeçalho (atalho **Ctrl + K**) para ir direto a uma máquina ou gateway pelo nome ou código.",
    },
  ],

  // -------------------------------------------------------------------------
  "classificar-paradas": [
    { kind: "p", text: "Paradas acima do limite de micro-parada pedem um **motivo**. Com o motivo certo, o Pareto mostra onde agir — e paradas planejadas deixam de derrubar o OEE." },
    {
      kind: "steps",
      title: "No tablet da máquina",
      items: [
        { title: "Toque em “Paradas para classificar”", text: "O contador mostra quantas paradas do turno estão sem motivo. A mais recente aparece primeiro." },
        { title: "Confira o horário e a duração", text: "Paradas em andamento aparecem com o selo “agora”." },
        { title: "Escolha o motivo", text: "Os motivos são agrupados em Não planejada, Planejada e Setup. Falhas com código do CLP já chegam com motivo automático." },
        { title: "Confirme", text: "O OEE do turno é recalculado na hora. Dá para corrigir depois, enquanto o turno estiver aberto." },
      ],
    },
    {
      kind: "callout",
      tone: "info",
      text: "Paradas sem motivo há mais de 30 min geram um aviso para o supervisor (agrupado por linha).",
    },
  ],

  // -------------------------------------------------------------------------
  "andon-tv": [
    { kind: "p", text: "A TV Andon mostra o estado das máquinas de uma linha em tela cheia, com alarme visual e sonoro. Ela é pareada por código — sem login e senha na TV." },
    {
      kind: "steps",
      items: [
        { title: "Abra o endereço de terminal na TV", text: "No navegador da TV (ou mini-PC), abra a página de terminal da plataforma. Aparece um código de 6 dígitos, ex.: 482 917." },
        { title: "Cadastre o terminal", text: "Em Configurações › Terminais › Adicionar terminal, escolha “TV Andon”, a unidade e a linha." },
        { title: "Digite o código", text: "Informe o código exibido na TV. O pareamento vale só para o escopo escolhido." },
        { title: "Escolha o tema", text: "Escuro (recomendado para o chão de fábrica), claro ou do sistema." },
      ],
    },
    {
      kind: "list",
      items: [
        "A TV **não usa notificação push**: o alarme é dentro da página.",
        "Terminal offline aparece em Configurações › Terminais com a hora do último contato.",
        "Para trocar a linha exibida, edite o escopo do terminal; não é preciso parear de novo.",
      ],
    },
  ],

  // -------------------------------------------------------------------------
  "ligar-clp-modbus-tcp": [
    { kind: "p", text: "Modbus TCP é o caminho mais simples: o CLP é **servidor** e aceita vários clientes ao mesmo tempo (IHM, SCADA e o gateway)." },
    {
      kind: "steps",
      items: [
        { title: "Rede OT", text: "O CLP precisa de IP fixo na rede de máquinas (OT), alcançável pela porta OT do gateway. Nunca exponha Modbus TCP na rede administrativa: o protocolo não tem autenticação nem criptografia." },
        { title: "Servidor Modbus no CLP", text: "Em algumas marcas basta um parâmetro; em outras (ex.: Siemens S7-1200/1500) é preciso o bloco MB_SERVER no programa." },
        { title: "Cadastre o dispositivo", text: "IP, porta **502** e **unit id** (normalmente 1; alguns CLPs usam 255 ou ignoram)." },
        { title: "Teste", text: "Use **“Testar conexão”** e depois **“Ler agora”** em cada tag. Valide os contadores com um valor conhecido." },
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      title: "Limite de conexões",
      text: "Muitos CLPs aceitam poucas conexões Modbus TCP simultâneas. IHM e SCADA também consomem conexões: confira antes de ligar o gateway.",
    },
  ],

  // -------------------------------------------------------------------------
  "barramento-rs485": [
    {
      kind: "p",
      text: "No **Modbus RTU** várias máquinas compartilham o mesmo par de fios (RS-485). A maior parte dos problemas — **CRC inválido**, timeouts intermitentes, escravos que “somem” — vem da instalação, não do CLP. Siga estas regras:",
    },
    {
      kind: "table",
      head: ["Item", "Regra"],
      rows: [
        ["Topologia", "**Barramento em cascata** (daisy chain). Nada de estrela. Derivações curtas (< 20 m)."],
        ["Terminação", "**120 Ω só nas duas pontas** (também se admite 150 Ω, ou 120 Ω + 1 nF). No reComputer R1000 o resistor não vem montado: use resistor externo no borne da última estação."],
        ["Polarização", "**Um único par** de resistores (450–650 Ω) no barramento, normalmente no mestre. Não duplicar."],
        ["Cabo", "Par trançado blindado de 120 Ω (22–24 AWG) **+ condutor de comum (0 V)**. Malha aterrada em **um só ponto** (no gateway), longe de cabos de motor e inversor."],
        ["Isolação", "Porta RS-485 isolada no gateway. A isolação **não dispensa** o fio de comum (no R1000 ele vai no `GND_ISO`)."],
        ["Limites", "32 cargas unitárias por segmento · ~1.000–1.200 m em baixa velocidade · endereços 1–247 (0 é broadcast, nunca ler)."],
        ["Velocidade e formato", "9600 ou **19200 bps**; formato **8E1** (ou 8N2), mas há muito 8N1 na prática. **Todos os escravos com a mesma configuração.**"],
        ["Controle de direção", "Por hardware ou pelo modo RS-485 do kernel, já configurado no gateway. Nunca alternar RTS por software."],
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      title: "Um mestre por barramento",
      text: "O Modbus RTU tem um único mestre. Se a IHM já é mestre na serial do CLP, o gateway **não pode** entrar nesse barramento (haveria colisões e timeouts na IHM). Prefira Modbus TCP no CLP, uma segunda porta serial configurada como escravo ou a IHM como ponte.",
    },
    { kind: "h", text: "Quanto cabe num barramento?" },
    {
      kind: "table",
      caption: "Leitura de 10 registradores (FC03) por escravo; resposta do CLP em 5 a 20 ms.",
      head: ["Velocidade", "Por transação", "Ciclo de 10 escravos", "Leituras por escravo"],
      rows: [
        ["9600 bps", "~46 ms", "0,5–0,7 s", "~1,5–2 por segundo"],
        ["**19200 bps**", "~23 ms", "**0,3–0,4 s**", "**~2,3–3,6 por segundo**"],
        ["115200 bps", "~7 ms", "0,1–0,3 s", "~3,7–8,6 por segundo"],
      ],
    },
    {
      kind: "p",
      text: "Para OEE (leitura a cada 1 s), **19200 bps com até ~10 escravos** atende com folga. O bloco OEE padrão (32 registradores) leva ~40 ms por máquina. Um escravo desligado consome o timeout inteiro a cada ciclo; por isso o gateway usa timeout curto, 1 nova tentativa e backoff só para ele.",
    },
    { kind: "h", text: "Sintoma → causa provável" },
    {
      kind: "table",
      head: ["Sintoma", "Verifique"],
      rows: [
        ["CRC inválido intermitente", "Terminação faltando ou em mais de duas estações; paridade diferente entre escravos; malha aterrada em dois pontos"],
        ["Timeout em um só escravo", "Endereço (unit id) errado, escravo desligado, fios A/B invertidos naquela estação"],
        ["Funciona com 1 máquina e falha com várias", "Derivação em estrela, polarização ausente ou duplicada, outro mestre no barramento"],
        ["Erros quando motores/inversores ligam", "Cabo junto da potência, falta do condutor de comum (0 V), blindagem sem aterramento"],
      ],
    },
    { kind: "h", text: "Checklist de comissionamento" },
    {
      kind: "list",
      ordered: true,
      items: [
        "Confirmar que **não há outro mestre** no barramento.",
        "Cascata, terminação nas pontas, polarização única, comum ligado, malha aterrada em um ponto.",
        "Mesma velocidade e formato em todos os escravos; endereços únicos de 1 a 247.",
        "Na plataforma: **“Testar conexão”** e **“Ler agora”** em cada tag.",
        "Forçar uma parada e uma falha na máquina e conferir o estado na tela ao vivo.",
      ],
    },
  ],

  // -------------------------------------------------------------------------
  "bloco-oee-padrao": [
    {
      kind: "p",
      text: "É um bloco de **32 holding registers contíguos** que a Engemase inclui nos programas dos CLPs que programa ou altera. Com ele, qualquer máquina — de qualquer marca — é lida da mesma forma.",
    },
    {
      kind: "list",
      items: [
        "**Uma única leitura** em bloco (1 transação) por máquina.",
        "**Template pronto** na plataforma: cadastrar a máquina vira “informar IP/endereço e endereço base”.",
        "Mesmo significado em qualquer marca, o que simplifica suporte e comissionamento.",
      ],
    },
    { kind: "h", text: "Mapa de registradores" },
    {
      kind: "table",
      caption: "A partir de um endereço base configurável — por exemplo, HR 1000 (convenção 41001).",
      mono: [0, 2],
      head: ["Offset", "Tipo", "Nome", "Descrição"],
      rows: [
        ["0", "uint16", "versao_bloco", "Versão do layout (começa em 1)"],
        ["1", "uint16", "heartbeat", "Incrementado pelo CLP a cada scan ou a cada 1 s (detecta CLP “congelado”)"],
        ["2", "uint16", "estado", "0 parada · 1 produzindo · 2 falha · 3 setup · 4 manual · 5 emergência"],
        ["3", "uint16", "codigo_falha", "Código do alarme ativo (0 = nenhum)"],
        ["4–5", "uint32", "contador_total", "Ciclos/peças acumulados (nunca zerar por programa; overflow tratado pelo gateway)"],
        ["6–7", "uint32", "contador_refugo", "Peças refugadas acumuladas"],
        ["8–9", "uint32", "contador_bons", "Opcional (se 0, o gateway calcula total − refugo)"],
        ["10", "uint16", "produto", "Código do produto/receita atual"],
        ["11", "uint16", "velocidade", "Velocidade atual (unidade definida por máquina)"],
        ["12", "uint16", "ciclo_ultimo_ms", "Duração do último ciclo, em ms (opcional)"],
        ["13", "uint16", "bits_status", "Bit 0 automático · bit 1 porta aberta · bit 2 falta material · bit 3 manutenção"],
        ["14–31", "—", "reservado", "Expansão futura (não usar)"],
      ],
    },
    { kind: "h", text: "Regras" },
    {
      kind: "list",
      items: [
        "**Ordem das words em 32 bits: CDAB** (word baixa primeiro), o comum em CLPs. Fica no template e pode ser trocada por máquina.",
        "O bloco é **somente leitura** para o gateway: ele nunca escreve no CLP.",
        "Os contadores são **acumulados**: não zere por programa. Reset e overflow são detectados pelo gateway.",
        "Offsets 14 a 31 ficam **reservados** para versões futuras do layout.",
      ],
    },
    { kind: "h", text: "Como validar a ordem das words" },
    {
      kind: "p",
      text: "Force `contador_total` = **100.000** no CLP. Em CDAB, com base 1000, a leitura deve ser:",
    },
    { kind: "code", text: "HR 1004 = 34464   (word baixa, 0x86A0)\nHR 1005 = 1       (word alta,  0x0001)\n→ 1 × 65536 + 34464 = 100000 ✓" },
    {
      kind: "callout",
      tone: "tip",
      text: "Na plataforma, ao cadastrar a máquina, escolha o template **“Bloco OEE padrão Engemase”**, informe o endereço base e use **“Testar conexão”** e **“Ler agora”**. A 19200 bps em RS-485, o bloco inteiro é lido em ~40 ms.",
    },
  ],

  // -------------------------------------------------------------------------
  "enderecos-modbus": [
    {
      kind: "table",
      head: ["Área", "Tamanho", "Acesso", "Função", "Convenção"],
      rows: [
        ["Coils", "1 bit", "Leitura/escrita", "FC01", "0xxxx"],
        ["Discrete inputs", "1 bit", "Leitura", "FC02", "1xxxx"],
        ["Input registers", "16 bits", "Leitura", "FC04", "3xxxx"],
        ["Holding registers", "16 bits", "Leitura/escrita", "FC03", "4xxxx"],
      ],
    },
    {
      kind: "list",
      items: [
        "**Base 0 × 40001:** “40001” é o holding register de **endereço 0** no protocolo. Esse deslocamento de 1 é o erro nº 1 de integração. A plataforma guarda o endereço base 0 e mostra a convenção ao lado.",
        "**32 bits e float:** a ordem das words/bytes varia (**ABCD, CDAB, BADC, DCBA**). Sempre teste com um valor conhecido (ex.: contador = 100.000).",
        "**Limites por leitura:** até 125 registradores (FC03/FC04) ou 2.000 bits (FC01/FC02) por transação.",
      ],
    },
    { kind: "h", text: "Exceções mais comuns" },
    {
      kind: "table",
      head: ["Código", "Significado", "O que fazer"],
      rows: [
        ["01", "Função não suportada", "Use FC03 em vez de FC04 (ou o contrário) conforme a área do CLP"],
        ["02", "Endereço inválido", "Revise base 0 × 4xxxx e o tamanho do bloco lido"],
        ["03", "Valor inválido", "Quantidade de registradores fora do limite do CLP"],
        ["04", "Falha no escravo", "Erro interno do CLP: verifique o programa e o diagnóstico do equipamento"],
        ["0B", "Gateway sem resposta do escravo", "Conversor TCP↔RTU não recebeu resposta: cabo, endereço ou velocidade"],
      ],
    },
  ],

  // -------------------------------------------------------------------------
  "gateway-offline": [
    {
      kind: "callout",
      tone: "info",
      title: "Nenhum dado se perde",
      text: "O gateway guarda os dados localmente por dias e reenvia tudo, em ordem, quando a conexão volta. Enquanto isso as telas mostram o selo “dados atrasados” em vez de mostrar as máquinas como paradas.",
    },
    {
      kind: "steps",
      title: "Verifique, nesta ordem",
      items: [
        { title: "Energia", text: "O LED de alimentação do gateway está aceso? Houve desligamento do painel?" },
        { title: "Rede administrativa (IT)", text: "Cabo na porta IT, link no switch e IP recebido. A porta OT (máquinas) não dá acesso à internet." },
        { title: "Firewall e proxy", text: "O gateway só precisa de saída TCP 443. Inspeção SSL/DPI do firewall pode bloquear a conexão: peça exceção à TI." },
        { title: "Relógio", text: "Relógio com desvio grande faz a nuvem recusar a conexão. Libere NTP ou deixe o gateway usar a hora vinda da plataforma." },
        { title: "Token", text: "Se o gateway foi substituído ou revogado, ele precisa ser ativado de novo em Configurações › Gateways." },
      ],
    },
    {
      kind: "p",
      text: "Gateway sem contato há mais de 5 minutos gera alerta **crítico** para a engenharia do cliente e para o suporte da Engemase. Se não resolver, abra um chamado informando o gateway e o horário da queda.",
    },
  ],

  // -------------------------------------------------------------------------
  "usuarios-e-escopo": [
    {
      kind: "table",
      head: ["Papel", "O que faz"],
      rows: [
        ["Admin do cliente", "Gerencia unidades, máquinas, usuários, política de acesso remoto e de suporte. Vê sempre o cliente inteiro."],
        ["Engenheiro", "Configura gateways, CLPs e tags; vê tudo das unidades permitidas."],
        ["Supervisor", "Dashboards, relatórios, turnos, produtos e motivos de parada."],
        ["Operador", "Tela do operador: classifica paradas, lança refugo e troca de produto."],
        ["Visualizador", "Somente leitura (ideal para TV / Andon)."],
      ],
    },
    {
      kind: "list",
      items: [
        "**Escopo por unidade:** além do papel, cada pessoa pode ver “todas as unidades” ou só algumas. Alertas e relatórios respeitam esse escopo.",
        "**Equipe Engemase:** o suporte só vê seus dados com **concessão ativa** (motivo, chamado e prazo de até 4 h); engenheiros de campo, só nos clientes atribuídos. Tudo fica na Auditoria.",
        "Usuários de chão de fábrica podem entrar com **nome de usuário** (sem e-mail).",
      ],
    },
    { kind: "p", text: "Convide pessoas e ajuste escopos em **Configurações › Usuários**." },
  ],

  // -------------------------------------------------------------------------
  "acesso-remoto": [
    {
      kind: "p",
      text: "Para manutenção, a Engemase pode pedir **acesso remoto (VPN)** a um gateway. A VPN fica **desligada por padrão** e só existe durante uma sessão aprovada pelo admin do cliente. Quem pede nunca aprova.",
    },
    {
      kind: "steps",
      items: [
        { title: "Você recebe o pedido", text: "No sino, por push e por e-mail: técnico, motivo, chamado, gateway, duração e escopo." },
        { title: "Aprove com MFA, ajuste ou recuse", text: "Em Acesso remoto: “Aprovar” pede o código de 6 dígitos do seu autenticador. “Aprovar com alterações” permite reduzir a duração ou remover o acesso ao CLP." },
        { title: "Acompanhe a sessão", text: "Contagem regressiva, tipo de conexão e “Encerrar agora” a qualquer momento." },
        { title: "Receba o resumo", text: "No fim, o resumo da sessão (duração, tráfego, log de comandos) vai para a Auditoria e por e-mail." },
      ],
    },
    {
      kind: "list",
      items: [
        "Somente conexões de **saída TCP 443**: nenhuma porta aberta no firewall da fábrica.",
        "O gateway **não roteia**: acesso a um CLP é um único IP:porta, com aprovação própria e prazo curto.",
        "A sessão **expira sozinha** (prazo, inatividade ou teto local de 8 h) e nunca religa após reboot.",
        "Um **kill switch local** no gateway prevalece sobre a plataforma.",
      ],
    },
  ],

  // -------------------------------------------------------------------------
  "ativar-push": [
    {
      kind: "p",
      text: "As notificações avisam na hora quando uma máquina entra em falha, fica parada ou um gateway sai do ar — mesmo com a plataforma fechada. Tudo também fica no **sino**, que é a fonte da verdade: o push é só um canal de entrega.",
    },
    {
      kind: "steps",
      title: "Android (Chrome) — o caminho mais confiável",
      items: [
        { title: "Abra a plataforma no Chrome", text: "Entre com seu usuário normalmente." },
        { title: "Toque no sino › “Ativar notificações neste dispositivo”", text: "O botão também fica em Notificações › Dispositivos." },
        { title: "Toque em “Permitir”", text: "O pedido de permissão só aparece depois do seu toque — é uma regra do navegador." },
        { title: "Confira a notificação de teste", text: "Ela chega em alguns segundos. O aparelho passa a aparecer na lista de dispositivos inscritos." },
      ],
    },
    {
      kind: "steps",
      title: "iPhone e iPad (iOS/iPadOS 16.4 ou superior)",
      items: [
        { title: "Abra a plataforma no Safari", text: "Em outros navegadores do iPhone a opção não aparece." },
        { title: "Compartilhar › “Adicionar à Tela de Início”", text: "Sem instalar o app na Tela de Início, o iPhone não recebe push." },
        { title: "Abra pelo ícone criado", text: "Não pelo Safari. A plataforma abre em tela cheia, como um aplicativo." },
        { title: "Ative e permita", text: "Toque em “Ativar notificações neste dispositivo” e em “Permitir”." },
      ],
    },
    {
      kind: "steps",
      title: "Computador (Chrome, Edge, Firefox ou Safari no macOS)",
      items: [
        { title: "Clique no sino › “Ativar notificações neste dispositivo”", text: "E em “Permitir” no aviso do navegador." },
        { title: "Mantenha o navegador aberto", text: "No computador, o push só chega com o navegador em execução (pode estar minimizado)." },
      ],
    },
    {
      kind: "table",
      head: ["Plataforma", "Push", "Observação"],
      rows: [
        ["Chrome / Edge (Windows, macOS, Linux)", "Sim", "Só com o navegador em execução"],
        ["Chrome Android", "Sim", "O caminho mais confiável para celular e tablet"],
        ["Firefox desktop e Android", "Sim", ""],
        ["Safari macOS", "Sim", ""],
        ["iPhone / iPad", "Com app na Tela de Início", "iOS/iPadOS 16.4+"],
        ["Smart TV", "Não", "A TV Andon usa alarme visual e sonoro na própria tela"],
      ],
    },
    { kind: "h", text: "Não está chegando?" },
    {
      kind: "list",
      items: [
        "Modo **Não perturbe / Foco** silencia as notificações do aparelho.",
        "Permissão bloqueada: clique no **cadeado** ao lado do endereço › Notificações › Permitir, e ative de novo.",
        "Confira seu **horário de silêncio** e os tipos de alerta em Notificações › Preferências.",
        "No iPhone, confirme que abriu pelo **ícone da Tela de Início**.",
      ],
    },
    {
      kind: "callout",
      tone: "info",
      title: "Tablet compartilhado do operador",
      text: "A inscrição é do aparelho (ligada à máquina ou linha), não da pessoa, e é desfeita no logout. Prefira Android: no iPad, o app instalado não mantém a tela acesa.",
    },
  ],

  // -------------------------------------------------------------------------
  "regras-de-alerta": [
    {
      kind: "table",
      head: ["Alerta", "Quando dispara", "Padrão"],
      rows: [
        ["Máquina parada", "Estado “parada” há X min", "10 min · aviso"],
        ["Falha", "Estado “falha” (com código)", "Imediato · crítico"],
        ["Gateway offline", "Sem contato por ≥ 5 min", "Crítico"],
        ["Sem comunicação", "Máquina sem dados há N min", "5 min · aviso (suprimido se o gateway já está offline)"],
        ["OEE abaixo da meta", "OEE do turno < meta após 2 h de turno", "Aviso · no máximo 1 por turno"],
        ["Paradas sem motivo", "Paradas sem motivo há mais de 30 min", "Informativo · supervisor"],
        ["Acesso remoto", "Pedido aguardando aprovação; sessão iniciada/encerrada", "Admin do cliente"],
      ],
    },
    {
      kind: "list",
      items: [
        "Escolha **tipos, unidades/linhas/máquinas e canais** em Notificações › Preferências (sempre dentro do seu escopo).",
        "**Horário de silêncio:** nada de push nesse período — exceto críticos, se você optar.",
        "Alertas repetidos da mesma máquina viram **um só** alerta atualizado; várias máquinas paradas na mesma linha viram uma notificação.",
        "Crítico sem reconhecimento sobe de nível (supervisor → gerente; push → e-mail).",
      ],
    },
  ],
}
