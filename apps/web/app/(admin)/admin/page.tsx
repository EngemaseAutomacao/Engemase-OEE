import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Visão geral da plataforma" description="Clientes, gateways e alertas" />
      <Placeholder title="Visão geral da plataforma" />
    </PageBody>
  )
}
