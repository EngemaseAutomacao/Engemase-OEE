/**
 * Dados de ACOMPANHAMENTO de um cliente (visão geral, máquinas, linhas, relatórios, notificações, Andon e
 * tela do operador), já lidos e calculados no servidor. As telas consultam SÓ este objeto: ele vem do
 * banco (`banco.ts`, com o escopo da pessoa e o cálculo do `@engemase/oee-core`) quando `DATABASE_URL`
 * existe, e dos dados simulados (`simulado.ts`, `@/lib/mock`) na demonstração sem banco.
 *
 * As consultas são síncronas: tudo o que a tela pediu (`NecessidadesCliente`) já foi carregado.
 * Os formatos são os do protótipo (`@/lib/mock/types`), para as telas não mudarem com a troca.
 */
import type {
  AppNotification,
  Area,
  Client,
  ClientBranding,
  DailyOee,
  Device,
  DowntimeReason,
  Gateway,
  HourlyProduction,
  Line,
  Machine,
  MachineLive,
  MachineWithLive,
  OeeValues,
  ParetoItem,
  Product,
  RemoteAccessSession,
  Shift,
  ShiftOeeRow,
  StateEvent,
  Tag,
  Unit,
} from "@/lib/mock"
import type { StopRecord } from "@/components/reports/stops-data"

/** De onde vieram os dados (aparece só para quem desenvolve; as telas são iguais). */
export type FonteDados = "banco" | "simulado"

/** O que a tela vai consultar além do básico (cadastros, estado ao vivo e turno corrente). */
export interface NecessidadesCliente {
  /** Dias de OEE diário por máquina (`getDailyOee`). */
  readonly diasOee?: number
  /** Dias de turnos fechados por máquina (`getShiftHistory`, relatório de OEE). */
  readonly diasTurnos?: number
  /** Paradas por motivo das últimas semanas (`getStopRecords`, `getPareto`). */
  readonly paradas?: boolean
  /** Alertas/notificações do cliente (`getNotifications`). */
  readonly notificacoes?: boolean
  /**
   * Só cadastros, gateways e alertas, sem séries (estado ao vivo, eventos, minutos): para o menu e o
   * cabeçalho do layout, que não mostram números.
   */
  readonly somenteCadastro?: boolean
}

/** Quem está vendo a tela (sessão real no banco; usuário simulado na demonstração). */
export interface Visitante {
  readonly name: string
  readonly email: string
  /** "Supervisor", "Engemase · Suporte"... */
  readonly roleLabel: string
  readonly isPlatform: boolean
}

/** Permissões que mudam o que a tela mostra (D12/D13). */
export interface AcessoTela {
  readonly isEngemase: boolean
  readonly canConfigure: boolean
  readonly canManageUsers: boolean
  /** Vê gateways por dentro: conexões Modbus, endereços e tags (leitura técnica). */
  readonly canSeeTechnical: boolean
}

/** Janela do turno corrente (ou do último turno, fora do horário), em ISO UTC. */
export interface JanelaTurno {
  readonly id: string
  readonly name: string
  readonly start: string
  readonly end: string
  /** Pausas planejadas do turno (refeição...), em ISO UTC. */
  readonly breaks: readonly { readonly start: string; readonly end: string }[]
  /** O turno está em andamento agora (senão, é o último que terminou). */
  readonly emAndamento: boolean
}

/** Agregado de OEE de um conjunto de máquinas (soma das bases, docs/07). */
export type OeeAgregado = OeeValues & { machinesWithData: number }

export interface ClienteDados {
  readonly fonte: FonteDados
  /** "Agora" desta leitura (ISO): relógio real no banco; MOCK_NOW na demonstração. */
  readonly now: string
  readonly nowMs: number
  readonly client: Client
  readonly viewer: Visitante
  readonly access: AcessoTela
  /** Clientes que a pessoa pode trocar no menu. */
  readonly accessibleClients: readonly { slug: string; name: string; status: Client["status"] }[]
  readonly branding: ClientBranding | undefined
  /** Meta de OEE do cliente (média das metas das linhas; sem meta cadastrada, 75%). */
  readonly oeeTarget: number

  readonly units: readonly Unit[]
  readonly areas: readonly Area[]
  readonly lines: readonly Line[]
  /** Máquinas no escopo da pessoa. */
  readonly machines: readonly Machine[]
  readonly gateways: readonly Gateway[]
  readonly reasons: readonly DowntimeReason[]
  readonly products: readonly Product[]
  /** Motivos de refugo ativos (cadastro da Engemase, L3). Vazio nos dados simulados. */
  readonly rejectReasons: readonly { readonly id: string; readonly name: string }[]
  readonly shifts: readonly Shift[]

  getUnit(id: string): Unit | undefined
  getLine(id: string): Line | undefined
  getMachine(id: string): Machine | undefined
  getAreas(unitId: string): Area[]
  getGateway(id: string): Gateway | undefined
  getDevice(id: string): Device | undefined
  getDevices(gatewayId: string): Device[]
  getTags(machineId: string): Tag[]
  getDowntimeReason(id: string | null): DowntimeReason | undefined

  /** Turno corrente da unidade (sem unidade: a primeira com máquinas). */
  shiftWindow(unitId?: string): JanelaTurno

  getMachinesWithLive(filter?: { unitId?: string; lineId?: string }): MachineWithLive[]
  getMachineLive(machineId: string): MachineLive | undefined
  /** Eventos de estado do turno corrente, recortados até agora. */
  getTimeline(machineId: string): StateEvent[]
  /** Produção por hora do turno corrente. */
  getHourlyProduction(machineId: string): HourlyProduction[]
  /** OEE por dia (precisa de `diasOee`). */
  getDailyOee(machineId: string, days: number): DailyOee[]
  /** Pareto dos motivos dos últimos 7 dias (precisa de `paradas`). */
  getPareto(machineIds: readonly string[]): ParetoItem[]
  /** Turnos fechados (precisa de `diasTurnos`). */
  getShiftHistory(machineIds: readonly string[], days: number): ShiftOeeRow[]
  /** Paradas por máquina, semana e motivo (precisa de `paradas`). */
  getStopRecords(machineIds: readonly string[]): StopRecord[]
  /** OEE de um conjunto de máquinas no turno: Σ(boas × ciclo ideal) ÷ Σ tempo planejado. */
  aggregateOee(list: readonly { live?: MachineLive }[]): OeeAgregado
  /** Alertas do cliente, mais novos primeiro (precisa de `notificacoes`). */
  getNotifications(): AppNotification[]
  /** Pedidos de acesso remoto (só a demonstração tem; no banco, a tela de acesso remoto é outra entrega). */
  getRemoteSessions(): RemoteAccessSession[]
  /** Quem aparece como operador no tablet da máquina. */
  operatorFor(machine: Machine): { name: string; username: string | null }
}
