import { Suspense } from "react"
import type { Metadata } from "next"

import { getLine, lineParams } from "@/lib/mock"
import { AndonBoard, AndonSkeleton } from "@/components/kiosk/andon-board"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return lineParams(params.cliente)
}

export async function generateMetadata({ params }: PageProps<"/[cliente]/andon/[linhaId]">): Promise<Metadata> {
  const { linhaId } = await params
  const line = getLine(linhaId)
  return { title: line ? `Andon · ${line.name}` : "Andon" }
}

/** TV / Andon da linha: tela cheia, fonte grande e alto contraste (tema escuro fixo). */
export default function Page({ params }: PageProps<"/[cliente]/andon/[linhaId]">) {
  return (
    <Suspense fallback={<AndonSkeleton />}>
      <AndonBoard params={params} />
    </Suspense>
  )
}
