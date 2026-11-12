# RB-03 — Dados atrasados ou fila (buffer) crescendo

| | |
|---|---|
| **Severidade típica** | Aviso; alta se a fila se aproximar do limite |
| **Alerta** | "Buffer > 80%" (operacional, só equipe Engemase, [docs/13](../../13-notificacoes-e-alertas.md#catálogo-inicial-de-alertas-presets-por-cliente)); selo "dados atrasados" nas telas |
| **Quem atende** | N1 (suporte Engemase); N2 quando a nuvem recusa dados |
| **Perde dados?** | Não enquanto a fila estiver abaixo do limite (**30 dias ou 1 GB**). Acima dele, saem primeiro as amostras e depois os itens mais antigos, com evento `data_loss` (`retention_limit`). Itens isolados em quarentena por erro 400 também podem virar `data_loss` (`quarantine_expired`) |

## 1. Sintoma

Os dados chegam à plataforma com atraso ou não chegam, e a fila de envio do gateway (outbox SQLite) cresce. Três situações diferentes:

| Situação | O que se vê | Caminho |
|---|---|---|
| **A.** Gateway offline | Gateway "offline"; fila crescendo é o esperado | [RB-01](01-gateway-offline.md) |
| **B.** Gateway **online**, fila **não cai** | Gateway "online" (a saúde chega), mas `buffer_pending` e `buffer_oldest_s` sobem | Este runbook |
| **C.** Gateway online, fila baixa, **uma máquina** com "dados atrasados" | A foto ao vivo da máquina está velha (mais de 30 s) | Seção 4.1, passo 5 |

## 2. Como aparece na plataforma e nos alertas

- **Telas ao vivo e TV:** selo **"dados atrasados"** quando o último dado ao vivo da máquina passa de 30 s ou o gateway está offline ([docs/05](../../05-plataforma-web.md#dados-ao-vivo)).
- **Dashboards e relatórios:** OEE do turno parado ou faltando minutos; depois que a fila drena, os turnos afetados são recalculados (turno "sujo", cron `recompute-dirty` a cada 5 min).
- **Detalhe do gateway**, aba **Saúde** (campos do `/sync`):
  - `buffer_pending`: itens da fila principal (eventos e minutos) ainda não confirmados;
  - `buffer_oldest_s`: idade do item mais antigo;
  - `samples_pending`: amostras pendentes (F2);
  - `quarantined`: itens isolados depois de um erro 400;
  - `disk_free_mb`: espaço livre na partição de dados.
- **Alerta operacional "buffer > 80%"** (do limite de 30 dias / 1 GB), só para a equipe Engemase.
- **LED (Fase 1):** verde piscando = coletando sem nuvem, fila enchendo.

## 3. Causas prováveis (situação B)

1. **A nuvem recusa os dados (400):** contrato diferente entre a versão do agente e a da plataforma, ou item inválido (por exemplo, máquina removida do gateway na plataforma enquanto havia itens dela na fila). O agente divide o lote até achar o item culpado e o manda para a **quarentena**; o resto segue.
2. **Limite de taxa (429):** muitos gateways voltando juntos ou regra de taxa apertada demais. O agente respeita o `Retry-After`.
3. **Erro da plataforma (5xx) ou banco lento:** o agente tenta de novo com espera crescente (1 s a 5 min).
4. **Lote grande demais (413):** o agente divide o lote ao meio sozinho. Se repetir, há item gigante (N2).
5. **Relógio adiantado:** itens com horário mais de 2 min no futuro são recusados pela API ([RB-04](04-relogio-fora-de-sincronia.md)).
6. **Rede lenta ou proxy limitando** a banda: o envio anda, mas mais devagar que a produção de dados.
7. **Disco quase cheio** ou banco local com problema (`buffer_corrupted`).

**Ritmo normal de recuperação:** com fila acumulada, o agente envia um lote cheio (até 2.000 itens ou ~900 KB) a cada ~1 a 1,5 s. Um dia de 10 máquinas (~15 mil itens) drena em menos de 1 minuto. **Se a fila não cai em poucos minutos com o gateway online, há erro.**

## 4. Diagnóstico

### 4.1 Pela plataforma (sempre primeiro)

1. **O gateway está online?** Se não, [RB-01](01-gateway-offline.md).
2. **A fila está caindo?** Acompanhe `buffer_pending` por 5 min. Caindo → é só recuperação depois de uma queda: aguarde e confira o recálculo dos turnos. Parada ou subindo → continue.
3. **`quarantined` > 0?** A nuvem recusou itens (400). Anote a quantidade e a hora: N2 precisa ver o erro de validação na ingestão.
4. **Só equipe Engemase (N2):** logs da rota `/api/gateway/v1/sync` para este gateway na Vercel e erros no Sentry: códigos de resposta (`400`, `413`, `429`, `5xx`), tempo de resposta e mensagens de validação. Compare com outros gateways: se todos estão com 5xx ou 429, é a plataforma.
5. **Situação C (uma máquina):** a máquina está em `NO_COMM`? Então é o [RB-02](02-clp-sem-comunicacao.md). Ela está na config aplicada do gateway (`config_status` com a versão mais recente)? Uma máquina recém-cadastrada só aparece depois de a config ser aplicada.
6. **`clock_offset_ms`** fora de ±2 s → [RB-04](04-relogio-fora-de-sincronia.md).
7. **Eventos `data_loss` ou `buffer_corrupted`** → seção 6, sempre.

### 4.2 Remoto

- **Logs do gateway:** `logs.upload` mínimo **(Fase 1, se aprovado na D29)**; na F2, também por SSH durante uma sessão de VPN aprovada.
- **TI do cliente:** houve limitação de banda, troca de proxy ou inspeção SSL nova? A inspeção pode atrasar ou cortar requisições grandes.

### 4.3 No local

```bash
systemctl status oee-gateway      # "nuvem online" com fila parada indica recusa da nuvem
sudo oee-gateway diag             # mostra o tamanho do buffer.db
sudo oee-gateway status           # (Fase 1) fila, item mais antigo, quarentena, último /sync
oee-gateway buffer stats          # (Fase 1) pendentes, quarentena e tamanho do banco
df -h /data                       # espaço livre na partição de dados
```

Na página local **(Fase 1)**: tela **Status** (fila, último `/sync`) e **Logs**.

## 5. Correção

| Causa | O que fazer |
|---|---|
| Só recuperação depois de queda | Nada. Confirmar o recálculo dos turnos depois que a fila zerar |
| 400 / quarentena | N2 corrige a causa (agente, plataforma ou config). **Não apague** a quarentena: os itens ficam guardados (30 dias, conforme o rascunho de software) e a reentrega depende da correção |
| Máquina removida com itens na fila | N2 avalia recriar o vínculo temporariamente para receber os itens ou aceitar a perda, registrando no chamado |
| 429 | N2 revisa a regra de taxa ou escalona a volta dos gateways. A fila drena sozinha |
| 5xx | Incidente de plataforma (seção 6). A fila drena sozinha quando a ingestão volta |
| Relógio adiantado | [RB-04](04-relogio-fora-de-sincronia.md); depois de corrigir, os itens novos passam. Os já recusados ficam na quarentena (N2) |
| Rede lenta ou proxy | TI do cliente revisa a limitação e a inspeção para os domínios da [ficha técnica](../ficha-tecnica-ti-cliente.md#4-tráfego-de-saída-necessário-porta-it) |
| Disco quase cheio | N2: ver o que ocupa a partição `/data` (o journal tem limite próprio). **Nunca** apague o `buffer.db` |

**Não fazer:** apagar o `buffer.db`, "limpar a fila", fazer reset de fábrica ou registrar o gateway de novo com outro código. Qualquer um desses descarta os dados que ainda não chegaram à nuvem.

## 6. Quando escalar

| Situação | Para quem | Urgência |
|---|---|---|
| `quarantined` > 0 | **N2** | Mesmo dia |
| 5xx ou 429 em vários gateways | **N3** (incidente de plataforma) e N2 | Imediata |
| Fila acima de 80% do limite, ou `buffer_oldest_s` acima de 20 dias | **N2** e gestor da conta: risco de descarte | Imediata |
| Evento `data_loss` ou `buffer_corrupted` | **N2**; avisar o cliente sobre o período afetado | Imediata |
| Fila cresce com gateway online e nenhum erro visível | **N2** com os logs | Mesmo dia |

## 7. Ao fechar o chamado

Registre: gateway (`EGW-NNNNN`), período afetado, pico de `buffer_pending`, se houve quarentena ou `data_loss` (quantos itens e de quando), causa e correção. Se houve perda, registre quais turnos e máquinas ficaram com dados incompletos e avise o cliente.
