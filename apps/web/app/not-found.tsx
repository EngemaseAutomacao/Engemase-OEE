import type { Metadata } from "next"
import Link from "next/link"
import { SearchXIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export const metadata: Metadata = { title: "Página não encontrada" }

/** 404 em português para todo o app (as telas chamam `notFound()` quando o cliente, a máquina ou a linha não existe). */
export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Página não encontrada</EmptyTitle>
          <EmptyDescription>
            O endereço pode estar errado ou o item (cliente, máquina, linha) não existe mais.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Link href="/inicio" className={buttonVariants()}>
            Ir para o início
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Página do produto
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  )
}
