import { Skeleton } from "@/components/ui/skeleton"

/**
 * Esqueleto das telas de acompanhamento enquanto os dados do cliente chegam (sessão conferida e banco
 * lido). Mesmo espaçamento do padrão das páginas, para a tela não "pular" ao carregar.
 */
export function PageSkeleton({ cards = 4, blocks = 2 }: { cards?: number; blocks?: number }) {
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6" aria-busy="true" aria-label="Carregando">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {cards > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} className="h-72 rounded-2xl" />
      ))}
    </div>
  )
}
