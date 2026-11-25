import { Suspense } from "react"
import type { Metadata } from "next"

import { AndonBoard, AndonSkeleton } from "@/components/kiosk/andon-board"

export const metadata: Metadata = { title: "Andon" }

/** TV / Andon da linha: tela cheia, fonte grande e alto contraste (tema escuro fixo). */
export default function Page({ params }: PageProps<"/[cliente]/andon/[linhaId]">) {
  return (
    <Suspense fallback={<AndonSkeleton />}>
      <AndonBoard params={params} />
    </Suspense>
  )
}
