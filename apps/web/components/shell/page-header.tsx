import { cn } from "@/lib/utils"

/** Cabeçalho padrão das páginas: título, descrição e ações à direita. */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Container de conteúdo com espaçamento padrão. */
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-col gap-6 p-4 md:p-6", className)}>{children}</div>
}
