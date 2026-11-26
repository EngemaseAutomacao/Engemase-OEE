import { Skeleton } from "@/components/ui/skeleton"

/** Esqueleto de página enquanto os dados do banco chegam (fallback do <Suspense>). */
export function CarregandoPagina({ cartoes = 4 }: { cartoes?: number }) {
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6" aria-busy="true" aria-label="Carregando">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {cartoes > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: cartoes }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  )
}
