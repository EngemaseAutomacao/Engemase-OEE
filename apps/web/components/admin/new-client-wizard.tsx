"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleCheckBigIcon,
  CpuIcon,
  FactoryIcon,
  MonitorSmartphoneIcon,
  PlusIcon,
  RocketIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PLATFORM_HOST, SHIFT_TEMPLATES, onlyDigits, timezoneForUf } from "./labels"
import { INITIAL_DATA, STEPS, validateStep, type WizardContext, type WizardData, type WizardErrors } from "./wizard-model"
import { StepAdmin, StepCompany, StepReview, StepUnit } from "./wizard-steps"

/** Fluxo de implantação (docs/15 §7): os 3 primeiros passos acontecem neste assistente. */
const FLOW = [
  { title: "Empresa, slug e plano", wizard: true },
  { title: "Primeira unidade, fuso e turnos", wizard: true },
  { title: "Primeiro admin (e-mail “Definir senha”)", wizard: true },
  { title: "Provisionar gateway (código de ativação)", wizard: false },
  { title: "Cadastrar máquinas e tags Modbus", wizard: false },
  { title: "Parear TV e tablets", wizard: false },
  { title: "Admin do cliente adiciona a equipe", wizard: false },
  { title: "Concluir implantação: cliente ativo", wizard: false },
]

export function NewClientWizard({ ctx: baseCtx }: { ctx: WizardContext }) {
  // Clientes criados nesta sessão também bloqueiam slug e CNPJ (slug nunca é reaproveitado)
  const [createdHere, setCreatedHere] = useState<{ slugs: string[]; cnpjs: string[] }>({ slugs: [], cnpjs: [] })
  const ctx: WizardContext = {
    ...baseCtx,
    usedSlugs: [...baseCtx.usedSlugs, ...createdHere.slugs],
    usedCnpjs: [...baseCtx.usedCnpjs, ...createdHere.cnpjs],
  }
  const [data, setData] = useState<WizardData>(INITIAL_DATA)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [errors, setErrors] = useState<WizardErrors>({})
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  const patch = (p: Partial<WizardData>) => {
    setData((d) => ({ ...d, ...p }))
    // limpa o erro dos campos alterados
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(p)) delete next[k as keyof WizardErrors]
      if ("limits" in p) for (const k of ["limits.machines", "limits.gateways", "limits.users", "limits.retentionMonths"] as const) delete next[k]
      return next
    })
  }

  const goTo = (s: number) => {
    setErrors({})
    setStep(s)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const next = () => {
    const e = validateStep(step, data, ctx)
    if (Object.keys(e).length > 0) {
      setErrors(e)
      toast.error("Revise os campos destacados", { description: Object.values(e)[0] })
      return
    }
    // Ao sair do passo 1, sugere a unidade com a cidade da empresa
    if (step === 0 && !data.unitCity && !data.unitName) {
      patch({
        unitName: `Fábrica ${data.city.trim()}`,
        unitCity: data.city.trim(),
        unitUf: data.uf,
        ...(data.timezoneEdited ? {} : { timezone: timezoneForUf(data.uf) }),
      })
    }
    const s = step + 1
    setMaxStep((m) => Math.max(m, s))
    goTo(s)
  }

  const create = () => {
    setCreating(true)
    window.setTimeout(() => {
      setCreating(false)
      setCreated(true)
      setCreatedHere((c) => ({ slugs: [...c.slugs, data.slug], cnpjs: [...c.cnpjs, onlyDigits(data.cnpj)] }))
      toast.success(`${data.tradeName} criado`, {
        description: data.sendEmail ? `E-mail “Definir senha” enviado para ${data.adminEmail}.` : "Cliente em implantação. O e-mail de acesso pode ser enviado depois.",
      })
      window.scrollTo({ top: 0, behavior: "smooth" })
    }, 900)
  }

  const reset = () => {
    setData(INITIAL_DATA)
    setErrors({})
    setStep(0)
    setMaxStep(0)
    setCreated(false)
  }

  if (created) return <Success data={data} onAnother={reset} />

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className="flex min-w-0 flex-col rounded-2xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-8">
        <Stepper step={step} maxStep={maxStep} onSelect={goTo} />
        <div className="border-t px-5 py-5">
          {step === 0 && <StepCompany data={data} errors={errors} patch={patch} ctx={ctx} />}
          {step === 1 && <StepUnit data={data} errors={errors} patch={patch} />}
          {step === 2 && <StepAdmin data={data} errors={errors} patch={patch} ctx={ctx} />}
          {step === 3 && <StepReview data={data} goTo={goTo} />}
        </div>
        <footer className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-4">
          {step === 0 ? (
            <Button variant="ghost" asChild>
              <Link href="/admin/clientes">Cancelar</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => goTo(step - 1)} disabled={creating}>
              <ArrowLeftIcon />
              Voltar
            </Button>
          )}
          <span className="hidden text-xs text-muted-foreground sm:block">
            Passo {step + 1} de {STEPS.length}
          </span>
          {step < 3 ? (
            <Button onClick={next}>
              Continuar
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button onClick={create} disabled={creating}>
              {creating ? <Spinner /> : <CheckIcon />}
              {creating ? "Criando…" : "Criar cliente"}
            </Button>
          )}
        </footer>
      </section>

      <aside className="flex flex-col gap-4 lg:col-span-4">
        <section className="rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[15px] font-semibold">Como funciona a implantação</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Os 3 primeiros passos são feitos aqui; o resto segue no detalhe do cliente.</p>
          <ol className="relative mt-4 grid gap-3">
            <span className="absolute top-3 bottom-3 left-[11px] border-l-2 border-dashed border-border" aria-hidden />
            {FLOW.map((f, i) => {
              const done = f.wizard && i < step
              const current = f.wizard && i === Math.min(step, 2) && step < 3
              return (
                <li key={f.title} className="relative flex items-center gap-3 text-[13px]">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-4 ring-card",
                      done ? "bg-state-running text-white" : current ? "bg-primary text-primary-foreground" : f.wizard ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn(f.wizard ? "font-medium" : "text-muted-foreground", current && "text-primary")}>{f.title}</span>
                </li>
              )
            })}
          </ol>
        </section>
        <section className="rounded-2xl border bg-card p-5 text-xs leading-relaxed text-muted-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="mb-2 text-[15px] font-semibold text-foreground">Bom saber</h2>
          <ul className="grid gap-2">
            <li>Um grupo com vários CNPJs é um único cliente com várias unidades.</li>
            <li>O cliente nasce em <strong className="text-foreground">Implantação</strong>: o admin já pode entrar, mas o cliente não conta como uso produtivo.</li>
            <li>A equipe Engemase acessa o cliente por papel, concessão de suporte ou atribuição, sempre com registro visível ao cliente.</li>
          </ul>
        </section>
      </aside>
    </div>
  )
}

function Stepper({ step, maxStep, onSelect }: { step: number; maxStep: number; onSelect: (s: number) => void }) {
  return (
    <nav aria-label="Passos do assistente" className="px-5 py-4">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const done = i < step
          const current = i === step
          const reachable = i <= maxStep
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onClick={() => reachable && onSelect(i)}
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                className="group flex w-full min-w-0 flex-col items-start gap-2 text-left outline-none disabled:cursor-default"
              >
                <span className={cn("h-1 w-full rounded-full", done ? "bg-state-running" : current ? "bg-primary" : "bg-muted")} aria-hidden />
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
                      done ? "bg-state-running text-white" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" /> : i + 1}
                  </span>
                  <span className="hidden min-w-0 leading-tight sm:block">
                    <span className={cn("block truncate text-[13px] font-semibold", !current && !done && "text-muted-foreground")}>{s.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s.hint}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-sm font-semibold sm:hidden">{STEPS[step]!.title}</p>
    </nav>
  )
}

function Success({ data, onAnother }: { data: WizardData; onAnother: () => void }) {
  const template = SHIFT_TEMPLATES.find((t) => t.id === data.shiftTemplate)!
  const steps = [
    {
      icon: CpuIcon,
      title: "Provisionar o gateway",
      text: `Gere o código de ativação para a ${data.unitName} e instale o gateway no quadro da planta.`,
      href: "/admin/gateways",
      cta: "Provisionar",
    },
    { icon: FactoryIcon, title: "Cadastrar máquinas e tags Modbus", text: `Até ${data.limits.machines} máquinas no plano. Use o bloco OEE padrão Engemase sempre que possível.` },
    { icon: MonitorSmartphoneIcon, title: "Parear TV e tablets", text: "Cada TV Andon e tablet de operador é um terminal pareado por código, sem conta compartilhada." },
    { icon: UsersIcon, title: "Admin do cliente adiciona a equipe", text: `${data.adminName.split(" ")[0]} entra pelo e-mail e convida supervisores, engenheiros e operadores.` },
    { icon: RocketIcon, title: "Concluir implantação", text: "Com dados chegando e a equipe treinada, mude o cliente para Ativo no detalhe do cliente." },
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-5">
        <IconCircle icon={CircleCheckBigIcon} tone="green" size="lg" />
        <div>
          <h2 className="text-lg font-bold">{data.tradeName} foi criado</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Estado: Implantação · {data.managed ? "gerenciado pela Engemase" : "autogestão"}</p>
        </div>
        <dl className="grid w-full gap-2 rounded-xl bg-muted/60 p-3 text-left text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Endereço</dt>
            <dd className="min-w-0 truncate font-mono text-xs leading-5">
              {PLATFORM_HOST}/{data.slug}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Unidade</dt>
            <dd className="min-w-0 truncate font-medium">{data.unitName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Turnos</dt>
            <dd className="min-w-0 truncate font-medium">{template.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Admin</dt>
            <dd className="min-w-0 truncate font-medium">{data.adminEmail}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {data.sendEmail ? "O e-mail “Definir senha” foi enviado. O link é de uso único." : "O e-mail “Definir senha” ainda não foi enviado."}
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" asChild>
            <Link href="/admin/clientes">Ver clientes</Link>
          </Button>
          <Button variant="outline" onClick={onAnother}>
            <PlusIcon />
            Criar outro cliente
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:col-span-7">
        <header className="px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold">Próximos passos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">O que falta para o cliente ficar ativo</p>
        </header>
        <ol className="divide-y px-5 pb-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 py-3">
              <IconCircle icon={s.icon} tone={i === 0 ? "blue" : "slate"} soft size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {i + 1}. {s.title}
                </div>
                <p className="text-xs text-muted-foreground">{s.text}</p>
              </div>
              {s.href && (
                <Button size="sm" asChild>
                  <Link href={s.href}>{s.cta}</Link>
                </Button>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
