import { lineParams } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Placeholder } from "@/components/shell/placeholder"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return lineParams(params.cliente)
}

export default async function Page({ params }: PageProps<"/[cliente]/andon/[linhaId]">) {
  const { cliente, linhaId } = await params
  void [cliente, linhaId]
  return (
    <PageBody>
      <PageHeader title="TV / Andon" description="Modo TV da linha" />
      <Placeholder title="TV / Andon" />
    </PageBody>
  )
}
