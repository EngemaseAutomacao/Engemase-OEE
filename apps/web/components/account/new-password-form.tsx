"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2Icon, EyeIcon, EyeOffIcon, LockIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

export type NewPasswordResult =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly message: string; readonly field?: "password" | "token" }

const MIN = 12

/**
 * Formulário de senha nova com o token do link (no fragmento `#t=...`, que nunca chega ao servidor nem
 * aos logs). Lê o token uma vez, tira o fragmento da barra de endereço e manda token + senha para a
 * Server Action (`submit`).
 */
export function NewPasswordForm({
  submit,
  doneTitle,
  doneText,
  invalidText,
}: {
  submit: (input: { token: string; password: string }) => Promise<NewPasswordResult>
  doneTitle: string
  doneText: string
  invalidText: string
}) {
  // undefined = ainda lendo o fragmento; null = link sem token.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({})
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [tokenInvalid, setTokenInvalid] = useState(false)

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("t")
    // O token sai da barra de endereço (histórico, captura de tela), mas fica na memória do formulário.
    if (window.location.hash !== "") window.history.replaceState(null, "", window.location.pathname)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- o fragmento só existe no navegador
    setToken(value !== null && value.trim() !== "" ? value.trim() : null)
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (token == null) return
    const next: typeof errors = {}
    if ([...password].length < MIN) next.password = `A senha precisa ter pelo menos ${MIN} caracteres.`
    if (confirm !== password) next.confirm = "As duas senhas não são iguais."
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setPending(true)
    try {
      const result = await submit({ token, password })
      if (result.status === "ok") {
        setPassword("")
        setConfirm("")
        setDone(true)
      } else if (result.field === "token") {
        setTokenInvalid(true)
      } else if (result.field === "password") {
        setErrors({ password: result.message })
      } else {
        setErrors({ form: result.message })
      }
    } catch {
      setErrors({ form: "Sem conexão com o servidor. Confira a internet e tente de novo." })
    }
    setPending(false)
  }

  if (token === undefined) {
    return (
      <div className="flex justify-center py-8">
        <Spinner aria-label="Carregando" />
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Alert className="border-primary/20 bg-primary/5">
          <CheckCircle2Icon className="text-primary" />
          <AlertTitle>{doneTitle}</AlertTitle>
          <AlertDescription>{doneText}</AlertDescription>
        </Alert>
        <Button asChild size="lg" className="h-11 w-full text-base">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    )
  }

  if (token === null || tokenInvalid) {
    return (
      <div className="flex flex-col gap-6">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Link inválido ou vencido</AlertTitle>
          <AlertDescription>{invalidText}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="lg" className="h-11 w-full text-base">
          <Link href="/login">Voltar para o login</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="nova-senha">Nova senha</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <LockIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="nova-senha"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              autoFocus
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={show}
              >
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : (
            <FieldDescription>
              Pelo menos {MIN} caracteres. Uma frase fácil de lembrar funciona bem (ex.: quatro palavras soltas). Senhas que
              aparecem em vazamentos conhecidos são recusadas.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.confirm)}>
          <FieldLabel htmlFor="confirmar-senha">Repita a nova senha</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <LockIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="confirmar-senha"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={Boolean(errors.confirm)}
            />
          </InputGroup>
          {errors.confirm && <FieldError>{errors.confirm}</FieldError>}
        </Field>
      </FieldGroup>

      {errors.form && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.form}
        </p>
      )}

      <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending}>
        {pending && <Spinner aria-label="Carregando" />}
        {pending ? "Salvando…" : "Salvar senha"}
      </Button>
    </form>
  )
}
