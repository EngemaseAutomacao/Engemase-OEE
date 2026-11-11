import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Entrar" description="Tela de login" />
      <Placeholder title="Entrar" />
    </PageBody>
  )
}
