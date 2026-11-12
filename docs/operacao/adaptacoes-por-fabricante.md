# Adaptações por fabricante: expor o bloco OEE via Modbus

Guia para a equipe de automação colocar o [bloco OEE padrão v1](bloco-oee-v1.md) nos CLPs dos clientes e expô-lo por **Modbus TCP** e/ou **Modbus RTU (RS-485)** para o gateway. Complementa a tabela de suporte do [docs/11 §2](../11-integracao-modbus.md#2-suporte-por-marca-de-clp).

**Marcas prioritárias (D26, 12/11/2026): Siemens, Schneider Electric, Rockwell Automation e ABB.** Elas vêm primeiro (seções 6 a 9), com fontes oficiais. As demais marcas ficam na seção 11, atendidas sob demanda. O bloco v1 não muda: 32 registradores a partir do HR 1000, valores de 32 bits em CDAB.

> **Leia antes:** as informações das marcas prioritárias foram conferidas em documentação oficial dos fabricantes em 12/11/2026 (seção 14), por busca na web, **sem leitura completa de todos os manuais e sem teste em todos os firmwares**. As demais marcas vêm de conhecimento técnico e de pesquisa. Tudo que está marcado **"confirmar no manual do fabricante"** precisa ser conferido no manual do modelo e testado na bancada ([verificação de bancada, Parte C](verificacao-bancada-r1000.md#6-parte-c--clps-das-marcas-prioritárias-d26)) antes de ir a um cliente. Nunca prometa ao cliente uma integração que não foi testada no modelo e no firmware dele.
>
> Referências entre colchetes, como **[S1]**, apontam para a lista de fontes da seção 14.

## 1. Receita comum a todas as marcas

1. **Servidor Modbus:** habilite o servidor Modbus TCP (porta 502) ou o escravo Modbus RTU na porta serial que estiver livre. Lembre: **um mestre por barramento** RS-485 ([docs/11 §5](../11-integracao-modbus.md#5-um-mestre-por-barramento)).
2. **Área de registradores:** descubra qual memória do CLP aparece como holding registers e **qual é o deslocamento** entre o endereço do CLP e o endereço Modbus (seção 3).
3. **Bloco:** reserve 32 words contíguas para cada máquina (padrão: HR 1000 a 1031).
4. **Lógica:** chame o [`FB_OEE_ENGEMASE`](FB_OEE_ENGEMASE.st) todo ciclo, uma instância por máquina, em memória retentiva. Onde não há ST, traduza a lógica para Ladder. Notas de cada software na seção 10.
5. **Cópia:** as 32 words do FB vão para a área do servidor, **word a word**, todo ciclo. **Não** mapeie os contadores como DINT/UDINT nativos: a ordem de words passaria a ser a do CLP, e não a CDAB do bloco (seção 4).
6. **Escrita:** se o servidor permitir bloquear escrita numa faixa (ABB, por exemplo), bloqueie a faixa do bloco. O FB reescreve tudo a cada ciclo de qualquer forma.
7. **Teste:** leia o bloco com o gateway ou com um cliente Modbus no notebook (seção 5) antes de cadastrar a máquina na plataforma.

**Por que o FB divide as words:** como o FB monta as words por aritmética, a ordem **CDAB sai igual em qualquer CLP**, big-endian ou little-endian. A ordem nativa de cada marca (seção 4) só importa para quem mapear variáveis de 32 bits diretamente, o que este guia não recomenda.

## 2. Marcas prioritárias: resumo

Legenda: ✅ nativo, sem módulo nem licença · ⚙️ nativo, exige configuração ou bloco no programa · 🧩 exige módulo, gateway de protocolo ou código de exemplo · ❓ confirmar.

| Família | Software | Modbus TCP (servidor) | Modbus RTU (escravo) | ST | Onde ficam os HR | Ordem nativa 32 bits | Licença |
|---|---|---|---|---|---|---|---|
| Siemens S7-1200 / S7-1500 | TIA Portal (STEP 7 Basic/Professional) | ⚙️ `MB_SERVER` no programa | 🧩 CM 1241 / CB 1241 (S7-1200); CM PtP RS422/485 **HF** (S7-1500) | Sim (SCL) | Array de Word apontado por `MB_HOLD_REG` | ABCD | Instruções sem licença; TIA Portal pago |
| Siemens S7-300 / S7-400 | STEP 7 Classic ou TIA Portal | 🧩 biblioteca Modbus/TCP da Siemens (CP ou CPU PN) | 🧩 CP 341 / CP 441-2 com driver Modbus | Sim (SCL) | Definido pela biblioteca | ABCD | **Licença paga por CPU** (confirmar) |
| Schneider M221 | Machine Expert – Basic | ⚙️ marcar "Modbus server enabled" (modelos com Ethernet) | ✅ SL1; SL2 só nos TM221C sem Ethernet ou com o cartucho TMC2SL1 (seção 7.1) | **Não** | %MWn = HR n | CDAB (confirmar) | Software gratuito |
| Schneider M241 / M251 / M262 | Machine Expert (CODESYS V3) | ⚙️ servidor embarcado (vem desativado) ou "Modbus TCP Slave Device" | ⚙️ M241: linha serial como escravo | Sim | %MWn = HR n (unit id 255) ou %QW do Slave Device | CDAB (confirmar) | Licença gratuita limitada ou paga (confirmar) |
| Schneider M340 / M580 | Control Expert | ✅ CPU com Ethernet ou NOE/NOC | ⚙️ M340: porta serial da CPU; M580: módulo serial | Sim | %MWn = HR n | CDAB (confirmar) | Control Expert pago |
| Rockwell Micro820 / 850 / 870 | Connected Components Workbench (CCW) | ⚙️ tabela "Modbus Mapping" | ✅ porta serial embarcada | Sim | Variáveis globais mapeadas em 4xxxxx (6 dígitos) | ABCD | CCW Standard gratuito (confirmar) |
| Rockwell CompactLogix / ControlLogix | Studio 5000 Logix Designer | 🧩 **sem servidor nativo**: AOI de exemplo sobre sockets, gateway EtherNet/IP↔Modbus TCP ou, no futuro, driver EtherNet/IP no gateway Engemase | 🧩 módulo de terceiros | Conforme a edição (confirmar) | Definido pela AOI ou pelo gateway | Definido pela AOI ou pelo gateway | Studio 5000 pago; gateway de protocolo pago |
| ABB AC500 V3 / AC500-eCo V3 | Automation Builder (CODESYS V3) | ⚙️ objeto "Modbus TCP/IP Server" na interface ETH | ⚙️ COM como escravo (eCo: conforme o modelo) | Sim | %MWn = HR n | CDAB (provável, confirmar) | Automation Builder Basic gratuito basta para o eCo V3 |
| ABB AC500 V2 / AC500-eCo V2 | Automation Builder (CODESYS 2.3) | ⚙️ protocolo Modbus na interface ETH | ⚙️ COM como escravo | Sim | %MW0.n = HR n | ABCD (provável, confirmar) | Confirmar a edição exigida |

Quando o CLP **não tem como expor o bloco** (fechado pelo fabricante da máquina, sem porta livre, sem acesso ao programa, sem Modbus ou sem licença): use um **módulo de I/O remoto Modbus TCP** ligado aos sinais da máquina, com os pulsos de peça no **contador de hardware** do módulo ([docs/11 §2](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Nesse caso não há bloco OEE: o template é o de sinais discretos.

## 3. Endereços: a fonte nº 1 de erro

| Notação | Exemplo para o início do bloco | Onde aparece |
|---|---|---|
| **Endereço de protocolo, base 0** | **1000** | Plataforma, config do gateway (`offset`), `--offset` da CLI |
| Convenção 4xxxx (5 dígitos, base 1) | 41001 | docs/11, IHMs, muitos manuais |
| Convenção 4xxxxx (6 dígitos, base 1) | 401001 | CLI do gateway, Rockwell CCW, alguns softwares de CLP |
| Memória do CLP | `MB_HOLD_REG[0]` com `HR_Start_Offset = 1000` (Siemens), %MW1000 (Schneider, ABB V3), %MW0.1000 (ABB V2) | Software do CLP |

**Deslocamentos das marcas prioritárias:**

| Família | Regra | Bloco no HR 1000 | Unit id |
|---|---|---|---|
| Siemens `MB_SERVER` | `MB_HOLD_REG[i]` = HR (`HR_Start_Offset` + i). Sem offset, a primeira word é o HR 0 [S1] | `HR_Start_Offset := 1000` e array `[0..31]`, ou array `[0..1031]` | Confirmar (teste 1, 0 e 255) |
| Schneider M221 | %MWn = HR n | %MW1000–%MW1031 | **255** (padrão do M221 [E6]) |
| Schneider M241/M251/M262, servidor embarcado | %MWn = HR n | %MW1000–%MW1031 | **255** [E2][E3] |
| Schneider M241/M251/M262, Modbus TCP Slave Device | %IW nos registradores 0 a n−1 (escrita do mestre); **%QW nos registradores n a n+m−1** (só leitura) [E2] | Base = **n** (quantidade de %IW configurada), não 1000 | O do dispositivo (1–247) |
| Schneider M340/M580 | %MWn = HR n | %MW1000–%MW1031 | Confirmar |
| Rockwell Micro800 | Endereço de 6 dígitos − 400001 = base 0 | Variáveis em **401001 a 401032** | Confirmar |
| ABB AC500 V3 / eCo V3 | %MWn = HR n [A4] | %MW1000–%MW1031 (no PM5012, só %MW0–%MW2047 são acessíveis [A3]) | Confirmar |
| ABB AC500 V2 / eCo V2 | %MW0.n = HR n (segmento 0); o segmento 1 vem depois [A8] | %MW0.1000–%MW0.1031 | Confirmar |

As regras das outras marcas estão na seção 11.

**Teste do deslocamento:** leia o bloco e procure o valor fixo **1** (`versao_bloco`) e o heartbeat que sobe a cada segundo. Se o 1 aparecer um registrador antes ou depois do esperado, há deslocamento de 1: **corrija o endereço base no template**, não o CLP.

## 4. Ordem de bytes e de words

O bloco v1 pede (G5 e G6 da [especificação](bloco-oee-v1.md#2-regras-gerais)): **bytes na ordem padrão do Modbus** dentro de cada registrador e **CDAB** nos valores de 32 bits (word baixa no offset menor). Com o FB, as duas regras saem certas em qualquer marca, **desde que** o servidor não troque bytes.

| Família | Ordem nativa de um valor de 32 bits na memória | Com o FB | Cuidado |
|---|---|---|---|
| Siemens S7 (todas) | ABCD (big-endian) | CDAB | Um DInt copiado direto sai com a word alta primeiro |
| Schneider M221 (Machine Expert – Basic), M340 e M580 (Control Expert) | CDAB: %MDn ocupa %MWn (word baixa) e %MWn+1 (alta) (confirmar; [E9] para o M580) | CDAB | — |
| Schneider M241, M251 e M262 (Machine Expert, CODESYS V3) | CDAB: %MDn ocupa **%MW2n** (word baixa) e **%MW2n+1** (alta). Ex.: %MD1 = %MW2 e %MW3 (confirmar) | CDAB | O índice do %MD não é o do %MW (seção 7.2): um %MD mapeado direto cai em outros registradores |
| Rockwell Micro800 | ABCD: "o byte mais significativo vem sempre primeiro" [R1] | CDAB | Mapear um DINT direto na tabela dá ABCD |
| Rockwell Logix (via AOI ou gateway) | Definida pela AOI ou pelo gateway. A memória do Logix é little-endian: copiar um DINT para INT[2] com `COP` põe a word baixa no índice 0 (confirmar) | CDAB | Passe só INT/words, nunca DINT, para a AOI ou o gateway |
| ABB AC500 V3 / eCo V3 | CDAB provável (CPU little-endian). Como no M241 (CODESYS V3), %MDn ocupa %MW2n e %MW2n+1. A Nota AN-0397 avisa que o layout de memória mudou do V2 para o V3 [A7] (confirmar) | CDAB | O servidor tem o parâmetro **ordem de bytes** dos registradores: deixe o padrão, **big endian** [A1]. Em little endian, a `versao_bloco` aparece como 256 |
| ABB AC500 V2 / eCo V2 | ABCD provável (CPU big-endian) (confirmar) | CDAB | Projeto convertido de V2 para V3 que use %MD muda de ordem: mais um motivo para usar o FB |

**Conferência:** force o contador total do FB em **100.000**. A leitura deve dar **34464** no offset 4 e **1** no offset 5 ([especificação, §6](bloco-oee-v1.md#6-ordem-das-words-cdab)).

## 5. Como testar a exposição do bloco

De um notebook Linux com o binário `oee-gateway` para amd64 (`make build-all` em `gateway/`) ou de um gateway de bancada. Num gateway de campo, o firewall só libera a rede OT para o próprio agente: lá, use a leitura pela fila do agente ou a página local **(Fase 1)**.

```bash
# Modbus TCP
oee-gateway modbus read --target tcp://192.168.10.23:502 --unit 1 --offset 1000 --count 32 --oee-block

# Schneider (servidor embarcado): unit id 255
oee-gateway modbus read --target tcp://192.168.10.30:502 --unit 255 --offset 1000 --count 32 --oee-block

# Modbus RTU com adaptador USB-RS485 (sem outro mestre ativo no barramento)
oee-gateway modbus read --target "rtu:///dev/ttyUSB0?baud=19200&parity=E&stop_bits=1" --unit 3 \
  --offset 1000 --count 14 --oee-block
```

Ou com um cliente Modbus no notebook (mbpoll, QModMaster, Modbus Poll), lendo 32 holding registers a partir do endereço base.

**Critério:** os testes 1 a 8 da [especificação, §11](bloco-oee-v1.md#11-verificação-no-comissionamento). Em resumo: versão = 1, heartbeat subindo, estado acompanhando a máquina, contadores batendo com a IHM, offsets 14–31 em 0 e sem exceção 02 nos 32 registradores. A matriz por marca está na [verificação de bancada, Parte C](verificacao-bancada-r1000.md#6-parte-c--clps-das-marcas-prioritárias-d26).

**Unit id em Modbus TCP:** o padrão do gateway é 1. Os Schneider com servidor embarcado respondem em **255**. Outros servidores ignoram o valor ou aceitam só 0. Se der timeout ou exceção com unit id 1, teste 255 e 0, e registre o valor certo no cadastro do dispositivo.

## 6. Siemens

**Famílias cobertas:** S7-1200 e S7-1500 (inclusive CPUs ET 200SP) no TIA Portal; S7-300 e S7-400 legados; LOGO! 8 em resumo. A geração **S7-1200 G2** é nova: confirmar no manual dela a versão do `MB_SERVER` antes do primeiro cliente.

### 6.1 S7-1200 e S7-1500: Modbus TCP com `MB_SERVER`

| Item | Como fazer |
|---|---|
| Instrução | **`MB_SERVER`** (Instruções > Comunicação > Outros > MODBUS TCP), chamada todo ciclo (OB1 ou OB cíclico), com `DISCONNECT = FALSE` [S1] |
| Conexão | Parâmetro `CONNECT` (estrutura `TCON_IP_v4`): servidor passivo, porta local 502, aceitando qualquer IP remoto. `CONNECT_ID` único na CPU (1 a 4095) [S5] |
| Uma instância por cliente | Cada cliente Modbus (gateway, IHM, SCADA) precisa de **uma instância própria**, com DB de instância e `CONNECT_ID` próprios [S5]. Se o gateway e a IHM leem por Modbus, são duas instâncias |
| Área do bloco | DB global com `aBloco : Array[0..31] of Word`, apontado por `MB_HOLD_REG` [S3] |
| Endereço base | Sem deslocamento, `MB_HOLD_REG[0]` é o HR 0 [S1]. Para o bloco ficar no HR 1000, escreva **`HR_Start_Offset := 1000`** no DB de instância **antes** da chamada (no OB100 ou numa rede antes do `MB_SERVER`). Endereços fora da janela respondem com exceção. Alternativa: `Array[0..1031] of Word` usando os elementos 1000–1031 |
| DB otimizado | A Siemens aceita DB **otimizado** com array de tipo elementar no S7-1500 [S1][S3] e pede acesso **padrão** no S7-1200 numa FAQ antiga [S2]. **Padrão Engemase:** DB global **sem acesso otimizado**, com array de Word: funciona nas duas famílias |
| Áreas em vários DBs | A partir da V4.0 das instruções, o `Data_Area_Array` (8 áreas) do DB de instância liga áreas Modbus a DBs diferentes [S4]. O bloco OEE não precisa disso |
| Conexões | O S7-1200 tem poucas conexões de comunicação aberta (em torno de 8, conforme CPU e firmware) [S5]. Confirmar na ficha técnica da CPU e contar IHM e SCADA |
| Licença | As instruções Modbus TCP vêm com o STEP 7 e funcionam nas interfaces PROFINET integradas **sem licença extra**. O TIA Portal é pago: **STEP 7 Basic** (só S7-1200) ou **Professional** (S7-1200, S7-1500, S7-300, S7-400) |

### 6.2 S7-1200 e S7-1500: Modbus RTU

- **S7-1200:** módulo **CM 1241 (RS-422/485)** ou placa **CB 1241 (RS-485)**, com `Modbus_Comm_Load` (uma vez, e com sucesso, antes do resto) e **`Modbus_Slave`** (todo ciclo). O `MB_HOLD_REG` aponta para o mesmo array; o `HR_Start_Offset` existe também no `Modbus_Slave` (confirmar na versão).
- **S7-1500:** módulo **CM PtP RS422/485 HF** (ou CM PtP do ET 200SP), que faz Modbus RTU mestre e escravo [S6]. As variantes **BA** não fazem Modbus (confirmar no catálogo). Os módulos seriais do S7-1500 **não** fazem Modbus ASCII [S6].

### 6.3 S7-300 e S7-400 (legados)

- **Modbus TCP:** não há `MB_SERVER` nativo. A Siemens vende bibliotecas Modbus/TCP para a interface PN da CPU e para os CPs Ethernet (CP 343-1, CP 443-1). **Licença paga por CPU**; número de pedido e preço: confirmar com a Siemens antes de orçar.
- **Modbus RTU:** CP 341 (S7-300) ou CP 441-2 (S7-400) com o driver Modbus escravo carregável, vendido à parte (confirmar).
- **Programação:** S7-300 e S7-400 não têm os tipos `UDINT` e `UINT` (só S7-1200 e S7-1500 [S8]). O FB precisa de ajuste (seção 10.1).
- **Sem licença ou sem acesso ao programa:** módulo de I/O remoto (MVP) ou S7comm PUT/GET na fase futura ([docs/03](../03-gateway.md#futuro-outros-protocolos)). Ver a seção 13.

### 6.4 LOGO! 8

O LOGO! 8 (FS4 em diante) tem servidor Modbus TCP nativo, habilitado no LOGO!Soft Comfort ([docs/11 §2](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Não tem ST e a memória de variáveis é pequena: a faixa de HR acessível e se o bloco cabe no HR 1000 devem ser **confirmados no manual do fabricante**. Na dúvida, use o módulo de I/O remoto.

### 6.5 Atenção na Siemens

- **Download sem perder contadores:** no S7-1500, use **"carregar sem reinicialização"** (reserva de memória, só em blocos otimizados). Trocar tipo, mudar a retenção ou apagar variáveis do FB **reinicializa** o DB de instância [S7]: os contadores voltam a 0 e o gateway registra `counter_reset`. Faça essas mudanças fora de produção e avise o suporte.
- O `MB_SERVER` aceita escrita (FC06/FC16) de qualquer cliente na rede OT. O FB reescreve o bloco todo ciclo, então uma escrita indevida não persiste.
- S7comm (PUT/GET) e OPC UA são protocolos da fase futura ([docs/03](../03-gateway.md#futuro-outros-protocolos)), não do MVP.

**Teste:** `oee-gateway modbus read ... --unit 1 --offset 1000 --count 32 --oee-block`. Exceção 02 = `HR_Start_Offset` ou tamanho do array errado. Exceção ou timeout com o gateway ligado e a IHM funcionando = falta uma instância de `MB_SERVER` livre.

## 7. Schneider Electric

**Famílias cobertas:** M221 (Machine Expert – Basic); M241, M251 e M262 (Machine Expert, base CODESYS V3); M340 e M580 (Control Expert).

### 7.1 M221 (Machine Expert – Basic)

- **Modbus TCP:** servidor nativo nos modelos com Ethernet (TM221**CE**…). Em Configuração > ETH1, marque **"Modbus server enabled"** [E6]. Unit id padrão: **255** [E6].
- **Modbus RTU:** linha serial como escravo. Os **TM221CE** (com Ethernet, como o da bancada) têm **só a SL1** (RJ45, RS-232 ou RS-485) [E10]. A **SL2** existe nos TM221C sem Ethernet; num TM221CE, só com o cartucho **TMC2SL1**, comprado à parte [E11]. A SL1 costuma estar com a IHM: não entre num barramento que já tem mestre.
- **Endereços:** %MWn = HR n. O bloco fica em **%MW1000 a %MW1031**. Confirme a quantidade de %MW do modelo no guia de programação [E7].
- **Consistência (G8):** não documentada para o servidor Modbus do M221. Quem decide é o teste C9 da [bancada](verificacao-bancada-r1000.md#63-matriz-de-testes-por-marca). Se reprovar, o M221 não é liberado até haver solução escrita aqui (seção 13). O M221 tem um mapeamento próprio de escravo Modbus TCP (%IWM/%QWM, diferente do Slave Device da seção 7.2; confirmar no guia de programação [E7]): se ele garante a consistência ainda não foi testado.
- **Sem ST:** o Machine Expert – Basic programa em Ladder, Lista de Instruções e Grafcet [E5]. Traduza a lógica do FB para Ladder com blocos de operação (atribuições e comparações), escrevendo direto nos %MW. Faça a soma circular e a divisão em words exatamente como no FB. Atenção: %MD é com sinal (DINT); a soma circular precisa tratar a passagem de 2.147.483.647 para negativo como continuação (confirmar o comportamento de estouro).
- **Licença:** o Machine Expert – Basic é gratuito.

### 7.2 M241, M251 e M262 (Machine Expert)

Há dois jeitos de expor o bloco. O segundo atende a regra de consistência do bloco (G8).

| | Servidor embarcado | Modbus TCP Slave Device |
|---|---|---|
| Como habilitar | Vem **desativado**; habilite na configuração Ethernet [E1] | Adicione o dispositivo na porta Ethernet [E2] |
| Área | **%MW** (FC3, FC6, FC16, FC23) [E1] | %IW (escrita pelo mestre) nos registradores 0 a n−1; **%QW (só leitura)** nos registradores n a n+m−1 [E2] |
| Unit id | **255** [E2][E3] | O do dispositivo, 1 a 247 [E2] |
| Consistência | **Só uma word** por vez [E1]: um contador de 32 bits pode ser lido "rasgado" | Todas as %IW e %QW atualizadas juntas, sincronizadas com a tarefa MAST [E2] |
| Tamanho | Faixa %MW do controlador | De 2 a 120 words por sentido nas versões atuais (40 nas antigas) [E4] |
| Bloco | `AT %MW1000`, HR 1000 | Ligue o `aBloco` às 32 primeiras %QW; base no template = **n** (quantidade de %IW) |

```iecst
VAR_GLOBAL
    aMbInjetora03 AT %MW1000 : ARRAY[0..31] OF WORD;   (* servidor embarcado: HR 1000–1031, unit id 255 *)
END_VAR
```

- **Recomendação:** use o **Slave Device** quando o cliente aceitar uma base diferente de 1000 (vale para o template, G2 da especificação). Com o servidor embarcado, a leitura rasgada é rara (só na virada da word baixa, a cada 65.536 peças), mas aparece como `counter_reset` seguido de `counter_jump` e perde as peças daquele instante.
- Confirmar na bancada se o %QW do Slave Device é lido com FC03 a partir do registrador n e se o FC04 é aceito (há relatos de exceção 01 com FC04).
- O `FB_ModbusTcpServer` da biblioteca não pode usar a porta 502, que é do servidor embarcado.
- Em CODESYS, %MD1 ocupa %MW2 e %MW3 (o índice do %MD não é o do %MW). Mais um motivo para usar só words.
- **Modbus RTU (M241):** linha serial configurada como escravo Modbus. Confirmar no manual do fabricante. No M251 e no M262, confirmar se o modelo tem porta serial.
- **Conexões:** o servidor do M262 aceita 8 conexões [E3]. Confirmar no M241 e no M251.
- **Licença:** o Machine Expert tem licença gratuita após o período de teste, com funções limitadas, e licenças pagas Standard e Professional [E8]. Confirmar se a gratuita basta para os M2xx.

### 7.3 M340 e M580 (Control Expert)

- Servidor Modbus TCP nativo (CPU com Ethernet ou módulo NOE/NOC), **%MWn = HR n**.
- **Controle de acesso por IP:** nas CPUs com firmware de segurança, o servidor só atende clientes autorizados na aba de segurança da CPU [E9]. Inclua o IP OT do gateway, senão a leitura falha sem motivo aparente.
- **Modbus RTU:** a porta serial da CPU M340 pode ser escravo. O M580 não tem serial na CPU: precisa de módulo (confirmar).
- **Programação:** em Control Expert, as funções do arquivo viram DFB ou código direto na seção (seção 10.3). Licença paga.

## 8. Rockwell Automation

**Famílias cobertas:** Micro820, Micro850 e Micro870 (CCW); CompactLogix e ControlLogix (Studio 5000). A Micro830 não tem Ethernet: só Modbus RTU pela porta serial.

### 8.1 Micro800 (Micro820, Micro850, Micro870)

- **Modbus TCP:** servidor nativo nos modelos com Ethernet. Não há configuração de protocolo além da tabela de mapeamento [R1]. **Modbus RTU:** porta serial embarcada como escravo. Sem licença.
- No **Connected Components Workbench (CCW)**, preencha a tabela **"Modbus Mapping"** nas propriedades do controlador: cada variável global recebe um endereço de 6 dígitos [R1]. Para a base 1000: **401001 a 401032**.
- **Mapeie as 32 words sem buracos.** Lacunas no mapeamento causam erro de comunicação na leitura em bloco [R2]. A tabela aceita um número limitado de variáveis (200 no FactoryTalk Design Workbench [R3]; confirmar no CCW).
- Declare 32 variáveis globais `WORD`/`UINT` (por exemplo `MB_INJ03_00` a `MB_INJ03_31`) e copie o `aBloco` para elas no fim do programa. Se a versão do CCW aceitar mapear elementos de array, use o array (confirmar no manual do fabricante).
- **Ordem nativa ABCD:** a Micro800 é big-endian e, em tipos maiores que 16 bits, "o byte mais significativo vem sempre primeiro" [R1]. Um DINT mapeado direto sai ABCD: por isso use o FB.
- ST disponível no CCW (`TON` padrão IEC). Retenção dos contadores: confirmar no CCW como declarar as variáveis do FB como retidas.
- **Licença:** CCW Standard gratuito (confirmar a edição atual).

### 8.2 CompactLogix e ControlLogix

**Não há servidor Modbus TCP nativo** nesses controladores. Até a decisão da seção 13, as opções são estas, em ordem de preferência técnica:

| # | Opção | Como funciona | Prós | Contras |
|---|---|---|---|---|
| 1 | **AOI de servidor Modbus TCP da Rockwell** (Sample Code Library) | Add-On Instruction sobre a interface de sockets do EtherNet/IP [R4]. Expõe tags da controladora como holding registers (formato e limites: confirmar na documentação da AOI) | Sem hardware extra, sem licença | Só em controladores e portas com sockets (lista no artigo 470690 da base de conhecimento da Rockwell); firmware 20 ou superior; **uma AOI de servidor por CompactLogix**; a primeira instância usa cerca de 123 KB de memória [R5]. Código de exemplo, sem suporte formal. Uma versão antiga (Modbus TCP Slave R1.02) pede 280–300 KB [R6] |
| 2 | **Gateway de protocolo EtherNet/IP ↔ Modbus TCP** | O controlador troca uma tag `INT[32]` com o gateway por conexão de I/O; o gateway publica esses valores como holding registers. Ex.: ProSoft **PLX32-EIP-MBTCP** [R7], HMS **Anybus Communicator ABC4011** (adaptador EtherNet/IP ↔ servidor Modbus TCP) [R8]; módulos no rack ProSoft MVI69E/MVI56E (confirmar o modelo) | Não pesa no controlador; suporte do fabricante do gateway | Custo de hardware por CLP ou por planta, mais um equipamento para configurar e manter |
| 3 | **Driver EtherNet/IP (CIP) no gateway Engemase** | O gateway lê a tag `aBloco` (INT[32]) direto do controlador | Sem Modbus, sem hardware extra, mesmo bloco | **Não existe hoje:** está no roadmap de protocolos nativos ([docs/03](../03-gateway.md#futuro-outros-protocolos), [docs/10](../10-decisoes-arquiteturais.md)). Exige decisão de prioridade |
| 4 | **Módulo de I/O remoto** | Sinais da máquina num módulo Modbus TCP | Funciona sem mexer no programa | Sem bloco OEE; template de sinais discretos |

Em todas as opções com bloco:
- O FB vira AOI ou rotina ST (seção 10.2). Passe para a AOI ou para o gateway **só words (INT)**, nunca DINT: assim a ordem CDAB do FB chega intacta.
- Confira na documentação da AOI ou do gateway se o primeiro elemento do array é o HR 0 ou o HR 1, e teste com o valor 100.000.
- O editor de ST depende da edição do Studio 5000 (confirmar com o distribuidor). Sem ST, traduza o FB para Ladder ou AOI em Ladder.
- **Download:** um download completo grava no controlador os valores das tags do projeto offline. Antes de baixar um programa novo, **suba (upload) os valores** dos contadores ou faça a mudança por edição online. Senão os contadores voltam e o gateway registra `counter_reset`.

## 9. ABB

**Famílias cobertas:** AC500 V3 e AC500-eCo V3 (Automation Builder, CODESYS V3); AC500 V2 e AC500-eCo V2 (Automation Builder, CODESYS 2.3).

### 9.1 AC500 V3 e AC500-eCo V3

| Item | Como fazer |
|---|---|
| Servidor | Adicione o objeto **"Modbus TCP/IP Server"** abaixo da interface Ethernet na árvore de dispositivos. **Um servidor por interface** [A1][A6] |
| Firmware | No eCo V3, o servidor Modbus TCP existe a partir do firmware **3.4.1** (PM5012, PM5032, PM5052, PM5072) e **3.6.2** (PM5082, PM5092) [A1] |
| Endereços | **%MWn = HR n** [A4]. O bloco fica em **%MW1000 a %MW1031**. A faixa acessível depende da CPU: no **PM5012, %MW0 a %MW2047**; no PM5072/PM5082, até %MW32767 [A3] |
| Ordem dos bytes | Parâmetro do servidor; padrão **big endian** (o do Modbus) [A1]. Não mude |
| Proteção de escrita | O servidor permite bloquear escrita (e leitura) numa faixa de %MB [A2]. Bloqueie a escrita em **%MB2000 a %MB2063** (= %MW1000 a %MW1031): uma escrita externa recebe exceção |
| Conexões | Poucas no eCo: **PM5012 = 3**, PM5032 = 8, PM5052 = 10, PM5072 = 15 (firmware 3.4.1) [A5]. Com IHM e SCADA, o PM5012 fica sem folga |
| Exceção 09 | O servidor pode responder a exceção 09, que não existe na especificação Modbus [A1]. Se aparecer na CLI, registre o caso para a engenharia |
| Modbus RTU | COM configurada como escravo Modbus RTU [A11]. No eCo V3, porta serial embarcada ou em placa opcional, conforme o modelo (confirmar) |
| Licença | **Automation Builder Basic é gratuito** e basta para o AC500-eCo V3 [A9]. Para o AC500 V3, a edição Basic inclui LD, FBD, SFC e ST [A9]; confirmar se o servidor Modbus TCP entra nela |

```iecst
VAR_GLOBAL
    aMbInjetora03 AT %MW1000 : ARRAY[0..31] OF WORD;   (* HR 1000–1031 *)
END_VAR
```

### 9.2 AC500 V2 e AC500-eCo V2

- **Modbus TCP:** protocolo Modbus habilitado na configuração da interface Ethernet da CPU (ex.: PM573-ETH, PM583-ETH, eCo PM554-ETH/PM564-ETH). Confira o número de conexões de servidor no parâmetro da interface: há relatos de padrão 0 (confirmar no manual do fabricante).
- **Endereços:** a memória %M é dividida em segmentos. O Modbus enxerga os segmentos 0 e 1 [A8]: **HR n = %MW0.n** (n até 32767). O bloco fica em **%MW0.1000 a %MW0.1031**. Confirmar na tabela de endereços Modbus da ajuda [A4].
- **Ordem nativa:** provável ABCD (CPU big-endian). A ABB avisa que o endereçamento Modbus mudou do V2 para o V3 [A7]: ao converter um projeto, refaça o mapeamento e repita o teste dos 100.000.
- **Modbus RTU:** COM1/COM2 configuradas como escravo Modbus (confirmar no manual do fabricante).
- **Licença:** confirmar a edição do Automation Builder exigida para a linha V2.

**Teste (V2 e V3):** como o unit id não aparece na configuração do servidor, teste 1, 0 e 255 na primeira leitura e registre o que funcionou.

## 10. Portabilidade do `FB_OEE_ENGEMASE`

O [`FB_OEE_ENGEMASE.st`](FB_OEE_ENGEMASE.st) usa só ST da norma IEC 61131-3: tipos, conversões e o temporizador `TON`. A lógica **não muda** entre marcas. O que muda está abaixo. Em todos os casos, confira com o teste dos 100.000 (offsets 4 e 5 = 34464 e 1) e com um desligamento do CLP (contadores mantidos).

**Em todas as plataformas:** o exemplo de chamada e as notas do fim do arquivo estão dentro de um comentário. Importe só as POUs (as duas funções de soma, as duas de word e o FB).

### 10.1 TIA Portal (SCL): S7-1200, S7-1500 e S7-300/400

| Item | Ajuste |
|---|---|
| Importação | Fonte externa (`.scl`) e **"Gerar blocos a partir da fonte"**. Acrescente `BEGIN` entre as declarações e o código de cada `FUNCTION` e `FUNCTION_BLOCK` |
| Temporizadores | Multi-instância IEC: declare `tonHeartbeat : TON_TIME;` e `tonCiclo : TON_TIME;` (ou `IEC_TIMER`). `TIME_TO_DINT` dá milissegundos |
| Tipos | `UDINT`, `UINT` e `WORD` existem no S7-1200 e no S7-1500 [S8] |
| Retenção | Em bloco otimizado, `VAR RETAIN` no FB marca os contadores como retentivos no DB de instância. Em bloco não otimizado, a retenção vale para o DB de instância inteiro (confirmar na versão) |
| Download | Use "carregar sem reinicialização" (seção 6.5) [S7] |
| Saída | `aBloco` como `VAR_IN_OUT` apontando para o array do DB do `MB_SERVER` |
| **S7-300/400** | **Não há `UDINT` nem `UINT`** [S8]. Declare os contadores como `DWORD` e as words como `WORD`. Faça a soma circular com a mesma regra do `FC_OEE_SOMA_CIRC`, em `DINT`/`DWORD` (confirmar o comportamento de estouro), e divida as words com `DWORD_TO_WORD(dw)` (baixa) e `DWORD_TO_WORD(SHR(IN := dw, N := 16))` (alta). Temporizador: `TON` (SFB 4) com instância. S7-SCL no STEP 7 Classic é pacote opcional; no TIA Portal vem no STEP 7 Professional |

### 10.2 Studio 5000 Logix Designer (ST ou AOI): CompactLogix e ControlLogix

| Item | Ajuste |
|---|---|
| Estrutura | O Logix não tem `FUNCTION`. O FB vira uma **AOI** (uma tag de instância por máquina); as quatro funções viram código dentro da AOI |
| Bloco | Parâmetro **InOut `INT[32]`** (a AOI aceita array como InOut). É esse array que vai para a AOI de servidor Modbus ou para o gateway de protocolo |
| Tipos | Tipos sem sinal (`UINT`, `UDINT`) só a partir da versão 32 e só nos CompactLogix 5380/5480 e ControlLogix 5580 [R10] (confirmar o suporte em expressões). Caminho portável: cada contador em **duas DINT** (parte baixa e alta, de 0 a 65535), somando a baixa e propagando o "vai um" para a alta. Isso evita o estouro de DINT, que gera falha menor no Logix, e já entrega as words |
| Words em INT | O INT do Logix vai de −32768 a 32767. Uma word acima de 32767 precisa virar o padrão de bits correspondente (valor − 65536), ou ser copiada com `COP`/`BTD`. Confirme com o teste dos 100.000 |
| Temporizador | Em ST não há `TON`: use **`TONR`** com tag `FBD_TIMER` [R9]: `t.PRE := 1000; t.TimerEnable := NOT t.DN; TONR(t);`. O tempo decorrido é `t.ACC`, em ms (DINT): a seção 4 do FB usa `t.ACC` direto, sem `TIME_TO_DINT` |
| Retenção | As tags mantêm o valor sem energia. O risco é o **download**, que sobrescreve os valores (seção 8.2) |
| Comentários | `(* *)`, `/* */` e `//` são aceitos em ST |
| Editor | O editor de ST depende da edição do Studio 5000 (confirmar). Sem ele, escreva a AOI em Ladder com a mesma lógica |

### 10.3 Machine Expert (CODESYS V3): M241, M251, M262; e Control Expert (M340, M580)

| Item | Ajuste |
|---|---|
| Importação | Quase sem mudança: crie as POUs e cole o código. `TON` vem da biblioteca Standard; `TIME` é em ms (`LTIME` é que é em ns) |
| Retenção | `VAR RETAIN` local no FB põe **a instância inteira** na memória retentiva [C1]. RETAIN **não sobrevive a download** nem a reinício a frio [C1]. Para manter os contadores num download, use **PERSISTENT** (lista de variáveis persistentes) [C2]; confirmar o suporte no M2xx |
| Bloco | `AT %MW1000` (servidor embarcado) ou ligação às %QW do Modbus TCP Slave Device (seção 7.2) |
| Control Expert (M340/M580) | Não há POU `FUNCTION` do usuário no mesmo formato: as funções viram **DFB** ou código direto na seção. `TON` existe como EFB. Retenção e comportamento no download: confirmar no manual do fabricante |
| M221 | Sem ST: tradução para Ladder (seção 7.1) |

### 10.4 Automation Builder: AC500 V3 / eCo V3 (CODESYS V3) e AC500 V2 / eCo V2 (CODESYS 2.3)

| Item | Ajuste |
|---|---|
| V3 e eCo V3 | Igual ao CODESYS V3 da seção 10.3 (RETAIN e PERSISTENT [C1][C2]). Bloco com `AT %MW1000` |
| V2 e eCo V2 | CODESYS 2.3. Endereço com segmento: `AT %MW0.1000`. Retenção: área retentiva configurada na CPU ou `VAR_GLOBAL RETAIN` (confirmar). Se o compilador recusar `UDINT#16#FFFFFFFF`, use `16#FFFFFFFF` |
| Conversão V2 → V3 | O layout de memória e o endereçamento Modbus mudam [A7]: refaça o `AT` e o teste dos 100.000 |

## 11. Outras marcas

Atendidas sob demanda, sem bancada própria (seção 13). Tudo aqui é para **confirmar no manual do fabricante** e testar antes do cliente.

| Fabricante / família | Modbus TCP (servidor) | Modbus RTU (escravo) | ST disponível | Onde ficam os HR | Ordem nativa 32 bits |
|---|---|---|---|---|---|
| WEG PLC300 | ✅ (confirmar) | ✅ (confirmar) | Confirmar | Confirmar | Confirmar |
| WEG PLC500 (CODESYS) | ⚙️ adicionar "Modbus TCP Slave" no projeto | ⚙️ escravo serial no projeto (confirmar) | Sim | Imagem de E/S do dispositivo escravo (%QW/%IW) | CDAB (confirmar) |
| WEG CLIC02 / TPW-03 / TPW-04 | ❓ | ❓ | Não (CLIC02); confirmar nos demais | Confirmar | Confirmar |
| Delta DVP | ✅ modelos Ethernet; 🧩 DVP-EN01-SL nos demais | ✅ COM2 (padrão de fábrica: **ASCII 9600 7E1**) | ISPSoft: sim em vários modelos (confirmar); WPLSoft: não | **D(n) = HR 4096 + n** | CDAB |
| Delta AS | ✅ | ✅ COM1/COM2 (HWCONFIG) | Sim (ISPSoft) | Confirmar (tabela diferente da DVP) | CDAB (confirmar) |
| Mitsubishi FX5U | ⚙️ por parâmetro (GX Works3) | ⚙️ RS-485 embutida, por parâmetro | Sim | Registradores D, pela atribuição MODBUS (parâmetro) | CDAB |
| Mitsubishi FX3U/FX3G, iQ-R | 🧩 módulo ou adaptador | 🧩 módulo ou adaptador | FX3: limitado; iQ-R: sim | Definido pelo módulo | CDAB |
| Omron NJ / NX | 🧩 FB sobre sockets (confirmar biblioteca) | 🧩 confirmar | Sim (Sysmac Studio) | Definido pelo FB | Confirmar |
| Omron CP1 / CP2E | CP1: não; CP2E: confirmar | CP1: **só mestre** (sem escravo nativo) | CX-Programmer: ST em FB | Confirmar | CDAB (confirmar) |
| Altus Nexto | ⚙️ instância de servidor Modbus no MasterTool | ⚙️ escravo na COM (confirmar) | Sim | Mapeamentos variável ↔ endereço Modbus | Confirmar |
| Altus Hadron Xtorm | ⚙️ confirmar | ⚙️ confirmar | Sim (confirmar) | Mapeamentos (confirmar) | Confirmar |
| Unitronics Vision/Samba | ⚙️ inicializar socket como escravo Modbus no Ladder | ⚙️ bloco de configuração Modbus | Não (VisiLogic) | MI (confirmar correspondência) | Confirmar |
| Unitronics UniStream | ⚙️ configuração de escravo Modbus (UniLogic) | ⚙️ confirmar | Confirmar | Tabela de dados mapeada a tags | Confirmar |
| Eaton easyE4 | ⚙️ modelos com Ethernet (confirmar firmware) | ❓ confirmar módulo | Sim (easySoft 7 ou superior, confirmar) | Confirmar | Confirmar |

### 11.1 WEG

- **PLC300:** servidor Modbus TCP e escravo Modbus RTU nativos ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Área que aparece como holding registers, deslocamento, ST e retenção: confirmar no manual do fabricante. Sem ST, traduza o FB para Ladder.
- **PLC500 (base CODESYS):** adicione o dispositivo **"Modbus TCP Slave"** (ou o escravo serial) no projeto. Em geral, os registradores que o **mestre escreve** aparecem para o CLP como entradas (%IW) e os que o **CLP publica** aparecem como saídas (%QW). Ligue o `aBloco` às **saídas** do dispositivo escravo e confira como o mestre lê essa área:
  - se o dispositivo tiver a opção de **sobrepor** as áreas de holding e de input registers, o gateway lê com FC03 (holding), como no template padrão;
  - se não tiver, cadastre o bloco como **input registers** (FC04) no template, com o mesmo layout ([especificação, G1](bloco-oee-v1.md#2-regras-gerais)).
  - A cópia para a imagem de E/S acontece no ciclo da tarefa do barramento: deixe o FB na mesma tarefa, para manter a consistência.
- **CLIC02, TPW-03 e TPW-04:** suporte a Modbus escravo, módulos, mapeamento e linguagens: confirmar. O CLIC02 programa em Ladder/blocos, sem ST, e tem pouca memória. Se não houver como expor 32 registradores, use o **módulo de I/O remoto**.

### 11.2 Delta

- **DVP, Modbus RTU:** escravo nativo na **COM2 (RS-485)**. **Padrão de fábrica: Modbus ASCII 9600 7E1**, que o gateway não fala (ele usa RTU com 8 bits de dados). Para RTU, configure com **D1120/M1143** e ajuste endereço, velocidade e paridade iguais às do barramento.
- **DVP, Modbus TCP:** modelos com Ethernet ou módulo **DVP-EN01-SL**.
- **DVP, endereços:** mapa fixo: **D0 = 0x1000**, M0 = 0x0800, X0 = 0x0400, Y0 = 0x0500. **D1000 → 4096 + 1000 = 5096** (0x13E8), convenção 45097. Com o bloco em D1000–D1031, o endereço base no template é **5096**, não 1000.
- **DVP, retenção:** por faixa de registradores (configurável no modelo). Bloco e contadores numa faixa retentiva (confirmar). ST no ISPSoft para vários modelos; o WPLSoft só tem Ladder e Lista de Instruções.
- **AS (AS200/AS300):** servidor Modbus TCP nativo; COM1 e COM2 como escravo no HWCONFIG. **A tabela de endereços Modbus da série AS é diferente da DVP:** confirmar antes de definir a base. ST no ISPSoft.

### 11.3 Mitsubishi

- **FX5U / FX5UC:** no GX Works3, adicione o dispositivo de conexão MODBUS/TCP na porta Ethernet embutida; a RS-485 embutida faz MODBUS_RTU escravo por parâmetro. A **atribuição de dispositivos MODBUS** liga os holding registers aos registradores **D**: ajuste-a para que o HR base caia no D onde o FB escreve. ST e FB disponíveis; confirmar o nome do temporizador IEC (`TON` ou `TON_E`). Sem licença.
- **FX3U / FX3G e iQ-R:** exigem módulo ou adaptador com função Modbus. Sem o módulo, use o módulo de I/O remoto ou, na fase futura, o protocolo nativo (MC/SLMP).

### 11.4 Omron

- **NJ / NX (Sysmac Studio):** sem servidor Modbus TCP nativo configurável; o caminho é um **FB de servidor Modbus sobre os sockets TCP** do controlador (confirmar biblioteca, licença e conexões). **TIME em nanossegundos:** ajuste a seção 4 do FB (`TIME_TO_DINT`) para obter milissegundos. Alternativas: módulo de I/O remoto ou EtherNet/IP/FINS na fase futura.
- **CP1:** Modbus RTU nativo **só como mestre**: não serve como escravo para o gateway; use o módulo de I/O remoto. **CP2E:** servidor Modbus TCP em alguns modelos (confirmar). ST só dentro de FB no CX-Programmer.

### 11.5 Altus

- **Nexto (MasterTool IEC XE):** adicione a instância de **servidor Modbus Ethernet** sob a interface de rede e configure os **mapeamentos** entre variáveis e endereços Modbus (HR 1000–1031 para o `aBloco`). Porta COM como escravo (confirmar). ST disponível (base CODESYS).
- **Hadron Xtorm:** servidor e mapeamentos semelhantes aos da Nexto (confirmar). **Duo:** confirmar.

### 11.6 Unitronics e Eaton

- **Unitronics Vision / Samba (VisiLogic):** servidor Modbus TCP criado no Ladder (rede e socket como **escravo Modbus** na porta 502); RTU pelo bloco de configuração Modbus. Correspondência MI ↔ holding registers: confirmar. **Sem ST.** **UniStream (UniLogic):** escravo Modbus na parte de comunicação, com tabela de dados ligada às tags (confirmar).
- **Eaton easyE4:** servidor Modbus TCP a partir de certa versão de firmware e do easySoft (confirmar). É um relé programável com pouca memória: se não couber o bloco, use o módulo de I/O remoto.

## 12. Checklist de entrega por CLP

| # | Item | OK |
|---|---|---|
| 1 | Marca, modelo, firmware e software de programação registrados no cadastro da máquina | ☐ |
| 2 | Licenças necessárias conferidas (TIA Portal, Studio 5000, biblioteca Modbus do S7-300/400, gateway de protocolo) | ☐ |
| 3 | Servidor Modbus (TCP ou RTU) habilitado; nenhum outro mestre no barramento RS-485 | ☐ |
| 4 | Limite de conexões Modbus TCP do CLP conferido (IHM e SCADA também consomem); IP do gateway autorizado onde houver controle de acesso (M580) | ☐ |
| 5 | Unit id conferido (255 nos Schneider com servidor embarcado) | ☐ |
| 6 | FB chamado todo ciclo, uma instância por máquina, em memória retentiva | ☐ |
| 7 | 32 words copiadas word a word para a área do servidor, todo ciclo; escrita bloqueada onde o servidor permitir | ☐ |
| 8 | Endereço base do template conferido com o teste do deslocamento (seção 3) | ☐ |
| 9 | Teste dos 100.000 aprovado (offsets 4 e 5 = 34464 e 1) | ☐ |
| 10 | Testes 1 a 8 da [especificação §11](bloco-oee-v1.md#11-verificação-no-comissionamento) aprovados | ☐ |
| 11 | Procedimento de download sem zerar contadores combinado com o cliente (seção 10) | ☐ |
| 12 | Lista de códigos de falha e de produto entregue para cadastro na plataforma | ☐ |
| 13 | Backup do programa alterado entregue ao cliente, com a autorização dele registrada | ☐ |

## 13. Pendências e decisões

| Item | Situação |
|---|---|
| Caminho padrão para CompactLogix/ControlLogix (AOI da Rockwell, gateway de protocolo ou driver EtherNet/IP no gateway Engemase) | **Decisão do dono do produto**, com custo e prazo de cada opção (seção 8.2) |
| S7-300/S7-400 legados: licença Modbus/TCP por CPU (quem paga) ou I/O remoto até o S7comm | Decisão do dono do produto |
| Bancada das 4 marcas (compra de CPUs e licença do TIA Portal) | Decisão do dono do produto; roteiro na [Parte C da bancada](verificacao-bancada-r1000.md#6-parte-c--clps-das-marcas-prioritárias-d26) |
| Schneider M241/M251/M262: Slave Device (base n) ou servidor embarcado (HR 1000) como padrão | Equipe técnica, depois do teste de bancada |
| Schneider M221: consistência do servidor Modbus TCP (teste C9 da bancada) | Bancada (Parte C). Reprovado = M221 não liberado até haver solução documentada na seção 7.1 |
| Pontos marcados "confirmar" nas seções 6 a 10 | Bancada (Parte C) e leitura dos manuais completos |
| Outras marcas (seção 11) | Sob demanda; teste de bancada antes do primeiro cliente de cada família |

## 14. Fontes

Consultadas em 12/11/2026. Fóruns e sites de terceiros estão indicados como tal e valem só como pista.

**Siemens**
- [S1] Siemens Industry Online Support, entrada 102020340 — *Modbus/TCP with instructions "MB_CLIENT" and "MB_SERVER"* (S7-1500 e S7-1200): <https://support.industry.siemens.com/cs/attachments/102020340/net_modbus_tcp_s7-1500_s7-1200_en.pdf>
- [S2] Siemens Industry Online Support, FAQ 83130159 — Modbus TCP com S7-1200 (12/2014): <https://support.industry.siemens.com/cs/attachments/83130159/83130159_NET_S7-1200_MODBUS_TCP_en.pdf>
- [S3] Siemens (portal de produtos da China) — instrução `MB_SERVER` V4, parâmetro `MB_HOLD_REG`: <https://www.ad.siemens.com.cn/productportal/Prods/S7-1200_PLC_EASY_PLUS/11-Comm/01-Ethernet/04-Modbus_TCP/01-Modbus_TCP_V4/02-Server.html>. O parâmetro estático `HR_Start_Offset` está na descrição da instrução no manual de sistema do S7-1200 (confirmar na versão)
- [S4] Ajuda do TIA Portal V20 — `Modbus_Slave`: acesso a áreas de dados em DB a partir da V4.0 (`Data_Area_Array`): <https://docs.tia.siemens.cloud/r/es-es/v20/modbus-rtu-s7-1200-s7-1500/modbus_slave-s7-1200-s7-1500/acceso-a-areas-de-datos-en-db-en-lugar-del-acceso-directo-a-direcciones-modbus-a-partir-de-la-version-v4.0-s7-1200-s7-1500>
- [S5] Fórum Siemens (não oficial) — conexões do S7-1200 e `CONNECT_ID` por instância: <https://support.industry.siemens.com/forum/WW/en/posts/number-of-connections-with-s7-1200/40503>
- [S6] Siemens Industry Online Support, entrada 68202723 — *Master-Slave Communication via a CM PtP Using the Modbus RTU Protocol*: <https://support.industry.siemens.com/cs/attachments/68202723/68202723_S7-1500_ModbusRTU_DOC_v2d0d1_en.pdf>
- [S7] Siemens — manual de funções S7-1500 *Structure and use of the CPU memory* (carregar sem reinicialização): <https://cache.industry.siemens.com/dl/files/101/59193101/att_80162/v1/s71500_structure_and_use_of_the_PLC_memory_function_manual_en-US_en-US.pdf>
- [S8] Ajuda do TIA Portal V20 — tipos de dados (`UINT`/`UDINT` só S7-1200 e S7-1500): <https://docs.tia.siemens.cloud/r/it-it/v20/tipi-di-dati>

**Schneider Electric**
- [E1] Ajuda do Machine Expert V2.0 — M241, *Modbus TCP Client/Server*: <https://product-help.se.com/docs/Machine%20Expert/V2.0/en/m241prg/m241prg/D-SE-0002961.html>
- [E2] Ajuda do Machine Expert V2.0 — M241, *Controller as a Slave Device on Modbus TCP*: <https://product-help.se.com/docs/Machine%20Expert/V2.0/en/m241prg/m241prg/D-SE-0002964.html>
- [E3] Ajuda do Machine Expert V2.2 — M262, *Controller as a Slave Device on Modbus TCP*: <https://product-help.schneider-electric.com/Machine%20Expert/V2.2/en/m262prg/m262prg/D-SE-0002964.html>
- [E4] Schneider FAQ FA278867 — máximo de words do Modbus TCP Slave Device: <https://www.se.com/hk/en/faqs/FA278867/>
- [E5] Schneider FAQ FA360163 — linguagens do Machine Expert – Basic: <https://www.se.com/sa/en/faqs/FA360163/>
- [E6] Schneider FAQs Vijeo Designer e Harmony — M221 com "Modbus server enabled" e unit id 255: <https://www.se.com/us/en/faqs/FAQSET0000003-vijeo-designer-harmony-hmi-faqs-schneider-electric/>
- [E7] Modicon M221 — Programming Guide (EIO0000003297): <https://www.se.com/uk/en/download/document/EIO0000003297>
- [E8] Ajuda do Machine Expert V2.2 — licenças: <https://product-help.schneider-electric.com/Machine%20Expert/V2.2/en/Installer/Installer/D-SE-0075111.html>
- [E9] Cybus (terceiros) — *Connecting a Schneider Modicon M580 PLC* (ordem de words, controle de acesso): <https://docs.cybus.io/guides/machine-connectivity/plcs-industrial-controllers/connecting-a-schneider-modicon-m580-plc>
- [E10] Schneider — ficha do TM221CE16T (portas integradas: Ethernet, "serial 1" RJ45 RS-232/RS-485 e USB mini B; sem "serial 2"): <https://www.se.com/il/en/product/TM221CE16T/logic-controller-modicon-m221-16-io-transistor-pnp-ethernet>. As fichas dos TM221C sem Ethernet (ex.: TM221C16T) listam "serial 1" e "serial 2"
- [E11] Schneider — cartucho de linha serial TMC2SL1 (compatível com o M221 compacto, M221C): <https://eshop.se.com/za/serial-line-cartridge-modicon-m221-1-communication-extension-tmc2sl1.html>
- EcoStruxure Machine Expert — *Modbus TCP User Guide* (EIO0000003826): <https://www.se.com/au/en/download/document/EIO0000003826/>

**Rockwell Automation**
- [R1] Rockwell — manuais do usuário Micro830/850/870 (2080-UM002) e Micro820 (2080-UM005), apêndice *Modbus Mapping for Micro800*. Cópia consultada: <https://docs.rs-online.com/36a5/0900766b8123c7d2.pdf>
- [R2] Rockwell — nota de aplicação *Modbus Mapping for Micro8x0 controllers and PVC*: <https://support.rockwellautomation.com/cc/okcsFattachCustom/get/455060_5>
- [R3] Ajuda do FactoryTalk Design Workbench — Micro800, *Modbus Mapping*: <https://www.rockwellautomation.com/en-us/docs/factorytalk-design-workbench/1-01-00/ftdw-help-ditamap/micro800-controller/micro800-controller-configuration/controller-modbus-mapping.html>
- [R4] Rockwell — *EtherNet/IP Socket Interface* (ENET-AT002): <https://literature.rockwellautomation.com/idc/groups/literature/documents/at/enet-at002_-en-p.pdf>
- [R5] Reynolds (distribuidor Rockwell) — *Logix AOI for Modbus TCP* (AOI de servidor, requisitos e memória): <https://www.reynoldsonline.com/resources/featured-products/logix-aoi-for-modbus-tcp>
- [R6] Rockwell — *Modbus TCP Slave Sample Application* R1.02: <https://support.rockwellautomation.com/cc/okcsFattachCustom/get/956324_4>
- [R7] ProSoft — PLX32-EIP-MBTCP: <https://www.prosoft-technology.com/node_60/node_244/PLX3x/PLX32/EtherNet-IP-to-Modbus-TCP-IP-Communications-Gateway>
- [R8] HMS — Anybus Communicator ABC4011 (adaptador EtherNet/IP ↔ servidor Modbus TCP), ficha via distribuidor: <https://cdn11.bigcommerce.com/s-hltjsp5jm3/content/pdfs/Anybus-EtherNet_IP-Modbus-TCP-server-ABC4011.pdf>
- [R9] Ajuda do Studio 5000 Logix Designer v37 — `TONR`: <https://www.rockwellautomation.com/en-za/docs/studio-5000-logix-designer/37-00/contents-ditamap/instruction-set/timer-and-counter-instructions/timer-on-delay-with-reset--tonr-.html>
- [R10] Notas de versão do Studio 5000 Logix Designer (tipos sem sinal a partir da v32 nos 5380/5480/5580), no Product Compatibility and Download Center da Rockwell: <https://compatibility.rockwellautomation.com/>
- Rockwell — página do Micro820: <https://rockwellautomation.com/en-us/products/hardware/allen-bradley/programmable-controllers/micro-controllers/micro800-family/micro820-controllers.html>

**ABB**
- [A1] Ajuda do Automation Builder — *Configuration of Modbus TCP/IP server*: <https://help.plc.abb.com/Configuration%20of%20Modbus%20TCP_IP%20Server.html>
- [A2] Ajuda do Automation Builder — *Areas protected from read/write access by Modbus client*: <https://help.plc.abb.com/protected_areas_modbus_client.html>
- [A3] Ajuda do Automation Builder — *Modbus addresses for AC500-eCo processor modules PM50xx*: <https://help.plc.abb.com/modbus_tcp_addresses_for_pm50xx.html>
- [A4] Ajuda do Automation Builder — *Modbus address table*: <https://help.plc.abb.com/modbus_address_table.html>
- [A5] Ajuda do Automation Builder — limites de protocolo dos AC500-eCo: <https://help.plc.abb.com/Protocol_Limitation_2.html>
- [A6] ABB — exemplo de aplicação AE-0980 *AC500 V3 – Modbus TCP* (3ADR010980): <https://search.abb.com/library/Download.aspx?DocumentID=3ADR010980&DocumentPartId=PDF>
- [A7] ABB — nota de aplicação AN-0397 *Converting an AC500 V2 project to a V3 project* (3ADR010397), na biblioteca da ABB
- [A8] ABB — *System Description AC500* (2CDC125036M0202), segmentos de memória %M: <https://library.e.abb.com/public/da3758f8723d53a3c1257c210040dd65/2CDC125036M0202.pdf>
- [A9] ABB — edições do Automation Builder: <https://www.abb.com/global/en/areas/motion/digital-tools/automation-builder/engineering>; manual *AC500-eCo V3 products* (3ADR010635), licença Basic suficiente
- [A10] ABB — CPUs AC500-eCo: <https://new.abb.com/plc/programmable-logic-controllers-plcs/ac500-eco/cpus>
- [A11] ABB — exemplo de aplicação AE-0981 *AC500 V3 – Modbus RTU* (3ADR010981), na biblioteca da ABB

**CODESYS (base do Machine Expert e do Automation Builder)**
- [C1] Ajuda do CODESYS — *Variable: RETAIN*: <https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_var_retain.html>
- [C2] Ajuda do CODESYS — *Variable: PERSISTENT*: <https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_var_persistent.html>
