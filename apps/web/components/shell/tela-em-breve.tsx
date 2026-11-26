import Link from "next/link"
import { ConstructionIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

/**
 * Tela que ainda só existe com dados simulados. No sistema real (com banco) ela aparece no lugar dos
 * dados fictícios, para nunca misturar simulação com dado de cliente; a versão simulada continua no
 * ambiente de demonstração (`ENGEMASE_DEMONSTRACAO=1`).
 */
export function TelaEmBreve({ titulo, voltarPara, voltarTexto = "Voltar" }: { titulo: string; voltarPara: string; voltarTexto?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 md:p-6">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ConstructionIcon />
          </EmptyMedia>
          <EmptyTitle>{titulo}: em breve</EmptyTitle>
          <EmptyDescription>
            Esta tela ainda não está ligada aos dados reais da plataforma. Ela pode ser vista com dados simulados no ambiente de
            demonstração.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href={voltarPara} className={buttonVariants({ variant: "outline" })}>
            {voltarTexto}
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  )
}
