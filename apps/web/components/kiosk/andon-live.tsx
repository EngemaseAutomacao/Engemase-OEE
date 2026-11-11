"use client"

import { useEffect, useState } from "react"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { duration } from "@/lib/format"
import { useMockClock } from "@/components/kiosk/use-mock-clock"

/** Relógio grande da TV (HH:MM:SS + data por extenso), avançando a partir do "agora" simulado. */
export function AndonClock({ timeZone, className }: { timeZone: string; className?: string }) {
  const { now } = useMockClock(1000)
  const d = new Date(now)
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })
  const ss = d.toLocaleTimeString("pt-BR", { second: "2-digit", timeZone }).padStart(2, "0")
  const day = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone })
  return (
    <div className={cn("leading-none", className)}>
      <div className="font-bold tracking-tight tabular-nums" suppressHydrationWarning>
        <time className="text-[clamp(2.75rem,4.6vw,6rem)]">{hm}</time>
        <span className="ml-0.5 text-[clamp(1.25rem,2vw,2.5rem)] text-muted-foreground">:{ss}</span>
      </div>
      <div className="mt-2 text-[clamp(1rem,1.15vw,1.5rem)] text-muted-foreground first-letter:uppercase" suppressHydrationWarning>
        {day}
      </div>
    </div>
  )
}

/** "há 12 min" que continua contando na TV. */
export function LiveSince({ since, prefix = "há " }: { since: string; prefix?: string }) {
  const { now } = useMockClock(15_000)
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {prefix}
      {duration((now - Date.parse(since)) / 1000)}
    </span>
  )
}

/** Botão de tela cheia (na TV costuma ficar ligado; útil ao abrir num computador). */
export function FullscreenButton({ className }: { className?: string }) {
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  return (
    <button
      type="button"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen?.()
      }}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {full ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}
      {full ? "Sair da tela cheia" : "Tela cheia"}
    </button>
  )
}
