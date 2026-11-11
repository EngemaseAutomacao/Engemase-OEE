import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Clientes" description="Todos os clientes da plataforma" />
      <Placeholder title="Clientes" />
    </PageBody>
  )
}
