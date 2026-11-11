import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Auditoria global" description="Histórico de todas as ações" />
      <Placeholder title="Auditoria global" />
    </PageBody>
  )
}
