import { ConstructionIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

/** Placeholder temporário de página ainda não desenhada. */
export function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ConstructionIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description ?? "Tela em construção."}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
