import type { Metadata } from "next"
import { Suspense } from "react"

import { dadosUnidades } from "@/lib/data/config/telas"
import { PLAN_LABEL } from "@/lib/roles"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { FonteDadosProvider } from "@/components/config/fonte-dados"
import { UsageMeter } from "@/components/config/plan-usage"
import { UnitsManager } from "@/components/config/units-manager"
import { CarregandoPagina } from "@/components/shell/carregando"

export const metadata: Metadata = { title: "Unidades e linhas" }

/** Com banco, lê a sessão e o cadastro (requireTenant): fica dentro do <Suspense>. */
async function Estrutura({ params }: { params: PageProps<"/[cliente]/config/unidades">["params"] }) {
  const { cliente } = await params
  const d = await dadosUnidades(cliente)
  const { client } = d

  return (
    <FonteDadosProvider banco={d.banco} slug={client.slug}>
      <ConfigAccessProvider canEdit={d.access.canConfigure}>
        <div className="flex flex-col gap-5 p-4 md:p-6">
          <EngemaseManagedNote clientSlug={client.slug} subject="Unidades, áreas e linhas" />
          <UnitsManager
            clientSlug={client.slug}
            title="Unidades e linhas"
            description={`Estrutura de ${client.name}: unidade → área → linha → máquinas.`}
            machineLimit={client.limits.machines}
            initialUnits={d.unitNodes}
            initialAreas={d.areaNodes}
            initialLines={d.lineNodes}
            summary={
              <SectionCard
                title={`Plano ${PLAN_LABEL[client.plan]}`}
                description={`Assinatura cobrada por máquina: ${client.limits.machines} máquinas contratadas · retenção de dados de ${client.limits.retentionMonths} meses. Para contratar mais máquinas, fale com a Engemase.`}
                href={`/${client.slug}/ajuda`}
                linkLabel="Falar com a Engemase"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  {d.usage.map((it) => (
                    <UsageMeter key={it.label} item={it} />
                  ))}
                </div>
              </SectionCard>
            }
          />
        </div>
      </ConfigAccessProvider>
    </FonteDadosProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/unidades">) {
  return (
    <Suspense fallback={<CarregandoPagina cartoes={0} />}>
      <Estrutura params={params} />
    </Suspense>
  )
}
