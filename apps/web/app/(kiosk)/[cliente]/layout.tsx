import { notFound } from "next/navigation"

import { clientParams, getClientBySlug } from "@/lib/mock"

export function generateStaticParams() {
  return clientParams()
}

/** Layout de tela cheia (TV/Andon e tablet do operador): sem menu lateral. */
export default async function KioskLayout({ children, params }: LayoutProps<"/[cliente]">) {
  const { cliente } = await params
  if (!getClientBySlug(cliente)) notFound()
  return <div className="min-h-dvh bg-background">{children}</div>
}
