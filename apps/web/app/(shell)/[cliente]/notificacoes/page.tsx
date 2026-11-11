import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/notificacoes">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Notificações" description="Alertas das suas máquinas, preferências e dispositivos" />
      <Placeholder title="Notificações" />
    </PageBody>
  )
}
