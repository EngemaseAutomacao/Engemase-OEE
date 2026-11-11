"use client"

import { useState } from "react"
import { BellIcon, BellRingIcon, CheckCheckIcon, CircleCheckIcon, LockIcon, MailIcon, MessageCircleIcon, ShieldAlertIcon, SlidersHorizontalIcon, SmartphoneIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import type { AlertVM, DeviceVM, ScopeUnit } from "./account-data"
import { AlertsCard, TAB_TRIGGER, TabCount } from "./alert-list"
import { ALERT_TYPE_META, SEVERITY_META, plural } from "./labels"
import { NotificationPreferences } from "./notification-preferences"
import { PushDevicesPanel } from "./push-devices"

type MainTab = "alertas" | "preferencias" | "dispositivos"

function TypeBreakdown({ alerts }: { alerts: AlertVM[] }) {
  const rows = Object.entries(
    alerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1
      return acc
    }, {}),
  )
    .map(([type, n]) => ({ type: type as AlertVM["type"], n }))
    .sort((a, b) => b.n - a.n)
  const max = Math.max(1, ...rows.map((r) => r.n))

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum alerta hoje. 👏</p>
  return (
    <ul className="grid gap-3">
      {rows.map((r) => {
        const meta = ALERT_TYPE_META[r.type]
        return (
          <li key={r.type} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
            <IconCircle icon={meta.icon} tone={SEVERITY_META[meta.severity].tone} soft size="sm" className="row-span-2" />
            <span className="truncate text-sm">{meta.label}</span>
            <span className="text-sm font-bold tabular-nums">{r.n}</span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.n / max) * 100}%` }} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function ChannelSummary({ activeDevices, email, onAdjust }: { activeDevices: number; email: string; onAdjust: () => void }) {
  const rows = [
    { icon: BellIcon, tone: "blue" as const, title: "Central no app", text: "Sempre ligada · fonte da verdade", status: "on" as const },
    {
      icon: SmartphoneIcon,
      tone: "teal" as const,
      title: "Push",
      text: activeDevices > 0 ? plural(activeDevices, "aparelho ativo", "aparelhos ativos") : "Nenhum aparelho inscrito",
      status: activeDevices > 0 ? ("on" as const) : ("off" as const),
    },
    { icon: MailIcon, tone: "navy" as const, title: "E-mail", text: email, status: "on" as const },
    { icon: MessageCircleIcon, tone: "orange" as const, title: "WhatsApp", text: "Escalonamento de críticos", status: "soon" as const },
  ]
  return (
    <SectionCard
      title="Canais de entrega"
      description="Como os alertas chegam até você"
      action={
        <button type="button" onClick={onAdjust} className="shrink-0 text-xs font-semibold text-primary hover:underline">
          Ajustar
        </button>
      }
    >
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3">
            <IconCircle icon={r.icon} tone={r.tone} soft size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium">{r.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.text}</span>
            </span>
            {r.status === "on" && <span className="rounded-full bg-state-running/12 px-2 py-px text-[11px] font-semibold text-state-running">Ligado</span>}
            {r.status === "off" && <span className="rounded-full bg-muted px-2 py-px text-[11px] font-semibold text-muted-foreground">Desligado</span>}
            {r.status === "soon" && <span className="rounded-full bg-[#e96549]/12 px-2 py-px text-[11px] font-semibold text-[#cf5539]">Em breve</span>}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Central de alertas do cliente: indicadores, abas Alertas / Preferências / Dispositivos. */
export function AlertCenter({
  alerts: initial,
  units,
  scope,
  devices,
  user,
  clientName,
}: {
  alerts: AlertVM[]
  units: { id: string; name: string }[]
  scope: ScopeUnit[]
  devices: DeviceVM[]
  user: { name: string; email: string; isPlatform: boolean }
  clientName: string
}) {
  const [tab, setTab] = useState<MainTab>("alertas")
  const [alerts, setAlerts] = useState(initial)

  const open = alerts.filter((a) => a.status === "open")
  const criticalOpen = open.filter((a) => a.severity === "critical").length
  const acknowledged = alerts.filter((a) => a.status === "acknowledged").length
  const resolved = alerts.filter((a) => a.status === "resolved").length
  const activeDevices = devices.filter((d) => d.status === "active").length

  function acknowledge(a: AlertVM) {
    setAlerts((l) => l.map((x) => (x.id === a.id ? { ...x, status: "acknowledged", read: true, acknowledgedBy: user.name } : x)))
    toast.success("Alerta reconhecido", {
      description: user.isPlatform
        ? `Registrado na auditoria de ${clientName} como equipe Engemase. Os demais destinatários veem quem reconheceu.`
        : "Os demais destinatários veem que você está cuidando disso.",
      action: { label: "Desfazer", onClick: () => setAlerts((l) => l.map((x) => (x.id === a.id ? a : x))) },
    })
  }
  function markRead(a: AlertVM) {
    setAlerts((l) => l.map((x) => (x.id === a.id ? { ...x, read: true } : x)))
  }
  function readAll() {
    setAlerts((l) => l.map((x) => ({ ...x, read: true })))
    toast.success("Todas as notificações foram marcadas como lidas")
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BellRingIcon} tone="blue" label="Alertas abertos" value={open.length} hint={open.length ? `${open.filter((a) => !a.read).length} não lidos` : "Nada pendente"} />
        <StatCard
          icon={ShieldAlertIcon}
          tone="orange"
          label="Críticos sem reconhecimento"
          value={criticalOpen}
          hint={criticalOpen ? "Escalonam em 15 min" : "Nenhum crítico esperando"}
          className={cn(criticalOpen > 0 && "ring-1 ring-state-fault/25")}
        />
        <StatCard icon={CheckCheckIcon} tone="navy" label="Reconhecidos" value={acknowledged} hint="Em atendimento" />
        <StatCard icon={CircleCheckIcon} tone="teal" label="Resolvidos hoje" value={resolved} hint="Manual ou automaticamente" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-10 w-max rounded-xl border bg-card p-1 shadow-xs">
            <TabsTrigger value="alertas" className={TAB_TRIGGER}>
              <BellIcon />
              Alertas
              <TabCount n={open.length} strong={open.length > 0} />
            </TabsTrigger>
            <TabsTrigger value="preferencias" className={TAB_TRIGGER}>
              <SlidersHorizontalIcon />
              Preferências
            </TabsTrigger>
            <TabsTrigger value="dispositivos" className={TAB_TRIGGER}>
              <SmartphoneIcon />
              Dispositivos
              <TabCount n={activeDevices} />
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="alertas" forceMount className="data-[state=inactive]:hidden">
          <div className="grid gap-4 xl:grid-cols-12">
            <AlertsCard alerts={alerts} units={units} onAck={acknowledge} onOpen={markRead} onReadAll={readAll} className="xl:col-span-8" />
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
              <SectionCard title="Alertas por tipo" description="Hoje, em todas as situações">
                <TypeBreakdown alerts={alerts} />
              </SectionCard>
              <ChannelSummary activeDevices={activeDevices} email={user.email} onAdjust={() => setTab("preferencias")} />
              <div className="flex items-start gap-3 rounded-2xl border border-dashed p-4 text-xs text-muted-foreground">
                <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Você só vê alertas de máquinas e gateways dentro do seu acesso. Reconhecer avisa os outros destinatários e interrompe o escalonamento; o alerta é
                  resolvido sozinho quando a condição some.
                </p>
              </div>
              <Button variant="outline" className="xl:hidden" onClick={() => setTab("dispositivos")}>
                <SmartphoneIcon />
                Receber no celular
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="preferencias" forceMount className="data-[state=inactive]:hidden">
          <NotificationPreferences scope={scope} isPlatform={user.isPlatform} email={user.email} clientName={clientName} />
        </TabsContent>

        <TabsContent value="dispositivos" forceMount className="data-[state=inactive]:hidden">
          <PushDevicesPanel devices={devices} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
