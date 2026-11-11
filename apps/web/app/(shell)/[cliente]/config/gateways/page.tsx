import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export default async function Page({ params }: PageProps<"/[cliente]/config/gateways">) {
  const { cliente } = await params
  void [cliente]
  return (
    <PageBody>
      <PageHeader title="Gateways" description="Gateways, status e provisionamento" />
      <Placeholder title="Gateways" />
    </PageBody>
  )
}
