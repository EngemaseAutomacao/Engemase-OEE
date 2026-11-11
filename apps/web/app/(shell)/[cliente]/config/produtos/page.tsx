import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/produtos">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Produtos" description="Produtos e ciclo ideal por máquina" />
      <Placeholder title="Produtos" />
    </PageBody>
  )
}
