"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2Icon, CopyIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { confirmTwoFactorSetupAction, startTwoFactorSetupAction } from "@/app/conta/seguranca/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

type Step =
  | { readonly kind: "password" }
  | { readonly kind: "scan"; readonly totpURI: string; readonly secret: string; readonly backupCodes: readonly string[] }
  | { readonly kind: "codes"; readonly backupCodes: readonly string[] }

/** Agrupa a chave em blocos de 4 para digitar no aplicativo. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim()
}

/**
 * Cadastro do 2FA em três passos: senha atual → chave no aplicativo autenticador + código de
 * confirmação → 10 códigos de recuperação (mostrados uma vez só).
 */
export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ kind: "password" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (enabled && step.kind === "password") {
    return (
      <Alert className="border-primary/20 bg-primary/5">
        <CheckCircle2Icon className="text-primary" />
        <AlertTitle>Verificação em duas etapas ativa</AlertTitle>
        <AlertDescription>
          Todo login pede o código do aplicativo autenticador. Perdeu o celular e os códigos de recuperação? Peça ao administrador da
          sua empresa (ou ao suporte Engemase, se você é administrador) para reiniciar a verificação.
        </AlertDescription>
      </Alert>
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
        setStep({ kind: "scan", totpURI: result.totpURI, secret: result.secret, backupCodes: result.backupCodes })
      } else setError(result.message)
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.")
    }
    setPending(false)
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (step.kind !== "scan") return
    setPending(true)
    setError(null)
    try {
      const result = await confirmTwoFactorSetupAction({ code: code.trim() })
      if (result.status === "ok") setStep({ kind: "codes", backupCodes: step.backupCodes })
      else setError(result.message)
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.")
    }
    setPending(false)
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
          <FieldDescription>Para começar, confirme que é você.</FieldDescription>
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
          <li>Escolha adicionar conta e digite a chave abaixo (tipo: baseada em tempo).</li>
          <li>Digite o código de 6 dígitos que o aplicativo mostrar.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
          <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden />
          <code className="font-mono text-base tracking-wider break-all">{groupKey(step.secret)}</code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              void navigator.clipboard?.writeText(step.secret).then(() => toast.success("Chave copiada"))
            }}
          >
            <CopyIcon />
            Copiar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          No celular, você também pode abrir <a className="font-medium text-primary underline-offset-4 hover:underline" href={step.totpURI}>este link</a> para
          adicionar a conta direto no aplicativo.
        </p>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="twofa-code">Código do aplicativo</FieldLabel>
          <Input
            id="twofa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="h-11 max-w-40 text-lg tracking-widest"
            value={code}
            onChange={(e) => {
              setError(null)
              setCode(e.target.value.replace(/\D/g, ""))
            }}
            aria-invalid={Boolean(error)}
            autoFocus
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" size="lg" className="h-11 w-fit" disabled={pending || code.length !== 6}>
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
