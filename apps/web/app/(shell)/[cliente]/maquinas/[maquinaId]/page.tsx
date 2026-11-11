import { machineParams } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return machineParams(params.cliente)
}

export default async function Page({ params }: PageProps<"/[cliente]/maquinas/[maquinaId]">) {
  const { cliente, maquinaId } = await params
  void [cliente, maquinaId]
  return (
    <PageBody>
      <PageHeader title="Detalhe da máquina" description="Estado, timeline, OEE, paradas e produção" />
      <Placeholder title="Detalhe da máquina" />
    </PageBody>
  )
}
