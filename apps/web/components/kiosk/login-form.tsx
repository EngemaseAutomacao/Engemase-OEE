"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { EyeIcon, EyeOffIcon, Grid3x3Icon, LockIcon, MailIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NumericKeypad } from "@/components/kiosk/numeric-keypad"

const PIN_MAX = 6
const PIN_MIN = 4

/** Formulário de login do protótipo: e-mail/senha e acesso rápido do operador (usuário + PIN). */
export function LoginForm({ operatorHref }: { operatorHref: string }) {
  const [tab, setTab] = useState("email")
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <TabsList className="grid h-11 w-full grid-cols-2">
        <TabsTrigger value="email" className="h-full">
          <MailIcon />
          E-mail e senha
        </TabsTrigger>
        <TabsTrigger value="operator" className="h-full">
          <Grid3x3Icon />
          Operador
        </TabsTrigger>
      </TabsList>
      <TabsContent value="email">
        <EmailLogin />
      </TabsContent>
      <TabsContent value="operator">
        <OperatorLogin active={tab === "operator"} href={operatorHref} />
      </TabsContent>
    </Tabs>
  )
}

function EmailLogin() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [pending, setPending] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!email.trim()) next.email = "Informe seu e-mail."
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "E-mail inválido. Confira se digitou corretamente."
    if (!password) next.password = "Informe sua senha."
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setPending(true)
    // Protótipo: sem autenticação real.
    window.setTimeout(() => router.push("/"), 500)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="login-email">E-mail</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <MailIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="nome@empresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
          </InputGroup>
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="login-password">Senha</FieldLabel>
            <button
              type="button"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setForgotOpen(true)}
            >
              Esqueci minha senha
            </button>
          </div>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <LockIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {errors.password && <FieldError>{errors.password}</FieldError>}
        </Field>

        <div className="flex items-center gap-2.5">
          <Checkbox id="login-remember" defaultChecked />
          <Label htmlFor="login-remember" className="font-normal">
            Manter conectado neste dispositivo
          </Label>
        </div>
      </FieldGroup>

      <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending}>
        {pending && <Spinner aria-label="Carregando" />}
        {pending ? "Entrando…" : "Entrar"}
      </Button>

      <Alert className="border-primary/20 bg-primary/5">
        <ShieldCheckIcon className="text-primary" />
        <AlertTitle>Verificação em duas etapas</AlertTitle>
        <AlertDescription>
          Administradores, engenheiros e a equipe Engemase confirmam o acesso com o código de 6 dígitos do aplicativo autenticador, logo após a senha.
        </AlertDescription>
      </Alert>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} initialEmail={email} />
    </form>
  )
}

function ForgotPasswordDialog({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialEmail: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <ForgotPasswordBody initialEmail={initialEmail} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ForgotPasswordBody({ initialEmail, onDone }: { initialEmail: string; onDone: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | null>(null)

  function send(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Informe o e-mail cadastrado na plataforma.")
      return
    }
    toast.success("Verifique sua caixa de entrada", {
      description: `Se ${email.trim()} estiver cadastrado, você receberá um link para criar uma nova senha. O link vale por 30 minutos.`,
    })
    onDone()
  }

  return (
    <form onSubmit={send} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Redefinir senha</DialogTitle>
        <DialogDescription>Enviaremos um link de redefinição para o seu e-mail. Operadores devem pedir um novo PIN ao supervisor do turno.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="forgot-email">E-mail</FieldLabel>
        <Input
          id="forgot-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="nome@empresa.com.br"
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(error)}
          autoFocus
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit">Enviar link</Button>
      </DialogFooter>
    </form>
  )
}

function OperatorLogin({ active, href }: { active: boolean; href: string }) {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const addDigit = (d: string) => {
    setError(null)
    setPin((p) => (p.length >= PIN_MAX ? p : p + d))
  }
  const backspace = () => setPin((p) => p.slice(0, -1))
  const clear = () => setPin("")

  // Teclado físico também funciona (fora de campos de texto).
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      if (/^\d$/.test(e.key)) setPin((p) => (p.length >= PIN_MAX ? p : p + e.key))
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active])

  function submit() {
    if (!username.trim()) {
      setError("Informe seu usuário.")
      return
    }
    if (pin.length < PIN_MIN) {
      setError(`O PIN tem de ${PIN_MIN} a ${PIN_MAX} dígitos.`)
      return
    }
    setPending(true)
    toast.success(`Bom trabalho, ${username.trim()}!`, { description: "Abrindo a tela do operador da sua máquina." })
    window.setTimeout(() => router.push(href), 400)
  }

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor="login-operator">Usuário</FieldLabel>
        <InputGroup className="h-14">
          <InputGroupAddon>
            <UserRoundIcon className="size-5" />
          </InputGroupAddon>
          <InputGroupInput
            id="login-operator"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="ex.: op.injecao-a"
            className="text-lg md:text-lg"
            value={username}
            onChange={(e) => {
              setError(null)
              setUsername(e.target.value)
            }}
          />
        </InputGroup>
        <FieldDescription>Em tablets fixos da máquina, o usuário já vem preenchido pelo supervisor.</FieldDescription>
      </Field>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">PIN</span>
          <span className="text-xs text-muted-foreground">
            {PIN_MIN} a {PIN_MAX} dígitos
          </span>
        </div>
        <div className="grid grid-cols-6 gap-2" aria-live="polite" aria-label={`PIN com ${pin.length} dígitos digitados`}>
          {Array.from({ length: PIN_MAX }, (_, i) => (
            <div
              key={i}
              className={cn(
                "flex h-14 items-center justify-center rounded-xl border-2 bg-card transition-colors",
                i < pin.length ? "border-primary" : "border-input",
                i === pin.length && "border-primary/50 border-dashed",
              )}
            >
              {i < pin.length && <span className="size-3.5 rounded-full bg-foreground" />}
            </div>
          ))}
        </div>
        <NumericKeypad onDigit={addDigit} onBackspace={backspace} onClear={clear} />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <Button type="button" size="lg" className="h-14 w-full text-lg" onClick={submit} disabled={pending}>
        {pending && <Spinner aria-label="Carregando" />}
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">Esqueceu o PIN? Peça ao supervisor do turno para gerar um novo.</p>
    </div>
  )
}
