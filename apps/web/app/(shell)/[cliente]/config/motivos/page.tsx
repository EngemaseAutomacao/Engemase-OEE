import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/motivos">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Motivos de parada" description="Árvore de motivos de parada" />
      <Placeholder title="Motivos de parada" />
    </PageBody>
  )
}
