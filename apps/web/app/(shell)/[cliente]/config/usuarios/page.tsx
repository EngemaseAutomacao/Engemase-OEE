import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/usuarios">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Usuários" description="Usuários, papéis e escopo de unidades" />
      <Placeholder title="Usuários" />
    </PageBody>
  )
}
