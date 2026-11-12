"use client"

import { BuildingIcon, CheckCircle2Icon, CircleAlertIcon, ClockIcon, GlobeIcon, InfoIcon, MailIcon, PencilIcon, UserRoundCheckIcon } from "lucide-react"

import type { ClientPlan } from "@/lib/mock/types"
import { PLAN_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SoftBadge } from "./bits"
import {
  BILLING_NOTE,
  ENGEMASE_CONFIG_NOTE,
  PLAN_DEFAULTS,
  PLATFORM_HOST,
  RESERVED_SLUGS,
  SHIFT_TEMPLATES,
  TIMEZONES,
  UFS,
  maskCnpj,
  slugify,
  timezoneForUf,
  timezoneLabel,
  type PlanLimits,
} from "./labels"
import { checkSlug, type WizardContext, type WizardData, type WizardErrors } from "./wizard-model"

type Patch = (p: Partial<WizardData>) => void

// ---------------------------------------------------------------------------
// Peças de formulário
// ---------------------------------------------------------------------------
function FormField({
  id,
  label,
  error,
  hint,
  optional,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: React.ReactNode
  optional?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (opcional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function UfSelect({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder="UF" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {UFS.map((uf) => (
          <SelectItem key={uf} value={uf}>
            {uf}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StepHeading({ icon: Icon, title, description }: { icon: typeof BuildingIcon; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
}

// ---------------------------------------------------------------------------
// Passo 1 — Empresa
// ---------------------------------------------------------------------------
export function StepCompany({ data, errors, patch, ctx }: { data: WizardData; errors: WizardErrors; patch: Patch; ctx: WizardContext }) {
  const slug = checkSlug(data.slug, ctx)
  const setTradeName = (v: string) => patch({ tradeName: v, ...(data.slugEdited ? {} : { slug: slugify(v) }) })
  const setPlan = (plan: ClientPlan) => {
    const d = PLAN_DEFAULTS[plan]
    patch({ plan, limits: { machines: d.machines, gateways: d.gateways, users: d.users, retentionMonths: d.retentionMonths } })
  }
  const setLimit = (k: keyof PlanLimits, v: string) => patch({ limits: { ...data.limits, [k]: v === "" ? 0 : Math.max(0, Math.floor(Number(v))) } })

  return (
    <div className="flex flex-col gap-6">
      <StepHeading icon={BuildingIcon} title="Empresa" description="Dados cadastrais, identificador na URL, plano e modo de gestão." />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="legalName" label="Razão social" error={errors.legalName} className="sm:col-span-2">
          <Input id="legalName" value={data.legalName} onChange={(e) => patch({ legalName: e.target.value })} placeholder="Ex.: Bom Sabor Alimentos Ltda." aria-invalid={!!errors.legalName || undefined} />
        </FormField>
        <FormField id="tradeName" label="Nome fantasia" error={errors.tradeName} hint="É o nome que aparece no menu e nos relatórios.">
          <Input id="tradeName" value={data.tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder="Ex.: Bom Sabor Alimentos" aria-invalid={!!errors.tradeName || undefined} />
        </FormField>
        <FormField id="cnpj" label="CNPJ" error={errors.cnpj} hint="Matriz ou filial principal do contrato.">
          <Input
            id="cnpj"
            inputMode="numeric"
            value={data.cnpj}
            onChange={(e) => patch({ cnpj: maskCnpj(e.target.value) })}
            placeholder="00.000.000/0000-00"
            className="font-mono"
            aria-invalid={!!errors.cnpj || undefined}
          />
        </FormField>
        <div className="grid grid-cols-[1fr_6rem] gap-3 sm:col-span-2 sm:grid-cols-[1fr_8rem]">
          <FormField id="city" label="Cidade" error={errors.city}>
            <Input id="city" value={data.city} onChange={(e) => patch({ city: e.target.value })} placeholder="Ex.: Chapecó" aria-invalid={!!errors.city || undefined} />
          </FormField>
          <FormField id="uf" label="UF" error={errors.uf}>
            <UfSelect id="uf" value={data.uf} onChange={(v) => patch({ uf: v })} invalid={!!errors.uf} />
          </FormField>
        </div>
      </div>

      {/* Identificador */}
      <div className="grid gap-3 rounded-xl border bg-muted/30 p-4">
        <SectionLabel>Identificador na URL</SectionLabel>
        <FormField
          id="slug"
          label="Slug"
          error={errors.slug}
          hint={data.slugEdited ? "Editado manualmente." : "Gerado a partir do nome fantasia. Pode ser editado agora; depois, não muda mais."}
        >
          <div className="flex min-w-0 items-center rounded-md border bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <span className="hidden shrink-0 border-r px-3 py-2 text-sm text-muted-foreground sm:block">{PLATFORM_HOST}/</span>
            <input
              id="slug"
              value={data.slug}
              onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40), slugEdited: true })}
              className="h-9 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none"
              placeholder="bom-sabor"
              aria-invalid={!!errors.slug || undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {data.slug && (
              <span className="shrink-0 pr-2">
                <SoftBadge tone={slug.ok ? "green" : "red"} icon={slug.ok ? CheckCircle2Icon : CircleAlertIcon}>
                  {slug.ok ? "Disponível" : "Indisponível"}
                </SoftBadge>
              </span>
            )}
          </div>
        </FormField>
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm">
          <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate font-mono">
            https://{PLATFORM_HOST}/<span className="font-semibold text-primary">{data.slug || "identificador"}</span>
          </span>
        </div>
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            O slug <strong className="font-semibold text-foreground">nunca é reaproveitado</strong>, nem depois que o cliente é encerrado. Nomes reservados:{" "}
            <span className="font-mono">{RESERVED_SLUGS.slice(0, 8).join(", ")}</span>…
          </span>
        </p>
      </div>

      {/* Plano */}
      <div className="grid gap-3">
        <SectionLabel>Plano e máquinas contratadas</SectionLabel>
        <div role="radiogroup" aria-label="Plano" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PLAN_DEFAULTS) as ClientPlan[]).map((p) => {
            const active = data.plan === p
            const d = PLAN_DEFAULTS[p]
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPlan(p)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{PLAN_LABEL[p]}</span>
                  <span className={cn("size-4 rounded-full border-2", active ? "border-primary bg-primary shadow-[inset_0_0_0_2px_var(--card)]" : "border-muted-foreground/40")} aria-hidden />
                </span>
                <span className="text-xs text-muted-foreground">{d.summary}</span>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  Sugestão: {d.machines} máquinas · {d.gateways} gateways · {d.users} usuários
                </span>
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["machines", "Máquinas contratadas"],
              ["gateways", "Gateways"],
              ["users", "Usuários"],
              ["retentionMonths", "Retenção (meses)"],
            ] as const
          ).map(([k, label]) => (
            <FormField key={k} id={`limit-${k}`} label={label} error={errors[`limits.${k}`]}>
              <Input
                id={`limit-${k}`}
                type="number"
                inputMode="numeric"
                min={k === "retentionMonths" ? 6 : 1}
                value={data.limits[k] || ""}
                onChange={(e) => setLimit(k, e.target.value)}
                className="tabular-nums"
                aria-invalid={!!errors[`limits.${k}`] || undefined}
              />
            </FormField>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {BILLING_NOTE} Os limites bloqueiam a criação de máquinas, gateways e usuários além do contratado. Só a plataforma altera plano e limites.
        </p>
      </div>

      {/* Quem configura (D12/D13) */}
      <div className="flex items-start gap-3 rounded-xl border p-4">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Configurado pela Engemase</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{ENGEMASE_CONFIG_NOTE}</span>
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 2 — Primeira unidade
// ---------------------------------------------------------------------------
export function StepUnit({ data, errors, patch }: { data: WizardData; errors: WizardErrors; patch: Patch }) {
  const setUf = (uf: string) => patch({ unitUf: uf, ...(data.timezoneEdited ? {} : { timezone: timezoneForUf(uf) }) })
  return (
    <div className="flex flex-col gap-6">
      <StepHeading icon={BuildingIcon} title="Primeira unidade" description="A planta onde ficam as primeiras linhas, máquinas e o gateway. Outras unidades podem ser criadas depois." />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="unitName" label="Nome da unidade" error={errors.unitName} hint="Ex.: Fábrica Chapecó, Unidade Joinville." className="sm:col-span-2">
          <Input id="unitName" value={data.unitName} onChange={(e) => patch({ unitName: e.target.value })} placeholder="Fábrica Chapecó" aria-invalid={!!errors.unitName || undefined} />
        </FormField>
        <div className="grid grid-cols-[1fr_6rem] gap-3 sm:col-span-2 sm:grid-cols-[1fr_8rem]">
          <FormField id="unitCity" label="Cidade" error={errors.unitCity}>
            <Input id="unitCity" value={data.unitCity} onChange={(e) => patch({ unitCity: e.target.value })} aria-invalid={!!errors.unitCity || undefined} />
          </FormField>
          <FormField id="unitUf" label="UF" error={errors.unitUf}>
            <UfSelect id="unitUf" value={data.unitUf} onChange={setUf} invalid={!!errors.unitUf} />
          </FormField>
        </div>
        <FormField
          id="timezone"
          label="Fuso horário"
          error={errors.timezone}
          hint={`${TIMEZONES.find((t) => t.value === data.timezone)?.hint ?? ""}. ${data.timezoneEdited ? "Escolhido manualmente." : "Sugerido pela UF."} Turnos e relatórios usam o fuso da planta.`}
          className="sm:col-span-2"
        >
          <Select value={data.timezone} onValueChange={(v) => patch({ timezone: v, timezoneEdited: true })}>
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="grid gap-3">
        <SectionLabel>Modelo de turnos</SectionLabel>
        <div role="radiogroup" aria-label="Modelo de turnos" className="grid gap-2 sm:grid-cols-2">
          {SHIFT_TEMPLATES.map((t) => {
            const active = data.shiftTemplate === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ shiftTemplate: t.id })}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                  t.id === "depois" && "sm:col-span-2",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
                    {t.name}
                  </span>
                  <span className={cn("size-4 shrink-0 rounded-full border-2", active ? "border-primary bg-primary shadow-[inset_0_0_0_2px_var(--card)]" : "border-muted-foreground/40")} aria-hidden />
                </span>
                <span className="text-xs text-muted-foreground">{t.days}</span>
                {t.shifts.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {t.shifts.map((s) => (
                      <span key={s.name} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                        {s.name} {s.start}–{s.end}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">Pausas (refeição, café) e dias da semana são ajustados depois em Configurações › Turnos.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 3 — Primeiro admin
// ---------------------------------------------------------------------------
export function StepAdmin({ data, errors, patch, ctx }: { data: WizardData; errors: WizardErrors; patch: Patch; ctx: WizardContext }) {
  const known = ctx.knownEmails.find((k) => k.email === data.adminEmail.trim().toLowerCase())
  return (
    <div className="flex flex-col gap-6">
      <StepHeading icon={UserRoundCheckIcon} title="Primeiro admin do cliente" description="Essa pessoa gerencia unidades, máquinas e a equipe do cliente. O escopo é sempre o cliente inteiro." />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="adminName" label="Nome completo" error={errors.adminName} className="sm:col-span-2">
          <Input id="adminName" value={data.adminName} onChange={(e) => patch({ adminName: e.target.value })} placeholder="Ex.: Luís Andrade" autoComplete="off" aria-invalid={!!errors.adminName || undefined} />
        </FormField>
        <FormField
          id="adminEmail"
          label="E-mail"
          error={errors.adminEmail}
          hint={known ? `Já tem conta (${known.clients.join(", ")}). Será vinculada também a este cliente, sem nova senha.` : "Use um e-mail corporativo da empresa."}
        >
          <Input
            id="adminEmail"
            type="email"
            value={data.adminEmail}
            onChange={(e) => patch({ adminEmail: e.target.value })}
            placeholder="nome@empresa.com.br"
            autoComplete="off"
            aria-invalid={!!errors.adminEmail || undefined}
          />
        </FormField>
        <FormField id="adminPhone" label="Celular" optional hint="Para o suporte combinar a implantação.">
          <Input id="adminPhone" type="tel" value={data.adminPhone} onChange={(e) => patch({ adminPhone: e.target.value })} placeholder="(49) 99999-0000" />
        </FormField>
      </div>

      <div className="grid gap-3 rounded-xl border bg-muted/30 p-4">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={data.sendEmail} onCheckedChange={(v) => patch({ sendEmail: v === true })} className="mt-0.5" />
          <span>
            <span className="font-semibold">Enviar o e-mail “Definir senha” ao criar</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Link de uso único, que também confirma o e-mail. Se desmarcar, o envio pode ser feito depois na aba Usuários do cliente.
            </span>
          </span>
        </label>
        <div className="flex items-start gap-3 rounded-lg bg-background p-3">
          <MailIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 text-xs leading-relaxed">
            <div className="font-semibold">Prévia: “Seu acesso à plataforma Engemase OEE”</div>
            <p className="text-muted-foreground">
              Olá{data.adminName ? `, ${data.adminName.split(" ")[0]}` : ""}! A Engemase criou o acesso de {data.tradeName || "sua empresa"} em{" "}
              <span className="font-mono">
                {PLATFORM_HOST}/{data.slug || "identificador"}
              </span>
              . Clique no botão para definir sua senha.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 4 — Revisão
// ---------------------------------------------------------------------------
function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          <PencilIcon />
          Editar
        </Button>
      </header>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  )
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  )
}

export function StepReview({ data, goTo }: { data: WizardData; goTo: (step: number) => void }) {
  const template = SHIFT_TEMPLATES.find((t) => t.id === data.shiftTemplate)!
  return (
    <div className="flex flex-col gap-4">
      <StepHeading icon={CheckCircle2Icon} title="Revisão" description="Confira os dados. Depois de criado, o identificador não muda." />

      <ReviewBlock title="Empresa" onEdit={() => goTo(0)}>
        <Item label="Nome fantasia">{data.tradeName}</Item>
        <Item label="Razão social">{data.legalName}</Item>
        <Item label="CNPJ">
          <span className="font-mono">{data.cnpj}</span>
        </Item>
        <Item label="Cidade/UF">
          {data.city}/{data.uf}
        </Item>
        <Item label="Endereço na plataforma" wide>
          <span className="font-mono">
            {PLATFORM_HOST}/<span className="text-primary">{data.slug}</span>
          </span>
        </Item>
        <Item label="Plano">
          {PLAN_LABEL[data.plan]} · {data.limits.machines} máquinas contratadas (cobrança por máquina) · {data.limits.gateways} gateways · {data.limits.users} usuários ·{" "}
          {data.limits.retentionMonths} meses
        </Item>
        <Item label="Configuração">Equipe Engemase (o admin do cliente gerencia os usuários)</Item>
      </ReviewBlock>

      <ReviewBlock title="Primeira unidade" onEdit={() => goTo(1)}>
        <Item label="Unidade">{data.unitName}</Item>
        <Item label="Cidade/UF">
          {data.unitCity}/{data.unitUf}
        </Item>
        <Item label="Fuso">{timezoneLabel(data.timezone)}</Item>
        <Item label="Turnos">{template.shifts.length ? `${template.name} · ${template.shifts.map((s) => `${s.start}–${s.end}`).join(", ")}` : template.name}</Item>
      </ReviewBlock>

      <ReviewBlock title="Primeiro admin" onEdit={() => goTo(2)}>
        <Item label="Nome">{data.adminName}</Item>
        <Item label="E-mail">{data.adminEmail}</Item>
        <Item label="Papel">Admin do cliente · cliente inteiro</Item>
        <Item label="E-mail “Definir senha”">{data.sendEmail ? "Enviado ao criar" : "Não enviar agora"}</Item>
      </ReviewBlock>

      <div className="rounded-xl bg-primary/5 p-4">
        <h3 className="text-sm font-semibold">Ao criar, a plataforma vai</h3>
        <ul className="mt-2 grid gap-1.5 text-[13px]">
          {[
            "Criar o cliente no estado Implantação, com o plano e os limites acima.",
            `Criar a unidade ${data.unitName || "inicial"}${template.shifts.length ? ` e ${template.shifts.length} ${template.shifts.length === 1 ? "turno" : "turnos"}` : ""}.`,
            `Criar a conta de ${data.adminName || "admin"} sem senha e vinculá-la como admin do cliente${data.sendEmail ? ", enviando o e-mail “Definir senha”" : ""}.`,
            "Registrar tudo na auditoria do cliente e da plataforma.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
