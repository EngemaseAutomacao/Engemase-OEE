import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default function Page() {
  return (
    <PageBody>
      <PageHeader title="Minha conta" description="Perfil, senha, 2FA, tema e dispositivos" />
      <Placeholder title="Minha conta" />
    </PageBody>
  )
}
