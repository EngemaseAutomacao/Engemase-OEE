"use client"

import Link from "next/link"
import { TriangleAlertIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

/**
 * Erro inesperado numa tela: mensagem em português e "Tentar de novo" sem perder o resto do app.
 * O detalhe técnico não aparece para o usuário; só o código (`digest`) que liga ao log do servidor.
 */
export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined
  return (
    <main className="flex min-h-[60svh] flex-1 items-center justify-center p-4">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Não foi possível abrir esta tela</EmptyTitle>
          <EmptyDescription>
            Algo deu errado do nosso lado. Tente de novo; se continuar, fale com o suporte da Engemase
            {digest ? ` e informe o código ${digest}` : ""}.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button onClick={() => retry()}>Tentar de novo</Button>
          <Link href="/inicio" className={buttonVariants({ variant: "outline" })}>
            Ir para o início
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  )
}
