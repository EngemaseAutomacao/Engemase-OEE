import { adminClientParams } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export function generateStaticParams() {
  return adminClientParams()
}

export default async function Page({ params }: PageProps<"/admin/clientes/[clienteId]">) {
  const { clienteId } = await params
  void [clienteId]
  return (
    <PageBody>
      <PageHeader title="Cliente" description="Detalhe do cliente" />
      <Placeholder title="Cliente" />
    </PageBody>
  )
}
