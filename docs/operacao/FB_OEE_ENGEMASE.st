(* ===========================================================================
   FB_OEE_ENGEMASE - Bloco OEE padrão Engemase, layout v1
   ---------------------------------------------------------------------------
   Especificação : docs/operacao/bloco-oee-v1.md
   Adaptações    : docs/operacao/adaptacoes-por-fabricante.md
   Linguagem     : IEC 61131-3 Texto Estruturado (ST), sem bibliotecas de
                   fabricante. Usa só tipos, funções de conversão e o
                   temporizador TON da norma.

   O QUE FAZ
   Monta, a cada ciclo de scan, os 32 registradores de 16 bits do bloco OEE
   de UMA máquina, a partir de sinais simples:
     - rodando, falha, código de falha, emergência, setup, manual;
     - pulsos de peça boa e de refugo (com detecção de borda de subida);
     - código de produto, velocidade e bits de status.
   Mantém um heartbeat (+1 a cada 1 s) e três contadores de 32 bits
   (total, refugo, boas), retentivos e monotônicos, divididos em words na
   ordem CDAB (word baixa no offset menor).

   MAPA DO BLOCO (aBloco[i] = holding register base + i)
     [0]  versao_bloco      = 1
     [1]  heartbeat         +1 a cada 1 s, 65535 -> 0
     [2]  estado            0 parada, 1 produzindo, 2 falha, 3 setup,
                            4 manual, 5 emergência
     [3]  codigo_falha      0 = nenhum
     [4]  contador_total    word baixa  (CDAB)
     [5]  contador_total    word alta
     [6]  contador_refugo   word baixa
     [7]  contador_refugo   word alta
     [8]  contador_bons     word baixa
     [9]  contador_bons     word alta
     [10] produto           0 = não definido
     [11] velocidade        unidade definida por máquina
     [12] ciclo_ultimo_ms   satura em 65535
     [13] bits_status       b0 automático, b1 porta aberta, b2 falta de
                            material, b3 manutenção, b4 parada planejada
     [14..31] reservado     sempre 0

   COMO USAR
   1. Uma instância por máquina, chamada TODO ciclo, sem condição, numa
      tarefa cíclica de no máximo 100 ms.
   2. Ligue aBloco à área do servidor Modbus do CLP (32 registradores a
      partir do endereço base; padrão HR 1000). Ver as notas no fim deste
      arquivo e o guia de adaptações por fabricante.
   3. A instância (ou pelo menos os contadores) precisa ficar em memória
      RETENTIVA. Nunca reinicialize os retentivos num download de programa.
   4. Os pulsos precisam ficar pelo menos 1 ciclo de scan em nível alto e
      1 em nível baixo. Para máquinas mais rápidas, use contador rápido
      (HSC) e some o delta do HSC nos contadores com FC_OEE_SOMA_CIRC.
   5. Não troque xModoCiclo com a máquina em produção: é parâmetro de
      projeto.

   CONFERÊNCIA NA BANCADA (antes de ligar o gateway nesta máquina)
   Force online udiTotalRet := 100000. A leitura Modbus deve dar
   HR base+4 = 34464 (16#86A0) e HR base+5 = 1. Depois volte o valor
   (o gateway ainda não está coletando, então nada é afetado).

   Versão do arquivo: 1.0 (bloco v1). Engemase Automação.
   =========================================================================== *)


(* ---------------------------------------------------------------------------
   FC_OEE_SOMA_CIRC
   Soma circular de 32 bits sem sinal: (valor + incremento) módulo 2^32.
   Não depende do comportamento de estouro do CLP (alguns sinalizam erro ou
   saturam em vez de dar a volta).
   --------------------------------------------------------------------------- *)
FUNCTION FC_OEE_SOMA_CIRC : UDINT
VAR_INPUT
    udiValor      : UDINT;   (* valor atual do contador *)
    udiIncremento : UDINT;   (* quanto somar *)
END_VAR
VAR
    udiFolga : UDINT;        (* quanto falta até o máximo (4294967295) *)
END_VAR

udiFolga := UDINT#16#FFFFFFFF - udiValor;
IF udiIncremento > udiFolga THEN
    (* passou do máximo: recomeça do zero *)
    FC_OEE_SOMA_CIRC := udiIncremento - udiFolga - UDINT#1;
ELSE
    FC_OEE_SOMA_CIRC := udiValor + udiIncremento;
END_IF;

END_FUNCTION


(* ---------------------------------------------------------------------------
   FC_OEE_SUB_CIRC
   Subtração circular de 32 bits sem sinal: (a - b) módulo 2^32.
   Usada no modo ciclo: boas = total - refugo, mesmo depois da volta do
   contador total.
   --------------------------------------------------------------------------- *)
FUNCTION FC_OEE_SUB_CIRC : UDINT
VAR_INPUT
    udiA : UDINT;
    udiB : UDINT;
END_VAR

IF udiA >= udiB THEN
    FC_OEE_SUB_CIRC := udiA - udiB;
ELSE
    FC_OEE_SUB_CIRC := (UDINT#16#FFFFFFFF - udiB) + udiA + UDINT#1;
END_IF;

END_FUNCTION


(* ---------------------------------------------------------------------------
   FC_OEE_WORD_BAIXA / FC_OEE_WORD_ALTA
   Dividem um valor de 32 bits em duas words por aritmética. Assim a ordem
   CDAB sai igual em CLP big-endian ou little-endian.
   --------------------------------------------------------------------------- *)
FUNCTION FC_OEE_WORD_BAIXA : WORD
VAR_INPUT
    udiValor : UDINT;
END_VAR

FC_OEE_WORD_BAIXA := UDINT_TO_WORD(udiValor MOD UDINT#65536);

END_FUNCTION


FUNCTION FC_OEE_WORD_ALTA : WORD
VAR_INPUT
    udiValor : UDINT;
END_VAR

FC_OEE_WORD_ALTA := UDINT_TO_WORD(udiValor / UDINT#65536);

END_FUNCTION


(* ---------------------------------------------------------------------------
   FB_OEE_ENGEMASE
   --------------------------------------------------------------------------- *)
FUNCTION_BLOCK FB_OEE_ENGEMASE
VAR_INPUT
    (* --- Estado da máquina --- *)
    xRodando         : BOOL;      (* ciclo automático ativo (produzindo) *)
    xFalha           : BOOL;      (* parada por falha ou alarme *)
    uiCodigoFalha    : UINT;      (* alarme ativo; 0 = nenhum. Use o primeiro alarme (first-out) *)
    xEmergencia      : BOOL;      (* emergência acionada *)
    xSetup           : BOOL;      (* troca de produto, ajuste, regulagem *)
    xManual          : BOOL;      (* máquina em modo manual *)
    xParadaPlanejada : BOOL;      (* parada planejada sinalizada no CLP: só liga o bit 4 *)

    (* --- Contagem --- *)
    xPulsoBoa        : BOOL;      (* pulso por peça boa (ou por ciclo, se xModoCiclo) *)
    xPulsoRefugo     : BOOL;      (* pulso por peça refugada *)
    xModoCiclo       : BOOL;      (* FALSE: pulsos separados, total = boas + refugo.
                                     TRUE : xPulsoBoa é o pulso de ciclo (todas as peças)
                                            e o refugo é parte dele, boas = total - refugo *)
    uiPecasPorPulso  : UINT := 1; (* peças por pulso de boa/ciclo (ex.: molde de 4 cavidades = 4).
                                     0 é tratado como 1. O refugo conta sempre 1 por pulso *)

    (* --- Informações --- *)
    uiProduto        : UINT;      (* código do produto/receita; 0 = não definido *)
    uiVelocidade     : UINT;      (* velocidade atual (unidade definida no cadastro da máquina) *)

    (* --- Bits de status (offset 13) --- *)
    xAutomatico      : BOOL;      (* bit 0 *)
    xPortaAberta     : BOOL;      (* bit 1 *)
    xFaltaMaterial   : BOOL;      (* bit 2 *)
    xManutencao      : BOOL;      (* bit 3 *)
END_VAR

VAR_IN_OUT
    (* Área do servidor Modbus desta máquina: aBloco[0] = HR base, aBloco[31] = HR base+31.
       Se o seu CLP não aceitar array em VAR_IN_OUT, troque por VAR_OUTPUT e copie as
       32 words para a área do Modbus logo depois da chamada, no mesmo ciclo. *)
    aBloco           : ARRAY[0..31] OF WORD;
END_VAR

VAR_OUTPUT
    (* Cópias para IHM e diagnóstico. O gateway lê só o aBloco. *)
    uiEstado         : UINT;      (* estado calculado (0-5) *)
    uiHeartbeat      : UINT;      (* heartbeat atual *)
    udiContadorTotal : UDINT;
    udiContadorRefugo: UDINT;
    udiContadorBons  : UDINT;
END_VAR

VAR RETAIN
    (* Contadores do bloco: retentivos, monotônicos, NUNCA zerados pelo programa.
       Se o seu CLP não aceitar RETAIN dentro de FB, declare a instância inteira
       numa área retentiva. *)
    udiTotalRet      : UDINT;
    udiRefugoRet     : UDINT;
    udiBoasRet       : UDINT;
END_VAR

VAR
    xBoaAnterior     : BOOL;      (* para a borda de subida de xPulsoBoa *)
    xRefugoAnterior  : BOOL;      (* para a borda de subida de xPulsoRefugo *)
    xBordaBoa        : BOOL;
    xBordaRefugo     : BOOL;
    udiIncremento    : UDINT;
    tonHeartbeat     : TON;       (* base de 1 s do heartbeat *)
    uiHeartbeatInt   : UINT;
    tonCiclo         : TON;       (* mede o tempo entre pulsos de peça *)
    xCicloIniciado   : BOOL;
    diCicloMs        : DINT;
    uiCicloMs        : UINT;
    uiEstadoInt      : UINT;
    wBits            : WORD;
    iIdx             : INT;
END_VAR

VAR CONSTANT
    UI_VERSAO_BLOCO  : UINT := 1; (* versao_bloco desta especificação *)
END_VAR


(* ===== 1. Heartbeat: +1 a cada 1 s, de 65535 volta para 0 ================ *)
(* O TON se rearma sozinho: quando Q liga, no ciclo seguinte IN desliga e zera. *)
tonHeartbeat(IN := NOT tonHeartbeat.Q, PT := T#1S);
IF tonHeartbeat.Q THEN
    IF uiHeartbeatInt = UINT#65535 THEN
        uiHeartbeatInt := UINT#0;
    ELSE
        uiHeartbeatInt := uiHeartbeatInt + UINT#1;
    END_IF;
END_IF;


(* ===== 2. Bordas de subida dos pulsos ===================================== *)
xBordaBoa       := xPulsoBoa AND NOT xBoaAnterior;
xBoaAnterior    := xPulsoBoa;
xBordaRefugo    := xPulsoRefugo AND NOT xRefugoAnterior;
xRefugoAnterior := xPulsoRefugo;


(* ===== 3. Contadores (retentivos, monotônicos, volta em 2^32) ============== *)
IF uiPecasPorPulso = UINT#0 THEN
    udiIncremento := UDINT#1;
ELSE
    udiIncremento := UINT_TO_UDINT(uiPecasPorPulso);
END_IF;

IF xModoCiclo THEN
    (* Modo ciclo: o pulso de ciclo conta todas as peças; o refugo é parte do total. *)
    IF xBordaBoa THEN
        udiTotalRet := FC_OEE_SOMA_CIRC(udiValor := udiTotalRet, udiIncremento := udiIncremento);
    END_IF;
    IF xBordaRefugo THEN
        udiRefugoRet := FC_OEE_SOMA_CIRC(udiValor := udiRefugoRet, udiIncremento := UDINT#1);
    END_IF;
    udiBoasRet := FC_OEE_SUB_CIRC(udiA := udiTotalRet, udiB := udiRefugoRet);
ELSE
    (* Pulsos separados: cada peça é boa OU refugo; o total soma as duas. *)
    IF xBordaBoa THEN
        udiBoasRet  := FC_OEE_SOMA_CIRC(udiValor := udiBoasRet,  udiIncremento := udiIncremento);
        udiTotalRet := FC_OEE_SOMA_CIRC(udiValor := udiTotalRet, udiIncremento := udiIncremento);
    END_IF;
    IF xBordaRefugo THEN
        udiRefugoRet := FC_OEE_SOMA_CIRC(udiValor := udiRefugoRet, udiIncremento := UDINT#1);
        udiTotalRet  := FC_OEE_SOMA_CIRC(udiValor := udiTotalRet,  udiIncremento := UDINT#1);
    END_IF;
END_IF;


(* ===== 4. Tempo do último ciclo (entre dois pulsos de boa/ciclo) =========== *)
(* Se a sua plataforma não usa TIME em milissegundos (ex.: resolução em ns),
   ajuste a conversão TIME_TO_DINT abaixo. *)
IF xBordaBoa THEN
    IF xCicloIniciado THEN
        diCicloMs := TIME_TO_DINT(tonCiclo.ET);
        IF diCicloMs > DINT#65535 THEN
            uiCicloMs := UINT#65535;
        ELSIF diCicloMs < DINT#0 THEN
            uiCicloMs := UINT#0;
        ELSE
            uiCicloMs := DINT_TO_UINT(diCicloMs);
        END_IF;
    END_IF;
    xCicloIniciado := TRUE;
    tonCiclo(IN := FALSE, PT := T#1H);   (* zera a medição para o próximo ciclo *)
END_IF;
tonCiclo(IN := xCicloIniciado, PT := T#1H);


(* ===== 5. Estado (prioridade: emergência > falha > setup > manual >
            produzindo > parada) ============================================= *)
IF xEmergencia THEN
    uiEstadoInt := UINT#5;
ELSIF xFalha THEN
    uiEstadoInt := UINT#2;
ELSIF xSetup THEN
    uiEstadoInt := UINT#3;
ELSIF xManual THEN
    uiEstadoInt := UINT#4;
ELSIF xRodando THEN
    uiEstadoInt := UINT#1;
ELSE
    uiEstadoInt := UINT#0;
END_IF;
(* A parada planejada NÃO muda o estado: ela só liga o bit 4. A classificação
   de parada planejada é feita na plataforma (calendário ou motivo). *)


(* ===== 6. Bits de status =================================================== *)
wBits := WORD#16#0000;
IF xAutomatico THEN
    wBits := wBits OR WORD#16#0001;
END_IF;
IF xPortaAberta THEN
    wBits := wBits OR WORD#16#0002;
END_IF;
IF xFaltaMaterial THEN
    wBits := wBits OR WORD#16#0004;
END_IF;
IF xManutencao THEN
    wBits := wBits OR WORD#16#0008;
END_IF;
IF xParadaPlanejada THEN
    wBits := wBits OR WORD#16#0010;
END_IF;


(* ===== 7. Escrita do bloco (todos os 32 registradores, todo ciclo) ========= *)
aBloco[0]  := UINT_TO_WORD(UI_VERSAO_BLOCO);
aBloco[1]  := UINT_TO_WORD(uiHeartbeatInt);
aBloco[2]  := UINT_TO_WORD(uiEstadoInt);
aBloco[3]  := UINT_TO_WORD(uiCodigoFalha);
aBloco[4]  := FC_OEE_WORD_BAIXA(udiValor := udiTotalRet);    (* CDAB: word baixa primeiro *)
aBloco[5]  := FC_OEE_WORD_ALTA(udiValor := udiTotalRet);
aBloco[6]  := FC_OEE_WORD_BAIXA(udiValor := udiRefugoRet);
aBloco[7]  := FC_OEE_WORD_ALTA(udiValor := udiRefugoRet);
aBloco[8]  := FC_OEE_WORD_BAIXA(udiValor := udiBoasRet);
aBloco[9]  := FC_OEE_WORD_ALTA(udiValor := udiBoasRet);
aBloco[10] := UINT_TO_WORD(uiProduto);
aBloco[11] := UINT_TO_WORD(uiVelocidade);
aBloco[12] := UINT_TO_WORD(uiCicloMs);
aBloco[13] := wBits;
FOR iIdx := 14 TO 31 DO
    aBloco[iIdx] := WORD#16#0000;                              (* reservados *)
END_FOR;


(* ===== 8. Saídas para IHM e diagnóstico ==================================== *)
uiEstado          := uiEstadoInt;
uiHeartbeat       := uiHeartbeatInt;
udiContadorTotal  := udiTotalRet;
udiContadorRefugo := udiRefugoRet;
udiContadorBons   := udiBoasRet;

END_FUNCTION_BLOCK


(* ===========================================================================
   EXEMPLO DE CHAMADA (genérico)

   VAR_GLOBAL
       aMbInjetora03 : ARRAY[0..31] OF WORD;   (* ligado ao HR 1000-1031, ver notas *)
   END_VAR
   VAR
       fbOeeInjetora03 : FB_OEE_ENGEMASE;      (* instância em área retentiva *)
   END_VAR

   fbOeeInjetora03(
       xRodando         := xInjCicloAutomatico,
       xFalha           := xInjAlarmeParada,
       uiCodigoFalha    := uiInjPrimeiroAlarme,
       xEmergencia      := NOT xInjEmergenciaOk,
       xSetup           := xInjModoSetup,
       xManual          := xInjModoManual,
       xParadaPlanejada := xInjParadaProgramada,
       xPulsoBoa        := xInjFimDeCiclo,
       xPulsoRefugo     := xInjPecaRefugada,
       xModoCiclo       := TRUE,               (* sinal de fim de ciclo + sinal de refugo *)
       uiPecasPorPulso  := UINT#4,             (* molde de 4 cavidades *)
       uiProduto        := uiInjReceitaAtual,
       uiVelocidade     := uiInjCiclosPorHora,
       xAutomatico      := xInjModoAutomatico,
       xPortaAberta     := NOT xInjPortaFechada,
       xFaltaMaterial   := xInjFaltaMaterial,
       xManutencao      := xInjEmManutencao,
       aBloco           := aMbInjetora03);

   Várias máquinas no mesmo CLP: uma instância e um array por máquina, em
   blocos consecutivos de 32 registradores (HR 1000, 1032, 1064...).


   NOTAS DE MAPEAMENTO NA ÁREA DO SERVIDOR MODBUS
   (detalhes, licenças e endereços em docs/operacao/adaptacoes-por-fabricante.md;
    tudo marcado "confirmar" deve ser conferido no manual do fabricante)

   - Regra geral: a word aBloco[i] precisa aparecer no holding register
     (base + i). Copie as 32 words a cada ciclo. Não copie os contadores como
     DINT/UDINT nativos: isso troca a ordem para a do CLP.

   - Siemens S7-1200/S7-1500 (TIA Portal, SCL): aBloco = array de 32 Word num
     DB apontado pelo MB_HOLD_REG da instrução MB_SERVER (Modbus TCP) ou do
     Modbus_Slave (RTU, com CM/CB 1241). HR 0 = primeira word da área; para o
     bloco ficar no HR 1000, use o HR_Start_Offset da instância (se a versão da
     instrução tiver) ou um array maior. Ao importar como fonte externa .scl,
     acrescente BEGIN antes do código de cada FC/FB e declare os temporizadores
     como TON_TIME (ou IEC_TIMER). Confirmar retenção (VAR RETAIN) no FB.

   - Schneider M241/M251 e outros CODESYS V3 (Machine Expert, WEG PLC500,
     Altus Nexto): servidor nativo com HR n = %MWn (M241/M251):
         aMbInjetora03 AT %MW1000 : ARRAY[0..31] OF WORD;
     No "Modbus TCP Slave Device" do CODESYS, ligue o array às saídas (%QW) do
     dispositivo escravo e confira se o mestre lê essa área como holding
     (opção de sobreposição) ou como input registers (FC04): confirmar.

   - Schneider M221 (Machine Expert - Basic): não tem ST. Implemente a mesma
     lógica em Ladder com blocos de operação e escreva direto em %MW1000-%MW1031
     (HR n = %MWn).

   - Rockwell Micro800 (CCW): ST disponível. Ligue cada word a uma variável
     global e cadastre-as na tabela "Modbus Mapping" (endereços 401001-401032
     para a base 1000). Confirmar se a versão do CCW aceita elementos de array.

   - Delta DVP (ISPSoft): D(n) = HR 4096 + n. Com o bloco em D1000-D1031, o
     endereço base no template é 5096. Contadores em faixa retentiva (latched):
     confirmar a faixa do modelo. Delta AS: tabela de endereços diferente da
     DVP, confirmar.

   - Mitsubishi FX5U (GX Works3): HR mapeados para registradores D pela
     atribuição de dispositivos MODBUS (parâmetro); copie aBloco para D(base).
     Confirmar a atribuição padrão e o nome do TON (TON / TON_E).

   - Omron NJ/NX (Sysmac Studio): sem servidor Modbus TCP nativo; depende de FB
     sobre sockets. TIME tem resolução de ns: ajuste a seção 4. Confirmar.

   - Altus Nexto (MasterTool IEC XE): servidor Modbus Ethernet com mapeamento
     de variáveis para endereços Modbus. Confirmar.
   =========================================================================== *)
