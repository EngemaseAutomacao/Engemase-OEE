import { gatewayParams } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return gatewayParams(params.cliente)
}

export default async function Page({ params }: PageProps<"/[cliente]/config/gateways/[gatewayId]">) {
  const { cliente, gatewayId } = await params
  void [cliente, gatewayId]
  return (
    <PageBody>
      <PageHeader title="Gateway" description="Conexões Modbus, tags e comandos" />
      <Placeholder title="Gateway" />
    </PageBody>
  )
}
