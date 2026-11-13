import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Building2Icon, ClockIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react"

import { getAccessibleClients } from "@/lib/mock"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { ThemeToggle } from "@/components/theme-toggle"
import { AccessibleClients } from "@/components/account/accessible-clients"
import { AccountNav, BackButton } from "@/components/account/account-chrome"
import { buildAccessibleClients, buildDevices, buildProfile, buildSessions, buildTwoFactorSeed } from "@/components/account/account-data"
import { AppearancePicker } from "@/components/account/appearance-picker"
import { PasswordForm, ProfileForm } from "@/components/account/profile-forms"
import { DeviceList, ThisDeviceCard } from "@/components/account/push-devices"
import { SessionsList } from "@/components/account/sessions-list"
import { TwoFactorCard } from "@/components/account/two-factor"

export const metadata: Metadata = { title: "Minha conta" }

export default function Page() {
  const profile = buildProfile()
  const clients = buildAccessibleClients()
  const devices = buildDevices()
  const firstClient = getAccessibleClients()[0]

  return (
    <div className="min-h-svh bg-background">
      {/* Cabeçalho próprio (fora do layout do cliente) */}
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Link href="/inicio" className="flex min-w-0 items-center gap-2" aria-label="Engemase OEE: início">
            <Image src="/brand/engemase-icone.png" alt="" width={32} height={32} className="size-8 shrink-0" priority />
            <span className="hidden truncate text-sm font-semibold sm:inline">Engemase OEE</span>
          </Link>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <span className="truncate text-sm text-muted-foreground">Minha conta</span>
          <div className="ml-auto flex items-center gap-1.5">
            <BackButton fallbackHref="/inicio" />
            <ThemeToggle />
            <span
              className="hidden size-8 items-center justify-center rounded-full bg-[#2c4e73] text-xs font-semibold text-white sm:flex"
              title={profile.name}
              aria-hidden
            >
              {initials(profile.name)}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Minha conta</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Seus dados, segurança, aparência e notificações. Vale para todos os clientes que você acessa.</p>
        </div>

        {/* Resumo do perfil */}
        <section className="flex flex-col gap-4 rounded-2xl border bg-card px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#2c4e73] text-lg font-bold text-white">{initials(profile.name)}</span>
            <div className="min-w-0">
              <div className="truncate text-lg leading-tight font-bold">{profile.name}</div>
              <div className="truncate text-sm text-muted-foreground">{profile.email}</div>
              <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{profile.roleLabel}</span>
            </div>
          </div>
          <dl className="grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-3 md:border-t-0 md:border-l md:pt-0 md:pl-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#257bb4]/12 text-[#257bb4] dark:text-[#4a9fd6]">
                <Building2Icon className="size-4" aria-hidden />
              </span>
              <div>
                <dt className="text-muted-foreground">Clientes</dt>
                <dd className="text-sm font-semibold tabular-nums">{clients.length}</dd>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full",
                  profile.twoFactor ? "bg-[#0e9384]/12 text-[#0e9384]" : "bg-[#e96549]/14 text-[#cf5539]",
                )}
              >
                {profile.twoFactor ? <ShieldCheckIcon className="size-4" aria-hidden /> : <ShieldOffIcon className="size-4" aria-hidden />}
              </span>
              <div>
                <dt className="text-muted-foreground">2 etapas</dt>
                <dd className="text-sm font-semibold">{profile.twoFactor ? "Ativa" : "Desativada"}</dd>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#2c4e73]/12 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]">
                <ClockIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Último acesso</dt>
                <dd className="truncate text-sm font-semibold">{profile.lastLogin}</dd>
              </div>
            </div>
          </dl>
        </section>

        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
          <AccountNav />

          <div className="flex min-w-0 flex-col gap-4">
            <div id="perfil" className="scroll-mt-32 lg:scroll-mt-20">
              <ProfileForm name={profile.name} email={profile.email} roleLabel={profile.roleLabel} />
            </div>

            <div id="seguranca" className="grid scroll-mt-32 lg:scroll-mt-20 gap-4 xl:grid-cols-2">
              <PasswordForm email={profile.email} />
              <TwoFactorCard initialEnabled={profile.twoFactor} required={profile.isPlatform} seed={buildTwoFactorSeed()} email={profile.email} />
            </div>

            <div id="sessoes" className="scroll-mt-32 lg:scroll-mt-20">
              <SessionsList sessions={buildSessions()} />
            </div>

            <div id="aparencia" className="scroll-mt-32 lg:scroll-mt-20">
              <AppearancePicker />
            </div>

            <div id="clientes" className="scroll-mt-32 lg:scroll-mt-20">
              <AccessibleClients clients={clients} isPlatform={profile.isPlatform} />
            </div>

            <div id="notificacoes" className="grid scroll-mt-32 lg:scroll-mt-20 gap-4 xl:grid-cols-2">
              <ThisDeviceCard />
              <SectionCard
                title="Aparelhos com notificação"
                description="Recebem push dos alertas que você escolheu"
                href={firstClient ? `/${firstClient.slug}/notificacoes` : undefined}
                linkLabel="Preferências de alertas"
              >
                <DeviceList devices={devices} />
              </SectionCard>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
