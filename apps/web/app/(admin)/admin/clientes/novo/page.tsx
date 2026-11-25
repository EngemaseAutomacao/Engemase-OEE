import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { Suspense } from "react"

import { dadosNovoCliente } from "@/lib/data/admin/console"
import { usarBanco } from "@/lib/data/fonte"
import { PageTitle } from "@/components/admin/bits"
import { NewClientWizard } from "@/components/admin/new-client-wizard"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata: Metadata = { title: "Novo cliente" }

/** Com banco, lê a sessão e os clientes: fica dentro do <Suspense>. */
async function Assistente() {
  const ctx = await dadosNovoCliente()
  return <NewClientWizard ctx={ctx} banco={usarBanco()} />
}

export default function Page() {
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle title="Novo cliente" description="Assistente em 3 passos: empresa, primeira unidade e primeiro admin. O cliente nasce em implantação.">
        <Link href="/admin/clientes" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <ChevronLeftIcon className="size-3.5" />
          Clientes
        </Link>
      </PageTitle>
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Assistente />
      </Suspense>
    </div>
  )
}
