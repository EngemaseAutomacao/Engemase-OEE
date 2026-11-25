import { BrandLogo, BrandWatermark } from "@/components/shell/brand"
import { ThemeToggle } from "@/components/theme-toggle"

/** Moldura das telas públicas da conta (definir e redefinir senha): marca, tema e um cartão no centro. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background">
      <BrandWatermark className="absolute -top-6 -right-24 -z-10 w-[340px] opacity-40" />
      <div className="flex items-center justify-between gap-2 p-4 md:px-8">
        <BrandLogo width={112} priority />
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pt-2 pb-10 sm:items-center sm:pt-0 md:px-8">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </main>
      <p className="px-4 pb-6 text-center text-xs text-muted-foreground md:px-8">
        Problemas para acessar? Fale com o administrador da sua empresa ou com o suporte Engemase.
      </p>
    </div>
  )
}
