# RB-01 — Gateway offline

| | |
|---|---|
| **Severidade típica** | Crítica |
| **Alerta** | "Gateway offline" ([docs/13](../../13-notificacoes-e-alertas.md#catálogo-inicial-de-alertas-presets-por-cliente)) |
| **Quem atende** | N1 (suporte Engemase); TI do cliente para a rede IT; técnico de campo se precisar ir ao local |
| **Perde dados?** | **Não**, enquanto o gateway estiver ligado e com config: a coleta continua e vai para o buffer (até 30 dias ou 1 GB). Com o gateway **desligado**, o tempo sem energia fica como "sem comunicação" e as peças produzidas nesse intervalo entram no primeiro minuto depois da volta, se o CLP continuou contando |

## 1. Sintoma

A plataforma deixou de receber o `/sync` do gateway. As telas das máquinas dele mostram o selo **"dados atrasados"** e o OEE do turno para de andar.

## 2. Como aparece na plataforma e nos alertas

- **Lista de gateways** e **console Engemase** (`/admin/gateways`): status **offline** e "último contato há X min".
- **Alerta "Gateway offline"** (crítico): o cron `gateway-watchdog` marca offline o gateway sem `/sync` há mais de 60 s; o alerta abre depois de 5 min nessa condição. Destinatários: engenharia do cliente e suporte Engemase. No MVP, só na central do app (sino); e-mail e outros canais na F2.
- **Telas ao vivo e TV:** selo "dados atrasados" em vez de "parada" ([docs/07](../../07-calculo-oee.md#dados-atrasados)).
- Os alertas de "sem comunicação / dados atrasados" das máquinas desse gateway ficam **suprimidos** enquanto ele estiver offline.
- **LED do gateway (Fase 1):** verde piscando = coletando sem nuvem; vermelho piscando = erro crítico (disco, relógio, agente); apagado com PWR apagado = sem energia ([docs/16 §6](../../16-projeto-do-gateway.md#6-comissionamento-local)).

## 3. Causas prováveis

Da mais comum para a mais rara:

1. **Rede IT do cliente:** cabo ou porta do switch, VLAN trocada, DHCP sem reserva (o IP mudou e a regra do firewall era por IP), regra de saída 443 removida, proxy novo ou alterado, inspeção SSL ligada.
2. **Energia:** painel desligado (manutenção, fim de semana), disjuntor ou fusível do ramal, fonte 24 V.
3. **DNS:** o DNS interno deixou de resolver o domínio da plataforma.
4. **Relógio errado:** a conexão TLS falha com o certificado "ainda não válido" ou "expirado" ([RB-04](04-relogio-fora-de-sincronia.md)).
5. **Token recusado (401):** credencial revogada na plataforma ou gateway registrado de novo em outro lugar. O agente **para de enviar e mantém o buffer**.
6. **Agente parado ou em laço de reinício:** erro no disco, `/data` cheia, banco corrompido, atualização com problema ([RB-05](05-atualizacao-falhou-rollback.md)).
7. **Plataforma fora do ar ou recusando a ingestão:** afeta **vários gateways** ao mesmo tempo. Inclui mudança no endereço da plataforma na Vercel: proteção de deploy (senha ou login da Vercel) ligada no endereço de produção faz a nuvem responder 401 a todos; redirecionamento do endereço faz todo `/sync` falhar com "redirecionamento para ..." (o agente não segue redirecionamento).
8. **Hardware:** falha do R1000, da porta ETH1 (USB) ou do eMMC.

## 4. Diagnóstico

### 4.1 Pela plataforma (sempre primeiro)

1. **Só este gateway ou vários?**
   - Vários gateways de **clientes diferentes** offline ao mesmo tempo → problema da plataforma. Vá direto à seção 6 (N3, incidente).
   - Vários gateways da **mesma planta** → internet ou firewall da planta. Fale com o TI do cliente.
2. **Quando parou e o que veio antes.** No detalhe do gateway, anote o horário do último contato e a última foto de saúde (aba **Saúde**): `buffer_pending`, `buffer_oldest_s`, `disk_free_mb`, `clock_offset_ms`, `uptime_s`, `config_status`. Veja os últimos eventos:
   - `agent_stop` com motivo `shutdown`/`restart`/`update`/`error`;
   - `power_loss` **(Fase 1)**;
   - `config_rejected`, `clock_jump` **(Fase 1)**.
3. **Mudanças recentes** na auditoria (`audit_log`) do cliente: token revogado, gateway registrado de novo, config publicada, atualização enviada.
4. **Relógio:** se a última `clock_offset_ms` passava de ±2 s, siga também o [RB-04](04-relogio-fora-de-sincronia.md).
5. **Ingestão (só equipe Engemase, N2):** logs da rota `/api/gateway/v1/sync` na Vercel para este gateway: houve resposta `401`? `5xx`? Nenhuma requisição chegando (bloqueio antes da plataforma)?

### 4.2 Remoto

No MVP **não há acesso remoto ao gateway** (a VPN é da F2), e um gateway offline não recebe comandos (eles só chegam na resposta do `/sync`). O caminho remoto é o cliente:

1. **Manutenção do cliente:** o painel está energizado? O LED PWR do gateway está aceso? Peça uma **foto dos LEDs** e da porta ETH1 (o LED do RJ45 indica link).
2. **TI do cliente:** houve mudança de firewall, proxy, VLAN, DHCP ou inspeção SSL? Peça para:
   - procurar o MAC da ETH1 (está na etiqueta e no cadastro) no DHCP e nos logs do firewall;
   - rodar o teste de liberação da [ficha técnica §8](../ficha-tecnica-ti-cliente.md#8-teste-de-liberação-antes-da-visita) **na mesma VLAN do gateway**. Qualquer código HTTP na resposta prova que DNS, rota, firewall e TLS estão certos.
3. **F2:** com a VPN de manutenção, abrir uma sessão (aprovada pelo cliente) e seguir a seção 4.3 por SSH. Um gateway offline também não recebe o `vpn.enable`: a VPN não ajuda neste runbook.

### 4.3 No local

1. **Energia:** PWR aceso? Se não: medir a entrada (esperado 22–26 VDC no 24 V do painel; o R1000 aceita 9–36 VDC), conferir disjuntor, fusível e polaridade.
2. **Link IT:** LED do RJ45 da ETH1 aceso? Testar o cabo com o testador. Ligar o **notebook no mesmo ponto IT** (no lugar do gateway) e rodar o teste de liberação: se falhar no notebook, o problema é da rede do cliente.
3. **Página local (Fase 1):** notebook no switch OT ou direto na ETH0, abrir `https://<endereço de serviço 169.254.x.y>` (está na etiqueta), entrar com a senha local e ver **Status** (nuvem, relógio, fila) e **Diagnóstico** (DNS, HTTPS, NTP, proxy).
4. **Console** (HDMI + teclado USB, usuário `tecnico` com a senha local):

```bash
systemctl status oee-gateway        # linha "Status:": coletando N/M dispositivos · nuvem online | nuvem offline | nuvem bloqueada (401) | não registrado
sudo oee-gateway diag               # hoje: config local, credencial, buffer e DNS da nuvem; TLS/proxy, NTP, serial e links (Fase 1)
sudo oee-gateway status             # (Fase 1) nuvem, relógio, fila, dispositivos e máquinas
sudo oee-gateway net show           # (Fase 1) IPs, rotas, DNS, proxy e NTP aplicados
ip -br addr                         # eth1 tem IP? eth0 tem o IP OT e o 169.254.x.y?
ip route                            # rota padrão só pela eth1
getent hosts engemase-oee.vercel.app # o DNS resolve? (o host do cloud.url do gateway.yaml)
timedatectl                         # hora certa? "System clock synchronized: yes"?
```

O endereço da plataforma, hoje, é o domínio da Vercel (`engemase-oee.vercel.app`); o domínio próprio fica para depois (D28). Vale o que estiver no `cloud.url` do `/etc/oee-gateway/gateway.yaml` (o `diag` mostra o host na linha "DNS da nuvem").

5. **Logs do agente** (o `tecnico` está no grupo `systemd-journal`; também pela tela de logs da página local ou `oee-gateway logs`, **Fase 1**):

```bash
journalctl -u oee-gateway --since "-2h" -o cat | tail -50
```

Mensagens que indicam a causa:

| Mensagem no log | Causa | Vá para |
|---|---|---|
| `nuvem recusou o token: envio parado, buffer mantido; o mesmo token é testado de novo a cada 15m0s ...` | 401: credencial revogada ou inválida. Se vários gateways de clientes diferentes receberam 401 ao mesmo tempo, suspeite da plataforma (seção 3, item 7) | Seção 5, item "Token" |
| `falha ao gravar no buffer` | Disco ou banco | Seção 6 (N2) |
| `sem config salva: aguardando a nuvem (nada é coletado até lá)` | Gateway sem config | Seção 5, item "Sem config" |
| `credencial ilegível` | `credentials.json` corrompido ou sem permissão para o usuário `oee` | Seção 6 (N2) |
| `falha no sync ...` com `classe=tls` e `x509: certificate has expired or is not yet valid` | Relógio errado | [RB-04](04-relogio-fora-de-sincronia.md) |
| `falha no sync ...` com `classe=tls` e `x509: certificate signed by unknown authority` | Inspeção SSL sem a CA do cliente | Seção 5, item "Inspeção SSL" |
| `falha no sync ...` com `classe=dns` (`no such host`) | DNS | Seção 5, item "DNS" |
| `falha no sync ...` com `classe=conexao`, `timeout` ou `proxy` (`connection refused`, `i/o timeout`, `recusou o túnel (CONNECT)`) | Firewall ou proxy | Seção 5, item "Firewall/proxy" |
| `falha no sync ...` com `classe=outro` e `redirecionamento para ...` | O endereço da plataforma passou a redirecionar (por exemplo, numa troca de domínio). O agente não segue redirecionamento, para não mandar dados nem perder o token em outro host | Seção 6 (N2) |

As falhas do `/sync` saem como `falha no sync com a nuvem: a coleta continua e os dados ficam no buffer`, com `classe=` (`dns`, `tls`, `proxy`, `timeout`, `conexao`, `http_4xx`, `http_5xx`, `outro`) e o `erro`. A mesma falha volta no máximo a cada 10 min (`falha no sync com a nuvem persiste`); na volta, `sync com a nuvem recuperado`. O `diag` ainda não testa TLS e proxy até a nuvem (Fase 1): para isso, use o teste com o notebook no mesmo ponto IT (passo 2).

## 5. Correção

| Causa | O que fazer |
|---|---|
| Energia | Restabelecer o circuito. O gateway volta sozinho (ação padrão: reinício; nada se perde). Combinar com a manutenção para não desligar o painel sem avisar |
| Cabo, porta, VLAN | TI ou manutenção corrige. Conferir o link e o online na plataforma |
| IP mudou / DHCP sem reserva | TI cria a reserva pelo MAC da ETH1 ou ajusta a regra do firewall |
| Firewall/proxy | TI libera a saída TCP 443 para os domínios da [ficha técnica §4](../ficha-tecnica-ti-cliente.md#4-tráfego-de-saída-necessário-porta-it). Proxy NTLM/Kerberos: regra sem autenticação para o IP/MAC do gateway. Proxy novo: ajustar no gateway pela página local ou `sudo oee-gateway net set` **(Fase 1)**, com confirmação e volta automática |
| Inspeção SSL | Pedir exceção para os domínios. Sem exceção: instalar a CA do cliente no `network.json` (pelo ajudante privilegiado, **Fase 1**) com aceite por escrito do TI |
| DNS | TI corrige o DNS interno; ou ajustar os servidores DNS da IT no gateway (`net set`, **Fase 1**) |
| Relógio | [RB-04](04-relogio-fora-de-sincronia.md) |
| Token (401) | Confirmar na auditoria **por que** o token foi recusado. O buffer fica guardado; nada se perde enquanto isso. Se foi revogado por engano ou é preciso registrar de novo o **mesmo** gateway, o caminho é um código de ativação **para este mesmo gateway** e `oee-gateway enroll --code XXXX-XXXX --force`. **Lacuna atual:** com credencial existente, o `enroll` exige `--force`, o `sudo` do `tecnico` recusa o `--force` e a imagem não tem root: em campo, hoje, isso **não tem como ser feito**. Escale para N2 (seção 6), que decide entre liberar o re-registro (correção no agente ou no `sudo`) e trocar a unidade, recuperando o buffer da antiga na bancada. **Nunca** use um código de outro gateway: os itens pendentes seriam recusados. Se alguém registrar como root (imagem de engenharia), o arquivo da credencial fica com dono `root` e o agente não consegue lê-lo (log `credencial ilegível`); o `enroll` de campo é sempre `sudo -u oee oee-gateway enroll --code ...` ([docs/03](../../03-gateway.md)) |
| Sem config | Publicar a config na plataforma; ela é baixada no próximo `/sync` |
| Agente parado ou em laço | Reiniciar o agente pela plataforma (`agent.restart`, **Fase 1**) não funciona com o gateway offline. No local: desligar e religar a alimentação **uma vez**. Se voltar a cair, seção 6 |
| Hardware | Troca do gateway ([docs/16 §7](../../16-projeto-do-gateway.md#7-preparação-na-engemase-e-ciclo-de-vida)); recuperar o buffer da unidade antiga, se possível |

**Não fazer:**
- reset de fábrica, apagar `/var/lib/oee-gateway` (`buffer.db`, `credentials.json`) ou reinstalar a imagem para "resolver": a fila pendente se perde;
- religar a energia várias vezes seguidas durante uma atualização ([RB-05](05-atualizacao-falhou-rollback.md));
- abrir porta de entrada no firewall do cliente.

**Depois de voltar:** o gateway envia a fila em ordem (lotes de até 2.000 itens, um a cada ~1–1,5 s). Acompanhe `buffer_pending` cair até perto de zero. Os turnos afetados são recalculados pelo cron `recompute-dirty` (5 min). Se a fila não cair, siga o [RB-03](03-dados-atrasados-buffer.md).

## 6. Quando escalar

| Situação | Para quem | Urgência |
|---|---|---|
| Vários gateways de clientes diferentes offline | **N3** (incidente de plataforma) e N2. Conferir também a proteção de deploy e o redirecionamento do endereço de produção na Vercel (seção 3, item 7) | Imediata |
| Log com `redirecionamento para ...` | **N2**: tirar o redirecionamento do endereço que os gateways usam; a troca de domínio segue o [docs/16 §4](../../16-projeto-do-gateway.md#4-caminhos-usuários-e-identidade-canônico) | Imediata |
| 401 sem explicação na auditoria (suspeita de credencial vazada ou clonagem) | **N2**; revogar o token e seguir o runbook de rotação de token (a escrever) | Imediata |
| 401 que exige registrar o gateway de novo em campo | **N2** (lacuna do `enroll --force`, seção 5) | Mesmo dia |
| Erro de disco, banco ou eMMC; agente em laço de reinício | **N2** | Mesmo dia |
| Offline há mais de 7 dias, ou fila perto do limite (30 dias ou 1 GB) | **N2** e gestor da conta: risco de descarte (`data_loss`) | Mesmo dia |
| Hardware com defeito | **N2** + logística de troca | Conforme contrato |
| TI do cliente não libera a rede | Gestor da conta Engemase com o responsável do cliente | Conforme contrato |

## 7. Ao fechar o chamado

Registre: número de série (`EGW-NNNNN`), cliente e planta, horário de início e fim (com fuso), causa, o que foi feito, quem fez, e se houve `data_loss` ou turnos recalculados. Se a causa foi uma mudança do TI do cliente, anote para revisar a ficha técnica dele.
