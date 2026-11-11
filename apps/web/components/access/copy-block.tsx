"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Bloco de comando de terminal com botão de copiar. */
export function CopyBlock({ code, prompt = "$", className }: { code: string; prompt?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    const ok = await copyText(code)
    if (ok) {
      setCopied(true)
      toast.success("Comando copiado")
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      toast.error("Não foi possível copiar", { description: "Selecione o texto e copie manualmente." })
    }
  }
  return (
    <div className={cn("group/copy relative flex items-start gap-2 rounded-md border bg-zinc-950 py-2.5 pr-11 pl-3 text-zinc-100 dark:bg-black/40", className)}>
      <span aria-hidden className="font-mono text-xs leading-5 text-zinc-500 select-none">
        {prompt}
      </span>
      <code className="min-w-0 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{code}</code>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={onCopy}
        aria-label="Copiar comando"
        className="absolute top-2 right-2 text-zinc-400 hover:bg-white/10 hover:text-white"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

/** Código curto em destaque (ativação, PIN) com botão de copiar. */
export function CopyCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      toast.success(`${label} copiado`)
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      toast.error("Não foi possível copiar")
    }
  }
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="rounded-md border bg-muted/60 px-3 py-1.5 font-mono text-xl font-semibold tracking-[0.18em] tabular-nums sm:text-2xl">{value}</span>
      <Button type="button" variant="outline" size="icon-sm" onClick={onCopy} aria-label={`Copiar ${label.toLowerCase()}`}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
