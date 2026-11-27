"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2Icon, CopyIcon, KeyRoundIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react"
import { toast } from "sonner"

import { confirmTwoFactorSetupAction, disableTwoFactorAction, startTwoFactorSetupAction } from "@/app/conta/seguranca/actions"
import type { QrDrawing } from "@/lib/qr"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { MfaCodeInput } from "@/components/support/mfa-code-input"

import { QrCode } from "./qr-code"

type Step =
  | { readonly kind: "password" }
  | {
      readonly kind: "scan"
      readonly totpURI: string
      readonly qr: QrDrawing
      readonly secret: string
      readonly backupCodes: readonly string[]
    }
  | { readonly kind: "codes"; readonly backupCodes: readonly string[] }

/** Agrupa a chave em blocos de 4 para digitar no aplicativo. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim()
}

/**
 * Verificação em duas etapas, opcional. Ativar em três passos: senha atual → QR code para o
 * aplicativo autenticador (ou a chave, para digitar) + código de confirmação → 10 códigos de
 * recuperação (mostrados uma vez só). Quem já ativou pode desativar com a senha atual.
 */
export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ kind: "password" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [disabling, setDisabling] = useState(false)

  async function disable(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await disableTwoFactorAction({ password })
      if (result.status === "ok") {
        setPassword("")
        setDisabling(false)
        toast.success("Verificação em duas etapas desativada")
        router.refresh()
      } else setError(result.message)
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.")
    }
    setPending(false)
  }

  if (enabled && step.kind === "password") {
    return (
      <div className="grid max-w-xl gap-5">
        <Alert className="border-primary/20 bg-primary/5">
          <CheckCircle2Icon className="text-primary" />
          <AlertTitle>Verificação em duas etapas ativa</AlertTitle>
          <AlertDescription>
            Todo login pede o código do aplicativo autenticador. Perdeu o celular e os códigos de recuperação? Peça ao administrador da
            sua empresa (ou ao suporte Engemase, se você é administrador) para reiniciar a verificação.
          </AlertDescription>
        </Alert>
        {disabling ? (
          <form onSubmit={disable} noValidate className="grid max-w-md gap-5">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="twofa-disable-password">Senha atual</FieldLabel>
              <Input
                id="twofa-disable-password"
                type="password"
                autoComplete="current-password"
                className="h-11"
                value={password}
                onChange={(e) => {
                  setError(null)
                  setPassword(e.target.value)
                }}
                aria-invalid={Boolean(error)}
                autoFocus
              />
              <FieldDescription>Sem a verificação, o login volta a pedir só o e-mail e a senha.</FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" size="lg" className="h-11" disabled={pending || password === ""}>
                {pending ? <Spinner aria-label="Carregando" /> : <ShieldOffIcon />}
                Desativar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11"
                disabled={pending}
                onClick={() => {
                  setDisabling(false)
                  setPassword("")
                  setError(null)
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" size="lg" className="h-11 w-fit" onClick={() => setDisabling(true)}>
            <ShieldOffIcon />
            Desativar a verificação em duas etapas
          </Button>
        )}
      </div>
    )
  }

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await startTwoFactorSetupAction({ password })
      if (result.status === "ok") {
        setPassword("")
        setStep({ kind: "scan", totpURI: result.totpURI, qr: result.qr, secret: result.secret, backupCodes: result.backupCodes })
      } else setError(result.message)
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.")
    }
    setPending(false)
  }

  async function verifyCode(value: string) {
    if (step.kind !== "scan" || pending) return
    const clean = value.replace(/\D/g, "")
    if (clean.length !== 6) {
      setError("Informe o código de 6 dígitos.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await confirmTwoFactorSetupAction({ code: clean })
      if (result.status === "ok") {
        setStep({ kind: "codes", backupCodes: step.backupCodes })
        setPending(false)
        return
      }
      setError(result.message)
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.")
    }
    setPending(false)
    setCode("")
    setAttempt((n) => n + 1)
  }

  function confirm(e: React.FormEvent) {
    e.preventDefault()
    void verifyCode(code)
  }

  if (step.kind === "password") {
    return (
      <form onSubmit={start} noValidate className="grid max-w-md gap-5">
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="twofa-password">Senha atual</FieldLabel>
          <Input
            id="twofa-password"
            type="password"
            autoComplete="current-password"
            className="h-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(error)}
          />
          <FieldDescription>A verificação é opcional. Para ativar, confirme que é você.</FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" size="lg" className="h-11 w-fit" disabled={pending || password === ""}>
          {pending ? <Spinner aria-label="Carregando" /> : <ShieldCheckIcon />}
          Ativar a verificação em duas etapas
        </Button>
      </form>
    )
  }

  if (step.kind === "scan") {
    return (
      <form onSubmit={confirm} noValidate className="grid max-w-xl gap-5">
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>Abra o aplicativo autenticador do celular (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Escolha adicionar conta e aponte a câmera para o QR code abaixo.</li>
          <li>Digite o código de 6 dígitos que o aplicativo mostrar.</li>
        </ol>
        <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center">
          <QrCode drawing={step.qr} label="QR code para adicionar a conta no aplicativo autenticador" />
          <div className="grid min-w-0 gap-2 text-sm">
            <p className="text-muted-foreground">
              Está no próprio celular?{" "}
              <a className="font-medium text-primary underline-offset-4 hover:underline" href={step.totpURI}>
                Abrir no aplicativo autenticador
              </a>
              .
            </p>
            <p className="text-xs text-muted-foreground">Não conseguiu escanear? Digite esta chave no aplicativo (tipo: baseada em tempo):</p>
            <div className="flex flex-wrap items-center gap-2">
              <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <code className="min-w-0 flex-1 font-mono text-sm tracking-wider">{groupKey(step.secret)}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(step.secret).then(() => toast.success("Chave copiada"))
                }}
              >
                <CopyIcon />
                Copiar
              </Button>
            </div>
          </div>
        </div>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel>Código do aplicativo</FieldLabel>
          <div className="w-fit">
            <MfaCodeInput
              key={attempt}
              value={code}
              onChange={(v) => {
                setError(null)
                setCode(v)
              }}
              onComplete={(v) => void verifyCode(v)}
              invalid={Boolean(error)}
              disabled={pending}
            />
          </div>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" size="lg" className="h-11 w-fit" disabled={pending || !/^\d{6}$/.test(code)}>
          {pending && <Spinner aria-label="Carregando" />}
          Confirmar
        </Button>
      </form>
    )
  }

  return (
    <div className="grid max-w-xl gap-5">
      <Alert className="border-primary/20 bg-primary/5">
        <CheckCircle2Icon className="text-primary" />
        <AlertTitle>Pronto: verificação em duas etapas ativa</AlertTitle>
        <AlertDescription>
          Guarde estes 10 códigos de recuperação em lugar seguro (fora do celular). Cada um vale uma vez, se você perder o acesso ao
          aplicativo. Eles não serão mostrados de novo.
        </AlertDescription>
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/40 p-4 font-mono text-sm sm:grid-cols-2">
        {step.backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(step.backupCodes.join("\n")).then(() => toast.success("Códigos copiados"))
          }}
        >
          <CopyIcon />
          Copiar os códigos
        </Button>
        <Button type="button" onClick={() => router.push("/inicio")}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
