import { Fragment } from "react"
import { AlertTriangleIcon, InfoIcon, LightbulbIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ArticleBlock } from "./help-types"

/** Texto com **negrito** e `código` inline. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

const CALLOUT = {
  info: { icon: InfoIcon, className: "border-[#257bb4]/25 bg-[#257bb4]/6 [&_svg]:text-[#257bb4] dark:[&_svg]:text-[#4a9fd6]" },
  warn: { icon: AlertTriangleIcon, className: "border-state-stopped/35 bg-state-stopped/8 [&_svg]:text-amber-600 dark:[&_svg]:text-state-stopped" },
  tip: { icon: LightbulbIcon, className: "border-[#0e9384]/25 bg-[#0e9384]/6 [&_svg]:text-[#0e9384]" },
} as const

function Block({ b }: { b: ArticleBlock }) {
  switch (b.kind) {
    case "p":
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Inline text={b.text} />
        </p>
      )
    case "h":
      return <h3 className="pt-2 text-sm font-semibold text-foreground">{b.text}</h3>
    case "list": {
      const Tag = b.ordered ? "ol" : "ul"
      return (
        <Tag className={cn("grid gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground", b.ordered ? "list-decimal" : "list-disc marker:text-primary")}>
          {b.items.map((it, i) => (
            <li key={i} className="pl-1">
              <Inline text={it} />
            </li>
          ))}
        </Tag>
      )
    }
    case "table":
      return (
        <figure className="grid gap-1.5">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="bg-muted/60 text-[11px] text-muted-foreground uppercase">
                <tr>
                  {b.head.map((h, i) => (
                    <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {b.rows.map((r, i) => (
                  <tr key={i} className="align-top">
                    {r.map((c, j) => (
                      <td key={j} className={cn("px-3 py-2 leading-relaxed", j === 0 ? "font-medium text-foreground" : "text-muted-foreground", b.mono?.includes(j) && "font-mono whitespace-nowrap")}>
                        <Inline text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.caption && <figcaption className="text-[11px] text-muted-foreground">{b.caption}</figcaption>}
        </figure>
      )
    case "callout": {
      const meta = CALLOUT[b.tone]
      const Icon = meta.icon
      return (
        <div className={cn("flex gap-3 rounded-xl border p-3.5", meta.className)}>
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="grid gap-0.5 text-sm leading-relaxed">
            {b.title && <div className="font-semibold">{b.title}</div>}
            <p className="text-muted-foreground">
              <Inline text={b.text} />
            </p>
          </div>
        </div>
      )
    }
    case "steps":
      return (
        <div className="grid gap-3">
          {b.title && <h3 className="pt-2 text-sm font-semibold">{b.title}</h3>}
          <ol className="grid gap-0">
            {b.items.map((s, i) => (
              <li key={i} className="relative grid grid-cols-[1.75rem_1fr] gap-3 pb-4 last:pb-0">
                {i < b.items.length - 1 && <span className="absolute top-8 bottom-1 left-3.5 w-px -translate-x-1/2 bg-border" aria-hidden />}
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums">{i + 1}</span>
                <div className="min-w-0 pt-0.5">
                  <div className="text-sm font-medium">
                    <Inline text={s.title} />
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    <Inline text={s.text} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )
    case "meters":
      return (
        <div className="grid gap-3 rounded-xl bg-muted/50 p-4">
          {b.items.map((m) => (
            <div key={m.label} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{m.label}</span>
                <span className="font-bold tabular-nums" style={{ color: m.color }}>
                  {(m.value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full" style={{ width: `${m.value * 100}%`, background: m.color }} />
              </div>
              <div className="text-[11px] text-muted-foreground">{m.note}</div>
            </div>
          ))}
        </div>
      )
    case "code":
      return <pre className="overflow-x-auto rounded-xl bg-[#0f2133] p-3.5 font-mono text-xs leading-relaxed text-[#cfe3f5]">{b.text}</pre>
  }
}

/** Corpo de um artigo da central de ajuda. */
export function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="grid gap-4">
      {blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  )
}
