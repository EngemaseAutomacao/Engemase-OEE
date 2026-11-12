import { cn } from "@/lib/utils"

/**
 * Cabeçalho de página no padrão novo (ver app/(shell)/[cliente]/page.tsx):
 * título text-2xl em negrito, subtítulo discreto e ações/filtros à direita.
 * Sem estado: funciona em componente de servidor ou de cliente.
 */
export function PageTitle({
  title,
  description,
  actions,
  eyebrow,
  children,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Linha acima do título (ex.: trilha de navegação). */
  eyebrow?: React.ReactNode
  /** Conteúdo logo abaixo do subtítulo (ex.: estado ao vivo). */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div>}
    </div>
  )
}
