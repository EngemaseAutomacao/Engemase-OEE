import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/unidades">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Unidades e linhas" description="Unidades, áreas e linhas do cliente" />
      <Placeholder title="Unidades e linhas" />
    </PageBody>
  )
}
