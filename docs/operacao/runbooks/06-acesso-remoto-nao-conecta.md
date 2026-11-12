# RB-06 — Acesso remoto (VPN de manutenção) não conecta

| | |
|---|---|
| **Vale a partir de** | **Fase 2** (VPN de manutenção sob demanda, [docs/12](../../12-acesso-remoto-vpn.md)). No MVP não existe acesso remoto ao gateway além dos comandos da plataforma |
| **Severidade típica** | Baixa a média: **a coleta não depende da VPN** |
| **Quem atende** | Quem pediu a sessão (técnico Engemase) → N2; admin do cliente para a aprovação; TI do cliente para o firewall |
| **Perde dados?** | Não. A VPN roda num processo separado (`oee-remote-access`); uma falha nela não derruba a coleta |

## 1. Sintoma

Uma sessão de acesso remoto foi pedida, mas:
- fica parada em **solicitada** ou **ativando**;
- termina em **falhou**, **expirada sem aprovação**, **recusada** ou **revogada**;
- ou fica **ativa** na plataforma, mas o técnico não consegue entrar por SSH.

Estados da sessão: `solicitada → aprovada → ativando → ativa → encerrando → encerrada`, com as saídas `recusada`, `cancelada`, `expirada sem aprovação`, `falhou` e `revogada`.

## 2. Como aparece na plataforma e nos alertas

- **Detalhe do gateway**, aba **Acesso remoto**: estado da sessão, linha do tempo, resultado do comando `vpn.enable` e do `vpn.status`.
- **Resultado do `vpn.enable`** com erro ([`packages/contracts/src/commands.ts`](../../../packages/contracts/src/commands.ts)):

| Código | Significa |
|---|---|
| `policy_denied` | A política local do gateway não permite: acesso bloqueado no próprio gateway (`remote-access off --lock` ou `/etc/oee-gateway/remote-access.json`) |
| `approval_invalid` | Aprovação assinada ausente, inválida, vencida ou de outro gateway/sessão |
| `session_conflict` | Já existe outra sessão ativa incompatível (uma por gateway e técnico) |
| `vpn_failed` | O processo da VPN não conseguiu conectar (rede, proxy, inspeção SSL) |
| `expired` | O comando chegou ao gateway depois do prazo (o `vpn.enable` vale 5 min) |
| `timeout` | Passou do prazo de execução (60 s para o `vpn.enable`) |

- **`vpn.status`**: `off`, `activating`, `active`, `stopping` ou `error`; tipo de conexão `direct` (direta) ou `relay` (pelo relay da Tailscale, em 443).
- **Auditoria do cliente**: eventos `remote_access` (`session_started`, `ssh_login`, `policy_blocked`...).
- **Alerta "Acesso remoto"** para o admin do cliente (pedido aguardando aprovação; sessão iniciada e encerrada).

## 3. Causas prováveis

1. **Sem aprovação:** o admin do cliente ainda não aprovou, ou aprovou depois do prazo. Quem pede nunca aprova.
2. **Gateway offline:** o `vpn.enable` só chega na resposta do `/sync` ([RB-01](01-gateway-offline.md)).
3. **Bloqueio local do cliente:** o kill switch local prevalece sobre a nuvem (é proposital).
4. **Firewall do cliente:** saída TCP 443 para os domínios da Tailscale não liberada ([ficha técnica §4](../ficha-tecnica-ti-cliente.md#4-tráfego-de-saída-necessário-porta-it)).
5. **Inspeção SSL / DPI** no caminho (por exemplo, FortiGate com inspeção profunda): **a VPN não conecta** sem exceção para os domínios da Tailscale.
6. **Proxy corporativo:** a VPN através do `HTTPS_PROXY` ainda é item da prova de conceito ([docs/12](../../12-acesso-remoto-vpn.md#itens-para-a-prova-de-conceito)).
7. **Relógio errado:** a aprovação assinada e o certificado SSH têm validade; com o relógio fora, são recusados ([RB-04](04-relogio-fora-de-sincronia.md)).
8. **Lado da plataforma:** chave da API da Tailscale vencida, limite de nós, falha na criação da chave de uso único ou na reconciliação.
9. **SSH:** certificado SSH de curta duração vencido ou emitido para outro usuário.

## 4. Diagnóstico

### 4.1 Pela plataforma (sempre primeiro)

1. **Estado da sessão** e **resultado do `vpn.enable`** (tabela da seção 2).
2. **O gateway está online?** Se não, [RB-01](01-gateway-offline.md) primeiro.
3. **A aprovação existe e está no prazo?** Quem aprovou, quando, com que duração.
4. **`clock_offset_ms`** fora de ±2 s → [RB-04](04-relogio-fora-de-sincronia.md).
5. **Outras sessões falhando em outros clientes ao mesmo tempo** → lado da plataforma ou da Tailscale (N2).
6. **Só equipe Engemase (N2):** console da Tailscale (o nó foi criado? apareceu online? conexão direta ou relay?) e logs da criação de chave e da reconciliação.

### 4.2 Remoto

1. **`vpn.status`** pela plataforma: em `activating` por mais de 1 min, ou em `error`, indica bloqueio de rede no cliente.
2. **TI do cliente:** confirmar a liberação de saída TCP 443 para os domínios da Tailscale e a **exceção de inspeção SSL**. UDP 41641 e 3478 são opcionais (só aceleram).
3. **Admin do cliente:** confirmar que não há bloqueio local ativo e que a política do cliente permite a sessão (desativado, com aprovação, janela pré-aprovada).

### 4.3 No local (pessoal do cliente ou técnico em campo)

```bash
oee-gateway remote-access status         # (Fase 2) estado, sessão, bloqueio local (leitura: grupo oee-admin)
cat /etc/oee-gateway/remote-access.json  # (Fase 2) allowed, allow_ot_forward
systemctl status oee-remote-access       # (Fase 2) processo da VPN, só existe durante uma sessão
```

Bloquear e desbloquear o acesso local (`remote-access off --lock` / `remote-access on`) é decisão **do cliente**. Esses comandos não estão no `sudo` do `tecnico` ([docs/16 §4](../../16-projeto-do-gateway.md#4-caminhos-usuários-e-identidade-canônico)) e a imagem não tem root: como o cliente aciona o bloqueio local na prática (comando, página local ou chave física) ainda precisa ser definido na F2.

## 5. Correção

| Causa | O que fazer |
|---|---|
| Sem aprovação ou aprovação vencida | Pedir de novo; avisar o admin do cliente pelo contato do chamado |
| Gateway offline | [RB-01](01-gateway-offline.md) |
| Bloqueio local | Só o cliente decide desbloquear. Sem desbloqueio, atender pelo local ou pelos comandos da plataforma |
| Firewall ou inspeção SSL | TI libera os domínios da Tailscale em 443 e cria a exceção de inspeção. Se o cliente não aceitar: o acesso remoto não funciona nesse cliente (a coleta não é afetada); avaliar o plano B (NetBird) com o N2 (decisão D32) |
| Proxy | N2 avalia; até a validação da prova de conceito, o acesso remoto através de proxy não é garantido |
| Relógio | [RB-04](04-relogio-fora-de-sincronia.md) |
| Lado da plataforma | N2 corrige (chave da API, limite de nós, reconciliação) |
| Certificado SSH vencido | Pedir um certificado novo dentro da janela da sessão; se a janela acabou, pedir nova sessão |

**Nunca:**
- pedir ao cliente para abrir porta de entrada ou redirecionamento no firewall;
- contornar a aprovação (aprovar em nome do cliente, reaproveitar aprovação antiga);
- pedir para desligar o kill switch local sem o cliente decidir;
- pedir "acesso à rede OT inteira": o acesso a um CLP é por um único IP:porta, com aprovação própria.

## 6. Quando escalar

| Situação | Para quem |
|---|---|
| `vpn_failed` com firewall e inspeção liberados | **N2** |
| Falha em vários clientes ao mesmo tempo | **N2** (plataforma ou Tailscale) |
| `approval_invalid` sem explicação, ou aprovação que não foi dada pelo cliente | **N2/N3** (incidente de segurança) |
| Cliente não libera a rede para a VPN | Gestor da conta (contrato e alternativa de atendimento) |

## 7. Ao fechar o chamado

Registre: gateway (`EGW-NNNNN`), sessão, quem pediu e quem aprovou, estado final, código de erro, causa e correção. A auditoria da sessão fica na plataforma e é visível para o cliente.
