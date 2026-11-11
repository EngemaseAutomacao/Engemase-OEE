import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Acesso remoto" description="Sessões e pedidos de VPN de todos os clientes" />
      <Placeholder title="Acesso remoto" />
    </PageBody>
  )
}
