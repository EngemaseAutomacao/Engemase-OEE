# plc-sim — simulador de CLP Modbus TCP

Simula N máquinas com o **bloco OEE padrão Engemase** ([docs/11, seção 3](../../docs/11-integracao-modbus.md#3-bloco-oee-padrão-engemase)) em servidores **Modbus TCP** (`github.com/simonvetter/modbus`). Serve para desenvolver a plataforma e o gateway sem CLP físico, para testes automatizados com cenários determinísticos e para demonstrações ([docs/03](../../docs/03-gateway.md#simulador-toolsplc-sim)).

Módulo Go próprio (`go 1.24`), sem cgo.

## Como rodar

```bash
cd tools/plc-sim
go run . --machines 3 --base 1000 --port 1502 --cycle 6s --seed 42 --scenario normal
```

Ou gere o binário (`go build` cria `./plc-sim`, ignorado pelo git):

```bash
go build && ./plc-sim --help
```

Saída típica (mesmo comando com `--speed 30`, para o exemplo ficar curto):

```text
plc-sim · simulador de CLP Modbus TCP · bloco OEE padrão Engemase v1
  máquinas: 3 · modo: unit · ciclo: 6s · semente: 42 · cenário: normal · velocidade: 30×
  bloco: HR 1000–1031 (41001–41032) · 32 bits em CDAB · coils 0 (rodando) e 1 (falha) · somente leitura
  M1 → 127.0.0.1:1502 · unit id 1
  M2 → 127.0.0.1:1502 · unit id 2
  M3 → 127.0.0.1:1502 · unit id 3
Ctrl+C para encerrar.
23:13:00.678 [t=00:00:06] M1 produzindo → PARADA por ~30s (falta de material)
23:13:01.679 [t=00:00:36] M1 parada → PRODUZINDO (produto 1001)
23:13:01.779 [t=00:00:41] M1 produzindo → FALHA 520 (porta de segurança aberta) por ~54s
23:13:03.379 [t=00:01:30] status M1 falha 520  total=2 refugo=0 bons=2 hb=90 produto=1001 vel=0/h ciclo=5865ms
23:13:03.379 [t=00:01:30] status M2 produzindo total=15 refugo=1 bons=14 hb=90 produto=1002 vel=606/h ciclo=5941ms
23:13:03.379 [t=00:01:30] status M3 produzindo total=15 refugo=0 bons=15 hb=90 produto=1003 vel=632/h ciclo=5700ms
23:13:03.679 [t=00:01:36] M1 falha → PRODUZINDO (produto 1001)
```

`[t=…]` é o relógio simulado (com `--speed 10` ele anda dez vezes mais rápido que o relógio de parede).

### Exemplos

```bash
# Uma porta por máquina (M1 em 1502, M2 em 1503...), qualquer unit id
go run . --mode port --port 1502 --machines 2

# Escutar na rede (bancada com o gateway de verdade). Modbus não tem autenticação: só em rede OT/laboratório.
go run . --host 0.0.0.0 --port 502

# Conferir a ordem das words com um valor conhecido (docs/11 §6: contador = 100.000)
go run . --start-total 100000 --word-order CDAB

# Cenários combinados, 10× mais rápido
go run . --scenario counter-reset,overflow,offline --speed 10

# Execução curta para CI, com log de cada ciclo
go run . --duration 30s --speed 20 --verbose
```

Para ler o simulador sem o gateway, o cliente de linha de comando da própria biblioteca serve:

```bash
go run github.com/simonvetter/modbus/cmd@v1.6.4 --target tcp://127.0.0.1:1502 --unit-id 1 \
  --word-order lowfirst rh:uint16:1000+3 rh:uint32:1004+2 rh:uint16:1010+3 rc:0+1
```

## Mapa Modbus

Holding registers a partir de `--base` (endereço de protocolo, base 0; 1000 = 41001 na convenção 4xxxx):

| Offset | Tipo | Campo | O que o simulador coloca |
|---|---|---|---|
| 0 | uint16 | `versao_bloco` | 1 |
| 1 | uint16 | `heartbeat` | +1 a cada 1 s simulado (volta de 65535 para 0) |
| 2 | uint16 | `estado` | 0 parada · 1 produzindo · 2 falha · 3 setup · 4 manual · 5 emergência |
| 3 | uint16 | `codigo_falha` | 101, 102, 205, 310, 412 ou 520 durante a falha; 0 fora dela |
| 4–5 | uint32 | `contador_total` | +1 por ciclo |
| 6–7 | uint32 | `contador_refugo` | +1 por peça refugada (~2%) |
| 8–9 | uint32 | `contador_bons` | +1 por peça boa (0 com `--good-counter=false`) |
| 10 | uint16 | `produto` | 1001, 1002 ou 1003 (troca a cada setup) |
| 11 | uint16 | `velocidade` | peças/hora pelo último ciclo; 0 fora de produção |
| 12 | uint16 | `ciclo_ultimo_ms` | duração do último ciclo, em ms (satura em 65535) |
| 13 | uint16 | `bits_status` | bit 0 automático · bit 1 porta aberta · bit 2 falta material · bit 3 manutenção |
| 14–31 | — | reservado | 0 |

- Valores de 32 bits em **CDAB** (word baixa primeiro) por padrão; `--word-order` aceita ABCD, BADC e DCBA.
- **Coils:** 0 = rodando (estado 1), 1 = falha (estado 2 ou 5).
- O bloco é **somente leitura**: escrita (FC05/06/15/16) recebe a exceção 01. Leitura fora do bloco, de coils além da 1, de input registers ou de discrete inputs recebe a exceção 02.

## Comportamento simulado

Cada máquina é um motor orientado a eventos sobre um relógio simulado. **A mesma `--seed` gera sempre a mesma sequência**, independente do passo de avanço e do relógio de parede (ligar um cenário de comunicação não muda a linha do tempo de produção).

- **Ciclos:** tempo de ciclo `--cycle` com variação de −5% a +15% (normal, desvio de 2%).
- **Refugo:** `--scrap` (padrão 0,02) por peça.
- **Interrupções:** após cada ciclo, chance de 1/`--mean-run` (padrão 25) de parar. Sorteio: parada 45% (40% delas por falta de material), falha 35%, setup 10%, manual 5%, emergência 5%. Durações em ciclos nominais: parada 2–8, falha 3–15 (≥ 10 liga o bit de manutenção), setup 10–30 (troca o produto ao fim), manual 3–10, emergência 2–5 seguida de parada de rearme de 1–3. Com os padrões, a máquina fica ~75% do tempo produzindo.

### Cenários (`--scenario`, combináveis com vírgula)

| Cenário | O que faz | Ajustes |
|---|---|---|
| `normal` | Só o comportamento acima | — |
| `counter-reset` | Zera os três contadores de tempos em tempos (operador zerou) | `--reset-every` (média; sorteio de 0,5× a 1,5×) |
| `overflow` | Começa com `contador_total` = 4294967295 − margem, `contador_refugo` = 4294967295 e `contador_bons` coerente: os três dão a volta para 0 logo | `--overflow-margin` (padrão 20 peças) |
| `offline` | A máquina some da rede de forma intermitente e volta; a produção continua (só a rede caiu) | `--offline-every`, `--offline-for`, `--offline-mode` |
| `frozen` | CLP "congelado": continua respondendo, mas o bloco inteiro (inclusive o `heartbeat`) para; ao voltar, os contadores saltam | `--freeze-every`, `--freeze-for` |

**Offline** (`--offline-mode`): `close` fecha a porta da máquina (conexões caem e novas são recusadas; só no modo `port`); `exception` responde com a exceção **0x0B** (escravo não respondeu), como um conversor TCP→RTU. `auto` (padrão) usa `close` no modo `port` e `exception` no modo `unit`.

### Endereçamento (`--mode`)

- `unit` (padrão): uma porta, máquina *i* no unit id `--unit-start` + *i* − 1 (como um conversor Modbus TCP→RTU com vários escravos). Unit id sem máquina recebe a exceção 0x0A.
- `port`: uma porta por máquina (`--port` + *i* − 1), aceitando qualquer unit id (como CLPs com Ethernet própria).

## Como testar

```bash
cd tools/plc-sim
go test ./...          # ou: go test -race ./...
go vet ./...
```

Os testes sobem o servidor em portas livres de `127.0.0.1`, leem o bloco com um cliente Modbus de verdade e conferem tipos, ordem das words (inclusive contra o decodificador da biblioteca), avanço dos contadores, overflow, reset, offline (0x0B e porta fechada), congelamento, exceções e a CLI. O relógio simulado é avançado pelo próprio teste: nada depende de `sleep`, exceto um teste curto da CLI.

## Uso como biblioteca (testes do gateway)

Os pacotes não são `internal`, para que os testes de integração do gateway possam subir o simulador no mesmo processo, controlando o relógio:

```go
m, _ := sim.NewMachine(0, 42, sim.DefaultConfig())
srv, _ := plcserver.New([]*sim.Machine{m}, plcserver.Options{Host: "127.0.0.1", Port: 15020, Base: 1000})
_ = srv.Start()
defer srv.Stop()
events, _ := srv.Advance(30 * time.Second) // avança o relógio simulado
```

No `go.mod` do gateway: `require github.com/EngemaseAutomacao/engemase-oee/tools/plc-sim v0.0.0` com `replace ... => ../tools/plc-sim`. O código de produção do gateway **não** deve importar o pacote `block` daqui: o gateway tem o próprio decodificador.

Pacotes: `block` (layout e ordem das words), `sim` (motor determinístico e cenários), `plcserver` (servidor Modbus TCP), `main.go` (CLI).
