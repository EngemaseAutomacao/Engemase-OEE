"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  BellOffIcon,
  BellRingIcon,
  CheckIcon,
  LaptopIcon,
  MinusIcon,
  MonitorIcon,
  SendIcon,
  ShareIcon,
  SmartphoneIcon,
  SquarePlusIcon,
  TabletIcon,
  Trash2Icon,
  TvIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

import type { DeviceVM } from "./account-data"
import type { DeviceKind } from "./account-fixtures"
import { PERMISSION_LABEL, usePush } from "./use-push"

const KIND_ICON: Record<DeviceKind, { icon: LucideIcon; tone: IconTone }> = {
  laptop: { icon: LaptopIcon, tone: "navy" },
  desktop: { icon: MonitorIcon, tone: "navy" },
  phone: { icon: SmartphoneIcon, tone: "teal" },
  tablet: { icon: TabletIcon, tone: "orange" },
}

export function DeviceIcon({ kind, size = "md" }: { kind: DeviceKind; size?: "sm" | "md" }) {
  const k = KIND_ICON[kind]
  return <IconCircle icon={k.icon} tone={k.tone} soft size={size} />
}

// ---------------------------------------------------------------------------
// Passo a passo do iPhone/iPad
// ---------------------------------------------------------------------------
const IOS_STEPS: { title: React.ReactNode; hint: string }[] = [
  { title: "Abra a plataforma no Safari", hint: "O Chrome do iPhone não permite instalar o app." },
  {
    title: (
      <>
        Toque em <b>Compartilhar</b> <ShareIcon className="inline size-3.5 align-[-2px]" aria-label="ícone Compartilhar" />
      </>
    ),
    hint: "Fica na barra inferior (no iPad, no canto superior direito).",
  },
  {
    title: (
      <>
        Escolha <b>Adicionar à Tela de Início</b> <SquarePlusIcon className="inline size-3.5 align-[-2px]" aria-hidden />
      </>
    ),
    hint: "Role a lista de opções se não aparecer de primeira e confirme em “Adicionar”.",
  },
  { title: "Abra pelo ícone Engemase OEE", hint: "Entre com seu e-mail e toque em “Ativar notificações neste dispositivo”." },
]

export function IosSteps({ className }: { className?: string }) {
  return (
    <ol className={cn("grid gap-3", className)}>
      {IOS_STEPS.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums">{i + 1}</span>
          <span className="min-w-0 pt-0.5 leading-tight">
            <span className="block text-sm font-medium">{s.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function IosInstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notificações no iPhone e no iPad</DialogTitle>
          <DialogDescription>
            A Apple só entrega notificações de sites para apps instalados na Tela de Início (iOS e iPadOS 16.4 ou mais recente). Leva menos de um minuto:
          </DialogDescription>
        </DialogHeader>
        <IosSteps className="py-1" />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Este dispositivo
// ---------------------------------------------------------------------------
const TONE_CLASS = {
  ok: "bg-state-running/12 text-state-running",
  warn: "bg-state-fault/12 text-state-fault",
  off: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  muted: "bg-muted text-muted-foreground",
} as const

/** Botão "Ativar notificações neste dispositivo" (pede a permissão só no clique e envia um teste). */
export function EnablePushButton({ className, size = "default" }: { className?: string; size?: "default" | "sm" }) {
  const [iosOpen, setIosOpen] = useState(false)
  const { permission, busy, enable, test } = usePush({ onIosInstall: () => setIosOpen(true) })
  const granted = permission === "granted"
  return (
    <>
      <Button size={size} className={className} disabled={busy} variant={granted ? "outline" : "default"} onClick={granted ? test : enable}>
        {busy ? <Spinner /> : granted ? <SendIcon /> : <BellRingIcon />}
        {granted ? "Enviar notificação de teste" : "Ativar notificações neste dispositivo"}
      </Button>
      <IosInstallDialog open={iosOpen} onOpenChange={setIosOpen} />
    </>
  )
}

export function ThisDeviceCard({ className }: { className?: string }) {
  const [iosOpen, setIosOpen] = useState(false)
  const { permission, busy, enable, test } = usePush({ onIosInstall: () => setIosOpen(true) })
  const meta = PERMISSION_LABEL[permission]
  const granted = permission === "granted"

  return (
    <SectionCard title="Este dispositivo" description="O navegador que você está usando agora" className={className}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <IconCircle icon={granted ? BellRingIcon : BellOffIcon} tone={granted ? "teal" : "slate"} size="lg" />
        <div className="min-w-0 flex-1">
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", TONE_CLASS[meta.tone])}>{meta.label}</span>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {meta.hint ||
              "Receba os alertas das suas máquinas mesmo com a plataforma fechada. A central (o sino) continua sendo a fonte da verdade: tudo fica registrado lá."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {granted ? (
            <Button variant="outline" onClick={test}>
              <SendIcon />
              Enviar teste
            </Button>
          ) : (
            <Button onClick={enable} disabled={busy || permission === "denied"}>
              {busy ? <Spinner /> : <BellRingIcon />}
              Ativar notificações neste dispositivo
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setIosOpen(true)}>
            <SmartphoneIcon />
            Usa iPhone ou iPad?
          </Button>
        </div>
      </div>
      <IosInstallDialog open={iosOpen} onOpenChange={setIosOpen} />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Dispositivos inscritos
// ---------------------------------------------------------------------------
export function DeviceList({ devices: initial }: { devices: DeviceVM[] }) {
  const [devices, setDevices] = useState(initial)

  function remove(d: DeviceVM) {
    setDevices((l) => l.filter((x) => x.id !== d.id))
    toast.success(`${d.name} não recebe mais notificações`, {
      action: { label: "Desfazer", onClick: () => setDevices((l) => (l.some((x) => x.id === d.id) ? l : [...l, d])) },
    })
  }

  if (devices.length === 0) {
    return (
      <Empty className="border border-dashed py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellOffIcon />
          </EmptyMedia>
          <EmptyTitle className="text-base">Nenhum aparelho inscrito</EmptyTitle>
          <EmptyDescription>Ative as notificações no celular ou no computador para receber os alertas fora da plataforma.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="divide-y">
      {devices.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
          <DeviceIcon kind={d.kind} />
          <div className="min-w-0 flex-1 basis-48 leading-tight">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium">{d.name}</span>
              {d.status === "active" ? (
                <span className="rounded-full bg-state-running/12 px-2 py-px text-[11px] font-semibold text-state-running">Ativo</span>
              ) : (
                <span className="rounded-full bg-state-stopped/15 px-2 py-px text-[11px] font-semibold text-amber-700 dark:text-state-stopped">Inscrição expirada</span>
              )}
            </div>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.detail}</span>
            <span className="block text-xs text-muted-foreground">
              {d.status === "active" ? `Inscrito em ${d.created} · visto ${d.lastSeen}` : `Visto ${d.lastSeen} · abra o app nesse aparelho para renovar`}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={d.status !== "active"}
              onClick={() => toast.success(`Notificação de teste enviada para ${d.name}`)}
              aria-label={`Enviar teste para ${d.name}`}
              title="Enviar teste"
              className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-40"
            >
              <SendIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => remove(d)}
              aria-label={`Remover ${d.name}`}
              title="Remover"
              className="flex size-8 items-center justify-center rounded-lg bg-state-fault/10 text-state-fault transition hover:bg-state-fault/20"
            >
              <Trash2Icon className="size-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Onde funciona (docs/13)
// ---------------------------------------------------------------------------
const SUPPORT: { name: string; note: string; ok: boolean | "partial"; icon: LucideIcon }[] = [
  { name: "Chrome e Edge no computador", note: "Com o navegador aberto", ok: true, icon: LaptopIcon },
  { name: "Android (Chrome)", note: "O caminho mais confiável no celular", ok: true, icon: SmartphoneIcon },
  { name: "Firefox e Safari no Mac", note: "Computador e Android", ok: true, icon: MonitorIcon },
  { name: "iPhone e iPad", note: "Só com o app na Tela de Início (16.4+)", ok: "partial", icon: TabletIcon },
  { name: "TV Andon", note: "Não usa push: alarme visual e sonoro na tela", ok: false, icon: TvIcon },
]

export function PlatformSupport() {
  return (
    <ul className="grid gap-2.5">
      {SUPPORT.map((s) => (
        <li key={s.name} className="flex items-center gap-3">
          <s.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm">{s.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{s.note}</span>
          </span>
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              s.ok === true ? "bg-state-running/12 text-state-running" : s.ok === "partial" ? "bg-state-stopped/15 text-amber-700 dark:text-state-stopped" : "bg-muted text-muted-foreground",
            )}
            aria-label={s.ok === true ? "Funciona" : s.ok === "partial" ? "Funciona com condição" : "Não se aplica"}
          >
            {s.ok === false ? <MinusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Aba completa "Dispositivos" (Notificações) — também reaproveitada em Minha conta. */
export function PushDevicesPanel({ devices }: { devices: DeviceVM[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
        <ThisDeviceCard />
        <SectionCard title="Aparelhos inscritos" description="Recebem push dos alertas que você escolheu nas preferências">
          <DeviceList devices={devices} />
        </SectionCard>
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
        <SectionCard title="iPhone e iPad" description="Instale o app na Tela de Início para receber notificações">
          <IosSteps />
          <p className="mt-4 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
            Para o tablet do operador, prefira <b className="text-foreground">Android</b>: no iPad o app instalado não mantém a tela acesa.
          </p>
        </SectionCard>
        <SectionCard title="Onde funciona" description="Push é um canal de entrega; a central guarda tudo">
          <PlatformSupport />
        </SectionCard>
      </div>
    </div>
  )
}
