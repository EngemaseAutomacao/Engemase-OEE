import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { PlusIcon } from "lucide-react"

import { dadosCadastroMaquinas } from "@/lib/data/config/telas"
import { Button } from "@/components/ui/button"
import { MachineRegistry } from "@/components/config/machine-registry"
import { ConfigAccessProvider, EngemaseManagedNote, EngemaseOnlyChip } from "@/components/config/engemase-managed"
import { FonteDadosProvider } from "@/components/config/fonte-dados"
import { PageTitle } from "@/components/refresh/page-title"
import { CarregandoPagina } from "@/components/shell/carregando"

export const metadata: Metadata = { title: "Cadastro de máquinas" }

/** Com banco, lê a sessão e o cadastro (requireTenant): fica dentro do <Suspense>. */
async function Cadastro({ params }: { params: PageProps<"/[cliente]/config/maquinas">["params"] }) {
  const { cliente } = await params
  const d = await dadosCadastroMaquinas(cliente)
  const { client, access } = d

  return (
    <FonteDadosProvider banco={d.banco} slug={client.slug}>
      <ConfigAccessProvider canEdit={access.canConfigure}>
        <div className="flex flex-col gap-5 p-4 md:p-6">
          <EngemaseManagedNote clientSlug={client.slug} subject="Máquinas, conexões com os CLPs e sinais" />
          <PageTitle
            title="Cadastro de máquinas"
            description="Identificação, conexão Modbus com o CLP, modo de estado e ciclo ideal de cada máquina."
            actions={
              access.canConfigure && (
                <>
                  <EngemaseOnlyChip />
                  <Button asChild>
                    <Link href={`/${client.slug}/config/maquinas/nova`}>
                      <PlusIcon />
                      Nova máquina
                    </Link>
                  </Button>
                </>
              )
            }
          />
          <MachineRegistry
            clientSlug={client.slug}
            initialRows={d.rows}
            units={d.units}
            lines={d.lines}
            gateways={d.gateways}
            machineLimit={client.limits.machines}
          />
        </div>
      </ConfigAccessProvider>
    </FonteDadosProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/maquinas">) {
  return (
    <Suspense fallback={<CarregandoPagina cartoes={0} />}>
      <Cadastro params={params} />
    </Suspense>
  )
}
