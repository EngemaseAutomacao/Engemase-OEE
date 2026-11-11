import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Novo cliente" description="Assistente de criação de cliente" />
      <Placeholder title="Novo cliente" />
    </PageBody>
  )
}
