"use client"

import { useState } from "react"
import { ChevronRightIcon, ClockIcon, LifeBuoyIcon, ThumbsDownIcon, ThumbsUpIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ArticleBody } from "./article-body"
import { CATEGORY_META } from "./help-meta"
import type { ArticleVM } from "./help-types"

/** Leitura de um artigo da central de ajuda num painel lateral. */
export function ArticleSheet({
  open,
  article,
  articles,
  onOpenChange,
  onNavigate,
  onTicket,
}: {
  open: boolean
  article: ArticleVM | null
  articles: ArticleVM[]
  onOpenChange: (open: boolean) => void
  onNavigate: (slug: string) => void
  onTicket: (subject: string) => void
}) {
  const [feedback, setFeedback] = useState<Record<string, "yes" | "no">>({})

  const related = article
    ? [
        ...articles.filter((a) => a.category === article.category && a.slug !== article.slug),
        ...articles.filter((a) => a.category !== article.category && a.slug !== article.slug),
      ].slice(0, 3)
    : []

  function vote(v: "yes" | "no") {
    if (!article) return
    setFeedback((f) => ({ ...f, [article.slug]: v }))
    if (v === "yes") toast.success("Obrigado pelo retorno!", { description: "Isso nos ajuda a priorizar os guias mais úteis." })
    else
      toast("Obrigado. Vamos melhorar este artigo.", {
        description: "Se ainda precisar de ajuda, abra um chamado.",
        action: { label: "Abrir chamado", onClick: () => onTicket(`Dúvida: ${article.title}`) },
      })
  }

  const meta = article ? CATEGORY_META[article.category] : null
  const voted = article ? feedback[article.slug] : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        {article && meta && (
          <>
            <SheetHeader className="gap-2 border-b px-5 pt-5 pb-4">
              <div className="flex items-center gap-2 pr-8">
                <IconCircle icon={meta.icon} tone={meta.tone} soft size="sm" />
                <span className="text-xs font-semibold text-muted-foreground">{article.categoryLabel}</span>
              </div>
              <SheetTitle className="text-lg leading-snug font-bold tracking-tight">{article.title}</SheetTitle>
              <SheetDescription>{article.summary}</SheetDescription>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ClockIcon className="size-3.5" />
                  {article.minutes} min de leitura
                </span>
                <span className="inline-flex items-center gap-1">
                  <UsersIcon className="size-3.5" />
                  Para: {article.audience}
                </span>
              </div>
            </SheetHeader>

            <div key={article.slug} className="flex-1 overflow-y-auto px-5 py-5">
              <ArticleBody blocks={article.body} />

              <div className="mt-6 flex flex-col gap-3 rounded-xl bg-muted/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium">{voted ? "Obrigado pelo retorno!" : "Este artigo ajudou?"}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-pressed={voted === "yes"}
                    className={cn(voted === "yes" && "border-state-running/40 bg-state-running/10 text-state-running")}
                    onClick={() => vote("yes")}
                  >
                    <ThumbsUpIcon />
                    Sim
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-pressed={voted === "no"}
                    className={cn(voted === "no" && "border-state-fault/40 bg-state-fault/10 text-state-fault")}
                    onClick={() => vote("no")}
                  >
                    <ThumbsDownIcon />
                    Não
                  </Button>
                </div>
              </div>

              {related.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Leia também</h3>
                  <ul className="divide-y rounded-xl border">
                    {related.map((r) => {
                      const m = CATEGORY_META[r.category]
                      return (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onClick={() => onNavigate(r.slug)}
                            className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50"
                          >
                            <IconCircle icon={m.icon} tone={m.tone} soft size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium group-hover:text-primary">{r.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {r.categoryLabel} · {r.minutes} min
                              </span>
                            </span>
                            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
              <span className="text-xs text-muted-foreground">Ainda com dúvida? Nosso suporte responde pela plataforma.</span>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onTicket(`Dúvida: ${article.title}`)}>
                <LifeBuoyIcon />
                Abrir chamado
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
