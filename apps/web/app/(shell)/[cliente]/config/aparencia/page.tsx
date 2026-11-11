import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/aparencia">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Aparência" description="Cores e logotipos do cliente" />
      <Placeholder title="Aparência" />
    </PageBody>
  )
}
