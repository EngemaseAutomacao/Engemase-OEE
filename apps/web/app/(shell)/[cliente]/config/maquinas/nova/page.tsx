import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/maquinas/nova">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Nova máquina" description="Assistente de cadastro de máquina" />
      <Placeholder title="Nova máquina" />
    </PageBody>
  )
}
