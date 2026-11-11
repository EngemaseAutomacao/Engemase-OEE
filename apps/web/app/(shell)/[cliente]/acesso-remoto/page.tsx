import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/acesso-remoto">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Acesso remoto" description="Pedidos e histórico de acesso remoto (VPN) da Engemase aos gateways" />
      <Placeholder title="Acesso remoto" />
    </PageBody>
  )
}
