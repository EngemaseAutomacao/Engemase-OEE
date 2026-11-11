import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Frota de gateways" description="Todos os gateways de todos os clientes" />
      <Placeholder title="Frota de gateways" />
    </PageBody>
  )
}
