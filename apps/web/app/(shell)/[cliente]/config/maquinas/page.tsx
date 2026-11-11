import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/maquinas">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Cadastro de máquinas" description="Máquinas, tags e regras de estado" />
      <Placeholder title="Cadastro de máquinas" />
    </PageBody>
  )
}
