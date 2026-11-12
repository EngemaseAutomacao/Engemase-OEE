"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRightIcon, ClockIcon, LifeBuoyIcon, SearchIcon, SearchXIcon, UsersIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { ArticleSheet } from "./article-sheet"
import { CATEGORY_META } from "./help-meta"
import { useHelp } from "./help-provider"
import { normalize, type ArticleVM, type CategoryVM, type FaqVM, type HelpCategoryId } from "./help-types"

const QUICK_SEARCHES = ["OEE", "RS-485", "Bloco OEE", "iPhone", "Gateway offline", "Acesso remoto"]
const POPULAR_COUNT = 6

function matches(searchText: string, tokens: string[]) {
  return tokens.every((t) => searchText.includes(t))
}

/** Busca, categorias, artigos, perguntas frequentes e leitura do artigo (Sheet). */
export function HelpCenter({
  firstName,
  articles,
  categories,
  faq,
  aside,
}: {
  firstName: string
  articles: ArticleVM[]
  categories: CategoryVM[]
  faq: FaqVM[]
  aside: React.ReactNode
}) {
  const { openTicket } = useHelp()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<HelpCategoryId | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [slug, setSlug] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const articlesRef = useRef<HTMLDivElement>(null)

  // Atalho "/" para focar a busca (fora de campos de texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query])
  const searching = tokens.length > 0

  const visibleArticles = useMemo(() => {
    if (searching) return articles.filter((a) => matches(a.searchText, tokens))
    if (category) return articles.filter((a) => a.category === category)
    return showAll ? articles : articles.slice(0, POPULAR_COUNT)
  }, [articles, category, searching, showAll, tokens])

  const visibleFaq = useMemo(() => (searching ? faq.filter((f) => matches(f.searchText, tokens)) : faq), [faq, searching, tokens])

  const current = slug ? (articles.find((a) => a.slug === slug) ?? null) : null

  function openArticle(next: string) {
    setSlug(next)
    setSheetOpen(true)
  }
  const activeCategory = category ? categories.find((c) => c.id === category) : undefined

  function pickCategory(id: HelpCategoryId) {
    setQuery("")
    setCategory((c) => (c === id ? null : id))
    articlesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function clearFilters() {
    setQuery("")
    setCategory(null)
  }

  const listTitle = searching ? `Resultados para “${query.trim()}”` : activeCategory ? activeCategory.label : "Artigos populares"
  const listDescription = searching
    ? `${visibleArticles.length} ${visibleArticles.length === 1 ? "artigo" : "artigos"} · ${visibleFaq.length} ${visibleFaq.length === 1 ? "pergunta frequente" : "perguntas frequentes"}`
    : activeCategory
      ? `${CATEGORY_META[activeCategory.id].description} · ${activeCategory.count} ${activeCategory.count === 1 ? "artigo" : "artigos"}`
      : "Os guias mais lidos pelas equipes de produção e engenharia"

  return (
    <>
      {/* Busca */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2b8cc4] via-[#257bb4] to-[#1d5a86] px-5 py-6 text-white shadow-sm md:px-8 md:py-8">
        <LifeBuoyIcon className="pointer-events-none absolute -top-6 -right-6 size-44 opacity-10" aria-hidden />
        <div className="relative max-w-2xl">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">Olá, {firstName}. Como podemos ajudar?</h2>
          <p className="mt-1 text-sm text-white/80">Busque em guias de OEE, chão de fábrica, Modbus e gateways, ou fale com o suporte da Engemase.</p>
          <div className="relative mt-4">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("")
              }}
              placeholder="Ex.: CRC inválido, micro-parada, notificação no iPhone…"
              aria-label="Buscar na central de ajuda"
              className="h-12 w-full rounded-xl border-0 bg-white pr-12 pl-11 text-[15px] text-slate-900 shadow-lg outline-none placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-white/40 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  inputRef.current?.focus()
                }}
                className="absolute top-1/2 right-2.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Limpar busca"
              >
                <XIcon className="size-4" />
              </button>
            ) : (
              <Kbd className="absolute top-1/2 right-3.5 hidden -translate-y-1/2 bg-slate-100 text-slate-500 sm:inline-flex">/</Kbd>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-white/70">Buscas frequentes:</span>
            {QUICK_SEARCHES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setCategory(null)
                  setQuery(q)
                }}
                className="rounded-full bg-white/15 px-2.5 py-1 font-medium text-white transition hover:bg-white/25"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Categorias */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((c) => {
          const meta = CATEGORY_META[c.id]
          const active = category === c.id && !searching
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => pickCategory(c.id)}
              className={cn(
                "group flex items-center gap-4 rounded-2xl border bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                active && "border-primary ring-1 ring-primary",
              )}
            >
              <IconCircle icon={meta.icon} tone={meta.tone} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold group-hover:text-primary">{c.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{meta.description}</span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">{c.count}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div ref={articlesRef} className="flex min-w-0 scroll-mt-20 flex-col gap-4 xl:col-span-8">
          <SectionCard
            title={listTitle}
            description={listDescription}
            action={
              searching || category ? (
                <Button variant="ghost" size="xs" className="shrink-0 text-primary" onClick={clearFilters}>
                  <XIcon />
                  Limpar
                </Button>
              ) : (
                <Button variant="ghost" size="xs" className="shrink-0 font-semibold text-primary" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Mostrar menos" : `Ver todos (${articles.length})`}
                </Button>
              )
            }
          >
            {visibleArticles.length > 0 ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {visibleArticles.map((a) => {
                  const meta = CATEGORY_META[a.category]
                  return (
                    <li key={a.slug} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openArticle(a.slug)}
                        className="group flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <IconCircle icon={meta.icon} tone={meta.tone} soft size="sm" className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:text-primary">{a.title}</span>
                          <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.summary}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <ClockIcon className="size-3" />
                              {a.minutes} min
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <UsersIcon className="size-3" />
                              {a.audience}
                            </span>
                            {(searching || !category) && <span className="truncate">{a.categoryLabel}</span>}
                          </span>
                        </span>
                        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty className="border p-6 md:p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchXIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhum artigo encontrado</EmptyTitle>
                  <EmptyDescription>Tente outras palavras (ex.: “CRC”, “turno”, “iPhone”) ou descreva o problema num chamado.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="flex-row flex-wrap justify-center">
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Limpar busca
                  </Button>
                  <Button size="sm" onClick={() => openTicket({ subject: query.trim() })}>
                    <LifeBuoyIcon />
                    Abrir chamado
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </SectionCard>

          <SectionCard
            title="Perguntas frequentes"
            description={searching ? `${visibleFaq.length} de ${faq.length} perguntas com esses termos` : "Respostas rápidas para as dúvidas mais comuns"}
          >
            {visibleFaq.length > 0 ? (
              <Accordion key={searching ? `q:${tokens.join(" ")}` : "all"} type="multiple" defaultValue={searching ? visibleFaq.map((f) => f.id) : []}>
                {visibleFaq.map((f) => (
                  <AccordionItem key={f.id} value={f.id}>
                    <AccordionTrigger className="py-3.5 hover:no-underline hover:text-primary">{f.q}</AccordionTrigger>
                    <AccordionContent className="pr-6 leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma pergunta frequente com esses termos.</p>
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">{aside}</div>
      </div>

      <ArticleSheet
        open={sheetOpen && current !== null}
        article={current}
        articles={articles}
        onOpenChange={setSheetOpen}
        onNavigate={openArticle}
        onTicket={(subject) => {
          setSheetOpen(false)
          openTicket({ subject })
        }}
      />
    </>
  )
}
