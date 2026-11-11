import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/relatorios/paradas">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Paradas (Pareto)" description="Pareto de motivos, MTBF/MTTR" />
      <Placeholder title="Paradas (Pareto)" />
    </PageBody>
  )
}
