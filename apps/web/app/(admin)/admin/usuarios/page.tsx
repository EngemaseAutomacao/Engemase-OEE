import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Equipe Engemase" description="Usuários da plataforma" />
      <Placeholder title="Equipe Engemase" />
    </PageBody>
  )
}
