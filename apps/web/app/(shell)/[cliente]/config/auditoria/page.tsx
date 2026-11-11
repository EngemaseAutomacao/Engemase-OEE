import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/auditoria">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Auditoria" description="Histórico de alterações" />
      <Placeholder title="Auditoria" />
    </PageBody>
  )
}
