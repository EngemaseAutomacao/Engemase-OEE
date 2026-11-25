import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { ArrowLeftIcon, LockIcon } from "lucide-react"

import { dadosNovaMaquina } from "@/lib/data/config/telas"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { FonteDadosProvider } from "@/components/config/fonte-dados"
import { NewMachineWizard } from "@/components/config/new-machine-wizard"
import { CarregandoPagina } from "@/components/shell/carregando"

export const metadata: Metadata = { title: "Nova máquina" }

/** Com banco, lê a sessão e o cadastro (requireTenant): fica dentro do <Suspense>. */
async function Assistente({ params }: { params: PageProps<"/[cliente]/config/maquinas/nova">["params"] }) {
  const { cliente } = await params
  const d = await dadosNovaMaquina(cliente)
  const { client, access } = d

  return (
    <FonteDadosProvider banco={d.banco} slug={client.slug}>
    <ConfigAccessProvider canEdit={access.canConfigure}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <EngemaseManagedNote clientSlug={client.slug} subject="Máquinas, conexões com os CLPs e sinais" />
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              <Link href={`/${client.slug}/config/maquinas`} className="hover:text-primary">
                Cadastro de máquinas
              </Link>{" "}
              / Nova máquina
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">Nova máquina</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {access.canConfigure
                ? `Cadastre, conecte ao CLP por Modbus e ative a coleta de OEE em ${client.name}, sem SSH e sem desenvolvedor.`
                : `Máquinas novas em ${client.name} são cadastradas pela equipe Engemase.`}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/${client.slug}/config/maquinas`}>
              <ArrowLeftIcon />
              Voltar ao cadastro
            </Link>
          </Button>
        </div>

        {access.canConfigure ? (
          <NewMachineWizard
            clientSlug={client.slug}
            clientName={client.name}
            units={d.units}
            lines={d.lines}
            gateways={d.gateways}
            devices={d.devices}
            existingCodes={d.existingCodes}
            machineTypes={d.machineTypes}
            machineTemplates={d.machineTemplates}
            machineCount={d.machineCount}
            machineLimit={client.limits.machines}
          />
        ) : (
          <Empty className="rounded-2xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LockIcon />
              </EmptyMedia>
              <EmptyTitle>Cadastro de máquinas é feito pela Engemase</EmptyTitle>
              <EmptyDescription>
                Conectar o CLP, mapear os sinais e ativar a coleta é trabalho da equipe Engemase. Abra um chamado com a máquina, a linha e o modelo do CLP.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href={`/${client.slug}/ajuda`}>Abrir chamado</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </ConfigAccessProvider>
    </FonteDadosProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/maquinas/nova">) {
  return (
    <Suspense fallback={<CarregandoPagina cartoes={0} />}>
      <Assistente params={params} />
    </Suspense>
  )
}
