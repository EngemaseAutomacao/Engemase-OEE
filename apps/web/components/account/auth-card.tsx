import type { LucideIcon } from "lucide-react"
import { Building2Icon, CheckCircle2Icon, KeyRoundIcon, ShieldCheckIcon, TimerIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/shell/brand"
import { ThemeToggle } from "@/components/theme-toggle"

/*
 * Moldura das telas públicas (login, criar/redefinir senha, acesso suspenso), na mesma família visual da
 * apresentação (/): painel de marca escuro e animado à esquerda (no celular vira um topo compacto) e o
 * formulário num cartão de vidro à direita. Classes `au-*` em app/(auth)/auth.css.
 */

/** `--au-d` (atraso da entrada escalonada) no style. */
export function delay(seconds: number): React.CSSProperties {
  return { ["--au-d" as string]: `${seconds}s` }
}

/** Tela inteira: painel de marca + área do formulário. Sem `panel`, mostra o painel de conta e acesso. */
export function AuthShell({ panel, children }: { panel?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="au relative grid min-h-dvh grid-rows-[auto_1fr] bg-background lg:grid-rows-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      {/* Tema no celular: fora do painel `dark` para o ícone (sol/lua) seguir o tema escolhido. */}
      <div className="absolute top-4 right-4 z-10 md:right-8 lg:hidden [&_button]:size-11 [&_button]:text-white [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
        <ThemeToggle />
      </div>
      {/* `dark` fixo: o painel de marca é azul quase preto nos dois temas. */}
      <aside className="dark relative isolate overflow-hidden bg-[var(--au-ink)] text-white lg:sticky lg:top-0 lg:flex lg:max-h-dvh lg:min-h-dvh lg:flex-col lg:border-r lg:border-white/10">
        <div aria-hidden className="au-grid absolute inset-0 -z-10" />
        <div aria-hidden className="au-blob absolute -top-48 -left-40 -z-10 size-[40rem] rounded-full bg-[var(--brand-blue)]/30 blur-3xl" />
        <div aria-hidden className="au-blob-2 absolute -right-40 -bottom-56 -z-10 size-[34rem] rounded-full bg-[var(--brand-orange)]/20 blur-3xl" />

        <div className="flex items-center gap-3 px-4 pt-4 pr-16 pb-16 md:px-8 lg:px-10 lg:pt-8 lg:pb-0 xl:px-14">
          <BrandLogo variant="selo" width={56} priority className="size-11 rounded-full shadow-lg ring-2 ring-white/15 lg:size-14" />
          <div className="grid min-w-0 leading-tight">
            <span className="font-semibold lg:text-lg">Engemase OEE</span>
            <span className="truncate text-sm text-white/70 lg:hidden">Do CLP ao indicador, em tempo real.</span>
            <span className="hidden text-sm text-white/70 lg:inline">Plataforma de eficiência industrial</span>
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 flex-col justify-center gap-10 px-10 py-8 lg:flex xl:px-14 2xl:flex-row 2xl:items-center 2xl:gap-12 2xl:px-16">
          {panel ?? <AccountPanel />}
        </div>

        <div className="hidden items-center justify-between gap-4 border-t border-white/10 px-10 py-4 text-xs text-white/60 lg:flex xl:px-14">
          <span>© 2026 Engemase Engenharia</span>
          <span>Ambiente de demonstração · dados simulados</span>
        </div>
      </aside>

      <main className="relative isolate -mt-10 flex flex-col lg:mt-0">
        <div aria-hidden className="au-grid-soft absolute inset-0 -z-10 hidden lg:block" />
        <div
          aria-hidden
          className="absolute top-1/4 left-1/2 -z-10 hidden size-[32rem] -translate-x-1/2 rounded-full bg-[var(--brand-blue)]/10 blur-3xl lg:block dark:bg-[var(--brand-blue)]/15"
        />
        <div className="absolute top-4 right-4 hidden md:right-8 lg:block [&_button]:size-11">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pb-8 md:px-8 lg:items-center lg:py-12">{children}</div>
        <p className="px-4 pb-6 text-center text-xs text-pretty text-muted-foreground md:px-8 lg:-mt-10">
          Problemas para acessar? Fale com o administrador da sua empresa ou com o suporte Engemase.
        </p>
      </main>
    </div>
  )
}

/** Cartão de vidro do formulário (entra com um leve "pop"). */
export function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("au-glass au-card-in w-full max-w-md rounded-3xl border p-5 sm:p-8 2xl:max-w-lg 2xl:p-10", className)}>{children}</div>
}

/** Título do cartão: sobretítulo com fio (como na apresentação), título e descrição. */
export function AuthHeading({ eyebrow, title, description, className }: { eyebrow: string; title: string; description: string; className?: string }) {
  return (
    <div className={cn("mb-6", className)}>
      <p className="flex items-center gap-2.5 text-xs font-semibold tracking-[0.16em] text-primary uppercase">
        <span aria-hidden className="h-px w-6 bg-primary" />
        {eyebrow}
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{description}</p>
    </div>
  )
}

/** Texto do painel de marca: sobretítulo, título com degradê e parágrafo. */
export function PanelIntro({ eyebrow, title, highlight, text }: { eyebrow: string; title: string; highlight: string; text: string }) {
  return (
    <>
      <p className="au-in flex items-center gap-3 text-sm font-semibold tracking-[0.18em] text-[var(--au-accent)] uppercase" style={delay(0.05)}>
        <span aria-hidden className="h-px w-8 bg-[var(--au-accent)]" />
        {eyebrow}
      </p>
      <h2 className="au-in mt-4 text-4xl leading-[1.08] font-bold tracking-tight text-balance xl:text-5xl" style={delay(0.12)}>
        {title} <span className="bg-gradient-to-r from-[#7cc0ec] via-white to-[#f3a28f] bg-clip-text text-transparent">{highlight}</span>
      </h2>
      <p className="au-in mt-5 max-w-lg text-base text-pretty text-white/70 xl:text-lg" style={delay(0.2)}>
        {text}
      </p>
    </>
  )
}

export type PanelFeature = { icon: LucideIcon; color: string; title: string; text: string }

/** Lista curta de vantagens do painel de marca (ícones decorativos, texto legível). */
export function PanelFeatures({ items, start = 0.28 }: { items: readonly PanelFeature[]; start?: number }) {
  return (
    <ul className="mt-8 hidden gap-x-6 gap-y-4 sm:grid-cols-2 [@media(min-height:980px)]:grid 2xl:grid 2xl:grid-cols-1">
      {items.map(({ icon: Icon, color, title, text }, i) => (
        <li key={title} className="au-in flex gap-3" style={delay(start + i * 0.07)}>
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-white/10" style={{ color }}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 leading-snug">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-sm text-white/60">{text}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Cartão "tela ao vivo" do painel de marca (vidro escuro). */
export function LiveCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-white/12 bg-[var(--au-ink-2)]/85 p-4 shadow-[0_30px_80px_-30px_rgb(0_0_0/80%)] backdrop-blur-md", className)}>
      {children}
    </div>
  )
}

const ACCOUNT_FEATURES: readonly PanelFeature[] = [
  { icon: KeyRoundIcon, color: "#7cc0ec", title: "Links de uso único", text: "Convites e redefinições valem uma vez só e vencem sozinhos." },
  { icon: ShieldCheckIcon, color: "#5fd4a6", title: "Duas etapas", text: "Código do aplicativo autenticador logo após a senha." },
  { icon: Building2Icon, color: "#f3a28f", title: "Dados isolados", text: "Cada empresa vê só os seus dados, com papéis por unidade." },
]

/** Painel de marca das telas de conta (criar/redefinir senha, acesso suspenso). */
function AccountPanel() {
  return (
    <>
      <div className="max-w-xl 2xl:w-[29rem] 2xl:shrink-0">
        <PanelIntro
          eyebrow="Conta e acesso"
          title="Sua conta protegida,"
          highlight="do primeiro acesso ao dia a dia."
          text="Senhas guardadas com criptografia, links que vencem sozinhos e as ações importantes registradas na trilha de auditoria da sua empresa."
        />
        <PanelFeatures items={ACCOUNT_FEATURES} />
      </div>
      <TwoFactorPreview />
    </>
  )
}

const CODE = ["4", "8", "2", "9", "1", "6"]

/** Ilustração: código de 6 dígitos sendo digitado e o acesso confirmado. Decorativa. */
function TwoFactorPreview() {
  return (
    <div aria-hidden className="relative hidden w-full max-w-md self-start [@media(min-height:700px)]:block 2xl:block 2xl:self-center">
      <div className="au-card-in" style={delay(0.35)}>
        <LiveCard className="au-float p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#5fd4a6]/15 text-[#5fd4a6]">
              <ShieldCheckIcon className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Verificação em duas etapas</p>
              <p className="text-xs text-white/60">Código do aplicativo autenticador</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-6 gap-2">
            {CODE.map((d, i) => (
              <span key={i} className="flex h-12 items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] text-xl font-semibold tabular-nums">
                <span className="au-dot-in" style={delay(0.9 + i * 0.16)}>
                  {d}
                </span>
              </span>
            ))}
          </div>
          <p className="au-in mt-4 flex items-center gap-2 text-sm font-medium text-[#5fd4a6]" style={delay(1.95)}>
            <CheckCircle2Icon className="size-4" /> Acesso confirmado
          </p>
        </LiveCard>
      </div>
      <div className="au-card-in absolute -right-4 -bottom-10 xl:-right-10" style={delay(0.6)}>
        <LiveCard className="au-float-2 flex items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--state-stopped)]/20 text-[var(--state-stopped)]">
            <TimerIcon className="size-5" />
          </span>
          <div className="text-sm leading-tight">
            <p className="font-semibold">Link de uso único</p>
            <p className="text-white/60">Vale uma vez e vence sozinho</p>
          </div>
        </LiveCard>
      </div>
    </div>
  )
}

/** Moldura das telas de conta (definir e redefinir senha): painel de marca e o formulário num cartão. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <AuthShell>
      <GlassCard>
        <AuthHeading eyebrow="Conta Engemase OEE" title={title} description={description} />
        {children}
      </GlassCard>
    </AuthShell>
  )
}
