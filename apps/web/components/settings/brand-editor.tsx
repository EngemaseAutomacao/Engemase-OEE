"use client"

import { useRef, useState } from "react"
import {
  CheckIcon,
  CircleCheckIcon,
  ImageUpIcon,
  LockIcon,
  OctagonXIcon,
  PaletteIcon,
  RotateCcwIcon,
  SaveIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { STATE_META, STATE_ORDER } from "@/lib/states"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SectionCard } from "@/components/dashboard/section-card"
import { AA, ENGEMASE_BRAND, analyzeBrand, normalizeHex, ratioLabel } from "@/components/settings/brand-color"
import { BrandPreview, type PreviewLogo } from "@/components/settings/brand-preview"
import { ConfirmAction, SettingsTitle, SoftBadge } from "@/components/settings/bits"
import type { BrandingInitial, PreviewMachine, SidebarMode } from "@/components/settings/types"

type LogoKey = "light" | "dark" | "symbol"
type LogoFile = PreviewLogo & { size: number }

const SIDEBAR_MODES: { value: SidebarMode; title: string; hint: string }[] = [
  { value: "neutral", title: "Padrão", hint: "Azul-marinho Engemase" },
  { value: "brand-dark", title: "Escuro no tom da marca", hint: "Versão escura da sua cor" },
  { value: "light", title: "Claro", hint: "Fundo branco, ícones na cor" },
]

const LOGO_SLOTS: { key: LogoKey; title: string; hint: string; square?: boolean }[] = [
  { key: "light", title: "Logotipo · fundo claro", hint: "Horizontal, SVG ou PNG transparente. Relatórios, e-mails e menu claro." },
  { key: "dark", title: "Logotipo · fundo escuro", hint: "Versão clara do horizontal, para o menu lateral escuro." },
  { key: "symbol", title: "Símbolo quadrado", hint: "PNG ou SVG com 512 × 512 px ou mais. Vira favicon e ícone do app.", square: true },
]

const MAX_LOGO_BYTES = 1_048_576

export function BrandEditor({
  clientName,
  initial,
  presets,
  machine,
}: {
  clientName: string
  initial: BrandingInitial
  presets: { name: string; hex: string }[]
  machine: PreviewMachine
}) {
  const initialBrand = normalizeHex(initial.brandColor) ?? ENGEMASE_BRAND
  const [saved, setSaved] = useState({ brand: initialBrand, sidebarMode: initial.sidebarMode, displayName: initial.displayName, shortName: initial.shortName })
  const [brand, setBrand] = useState(initialBrand)
  const [hexDraft, setHexDraft] = useState(initialBrand.toUpperCase())
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initial.sidebarMode)
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [shortName, setShortName] = useState(initial.shortName)
  const [logos, setLogos] = useState<Partial<Record<LogoKey, LogoFile>>>({})
  const [logosChanged, setLogosChanged] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const stored = brand === initialBrand ? initial.tokens : null
  const a = analyzeBrand(brand, sidebarMode, stored)
  const blocked = a.proximity.level === "block"
  const preset = presets.find((p) => p.hex.toLowerCase() === brand)
  const hexInvalid = normalizeHex(hexDraft) === null
  const dirty =
    brand !== saved.brand || sidebarMode !== saved.sidebarMode || displayName.trim() !== saved.displayName || shortName.trim() !== saved.shortName || logosChanged
  const nameError = displayName.trim().length === 0 ? "Informe o nome exibido." : null

  const pick = (hex: string) => {
    const n = normalizeHex(hex)
    if (!n) return
    setBrand(n)
    setHexDraft(n.toUpperCase())
  }

  const save = () => {
    if (blocked || nameError) return
    setSaved({ brand, sidebarMode, displayName: displayName.trim(), shortName: shortName.trim() })
    setLogosChanged(false)
    toast.success("Identidade visual salva", {
      description: `Tokens recalculados (${a.light.primary.toUpperCase()} no claro, ${a.dark.primary.toUpperCase()} no escuro). Quem usa ${clientName} vê as novas cores na próxima página. Registrado na auditoria.`,
    })
  }

  const restore = () => {
    const name = clientName
    const short = clientName.split(/\s+/)[0]!.slice(0, 12)
    setBrand(ENGEMASE_BRAND)
    setHexDraft(ENGEMASE_BRAND.toUpperCase())
    setSidebarMode("neutral")
    setDisplayName(name)
    setShortName(short)
    Object.values(logos).forEach((l) => l && URL.revokeObjectURL(l.url))
    setLogos({})
    setLogosChanged(false)
    setSaved({ brand: ENGEMASE_BRAND, sidebarMode: "neutral", displayName: name, shortName: short })
    toast.success("Padrão Engemase restaurado", { description: "Cores, menu e logotipos voltaram ao padrão da plataforma. Registrado na auditoria." })
  }

  const acceptFile = (key: LogoKey, file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|svg\+xml|webp)$/.test(file.type)) {
      toast.error("Formato não aceito", { description: "Use SVG ou PNG com fundo transparente." })
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Arquivo maior que 1 MB", { description: "Exporte o logotipo em SVG ou reduza o PNG." })
      return
    }
    const prev = logos[key]
    if (prev) URL.revokeObjectURL(prev.url)
    setLogos((l) => ({ ...l, [key]: { url: URL.createObjectURL(file), name: file.name, size: file.size } }))
    setLogosChanged(true)
    toast.success(`${file.name} recebido`, {
      description: "Prévia atualizada. No protótipo o arquivo fica só neste navegador; na versão real ele é recortado e publicado ao salvar.",
    })
  }

  const removeLogo = (key: LogoKey) => {
    const prev = logos[key]
    if (prev) URL.revokeObjectURL(prev.url)
    setLogos((l) => {
      const next = { ...l }
      delete next[key]
      return next
    })
    setLogosChanged(true)
  }

  const lightLogo = sidebarMode === "light" ? logos.light : logos.dark

  return (
    <>
      <SettingsTitle
        title="Aparência"
        description={`Cor da marca, menu lateral e logotipos de ${clientName}. As cores de estado das máquinas e as faixas de OEE nunca mudam.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setRestoreOpen(true)}>
              <RotateCcwIcon />
              Restaurar padrão Engemase
            </Button>
            <Button onClick={save} disabled={!dirty || blocked || !!nameError}>
              <SaveIcon />
              Salvar identidade
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard
          title="Cor da marca"
          description="Paletas prontas já validadas contra as cores de estado, ou uma cor personalizada"
          className="xl:col-span-7"
          action={
            dirty ? (
              <SoftBadge tone="amber">Alterações não salvas</SoftBadge>
            ) : (
              <SoftBadge tone="green" icon={CheckIcon}>
                Salvo
              </SoftBadge>
            )
          }
        >
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {presets.map((p) => {
                const selected = p.hex.toLowerCase() === brand
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => pick(p.hex)}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 text-left transition outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected && "border-primary bg-primary/5 ring-1 ring-primary/30",
                    )}
                  >
                    <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10" style={{ background: p.hex }}>
                      {selected && <CheckIcon className="size-4 text-white" />}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-xs font-semibold">{p.name}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground uppercase">{p.hex}</span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 ring-card" style={{ background: brand }} title="Escolher cor">
                  <input type="color" value={brand} onChange={(e) => pick(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Seletor de cor personalizada" />
                </label>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">Cor personalizada</div>
                  <div className="text-xs text-muted-foreground">{preset ? `Paleta “${preset.name}”` : "Cor livre (validada abaixo)"}</div>
                </div>
              </div>
              <div className="grid gap-1 sm:ml-auto">
                <Label htmlFor="brand-hex" className="sr-only">
                  Código hexadecimal
                </Label>
                <div className="relative">
                  <PaletteIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="brand-hex"
                    value={hexDraft}
                    onChange={(e) => {
                      setHexDraft(e.target.value)
                      // aplica enquanto digita só com 6 dígitos; o formato curto (#RGB) é aceito ao sair do campo
                      if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) pick(e.target.value)
                    }}
                    onBlur={() => {
                      const n = normalizeHex(hexDraft)
                      if (n) pick(n)
                    }}
                    maxLength={7}
                    spellCheck={false}
                    className="h-9 w-full bg-card pl-8 font-mono uppercase sm:w-36"
                    aria-invalid={hexInvalid}
                  />
                </div>
                {hexInvalid && <span className="text-[11px] text-destructive">Use o formato #RRGGBB</span>}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contraste (WCAG) e cores de estado</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Seal
                  label="Botões e links · tema claro"
                  ratio={a.light.ratio}
                  swatch={a.light.primary}
                  adjusted={a.light.adjusted}
                  note={a.light.adjusted ? `A cor original tem ${ratioLabel(a.light.originalRatio)} sobre o fundo; escurecemos só a luminosidade (mesmo matiz) para ${ratioLabel(a.light.ratio)}.` : undefined}
                />
                <Seal label={`Texto ${a.light.onPrimary === "#ffffff" ? "branco" : "escuro"} no botão · claro`} ratio={a.light.onPrimaryRatio} swatch={a.light.primary} fg={a.light.onPrimary} />
                <Seal label="Botões e links · tema escuro" ratio={a.dark.ratio} swatch={a.dark.primary} note="No escuro usamos uma versão mais clara da mesma cor." />
                <Seal label={`Texto ${a.dark.onPrimary === "#ffffff" ? "branco" : "escuro"} no botão · escuro`} ratio={a.dark.onPrimaryRatio} swatch={a.dark.primary} fg={a.dark.onPrimary} />
              </div>

              {a.proximity.level === "block" && (
                <Alert variant="destructive">
                  <OctagonXIcon />
                  <AlertTitle>Cor bloqueada: muito próxima do {a.proximity.stateLabel}</AlertTitle>
                  <AlertDescription>
                    <p>
                      No chão de fábrica essa cor significa um estado de máquina; usá-la em botões e destaques confundiria a leitura. Escolha outro tom (azul, petróleo, teal ou
                      grafite funcionam bem).
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              {a.proximity.level === "warn" && (
                <Alert className="border-state-stopped/40 bg-state-stopped/10">
                  <TriangleAlertIcon className="text-amber-700! dark:text-state-stopped!" />
                  <AlertTitle>Atenção: parecida com o {a.proximity.stateLabel}</AlertTitle>
                  <AlertDescription>
                    <p>Pode ser confundida com o estado em TVs e tablets. É possível salvar, mas prefira um tom mais distante.</p>
                  </AlertDescription>
                </Alert>
              )}
              {a.proximity.level === "ok" && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CircleCheckIcon className="size-4 shrink-0 text-state-running" />
                  {a.neutral ? "Cor neutra: não conflita com nenhuma cor de estado." : "Distante do verde, âmbar, vermelho e violeta usados nos estados das máquinas."}
                </p>
              )}
              <p className="font-mono text-[11px] text-muted-foreground">
                Tokens: primária {a.light.primary.toUpperCase()} (claro) · {a.dark.primary.toUpperCase()} (escuro) · menu{" "}
                {a.light.sidebar.startsWith("#") ? a.light.sidebar.toUpperCase() : "—"}
              </p>
            </div>
          </div>
        </SectionCard>

        <div className="grid content-start gap-4 xl:col-span-5">
          <SectionCard title="Menu lateral" description="Fundo do menu para todos os usuários do cliente">
            <RadioGroup value={sidebarMode} onValueChange={(v) => setSidebarMode(v as SidebarMode)} className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {SIDEBAR_MODES.map((m) => {
                const sw = analyzeBrand(brand, m.value, stored).light
                return (
                  <Label
                    key={m.value}
                    htmlFor={`sb-${m.value}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 font-normal transition hover:bg-muted/50",
                      sidebarMode === m.value && "border-primary bg-primary/5 ring-1 ring-primary/30",
                    )}
                  >
                    <RadioGroupItem id={`sb-${m.value}`} value={m.value} className="sr-only" />
                    <span className="flex h-9 w-7 shrink-0 flex-col gap-0.5 overflow-hidden rounded-md p-1 ring-1 ring-black/10" style={{ background: sw.sidebar }} aria-hidden>
                      <span className="h-1.5 rounded-sm" style={{ background: sw.sidebarActiveBg }} />
                      <span className="h-1 rounded-sm opacity-40" style={{ background: sw.sidebarFg }} />
                      <span className="h-1 rounded-sm opacity-40" style={{ background: sw.sidebarFg }} />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block text-sm font-semibold">{m.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          </SectionCard>

          <SectionCard title="Nome exibido" description="Aparece no menu, nas abas do navegador e nos e-mails">
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="brand-name">Nome</Label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{displayName.length}/40</span>
                </div>
                <Input id="brand-name" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={!!nameError} />
                {nameError && <span className="text-[11px] text-destructive">{nameError}</span>}
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="brand-short">Nome curto</Label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{shortName.length}/12</span>
                </div>
                <Input id="brand-short" value={shortName} maxLength={12} onChange={(e) => setShortName(e.target.value)} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">O nome curto aparece embaixo do ícone do app instalado no celular.</p>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Prévia"
        description="Botão, link, badge, menu, barra de progresso e card de máquina, nos dois temas"
        action={
          blocked ? (
            <SoftBadge tone="red" icon={OctagonXIcon}>
              Cor bloqueada
            </SoftBadge>
          ) : a.light.adjusted ? (
            <SoftBadge tone="blue" icon={WandSparklesIcon}>
              Ajustado para AA
            </SoftBadge>
          ) : (
            <SoftBadge tone="green" icon={CheckIcon}>
              AA ok
            </SoftBadge>
          )
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <BrandPreview theme="light" tokens={a.light} displayName={displayName} machine={machine} logo={lightLogo} symbol={logos.symbol} />
          <BrandPreview theme="dark" tokens={a.dark} displayName={displayName} machine={machine} logo={logos.dark} symbol={logos.symbol} />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Logotipos" description="Arraste o arquivo para a área ou clique para escolher" className="xl:col-span-8">
          <div className="grid gap-3 md:grid-cols-3">
            {LOGO_SLOTS.map((slot) => (
              <LogoDrop key={slot.key} slot={slot} file={logos[slot.key]} onFile={(f) => acceptFile(slot.key, f)} onRemove={() => removeLogo(slot.key)} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Cores que não mudam" description="Iguais para todos os clientes (ISA-101)" className="xl:col-span-4">
          <ul className="grid gap-2">
            {STATE_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                <span className={cn("size-3 shrink-0 rounded-full", STATE_META[s].dot)} />
                <span className="flex-1">{STATE_META[s].label}</span>
                <LockIcon className="size-3.5 text-muted-foreground" aria-label="Travada" />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Também ficam travadas as faixas de OEE e a cor de erro. Cor nunca é o único sinal: estados sempre aparecem com texto e ícone.
          </p>
        </SectionCard>
      </div>

      <ConfirmAction
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Restaurar o padrão Engemase?"
        description={<p>A cor, o menu, o nome exibido e os logotipos de {clientName} voltam ao padrão da plataforma para todos os usuários. Você pode personalizar de novo depois.</p>}
        confirmLabel="Restaurar padrão"
        destructive={false}
        onConfirm={() => {
          restore()
          setRestoreOpen(false)
        }}
      />
    </>
  )
}

function Seal({ label, ratio, swatch, fg, adjusted, note }: { label: string; ratio: number; swatch: string; fg?: string; adjusted?: boolean; note?: string }) {
  const ok = ratio >= AA
  const body = (
    <div className="flex items-center gap-3 rounded-xl border p-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ring-1 ring-black/10" style={{ background: swatch, color: fg ?? "transparent" }} aria-hidden>
        {fg ? "Aa" : ""}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-bold tabular-nums">{ratioLabel(ratio)}</div>
      </div>
      {!ok ? (
        <SoftBadge tone="red">Abaixo de AA</SoftBadge>
      ) : adjusted ? (
        <SoftBadge tone="blue" icon={WandSparklesIcon}>
          Ajustado
        </SoftBadge>
      ) : (
        <SoftBadge tone="green" icon={CheckIcon}>
          AA ok
        </SoftBadge>
      )}
    </div>
  )
  if (!note) return body
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {body}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{note}</TooltipContent>
    </Tooltip>
  )
}

function LogoDrop({
  slot,
  file,
  onFile,
  onRemove,
}: {
  slot: (typeof LOGO_SLOTS)[number]
  file: LogoFile | undefined
  onFile: (f: File | undefined) => void
  onRemove: () => void
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            input.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFile(e.dataTransfer.files[0])
        }}
        className={cn(
          "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition outline-none hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          over && "border-primary bg-primary/10",
          slot.key === "dark" && file && "bg-[#2c4e73]",
        )}
      >
        {file ? (
          <span
            className={cn("bg-contain bg-center bg-no-repeat", slot.square ? "size-16" : "h-12 w-full")}
            style={{ backgroundImage: `url(${file.url})` }}
            role="img"
            aria-label={`Prévia de ${file.name}`}
          />
        ) : (
          <>
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ImageUpIcon className="size-5" />
            </span>
            <span className="text-xs font-semibold">{over ? "Solte para enviar" : "Arraste ou clique"}</span>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/svg+xml,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-semibold">{slot.title}</div>
          <div className="text-[11px] text-muted-foreground">{file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : slot.hint}</div>
        </div>
        {file && (
          <button type="button" onClick={onRemove} aria-label={`Remover ${slot.title}`} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
