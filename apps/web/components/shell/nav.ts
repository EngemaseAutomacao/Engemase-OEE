import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  BoxIcon,
  Building2Icon,
  ClipboardListIcon,
  ClockIcon,
  CpuIcon,
  FactoryIcon,
  GaugeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  type LucideIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  PackageXIcon,
  PaletteIcon,
  PlusCircleIcon,
  RouterIcon,
  ShieldCheckIcon,
  TabletSmartphoneIcon,
  TagsIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /** Rota exata (sem prefixo) para destacar como ativa. */
  exact?: boolean
}

export interface NavModel {
  main: NavItem[]
  /** Itens agrupados no submenu recolhível "Configurações". */
  config: NavItem[]
  quick: NavItem[]
}

/** Menu da área do cliente. */
export function clientNav(slug: string, kiosk: { machineId?: string; lineId?: string } = {}): NavModel {
  const b = `/${slug}`
  return {
    main: [
      { title: "Visão geral", href: b, icon: LayoutDashboardIcon, exact: true },
      { title: "Máquinas", href: `${b}/maquinas`, icon: GaugeIcon },
      { title: "Relatório de OEE", href: `${b}/relatorios/oee`, icon: BarChart3Icon },
      { title: "Paradas", href: `${b}/relatorios/paradas`, icon: ActivityIcon },
      { title: "Notificações", href: `${b}/notificacoes`, icon: BellIcon },
      ...(kiosk.machineId ? [{ title: "Tela do operador", href: `${b}/operador/${kiosk.machineId}`, icon: TabletSmartphoneIcon }] : []),
      ...(kiosk.lineId ? [{ title: "TV / Andon", href: `${b}/andon/${kiosk.lineId}`, icon: MonitorIcon }] : []),
      { title: "Acesso remoto", href: `${b}/acesso-remoto`, icon: KeyRoundIcon },
    ],
    config: [
      { title: "Unidades e linhas", href: `${b}/config/unidades`, icon: Building2Icon },
      { title: "Máquinas", href: `${b}/config/maquinas`, icon: FactoryIcon },
      { title: "Gateways", href: `${b}/config/gateways`, icon: RouterIcon },
      { title: "Produtos", href: `${b}/config/produtos`, icon: BoxIcon },
      { title: "Turnos", href: `${b}/config/turnos`, icon: ClockIcon },
      { title: "Motivos de parada", href: `${b}/config/motivos`, icon: TagsIcon },
      { title: "Usuários", href: `${b}/config/usuarios`, icon: UsersIcon },
      { title: "Terminais (TV/tablet)", href: `${b}/config/terminais`, icon: MonitorSmartphoneIcon },
      { title: "Aparência", href: `${b}/config/aparencia`, icon: PaletteIcon },
      { title: "Auditoria", href: `${b}/config/auditoria`, icon: HistoryIcon },
    ],
    quick: [
      ...(kiosk.machineId ? [{ title: "Classificar parada", href: `${b}/operador/${kiosk.machineId}`, icon: ClipboardListIcon }] : []),
      ...(kiosk.machineId ? [{ title: "Lançar refugo", href: `${b}/operador/${kiosk.machineId}`, icon: PackageXIcon }] : []),
      { title: "Nova máquina", href: `${b}/config/maquinas/nova`, icon: PlusCircleIcon },
      { title: "Adicionar usuário", href: `${b}/config/usuarios`, icon: UserPlusIcon },
      { title: "Abrir chamado", href: `${b}/ajuda`, icon: LifeBuoyIcon },
    ],
  }
}

/** Menu do console da plataforma (equipe Engemase). */
export const adminNav: NavModel = {
  main: [
    { title: "Visão geral", href: "/admin", icon: LayoutDashboardIcon, exact: true },
    { title: "Clientes", href: "/admin/clientes", icon: Building2Icon },
    { title: "Frota de gateways", href: "/admin/gateways", icon: CpuIcon },
    { title: "Acesso remoto", href: "/admin/acesso-remoto", icon: KeyRoundIcon },
    { title: "Equipe Engemase", href: "/admin/usuarios", icon: ShieldCheckIcon },
    { title: "Auditoria", href: "/admin/auditoria", icon: ClipboardListIcon },
  ],
  config: [],
  quick: [
    { title: "Novo cliente", href: "/admin/clientes/novo", icon: PlusCircleIcon },
    { title: "Provisionar gateway", href: "/admin/gateways", icon: RouterIcon },
    { title: "Adicionar membro", href: "/admin/usuarios", icon: UserPlusIcon },
  ],
}
