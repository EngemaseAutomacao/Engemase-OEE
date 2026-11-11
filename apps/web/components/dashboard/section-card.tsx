import Link from "next/link"

import { cn } from "@/lib/utils"

/** Cartão de seção do painel: título, subtítulo opcional e link "Ver tudo" à direita. */
export function SectionCard({
  title,
  description,
  href,
  linkLabel = "Ver tudo",
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: React.ReactNode
  href?: string
  linkLabel?: string
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
        {href && (
          <Link href={href} className="shrink-0 text-xs font-semibold text-primary hover:underline">
            {linkLabel}
          </Link>
        )}
      </header>
      <div className={cn("min-w-0 flex-1 px-5 pb-5", bodyClassName)}>{children}</div>
    </section>
  )
}
