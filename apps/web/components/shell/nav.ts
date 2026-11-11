import {
  ActivityIcon,
  BarChart3Icon,
  BoxIcon,
  Building2Icon,
  ClipboardListIcon,
  ClockIcon,
  CpuIcon,
  FactoryIcon,
  GaugeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MonitorIcon,
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
export function clientNav(slug: string): NavGroup[] {
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
        { title: "Tela do operador", href: `${b}/operador/mch_inj01`, icon: TabletSmartphoneIcon },
        { title: "TV / Andon", href: `${b}/andon/lin_injA`, icon: MonitorIcon },
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
        { title: "Auditoria", href: `${b}/config/auditoria`, icon: HistoryIcon },
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
