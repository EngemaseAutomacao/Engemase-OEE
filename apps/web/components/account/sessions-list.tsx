"use client"

import { useState } from "react"
import { LogOutIcon, MapPinIcon } from "lucide-react"
import { toast } from "sonner"

import { SectionCard } from "@/components/dashboard/section-card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import type { SessionVM } from "./account-data"
import { plural } from "./labels"
import { DeviceIcon } from "./push-devices"

/** Sessões de login abertas, com "encerrar" individual e "encerrar as outras". */
export function SessionsList({ sessions: initial }: { sessions: SessionVM[] }) {
  const [sessions, setSessions] = useState(initial)
  const others = sessions.filter((s) => !s.current)

  function end(s: SessionVM) {
    setSessions((l) => l.filter((x) => x.id !== s.id))
    toast.success("Sessão encerrada", { description: `${s.title} (${s.place}) precisa entrar de novo.` })
  }
  function endOthers() {
    const n = others.length
    setSessions((l) => l.filter((x) => x.current))
    toast.success(`${plural(n, "sessão encerrada", "sessões encerradas")}`, { description: "Só este navegador continua conectado." })
  }

  return (
    <SectionCard
      title="Sessões ativas"
      description={`${plural(sessions.length, "aparelho conectado", "aparelhos conectados")} · sessões sem uso por 30 dias expiram sozinhas`}
      action={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-state-fault hover:text-state-fault" disabled={others.length === 0}>
              <LogOutIcon className="size-3.5" />
              <span className="hidden sm:inline">Encerrar as outras</span>
              <span className="sm:hidden">Outras</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Encerrar as outras sessões?</AlertDialogTitle>
              <AlertDialogDescription>
                {plural(others.length, "aparelho vai", "aparelhos vão")} precisar entrar de novo com senha e verificação em 2 etapas. Use se perdeu um aparelho ou
                entrou em um computador compartilhado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={endOthers}>
                Encerrar sessões
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    >
      <ul className="divide-y">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <DeviceIcon kind={s.kind} />
            <div className="min-w-0 flex-1 basis-52 leading-tight">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium">{s.title}</span>
                {s.current && <span className="rounded-full bg-primary/10 px-2 py-px text-[11px] font-semibold text-primary">Este navegador</span>}
              </div>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPinIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">
                  {s.place} · IP {s.ip}
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                Entrou em {s.started} · {s.current ? <span className="font-medium text-state-running">ativa agora</span> : `último uso ${s.lastActive}`}
              </span>
            </div>
            {!s.current && (
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => end(s)}>
                <LogOutIcon />
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
