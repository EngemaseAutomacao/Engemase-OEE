import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  BoxIcon,
  Building2Icon,
  ClipboardListIcon,
  ClockIcon,
  CpuIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  PaletteIcon,
  FactoryIcon,
  GaugeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  RouterIcon,
  ShieldCheckIcon,
  TabletSmartphoneIcon,
  TagsIcon,
  UsersIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /** Rota exata (sem prefixo) para destacar como ativa. */
  exact?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Menu da área do cliente. `href` é relativo a /[cliente]. */
export function clientNav(slug: string, kiosk: { machineId?: string; lineId?: string } = {}): NavGroup[] {
  const b = `/${slug}`
  return [
    {
      label: "Monitoramento",
      items: [
        { title: "Visão geral", href: b, icon: LayoutDashboardIcon, exact: true },
        { title: "Máquinas", href: `${b}/maquinas`, icon: GaugeIcon },
      ],
    },
    {
      label: "Análise",
      items: [
        { title: "Relatório de OEE", href: `${b}/relatorios/oee`, icon: BarChart3Icon },
        { title: "Paradas (Pareto)", href: `${b}/relatorios/paradas`, icon: ActivityIcon },
      ],
    },
    {
      label: "Chão de fábrica",
      items: [
        ...(kiosk.machineId ? [{ title: "Tela do operador", href: `${b}/operador/${kiosk.machineId}`, icon: TabletSmartphoneIcon }] : []),
        ...(kiosk.lineId ? [{ title: "TV / Andon", href: `${b}/andon/${kiosk.lineId}`, icon: MonitorIcon }] : []),
        { title: "Notificações", href: `${b}/notificacoes`, icon: BellIcon },
      ],
    },
    {
      label: "Configurações",
      items: [
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
    },
    {
      label: "Suporte",
      items: [
        { title: "Acesso remoto", href: `${b}/acesso-remoto`, icon: KeyRoundIcon },
        { title: "Central de ajuda", href: `${b}/ajuda`, icon: LifeBuoyIcon },
      ],
    },
  ]
}

/** Menu do console da plataforma (equipe Engemase). */
export const adminNav: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { title: "Visão geral", href: "/admin", icon: LayoutDashboardIcon, exact: true },
      { title: "Clientes", href: "/admin/clientes", icon: Building2Icon },
      { title: "Frota de gateways", href: "/admin/gateways", icon: CpuIcon },
      { title: "Acesso remoto", href: "/admin/acesso-remoto", icon: KeyRoundIcon },
    ],
  },
  {
    label: "Administração",
    items: [
      { title: "Equipe Engemase", href: "/admin/usuarios", icon: ShieldCheckIcon },
      { title: "Auditoria", href: "/admin/auditoria", icon: ClipboardListIcon },
    ],
  },
]
