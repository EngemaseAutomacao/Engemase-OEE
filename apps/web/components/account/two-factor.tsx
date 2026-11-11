"use client"

import { useId, useState } from "react"
import { CopyIcon, DownloadIcon, KeyRoundIcon, RefreshCwIcon, ShieldCheckIcon, ShieldOffIcon, SmartphoneIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import type { TwoFactorSeed } from "./account-data"
import { IllustrativeQr } from "./illustrative-qr"

const STEPS = ["Escanear", "Confirmar", "Guardar códigos"]

function newCodes(): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
  const bytes = new Uint8Array(100)
  crypto.getRandomValues(bytes)
  return Array.from({ length: 10 }, (_, i) => {
    const c = Array.from(bytes.slice(i * 10, i * 10 + 10), (b) => alphabet[b % alphabet.length]).join("")
    return `${c.slice(0, 5)}-${c.slice(5)}`
  })
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copiad${what.endsWith("s") ? "os" : "a"}`)
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.")
  }
}

function download(codes: string[], email: string) {
  const text = [
    "Engemase OEE — códigos de recuperação da verificação em 2 etapas",
    `Conta: ${email}`,
    "",
    "Cada código funciona uma única vez. Guarde em local seguro.",
    "",
    ...codes,
    "",
  ].join("\n")
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = "engemase-oee-codigos-de-recuperacao.txt"
  a.click()
  URL.revokeObjectURL(url)
}

function RecoveryCodes({ codes, email }: { codes: string[]; email: string }) {
  return (
    <div className="grid gap-3">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-muted/60 p-4 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copy(codes.join("\n"), "Códigos")}>
          <CopyIcon />
          Copiar
        </Button>
        <Button variant="outline" size="sm" onClick={() => download(codes, email)}>
          <DownloadIcon />
          Baixar .txt
        </Button>
      </div>
    </div>
  )
}

/** Assistente de ativação: QR ilustrativo → código de 6 dígitos → códigos de recuperação. */
function SetupDialog({
  open,
  onOpenChange,
  seed,
  email,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  seed: TwoFactorSeed
  email: string
  onDone: () => void
}) {
  const uid = useId()
  const [step, setStep] = useState(0)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function reset(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setStep(0)
      setCode("")
      setError(null)
      setSaved(false)
    }
  }
  function verify() {
    if (!/^\d{6}$/.test(code)) {
      setError("Digite os 6 números que aparecem no aplicativo.")
      return
    }
    setError(null)
    setStep(2)
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar aplicativo autenticador</DialogTitle>
          <DialogDescription>Google Authenticator, Microsoft Authenticator, 1Password ou outro aplicativo compatível com TOTP.</DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-xs" aria-label="Etapas">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full font-bold tabular-nums",
                  i < step ? "bg-state-running text-white" : i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-current={i === step ? "step" : undefined}
              >
                {i + 1}
              </span>
              <span className={cn("hidden truncate sm:inline", i === step ? "font-semibold" : "text-muted-foreground")}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="flex justify-center">
              <IllustrativeQr value={seed.otpauth} label="QR code ilustrativo para o aplicativo autenticador" />
            </div>
            <div className="grid gap-3 text-sm">
              <p>
                Abra o aplicativo, toque em <b>Adicionar conta</b> e escaneie o QR code.
              </p>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">Não consegue escanear? Digite a chave:</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all">{seed.secret}</code>
                  <Button variant="outline" size="icon-sm" aria-label="Copiar chave" onClick={() => copy(seed.secret.replace(/\s/g, ""), "Chave")}>
                    <CopyIcon />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Protótipo: o QR é ilustrativo e não funciona em aplicativos reais.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-code`}>Código de 6 dígitos do aplicativo</Label>
            <Input
              id={`${uid}-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                setError(null)
              }}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              aria-invalid={Boolean(error)}
              className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
              autoFocus
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">O código muda a cada 30 segundos. No protótipo, qualquer sequência de 6 números é aceita.</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <p className="text-sm">
              Se perder o celular, use um destes códigos para entrar. <b>Cada um funciona uma única vez</b> e eles não serão mostrados de novo.
            </p>
            <RecoveryCodes codes={seed.recoveryCodes} email={email} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
              Guardei os códigos em local seguro
            </label>
          </div>
        )}

        <DialogFooter>
          {step > 0 && step < 2 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              Voltar
            </Button>
          )}
          {step === 0 && <Button onClick={() => setStep(1)}>Já escaneei</Button>}
          {step === 1 && <Button onClick={verify}>Verificar</Button>}
          {step === 2 && (
            <Button
              disabled={!saved}
              onClick={() => {
                onDone()
                reset(false)
              }}
            >
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Verificação em 2 etapas: estado, ativação com QR ilustrativo e códigos de recuperação. */
export function TwoFactorCard({
  initialEnabled,
  required,
  seed,
  email,
  className,
}: {
  initialEnabled: boolean
  required: boolean
  seed: TwoFactorSeed
  email: string
  className?: string
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [setupOpen, setSetupOpen] = useState(false)
  const [codesOpen, setCodesOpen] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [remaining, setRemaining] = useState(8)

  return (
    <SectionCard
      title="Verificação em 2 etapas"
      description={required ? "Obrigatória para a equipe Engemase" : "Recomendada para administradores e engenheiros"}
      className={className}
    >
      <div className="flex items-start gap-3">
        <IconCircle icon={enabled ? ShieldCheckIcon : ShieldOffIcon} tone={enabled ? "teal" : "orange"} soft />
        <div className="min-w-0 flex-1 leading-tight">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
              enabled ? "bg-state-running/12 text-state-running" : "bg-[#e96549]/12 text-[#cf5539]",
            )}
          >
            {enabled ? "Ativa" : "Desativada"}
          </span>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {enabled
              ? "Ao entrar em um aparelho novo, pedimos o código do aplicativo autenticador além da senha."
              : "Proteja sua conta: além da senha, peça um código do celular ao entrar em um aparelho novo."}
          </p>
        </div>
      </div>

      {enabled ? (
        <div className="mt-4 grid gap-2">
          <div className="flex items-center gap-3 rounded-xl border p-3">
            <SmartphoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium">Aplicativo autenticador</span>
              <span className="block text-xs text-muted-foreground">Código de 6 dígitos (TOTP)</span>
            </span>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSetupOpen(true)}>
              Trocar
            </Button>
          </div>
          <div className="flex items-center gap-3 rounded-xl border p-3">
            <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium">Códigos de recuperação</span>
              <span className={cn("block text-xs", remaining <= 3 ? "text-state-fault" : "text-muted-foreground")}>{remaining} de 10 disponíveis</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setCodes(newCodes())
                setRemaining(10)
                setCodesOpen(true)
              }}
            >
              <RefreshCwIcon />
              Gerar novos
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-xs text-muted-foreground"
            disabled={required}
            onClick={() => {
              setEnabled(false)
              toast.success("Verificação em 2 etapas desativada", { description: "Recomendamos ativar de novo assim que possível." })
            }}
          >
            <ShieldOffIcon />
            {required ? "Não é possível desativar (obrigatória para a equipe Engemase)" : "Desativar"}
          </Button>
        </div>
      ) : (
        <Button className="mt-4 w-full sm:w-auto" onClick={() => setSetupOpen(true)}>
          <ShieldCheckIcon />
          Ativar verificação em 2 etapas
        </Button>
      )}

      <SetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        seed={seed}
        email={email}
        onDone={() => {
          const wasEnabled = enabled
          setEnabled(true)
          setRemaining(10)
          toast.success(wasEnabled ? "Novo aplicativo configurado" : "Verificação em 2 etapas ativada", {
            description: wasEnabled ? "O aplicativo anterior deixou de valer." : "Ela será pedida no próximo login em um aparelho novo.",
          })
        }}
      />

      <Dialog open={codesOpen} onOpenChange={setCodesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novos códigos de recuperação</DialogTitle>
            <DialogDescription>Os códigos anteriores deixaram de valer. Guarde estes em local seguro: eles não serão mostrados de novo.</DialogDescription>
          </DialogHeader>
          {codes && <RecoveryCodes codes={codes} email={email} />}
          <DialogFooter>
            <Button
              onClick={() => {
                setCodesOpen(false)
                toast.success("Códigos de recuperação atualizados")
              }}
            >
              Pronto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
