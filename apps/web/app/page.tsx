import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Escolha o cliente" description="Seletor de cliente / página inicial" />
      <Placeholder title="Escolha o cliente" />
    </PageBody>
  )
}
