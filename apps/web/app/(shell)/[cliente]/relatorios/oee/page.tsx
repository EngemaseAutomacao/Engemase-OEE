import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/relatorios/oee">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Relatório de OEE" description="OEE por período, turno, máquina e produto" />
      <Placeholder title="Relatório de OEE" />
    </PageBody>
  )
}
