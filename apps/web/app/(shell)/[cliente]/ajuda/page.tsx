import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/ajuda">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Central de ajuda" description="Guias, perguntas frequentes e suporte" />
      <Placeholder title="Central de ajuda" />
    </PageBody>
  )
}
