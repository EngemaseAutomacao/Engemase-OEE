import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/terminais">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Terminais (TV e tablets)" description="Dispositivos pareados para Andon e tela do operador" />
      <Placeholder title="Terminais (TV e tablets)" />
    </PageBody>
  )
}
