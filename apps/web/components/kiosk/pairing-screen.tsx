"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2Icon, LoaderCircleIcon, QrCodeIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/shell/brand"
import { NumericKeypad } from "@/components/kiosk/numeric-keypad"

/** Demonstração: 6 dígitos. Sistema real: 8 dígitos (`generatePairingCode`). */
const DEMO_LENGTH = 6
const REAL_LENGTH = 8

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "error"; message: string } | { kind: "paired"; terminalId: string; name: string }

/**
 * Pareamento do aparelho: digita o código gerado em Configurações → Terminais.
 * Real (`pair`): Server Action com uso único, 10 min e limite de tentativas → cookie de aparelho só em /terminal.
 */
export function PairingScreen({
  pending,
  pair,
}: {
  pending: { terminalId: string; name: string; code: string }[]
  /** Sistema real: confere o código no servidor e grava o cookie do aparelho. */
  pair?: (code: string) => Promise<{ ok: true } | { ok: false; mensagem: string }>
}) {
  const router = useRouter()
  const LENGTH = pair ? REAL_LENGTH : DEMO_LENGTH
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const busy = status.kind === "checking" || status.kind === "paired"

  const type = (d: string) => {
    if (busy) return
    setStatus({ kind: "idle" })
    setCode((c) => (c.length < LENGTH ? c + d : c))
  }
  const back = () => !busy && setCode((c) => c.slice(0, -1))
  const clear = () => !busy && (setCode(""), setStatus({ kind: "idle" }))

  const submit = () => {
    if (code.length !== LENGTH || busy) return
    setStatus({ kind: "checking" })
    if (pair) {
      pair(code)
        .then((r) => {
          if (!r.ok) {
            setStatus({ kind: "error", message: r.mensagem })
            setCode("")
            return
          }
          setStatus({ kind: "paired", terminalId: "", name: "Aparelho" })
          window.setTimeout(() => {
            router.replace("/terminal")
            router.refresh()
          }, 1200)
        })
        .catch(() => setStatus({ kind: "error", message: "Sem conexão com o servidor. Confira a rede e tente de novo." }))
      return
    }
    window.setTimeout(() => {
      const hit = pending.find((p) => p.code === code)
      if (!hit) {
        setStatus({ kind: "error", message: "Código inválido ou vencido. Confira os números ou peça um código novo (vale 10 minutos)." })
        setCode("")
        return
      }
      setStatus({ kind: "paired", terminalId: hit.terminalId, name: hit.name })
      window.setTimeout(() => router.push(`/terminal/${hit.terminalId}`), 1600)
    }, 900)
  }

  // Teclado físico (TV com teclado USB, tablet com teclado Bluetooth).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) type(e.key)
      else if (e.key === "Backspace") back()
      else if (e.key === "Escape") clear()
      else if (e.key === "Enter") submit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="dark relative isolate hidden flex-col justify-between overflow-hidden bg-[#13263b] p-10 text-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_0%_0%,rgba(37,123,180,0.38),transparent),radial-gradient(55%_45%_at_100%_100%,rgba(233,101,73,0.18),transparent)]"
        />
        <BrandLogo variant="selo" width={88} priority className="rounded-full shadow-lg ring-4 ring-white/10" />
        <div className="max-w-md">
          <h2 className="text-3xl font-bold tracking-tight text-white">Parear TV ou tablet</h2>
          <ol className="mt-6 grid gap-4 text-base text-muted-foreground">
            <li>
              <span className="font-semibold text-white">1.</span> Um administrador abre <strong className="text-white">Configurações → Terminais</strong> e
              escolhe o que este aparelho vai mostrar.
            </li>
            <li>
              <span className="font-semibold text-white">2.</span> A plataforma mostra um código de 6 dígitos, válido por 10 minutos e de uso único.
            </li>
            <li>
              <span className="font-semibold text-white">3.</span> Digite o código aqui. O aparelho passa a abrir direto na tela da linha ou da máquina.
            </li>
          </ol>
        </div>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
          Terminal não é conta de pessoa: o aparelho recebe um token próprio, que pode ser revogado a qualquer momento.
        </p>
      </section>

      <section className="flex flex-col items-center justify-center gap-6 px-4 py-8">
        <BrandLogo width={112} priority className="lg:hidden" />
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold tracking-tight">Digite o código de pareamento</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerado em Configurações → Terminais</p>
        </div>

        {status.kind === "paired" ? (
          <div className="grid w-full max-w-sm justify-items-center gap-3 rounded-2xl border bg-card p-6 text-center" role="status">
            <CheckCircle2Icon className="size-12 text-state-running" />
            <div className="text-lg font-semibold">Pareado como {status.name}</div>
            <p className="text-sm text-muted-foreground">Abrindo a tela…</p>
            <Button asChild variant="outline">
              <Link href={`/terminal/${status.terminalId}`}>Abrir agora</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2" aria-label={`Código digitado: ${code.split("").join(" ") || "vazio"}`} aria-live="polite">
              {Array.from({ length: LENGTH }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex items-center justify-center rounded-xl border-2 bg-card font-mono font-bold tabular-nums",
                    // 8 casas cabem no celular (390 px) com casas menores; 6 mantêm o tamanho do protótipo.
                    LENGTH > 6 ? "h-14 w-9 text-2xl sm:h-[72px] sm:w-12 sm:text-3xl" : "h-16 w-12 text-3xl sm:h-[72px] sm:w-14",
                    i === code.length && !busy ? "border-primary" : "border-border",
                    status.kind === "error" && "border-destructive/60",
                    i === LENGTH / 2 - 1 && "mr-3",
                  )}
                >
                  {code[i] ?? ""}
                </span>
              ))}
            </div>
            <p className={cn("min-h-10 max-w-sm text-center text-sm", status.kind === "error" ? "text-destructive" : "text-muted-foreground")} role="alert">
              {status.kind === "error" ? status.message : "Use o teclado abaixo ou o teclado do aparelho."}
            </p>
            <NumericKeypad onDigit={type} onBackspace={back} onClear={clear} className="w-full max-w-sm" />
            <div className="grid w-full max-w-sm gap-2">
              <Button size="lg" className="h-14 text-lg" disabled={code.length !== LENGTH || busy} onClick={submit}>
                {status.kind === "checking" && <LoaderCircleIcon className="animate-spin" />}
                Parear
              </Button>
              <Button
                variant="ghost"
                onClick={() => toast.info("Leitura de QR", { description: "Protótipo: a câmera do aparelho não está disponível aqui." })}
              >
                <QrCodeIcon />
                Ler QR com a câmera
              </Button>
            </div>
            {pending.length > 0 && (
              <p className="text-xs text-muted-foreground">Protótipo: experimente o código {pending[0].code.replace(/(\d{3})(\d{3})/, "$1 $2")}.</p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
