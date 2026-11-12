# RB-08 — Restauração do banco (PITR da Neon)

| | |
|---|---|
| **Vale a partir de** | Banco de produção na Neon: ramo `main`, projeto na AWS `sa-east-1` (São Paulo, D7), funções da Vercel em `gru1`. As contas ainda vão ser criadas ([docs/17 §6](../../17-backlog-e-pendencias.md#6-itens-fora-do-código)) |
| **Severidade típica** | Crítica (incidente de plataforma) |
| **Quem atende** | **N3** decide e coordena (coordenador do incidente); **N2** (engenharia web) executa; N1 e os gestores de conta avisam os clientes |
| **Perde dados?** | **Sim**, tudo o que foi gravado depois do ponto escolhido, se nada for feito. **Os gateways não reenviam o que a nuvem já confirmou** (L14): a única cópia desse período é o estado de antes da restauração, que a Neon guarda num ramo de backup (seção 5.4) |

## 1. Quando restaurar

Restaurar é o último recurso. O banco é **um só para todos os clientes** (isolamento por RLS, D38): restaurar o ramo `main` volta **todos os clientes** ao mesmo ponto.

| Situação | Restaurar o ramo de produção? |
|---|---|
| Dados apagados ou sobrescritos em massa (comando errado, bug, migração com defeito) em várias tabelas ou vários clientes | **Avaliar** (seção 4). Normalmente sim |
| Migração que destruiu dados ou o esquema | **Sim** |
| Dano limitado a um cliente, uma tabela ou poucas linhas | **Não.** Recuperação parcial a partir de um ramo temporário (seção 5.2) |
| Gateway offline, dados atrasados, itens em quarentena | **Não.** Os dados estão nos gateways ([RB-01](01-gateway-offline.md), [RB-03](03-dados-atrasados-buffer.md)) |
| Número errado num dashboard | **Não.** [RB-07](07-contagem-divergente.md) ou recálculo do turno |
| Neon fora do ar | **Não.** Incidente no fornecedor: chamado na Neon. Os gateways guardam até 30 dias |

## 2. Como aparece na plataforma e nos alertas

- **Sentry e logs da Vercel:** erros de banco, `5xx` na ingestão (`/api/gateway/v1/sync`), telas vazias ou com dados faltando.
- **Clientes** relatando máquinas, turnos ou apontamentos que sumiram.
- **Auditoria:** a ação que causou o dano, quando passou pelo app (com `before` e `after`). Comando direto no banco não aparece na auditoria.
- **Gateways**, durante a restauração: erro `5xx` ou de conexão, selo "dados atrasados" e fila crescendo. É o esperado: voltam sozinhos.

## 3. O que se perde e o que volta

**T0** = o ponto para onde o banco volta. **T1** = a hora da restauração. Tudo o que foi gravado entre T0 e T1 sai do ramo de produção e fica só no **ramo de backup**.

| O quê | Exemplos | Volta sozinho? | Como recuperar |
|---|---|---|---|
| Produção que os gateways enviaram e a nuvem **confirmou** | Minutos, eventos de estado, eventos do gateway | **Não.** O gateway apaga da fila o que recebeu no `ack_seq` | Copiar do ramo de backup (5.4) |
| Produção ainda **na fila** dos gateways | O que não foi confirmado antes de T1 | **Sim** | Nada: chega quando a ingestão voltar |
| Apontamentos | Classificação de paradas, refugo lançado, troca de produto | **Não** | Copiar do ramo de backup (5.4) |
| Auditoria | `audit_log` (guardada por 5 anos, D6) | **Não** | Copiar **sempre** (5.4) |
| Cadastros e config | Máquinas, tags, turnos, config publicada | **Não** | Copiar ou refazer, guiado pela auditoria recuperada (5.5) |
| Usuários e acesso | Convites, senhas, 2FA, desativações, concessões de suporte | **Não.** E **o que foi revogado depois de T0 volta a valer** | Refazer as revogações **antes** de reabrir (5.3) |
| Gateways e terminais | Registros (`enroll`), bloqueios de token, códigos de ativação, pareamentos | **Não.** Token bloqueado volta a valer; token novo deixa de valer | 5.5 |

## 4. Diagnóstico

### 4.1 Pela plataforma e pela auditoria (sempre primeiro)

1. **Abrir o incidente** ([plano de resposta a incidentes](../../negocio/juridico/06-plano-de-resposta-a-incidentes.md#3-papéis)): coordenador, severidade, registro com horários e fuso. Perda ou corrupção de dados pessoais segue também os prazos do plano.
2. **Hora do dano:** pela auditoria, pelos deploys e migrações na Vercel, pelos erros no Sentry. **T0** = um pouco antes do dano, em UTC.
3. **Alcance:** quais tabelas, quais clientes, quantas linhas. Compare as contagens com um ramo temporário em T0 (4.2).
4. **Caminho:** recuperação parcial (5.2) sempre que o dano for limitado; restauração do ramo `main` (5.3) só quando for amplo ou estrutural.

### 4.2 Na Neon e na Vercel

- **Janela de restauração** configurada no projeto (proposta do [SLA §5](../../negocio/sla-e-suporte.md#5-recuperação-rpo-e-rto-proposta): 14 dias; o padrão da Neon é menor): T0 precisa estar dentro dela. Fora dela, só a exportação lógica periódica, se existir ([docs/06](../../06-banco-de-dados.md#backup-e-recuperação)).
- **Ramo temporário em T0** para conferir (no console da Neon, um ramo novo a partir de um ponto no tempo do `main`; conferir os passos na documentação da Neon). Não muda nada em produção.
- **Esquema × código:** a última migração aplicada no banco e a que o deploy de produção espera. No banco (e no ramo temporário):

```sql
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;
```

O `created_at` corresponde ao campo `when` de cada migração em [`packages/db/migrations/meta/_journal.json`](../../../packages/db/migrations/meta/_journal.json).

### 4.3 Nos gateways

Nada a fazer antes. A coleta não depende da nuvem: durante a restauração os gateways guardam tudo na fila (até 30 dias ou 1 GB). O que verificar depois está na seção 5.5.

## 5. Correção

### 5.1 Antes de restaurar

1. **Preservar evidências** ([plano, seção 9](../../negocio/juridico/06-plano-de-resposta-a-incidentes.md#9-preservação-de-evidências)): logs da Vercel e eventos do Sentry expiram rápido.
2. **Avisar os clientes:** plataforma em manutenção; a coleta continua nos gateways.
3. **Tirar a plataforma do ar** durante a restauração, pausando o projeto na Vercel. Confira o código de resposta antes:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://engemase-oee.vercel.app/api/gateway/v1/sync
```

Com a plataforma no ar, a resposta é 401 (o app respondeu a um pedido sem token). Pausada, ela **não pode ser 400 nem 401**: com 400 o agente manda itens para a quarentena; com 401 ele para de enviar e marca a credencial como recusada. `5xx`, `404` ou falha de conexão só fazem o agente esperar e tentar de novo. **Nunca** use a proteção de deploy (senha ou login da Vercel) para isso: ela responde 401 a todos os gateways ([RB-01](01-gateway-offline.md), seção 3, item 7). O endereço é o de hoje (D28); vale o de produção na hora.

### 5.2 Recuperação parcial (preferível)

1. Criar um **ramo temporário** a partir de T0 (4.2).
2. Conferir nele que os dados estão certos.
3. Copiar **só as linhas afetadas** para o `main`, como em 5.4 (exportar do ramo temporário, carregar numa tabela temporária, inserir o que falta).
4. Registrar na auditoria de cada cliente afetado.
5. **Apagar o ramo temporário** no fim: ele tem dados de clientes.

### 5.3 Restauração do ramo `main` (todos os clientes)

1. Seção 5.1 feita; T0 definido em UTC e anotado.
2. **Restaurar o `main` para T0 no console da Neon** (restauração no próprio ramo; conferir os passos na documentação da Neon). A Neon guarda o estado de antes num **ramo de backup**: anote o nome. **Não apague esse ramo** até terminar a seção 5.4.
3. **Endereço do banco:** a restauração no próprio ramo mantém o endereço de conexão (conferir). Se usar um ramo novo no lugar do `main`, troque o `DATABASE_URL` na Vercel e faça um novo deploy.
4. **Esquema × código** (4.2): se T0 é anterior a uma migração que o código de produção usa, aplique as migrações que faltam (o script `db:migrate` contra a Neon ainda é pendência: [packages/db, Pendências](../../../packages/db/README.md#pendências)) ou volte o deploy da Vercel para a versão compatível. Se a migração foi a causa do dano, corrija-a antes.
5. **Revogações feitas depois de T0** (pela auditoria do ramo de backup): refaça **antes de reabrir**. Tokens de gateway bloqueados ([RB-09](09-rotacao-token-gateway.md)), terminais revogados, usuários desativados, concessões de suporte encerradas.
6. **Reabrir** (tirar a pausa) e acompanhar os gateways voltando: `buffer_pending` caindo ([RB-03](03-dados-atrasados-buffer.md)).

### 5.4 Recuperar o período entre T0 e T1 (L14)

Os gateways **não reenviam**: o que a nuvem confirmou entre T0 e T1 saiu da fila deles. Esse período está **só no ramo de backup**. Sem ele, o período fica "sem dados" para sempre.

1. **Ordem:** cadastros e config primeiro (as chaves estrangeiras exigem), depois produção e apontamentos, por fim a auditoria. **Deixe de fora as linhas do dano.**
2. **Papel:** a cópia lê e grava todos os clientes. Use um papel com `BYPASSRLS` (a confirmar na Neon: [packages/db, Pendências](../../../packages/db/README.md#pendências)) ou faça cliente a cliente, com `SET LOCAL ROLE app_user` e `SELECT app.set_tenant(...)` antes de cada cópia. Linhas de auditoria de plataforma (`organization_id` nulo) só com `BYPASSRLS`.

| Tabela | O que pegar no ramo de backup | Como gravar no `main` |
|---|---|---|
| `audit_log` | `at >= T0 − 31 dias` (eventos de gateway trazem a hora do evento, que pode ser anterior à chegada; 31 dias cobrem a fila de 30) | `INSERT ... ON CONFLICT (id) DO NOTHING` |
| `production_minute` | `received_at >= T0` (pega também o atraso de gateways que voltaram depois de T0) | Inserir os que faltam (chave: máquina + minuto). Os que já existem com outro valor: vale o do backup (é o mais novo) |
| `machine_state_event` | `created_at >= T0`, ou `ended_at >= T0`, ou `classified_at >= T0` | Inserir os que faltam; nos que existem, copiar `ended_at`, `reason_id`, `classified_by` e `classified_at` |
| `production_run` | `created_at >= T0` ou `ended_at >= T0` | Inserir os que faltam; nos que existem, copiar `ended_at` |
| `quality_entry` | `created_at >= T0` | Inserir os que faltam (é só inserção: estorno é outro lançamento) |
| `oee_shift` | Não copiar | Marcar como sujos (`dirty = true`) os turnos de T0 em diante, para o recálculo (cron `recompute-dirty`, **Fase 1**) |
| `machine_live`, saúde do gateway | Não copiar | O próximo `/sync` reescreve |

Exemplo com os minutos (os outros seguem o mesmo padrão). `URL_BACKUP` e `URL_MAIN` são as conexões dos dois ramos; T0 em UTC:

```bash
# 1. No ramo de backup: exportar o que chegou depois de T0
psql "$URL_BACKUP" -c "\copy (SELECT * FROM production_minute WHERE received_at >= '2026-11-12T13:00:00Z') TO 'production_minute.csv' WITH (FORMAT csv, HEADER)"

# 2. No main: carregar numa tabela temporária e inserir só o que falta
psql "$URL_MAIN" <<'SQL'
BEGIN;
CREATE TEMP TABLE r (LIKE production_minute) ON COMMIT DROP;
\copy r FROM 'production_minute.csv' WITH (FORMAT csv, HEADER)
INSERT INTO production_minute SELECT * FROM r
  ON CONFLICT (machine_id, bucket_start) DO NOTHING;
COMMIT;
SQL
```

Os arquivos exportados têm dados de clientes: guarde em local restrito e apague no fim. Registre na auditoria de cada cliente o que foi recuperado.

### 5.5 Gateways, terminais e usuários depois da restauração

| Situação (depois de T0) | O que acontece | O que fazer |
|---|---|---|
| Gateway **registrado** (ou registrado de novo, ou trocado, [RB-10](10-troca-hardware-gateway.md)) | O banco não conhece o token novo: 401 `unauthorized`, "nuvem bloqueada (401)". O agente para de enviar e **guarda a fila** | Copiar do ramo de backup as colunas de credencial desse gateway (`status`, `token_hash`, `previous_token_hash`, `previous_token_expires_at`, `revoked_at`; o banco guarda só o hash). Sem isso: código novo e registro de novo no local ([RB-09](09-rotacao-token-gateway.md), seção 5.2) |
| Token **bloqueado** ou gateway revogado | O token antigo volta a valer | Bloquear de novo antes de reabrir (5.3, passo 5) |
| Config **publicada** | O gateway continua com a config nova. Itens de máquinas e tags que o banco não conhece vão para a quarentena (400). E o agente **só baixa versão maior que a sua**: uma publicação nova com número menor ou igual é ignorada | Copiar do backup os cadastros e as versões de config (`gateway_config_version` e `gateway.config_version_latest`), ou refazer e publicar com versão **acima** da aplicada (consulta abaixo) |
| Código de ativação gerado | Não existe mais | Gerar outro |
| Comando enviado | Some; o resultado que chegar é ignorado | Enviar de novo, se ainda fizer sentido |
| Terminal pareado | O token do terminal não existe mais | Copiar a credencial do backup ou parear de novo |
| Usuário criado, senha ou 2FA trocados | Volta ao estado de T0; sessões abertas depois de T0 caem | Copiar do backup ou refazer; avisar os usuários. Senha trocada por segurança: forçar nova troca |

Gateways com config aplicada acima da última publicada no banco (rodar depois que eles voltarem a sincronizar, cliente a cliente ou com `BYPASSRLS`):

```sql
SELECT id, organization_id, name, config_version_latest, config_version_applied, last_seen_at
  FROM gateway
 WHERE deleted_at IS NULL AND config_version_applied > config_version_latest;
```

Na auditoria recuperada, os eventos `gateway.enrolled` depois de T0 listam os gateways da primeira linha da tabela.

### 5.6 Teste de restauração (a cada 3 meses)

Escolha provisória da L14 ([docs/17 §4](../../17-backlog-e-pendencias.md#4-lacunas-de-especificação)):

1. Criar um ramo a partir de um ponto de cerca de 24 h atrás.
2. Conferir: última migração (4.2); contagem de linhas das tabelas principais por cliente; um turno recalculado igual ao de produção.
3. Medir o tempo de cada passo (referência de RTO) e anotar o ponto mais antigo disponível (janela).
4. Conferir que as chaves (OTA, VAPID, CA SSH) estão no cofre e que duas pessoas têm acesso.
5. Apagar o ramo e registrar o teste (data, quem, tempos, problemas).

RPO, RTO e a configuração da Neon (plano, janela de restauração) estão no [SLA §5](../../negocio/sla-e-suporte.md#5-recuperação-rpo-e-rto-proposta) (proposta). O teste confere se o tempo medido cabe no RTO.

## 6. Quando escalar

| Situação | Para quem | Urgência |
|---|---|---|
| Qualquer decisão de restaurar o ramo `main` | **N3** (coordenador) e direção (tirar a plataforma do ar) | Imediata |
| Perda ou corrupção de dados pessoais | Encarregado (DPO) e [plano de incidentes](../../negocio/juridico/06-plano-de-resposta-a-incidentes.md#8-roteiros-por-tipo-de-incidente) | Prazos do plano |
| T0 fora da janela de restauração | **N3** e suporte da Neon | Imediata |
| Falha na restauração ou na Neon | **N3** e suporte da Neon | Imediata |
| Período sem cópia (ramo de backup perdido ou com o dano) | **N3** e gestor de cada conta: avisar os clientes com máquinas e turnos afetados | Mesmo dia |

## 7. Ao fechar o chamado

Registre: hora do dano, T0 e T1 (com fuso), caminho escolhido (parcial ou ramo `main`), nome do ramo de backup e quando foi apagado, o que foi copiado (tabelas e linhas por cliente), o que ficou perdido (clientes, máquinas, períodos), gateways, terminais e usuários refeitos, migrações aplicadas ou deploy revertido, e a comunicação aos clientes. A revisão pós-incidente segue o plano (até 10 dias úteis depois do encerramento).
