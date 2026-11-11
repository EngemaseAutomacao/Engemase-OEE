import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Visão geral" description="Estado ao vivo das máquinas e OEE do turno" />
      <Placeholder title="Visão geral" />
    </PageBody>
  )
}
