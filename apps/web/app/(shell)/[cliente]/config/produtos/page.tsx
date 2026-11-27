import type { Metadata } from "next"
import { Suspense } from "react"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { ProductsManager } from "@/components/config/products-manager"
import { CarregandoPagina } from "@/components/shell/carregando"
import { dadosProdutos } from "@/lib/data/config/produtos"

export const metadata: Metadata = { title: "Produtos" }

/** Lê a sessão e o cadastro (com banco, `requireTenant`): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/produtos">["params"] }) {
  const { cliente } = await params
  const d = await dadosProdutos(cliente)
  return (
    <ConfigAccessProvider canEdit={d.canEdit}>
      <EngemaseManagedNote padded clientSlug={d.client.slug} subject="Produtos e ciclos ideais" />
      <ProductsManager initialProducts={d.products} machines={d.machines} units={d.units} banco={d.banco} clientSlug={d.client.slug} />
    </ConfigAccessProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/produtos">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
