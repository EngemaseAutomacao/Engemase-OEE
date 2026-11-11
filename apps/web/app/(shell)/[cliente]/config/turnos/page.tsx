import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/turnos">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Turnos" description="Calendário de turnos e paradas planejadas" />
      <Placeholder title="Turnos" />
    </PageBody>
  )
}
