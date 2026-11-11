import { machineParams } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return machineParams(params.cliente)
}

export default async function Page({ params }: PageProps<"/[cliente]/operador/[maquinaId]">) {
  const { cliente, maquinaId } = await params
  void [cliente, maquinaId]
  return (
    <PageBody>
      <PageHeader title="Tela do operador" description="Tablet do operador" />
      <Placeholder title="Tela do operador" />
    </PageBody>
  )
}
