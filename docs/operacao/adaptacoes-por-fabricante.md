# Adaptações por fabricante: expor o bloco OEE via Modbus

Guia para a equipe de automação colocar o [bloco OEE padrão v1](bloco-oee-v1.md) nos CLPs mais comuns nas plantas brasileiras e expô-lo por **Modbus TCP** e/ou **Modbus RTU (RS-485)** para o gateway. Complementa a tabela de suporte do [docs/11 §2](../11-integracao-modbus.md#2-suporte-por-marca-de-clp).

> **Leia antes:** as informações por marca vêm de conhecimento técnico e de pesquisa, **sem conferência em todos os manuais e versões de firmware**. Tudo que está marcado **"confirmar no manual do fabricante"** precisa ser conferido no manual do modelo e testado na bancada antes de ir a um cliente. Nunca prometa ao cliente uma integração que não foi testada no modelo e firmware dele.

## 1. Receita comum a todas as marcas

1. **Servidor Modbus:** habilite o servidor Modbus TCP (porta 502) ou o escravo Modbus RTU na porta serial que estiver livre. Lembre: **um mestre por barramento** RS-485 ([docs/11 §5](../11-integracao-modbus.md#5-um-mestre-por-barramento)).
2. **Área de registradores:** descubra qual memória do CLP aparece como holding registers e **qual é o deslocamento** entre o endereço do CLP e o endereço Modbus (seção 3).
3. **Bloco:** reserve 32 words contíguas para cada máquina (padrão: HR 1000 a 1031).
4. **Lógica:** chame o [`FB_OEE_ENGEMASE`](FB_OEE_ENGEMASE.st) todo ciclo, uma instância por máquina, em memória retentiva. Onde não há ST, traduza a lógica para Ladder.
5. **Cópia:** as 32 words do FB vão para a área do servidor, **word a word**, todo ciclo. **Não** mapeie os contadores como DINT/UDINT nativos: a ordem de words passaria a ser a do CLP, e não a CDAB do bloco.
6. **Teste:** leia o bloco com o gateway ou com um cliente Modbus no notebook (seção 4) antes de cadastrar a máquina na plataforma.

**Por que o FB divide as words:** como o FB monta as words por aritmética, a ordem **CDAB sai igual em qualquer CLP**, big-endian ou little-endian. A coluna "ordem nativa" da tabela abaixo só importa para quem mapear variáveis de 32 bits diretamente, o que este guia não recomenda.

## 2. Resumo por fabricante

Legenda: ✅ nativo, sem módulo nem licença conhecida · ⚙️ nativo, exige configuração ou bloco no programa · 🧩 exige módulo, adaptador ou biblioteca · ❓ confirmar.

| Fabricante / família | Modbus TCP (servidor) | Modbus RTU (escravo) | ST disponível | Onde ficam os HR | Ordem nativa 32 bits |
|---|---|---|---|---|---|
| Siemens S7-1200 / S7-1500 | ⚙️ instrução `MB_SERVER` no programa | 🧩 módulo CM/CB 1241 (S7-1200); módulo CM PtP (S7-1500, confirmar modelo) | Sim (SCL) | Área apontada por `MB_HOLD_REG` (DB) | ABCD (big-endian) |
| Rockwell Micro820/850/870 | ✅ (Micro820/850/870) | ✅ porta serial embarcada | Sim (CCW) | Tabela "Modbus Mapping" do CCW | Confirmar |
| Rockwell CompactLogix / ControlLogix | 🧩 AOI sobre sockets ou módulo/gateway de terceiros | 🧩 módulo de terceiros | Depende da edição do Studio 5000 (confirmar) | Definido pela AOI ou pelo módulo | Definido pela AOI ou pelo módulo |
| Schneider M221 | ✅ (modelos Ethernet) | ✅ SL1/SL2 | **Não** (Ladder/IL) | %MWn = HR n | CDAB (confirmar) |
| Schneider M241 / M251 | ⚙️ servidor nativo (pode vir desabilitado) | ⚙️ M241: linhas seriais (confirmar configuração) | Sim | %MWn = HR n (variáveis localizadas) | CDAB (confirmar) |
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

Quando o CLP **não tem como expor o bloco** (fechado pelo fabricante da máquina, sem porta livre, sem acesso ao programa ou sem Modbus): use um **módulo de I/O remoto Modbus TCP** ligado aos sinais da máquina, com os pulsos de peça no **contador de hardware** do módulo ([docs/11 §2](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Nesse caso não há bloco OEE: o template é o de sinais discretos.

## 3. Endereços: a fonte nº 1 de erro

| Notação | Exemplo para o início do bloco | Onde aparece |
|---|---|---|
| **Endereço de protocolo, base 0** | **1000** | Plataforma, config do gateway (`offset`), `--offset` da CLI |
| Convenção 4xxxx (5 dígitos, base 1) | 41001 | docs/11, IHMs, muitos manuais |
| Convenção 4xxxxx (6 dígitos, base 1) | 401001 | CLI do gateway, Rockwell CCW, alguns softwares de CLP |
| Memória do CLP | %MW1000 (Schneider), D1000 (Delta), `MB_HOLD_REG[1000]` (Siemens) | Software do CLP |

**Deslocamentos conhecidos:**
- **Schneider M221/M241/M251:** %MWn = HR n. %MW1000 → endereço 1000.
- **Delta DVP:** D0 = 0x1000 (4096). **D1000 → 4096 + 1000 = 5096** (0x13E8), convenção 45097. É um erro clássico: o template precisa do endereço base **5096**, não 1000.
- **Siemens `MB_SERVER`:** a primeira word da área `MB_HOLD_REG` é o HR 0, a menos que a instância tenha um deslocamento (`HR_Start_Offset`, confirmar na versão da instrução).
- **CODESYS Modbus Slave Device:** o endereço inicial de cada área é configurável no dispositivo (confirmar no projeto).

**Teste do deslocamento:** leia o bloco e procure o valor fixo **1** (`versao_bloco`) e o heartbeat que sobe a cada segundo. Se o 1 aparecer um registrador antes ou depois do esperado, há deslocamento de 1: **corrija o endereço base no template**, não o CLP.

## 4. Como testar a exposição do bloco

De um notebook Linux com o binário `oee-gateway` para amd64 (`make build-all` em `gateway/`) ou de um gateway de bancada. Num gateway de campo, o firewall só libera a rede OT para o próprio agente: lá, use a leitura pela fila do agente ou a página local **(Fase 1)**.

```bash
# Modbus TCP
oee-gateway modbus read --target tcp://192.168.10.23:502 --unit 1 --offset 1000 --count 32 --oee-block

# Modbus RTU com adaptador USB-RS485 (sem outro mestre ativo no barramento)
oee-gateway modbus read --target "rtu:///dev/ttyUSB0?baud=19200&parity=E&stop_bits=1" --unit 3 \
  --offset 1000 --count 14 --oee-block
```

Ou com um cliente Modbus no notebook (mbpoll, QModMaster, Modbus Poll), lendo 32 holding registers a partir do endereço base.

**Critério:** os testes 1 a 8 da [especificação, §11](bloco-oee-v1.md#11-verificação-no-comissionamento). Em resumo: versão = 1, heartbeat subindo, estado acompanhando a máquina, contadores batendo com a IHM, offsets 14–31 em 0 e sem exceção 02 nos 32 registradores.

**Unit id em Modbus TCP:** o padrão do gateway é 1. Alguns servidores respondem só a 255 ou a 0, outros ignoram o valor. Se der timeout ou exceção com unit id 1, teste 255 e 0.

## 5. Siemens S7-1200 / S7-1500

**Modbus TCP**
- Instrução **`MB_SERVER`** (TIA Portal, instruções de comunicação, Modbus TCP), chamada em todo ciclo (OB1 ou cíclico), com `DISCONNECT = FALSE`.
- **Uma instância de `MB_SERVER` por cliente**, cada uma com seu DB de instância e seu ID de conexão ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). O gateway é um cliente; se outro sistema também ler por Modbus, crie outra instância.
- Conexão (`CONNECT`, estrutura `TCON_IP_v4`): servidor passivo na porta local 502, aceitando qualquer IP remoto. Detalhes dos campos: confirmar no manual da versão da instrução.
- **Área:** `MB_HOLD_REG` aponta para um DB com `Array[0..31] of Word` (o `aBloco` do FB). HR 0 = primeira word. Para o bloco ficar no HR 1000, use o deslocamento `HR_Start_Offset` da instância, se a versão da instrução tiver, ou declare um array maior (`Array[0..1031] of Word`) e use os elementos 1000–1031. Confirmar no manual se a versão aceita DB otimizado; na dúvida, use DB com acesso padrão.
- **Licença:** as instruções Modbus TCP são usadas nas interfaces PROFINET integradas sem licença extra, até onde se sabe. Com CPs de comunicação, confirmar no manual do fabricante.

**Modbus RTU**
- S7-1200: módulo **CM 1241 (RS-422/485)** ou placa **CB 1241 (RS-485)**, com `Modbus_Comm_Load` (uma vez) e **`Modbus_Slave`** (todo ciclo), `MB_HOLD_REG` apontando para o mesmo array.
- S7-1500: módulo de comunicação ponto a ponto com suporte a Modbus (família CM PtP; confirmar qual variante suporta Modbus escravo).

**Programação**
- O FB é SCL puro. Ao importar como fonte externa (`.scl`), acrescente `BEGIN` antes do código de cada FC e FB. Declare os temporizadores como `TON_TIME` (ou `IEC_TIMER`) e confirme como declarar a retenção dos contadores (no FB ou no DB de instância).
- **Ordem nativa ABCD:** um DInt copiado direto para o array sai com a word alta primeiro. Por isso use o FB, que já entrega CDAB.

**Atenção**
- O `MB_SERVER` aceita escrita (FC06/FC16) de qualquer cliente na rede OT. O FB reescreve o bloco todo ciclo, então uma escrita indevida não persiste. Se a versão da instrução permitir restringir escrita, restrinja.
- S7comm (PUT/GET) e OPC UA são protocolos da fase futura ([docs/03](../03-gateway.md#futuro-outros-protocolos)), não do MVP.

## 6. Rockwell

### 6.1 Micro800 (Micro820, Micro850, Micro870)

- **Modbus TCP:** servidor nativo nos modelos com Ethernet. **Modbus RTU:** porta serial embarcada configurada como Modbus RTU escravo (Micro830, sem Ethernet, só por serial). Sem licença.
- No **Connected Components Workbench (CCW)**, preencha a tabela **"Modbus Mapping"** nas propriedades do controlador: cada variável global recebe um endereço Modbus em 6 dígitos. Para a base 1000: **401001 a 401032**.
- Declare o `aBloco` como 32 variáveis globais `WORD`/`UINT` ou como array, se a versão do CCW permitir mapear elementos de array (confirmar no manual do fabricante).
- ST disponível no CCW (`TON` padrão IEC).
- Ordem nativa de variáveis de 32 bits na tabela de mapeamento: confirmar. Com o FB, não importa.

### 6.2 CompactLogix / ControlLogix

- **Sem servidor Modbus nativo configurável** na maior parte dos controladores. Opções, da preferida para a última:
  1. **AOI de servidor Modbus TCP** baseada em sockets, publicada pela Rockwell como código de exemplo. Confirmar compatibilidade com o controlador, a porta Ethernet e o firmware.
  2. **Módulo ou gateway de terceiros** com servidor Modbus (ProSoft, HMS e outros), lendo uma tag array do controlador.
  3. **Módulo de I/O remoto** lendo sinais da máquina (MVP), ou EtherNet/IP nativo na fase futura ([docs/03](../03-gateway.md#futuro-outros-protocolos)).
- O editor de ST depende da edição do Studio 5000 (confirmar). Sem ST, traduza o FB para Ladder ou AOI.
- A ordem das words depende da AOI ou do módulo: copie o `aBloco` (INT/DINT por word, conforme o módulo) e teste com o valor conhecido.

## 7. Schneider Electric

### 7.1 M221 (Machine Expert – Basic / SoMachine Basic)

- **Modbus TCP:** servidor nativo nos modelos com Ethernet. Confira na configuração da porta Ethernet se o servidor Modbus está habilitado.
- **Modbus RTU:** SL1 e SL2 como escravo. A SL1 costuma estar com a IHM: não entre num barramento que já tem mestre.
- **Endereços:** %MWn = HR n. O bloco fica em **%MW1000 a %MW1031**.
- **Sem ST:** o M221 programa em Ladder e Lista de Instruções. Traduza a lógica do FB para Ladder com blocos de operação (atribuições e comparações), escrevendo direto nos %MW. Faça a soma circular e a divisão em words exatamente como no FB.
- Ordem nativa: %MDn ocupa dois %MW com a word baixa no endereço menor (CDAB). Confirmar no manual do fabricante.
- Confira a quantidade de %MW disponível no modelo (confirmar no manual do fabricante).

### 7.2 M241 / M251 (Machine Expert, base CODESYS V3)

- **Modbus TCP:** servidor nativo na porta Ethernet, que pode estar desabilitado no projeto. Expõe só as **%MW localizadas** ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)).
- **Endereços:** HR n = %MWn. Declare:

```iecst
VAR_GLOBAL
    aMbInjetora03 AT %MW1000 : ARRAY[0..31] OF WORD;   (* HR 1000–1031 *)
END_VAR
```

- Alternativa: dispositivo "Modbus TCP Slave" no projeto (imagem de E/S própria). Confirmar no manual do fabricante como a área de leitura aparece para o mestre (ver CODESYS, seção 8.2).
- **Modbus RTU (M241):** linha serial configurada como escravo Modbus. Confirmar no manual do fabricante.
- Em CODESYS, %MD1 ocupa %MW2 e %MW3 (o índice do %MD não é o do %MW). Mais um motivo para usar só words.

### 7.3 M340 / M580

Servidor Modbus TCP nativo (CPU com Ethernet ou módulo NOE/NOC), %MW = HR. Atenção ao controle de acesso por IP, que pode bloquear o gateway ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)).

## 8. WEG

### 8.1 PLC300

- Servidor Modbus TCP e escravo Modbus RTU nativos ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)).
- Área de memória que aparece como holding registers, deslocamento de endereço, suporte a ST e retenção: **confirmar no manual do fabricante** (software de programação WEG).
- Se não houver ST, traduza o FB para Ladder.

### 8.2 PLC500 (base CODESYS)

- Adicione o dispositivo **"Modbus TCP Slave"** (ou o escravo serial) no projeto.
- No escravo Modbus do CODESYS, cada área tem tamanho e endereço inicial configuráveis. Em geral, os registradores que o **mestre escreve** aparecem para o CLP como entradas (%IW) e os que o **CLP publica** aparecem como saídas (%QW). Ligue o `aBloco` às **saídas** do dispositivo escravo e confira como o mestre lê essa área:
  - se o dispositivo tiver a opção de **sobrepor** as áreas de holding e de input registers, o gateway lê com FC03 (holding), como no template padrão;
  - se não tiver, cadastre o bloco como **input registers** (FC04) no template, com o mesmo layout ([especificação, G1](bloco-oee-v1.md#2-regras-gerais)).
  - Confirmar no manual do fabricante e testar na bancada.
- A cópia para a imagem de E/S acontece no ciclo da tarefa do barramento: deixe o FB na mesma tarefa, para manter a consistência.

### 8.3 CLIC02, TPW-03 e TPW-04

- Relé programável (CLIC02) e CLPs compactos (TPW). Suporte a Modbus escravo, módulos de comunicação necessários, mapeamento de memória e linguagens: **confirmar no manual do fabricante**. O docs/11 também marca essas linhas como "a confirmar".
- O CLIC02 programa em Ladder/blocos, sem ST, e tem pouca memória de dados. Se não houver como expor 32 registradores, use o **módulo de I/O remoto**.

## 9. Delta

### 9.1 DVP

- **Modbus RTU:** escravo nativo na **COM2 (RS-485)**. **Padrão de fábrica: Modbus ASCII 9600 7E1**, que o gateway não fala (ele usa RTU com 8 bits de dados). Para RTU, configure com **D1120/M1143** ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Ajuste também o endereço do escravo, a velocidade e a paridade iguais às do barramento.
- **Modbus TCP:** modelos com Ethernet ou módulo **DVP-EN01-SL**.
- **Endereços:** mapa fixo: **D0 = 0x1000**, M0 = 0x0800, X0 = 0x0400, Y0 = 0x0500. Com o bloco em **D1000–D1031**, o endereço base no template é **5096**.
- Ordem nativa: registrador D(n) com a word baixa e D(n+1) com a alta (CDAB).
- **Retenção:** a DVP retém dados por faixa de registradores (configurável no modelo). Coloque o bloco e os contadores do FB numa faixa retentiva (confirmar a faixa no manual do fabricante).
- ST no ISPSoft para vários modelos DVP; o WPLSoft só tem Ladder e Lista de Instruções. Confirmar no manual do fabricante.

### 9.2 AS (AS200/AS300)

- Servidor Modbus TCP nativo; COM1 e COM2 configuráveis como escravo no HWCONFIG.
- **A tabela de endereços Modbus da série AS é diferente da DVP:** confirmar no manual do fabricante antes de definir a base.
- ST disponível no ISPSoft.

## 10. Mitsubishi

### 10.1 FX5U / FX5UC

- **Modbus TCP:** no GX Works3, adicione o dispositivo de conexão MODBUS/TCP na configuração de dispositivos externos da porta Ethernet embutida.
- **Modbus RTU:** porta RS-485 embutida com o protocolo MODBUS_RTU configurado nos parâmetros, como escravo.
- **Endereços:** a **atribuição de dispositivos MODBUS** (parâmetro) liga os holding registers aos registradores **D**. Confirmar no manual do fabricante a atribuição padrão e ajuste-a para que o HR base caia no D onde o FB escreve.
- Ordem nativa: D(n) word baixa, D(n+1) alta (CDAB).
- ST e FB disponíveis no GX Works3. Confirmar o nome do temporizador IEC na versão (`TON` ou `TON_E`).
- Sem licença.

### 10.2 FX3U / FX3G e iQ-R

- Exigem módulo ou adaptador com função Modbus (por exemplo, adaptadores de comunicação Modbus para a linha FX3, ou módulos seriais/Ethernet com função de escravo Modbus na iQ-R). Modelo, firmware e mapeamento: **confirmar no manual do fabricante**.
- Sem o módulo, use o módulo de I/O remoto ou, na fase futura, o protocolo nativo (MC/SLMP).

## 11. Omron

### 11.1 NJ / NX (Sysmac Studio)

- **Sem servidor Modbus TCP nativo configurável.** O caminho é um **FB de servidor Modbus sobre os sockets TCP** do controlador (bibliotecas de exemplo da Omron ou de terceiros): confirmar disponibilidade, licença e limite de conexões.
- Modbus RTU escravo pela placa ou unidade serial: confirmar no manual do fabricante.
- **TIME em nanossegundos:** no Sysmac Studio o tipo TIME tem resolução de ns. Ajuste a seção 4 do FB (`TIME_TO_DINT`) para obter milissegundos.
- Alternativas: módulo de I/O remoto ou EtherNet/IP/FINS na fase futura ([docs/03](../03-gateway.md#futuro-outros-protocolos)).

### 11.2 CP1 / CP2E

- **CP1:** Modbus RTU nativo **só como mestre** ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp)). Não serve como escravo para o gateway: use o módulo de I/O remoto.
- **CP2E:** suporte a servidor Modbus TCP em alguns modelos: confirmar no manual do fabricante.
- ST só dentro de FB no CX-Programmer. Ordem nativa de 32 bits (DM): word baixa primeiro (confirmar).

## 12. Altus

### 12.1 Nexto (MasterTool IEC XE)

- **Modbus TCP:** adicione a instância de **servidor Modbus Ethernet** sob a interface de rede no MasterTool e configure os **mapeamentos** entre variáveis e endereços Modbus (holding registers 1000–1031 para o `aBloco`). Sem licença conhecida (confirmar).
- **Modbus RTU:** porta COM configurada como escravo Modbus (confirmar no manual do fabricante).
- ST disponível (base CODESYS).

### 12.2 Hadron Xtorm e Duo

- **Hadron Xtorm** (base MasterTool IEC XE): servidor Modbus e mapeamentos semelhantes aos da Nexto, a confirmar no manual do fabricante.
- **Duo:** confirmar ([docs/11](../11-integracao-modbus.md#2-suporte-por-marca-de-clp) também marca "a confirmar").

## 13. Unitronics

- **Vision / Samba (VisiLogic):** o servidor Modbus TCP é criado no Ladder: inicialização da rede e de um socket como **escravo Modbus** na porta 502. O RTU usa o bloco de configuração Modbus na porta serial. Correspondência entre MI (memory integers) e holding registers: confirmar no manual do fabricante. **Sem ST:** traduza o FB para Ladder.
- **UniStream (UniLogic):** escravo Modbus configurado na parte de comunicação, com tabela de dados ligada às tags. Linguagens disponíveis e mapeamento: confirmar no manual do fabricante.

## 14. Eaton easyE4

- Modelos com Ethernet oferecem servidor Modbus TCP a partir de certa versão de firmware e do easySoft: **confirmar** a versão e a área de memória (marcadores de word) que aparece como holding registers.
- Modbus RTU escravo: confirmar se há módulo para isso.
- ST disponível no easySoft a partir da versão 7 (confirmar).
- É um relé programável: tem pouca memória. Se não couber o bloco de 32 words, use o módulo de I/O remoto.

## 15. Checklist de entrega por CLP

| # | Item | OK |
|---|---|---|
| 1 | Marca, modelo, firmware e software de programação registrados no cadastro da máquina | ☐ |
| 2 | Servidor Modbus (TCP ou RTU) habilitado; nenhum outro mestre no barramento RS-485 | ☐ |
| 3 | Limite de conexões Modbus TCP do CLP conferido (IHM e SCADA também consomem) | ☐ |
| 4 | FB chamado todo ciclo, uma instância por máquina, em memória retentiva | ☐ |
| 5 | 32 words copiadas word a word para a área do servidor, todo ciclo | ☐ |
| 6 | Endereço base do template conferido com o teste do deslocamento (seção 3) | ☐ |
| 7 | Testes 1 a 8 da [especificação §11](bloco-oee-v1.md#11-verificação-no-comissionamento) aprovados | ☐ |
| 8 | Lista de códigos de falha e de produto entregue para cadastro na plataforma | ☐ |
| 9 | Backup do programa alterado entregue ao cliente, com a autorização dele registrada | ☐ |
