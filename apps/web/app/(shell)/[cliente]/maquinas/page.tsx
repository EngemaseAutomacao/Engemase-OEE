import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/maquinas">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Máquinas" description="Lista de máquinas com estado e OEE" />
      <Placeholder title="Máquinas" />
    </PageBody>
  )
}
