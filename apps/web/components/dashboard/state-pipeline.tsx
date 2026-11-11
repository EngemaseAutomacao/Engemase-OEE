import Link from "next/link"

export interface PipelineItem {
  id: string
  name: string
  hint: string
  href: string
  initials: string
}

export interface PipelineStage {
  key: string
  title: string
  color: string
  textColor?: string
  count: number
  summary: string
  items: PipelineItem[]
}

/**
 * Colunas em "setas" (chevrons), uma por estado, com as máquinas de cada estado abaixo.
 * Inspirado no funil da referência; aqui cada etapa é um estado de máquina.
 */
export function StatePipeline({ stages, maxItems = 3 }: { stages: PipelineStage[]; maxItems?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="grid min-w-[640px] gap-x-1.5" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s, i) => (
          <div
            key={s.key}
            className="flex h-12 flex-col justify-center px-4 leading-tight"
            style={{
              background: s.color,
              color: s.textColor ?? "white",
              clipPath:
                i === 0
                  ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
                  : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)",
              borderRadius: i === 0 ? "8px 0 0 8px" : undefined,
            }}
          >
            <span className="truncate text-[13px] font-semibold">{s.title}</span>
            <span className="truncate text-[11px] opacity-85">{s.count === 1 ? "1 máquina" : `${s.count} máquinas`}</span>
          </div>
        ))}
        {stages.map((s) => (
          <div key={`${s.key}-sum`} className="truncate px-1 pt-2.5 pb-1.5 text-xs font-semibold tabular-nums">
            {s.summary}
          </div>
        ))}
        {stages.map((s) => (
          <ul key={`${s.key}-items`} className="flex flex-col gap-2 border-t px-1 pt-2.5">
            {s.items.slice(0, maxItems).map((m) => (
              <li key={m.id}>
                <Link href={m.href} className="group flex min-w-0 items-center gap-2">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: `color-mix(in oklab, ${s.color} 16%, transparent)`, color: s.color }}
                  >
                    {m.initials}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-xs font-medium group-hover:text-primary">{m.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{m.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
            {s.items.length > maxItems && <li className="text-[11px] text-muted-foreground">+{s.items.length - maxItems} mais</li>}
            {s.items.length === 0 && <li className="text-[11px] text-muted-foreground">Nenhuma</li>}
          </ul>
        ))}
      </div>
    </div>
  )
}
