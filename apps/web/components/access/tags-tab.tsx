"use client"

import { Fragment, useMemo, useState } from "react"
import { BookOpenIcon, ScanSearchIcon, SearchIcon, TagsIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { useCanEdit } from "@/components/config/engemase-managed"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RunCommand } from "./command-runner"
import type { DeviceVM, TagVM } from "./gateway-detail-data"
import { TAG_QUALITY_LABEL, TAG_QUALITY_STYLE, norm, plural } from "./labels"
import { Chip } from "./status-chip"

interface LiveValue {
  value: string
  quality: TagVM["quality"]
  fresh: boolean
}

function ReadButton({ tag, onRead }: { tag: TagVM; onRead: (t: TagVM) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await onRead(tag)
        setBusy(false)
      }}
      aria-label={`Ler agora: ${tag.name} (${tag.machineName})`}
    >
      {busy ? <Spinner /> : <ScanSearchIcon />}
      <span className="hidden sm:inline">{busy ? "Lendo…" : "Ler agora"}</span>
    </Button>
  )
}

/** Aba "Tags": endereços Modbus (base 0 + convenção), tipo, ordem, intervalo, último valor e "Ler agora". */
export function TagsTab({ tags, devices, run }: { tags: TagVM[]; devices: DeviceVM[]; run: RunCommand }) {
  const [device, setDevice] = useState("all")
  const [query, setQuery] = useState("")
  const [live, setLive] = useState<Record<string, LiveValue>>({})
  const canEdit = useCanEdit()

  const visible = useMemo(() => {
    const q = norm(query.trim())
    return tags.filter(
      (t) => (device === "all" || t.deviceId === device) && (!q || norm(`${t.name} ${t.machineName} ${t.roleLabel} ${t.ref} ${t.address}`).includes(q)),
    )
  }, [tags, device, query])

  const groups = useMemo(() => {
    const map = new Map<string, TagVM[]>()
    visible.forEach((t) => map.set(t.deviceId, [...(map.get(t.deviceId) ?? []), t]))
    return [...map.entries()].map(([id, list]) => ({ device: devices.find((d) => d.id === id), list }))
  }, [visible, devices])

  const onRead = async (t: TagVM) => {
    const out = await run("tag.read", `${t.machineName} · ${t.name}`, () =>
      t.deviceError
        ? { ok: false, result: t.deviceError, durationMs: 1000 }
        : { ok: true, result: `Valor ${t.readValue} (${t.ref})`, durationMs: (t.latencyMs ?? 20) + 4 },
    )
    if (!out) return
    if (out.ok) {
      setLive((l) => ({ ...l, [t.id]: { value: t.readValue, quality: "good", fresh: true } }))
      toast.success(`${t.name}: ${t.readValue}`, { description: `${t.machineName} · ${t.areaShort} ${t.address} (${t.ref}) · ${out.durationMs} ms` })
    } else {
      setLive((l) => ({ ...l, [t.id]: { value: "—", quality: "bad", fresh: true } }))
      toast.error(`Falha ao ler ${t.name}`, { description: out.result })
    }
  }

  const filters = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select value={device} onValueChange={setDevice}>
        <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Filtrar por CLP">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os CLPs</SelectItem>
          {devices.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <InputGroup className="h-8 w-full sm:w-64">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar tag ou endereço" aria-label="Buscar tag" />
      </InputGroup>
    </div>
  )

  if (tags.length === 0) {
    return (
      <Empty className="rounded-2xl border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TagsIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma tag mapeada</EmptyTitle>
          <EmptyDescription>
            {canEdit
              ? "Mapeie as tags por papel (rodando, contagem, refugo…) no cadastro da máquina e teste a leitura antes de publicar."
              : "A equipe Engemase mapeia as tags por papel (rodando, contagem, refugo…) e testa a leitura antes de publicar."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Tags"
        description={`${plural(tags.length, "tag", "tags")} em ${plural(devices.length, "CLP", "CLPs")} · endereço base 0 (protocolo) com a convenção 0xxxx/1xxxx/3xxxx/4xxxx ao lado`}
        bodyClassName="px-0 pb-2"
      >
        <div className="px-5 pb-3">{filters}</div>
        {visible.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyTitle className="text-base">Nenhuma tag encontrada</EmptyTitle>
              <EmptyDescription>Ajuste a busca ou escolha outro CLP.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Tag</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ordem</TableHead>
                <TableHead>Intervalo</TableHead>
                <TableHead className="text-right">Último valor</TableHead>
                <TableHead>Qualidade</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(({ device: d, list }) => (
                <Fragment key={d?.id ?? list[0]!.deviceId}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={9} className="py-1.5 pl-5 text-xs">
                      <span className="font-semibold">{list[0]!.machineName}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {d?.name ?? list[0]!.deviceName}
                        {d && <span className="font-mono"> ({d.protocol === "modbus-tcp" ? d.endpoint : `${d.serialPort} #${d.unitId}`})</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                  {list.map((t) => {
                    const lv = live[t.id]
                    const quality = lv?.quality ?? t.quality
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="max-w-72 pl-5">
                          <div className="truncate font-medium">{t.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{t.roleLabel}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">{t.areaShort}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{t.fc}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm font-semibold tabular-nums">{t.address}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{t.ref}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{t.dataType}</TableCell>
                        <TableCell className="font-mono text-xs">{t.byteOrder ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs tabular-nums">{t.pollLabel}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn("font-mono text-sm tabular-nums", lv?.fresh && "font-semibold text-primary")}>{lv?.value ?? t.value}</span>
                          {lv?.fresh && <div className="text-[11px] text-muted-foreground">lido agora</div>}
                        </TableCell>
                        <TableCell>
                          <Chip className={TAG_QUALITY_STYLE[quality]}>{TAG_QUALITY_LABEL[quality]}</Chip>
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          {canEdit && <ReadButton tag={t} onRead={onRead} />}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-2xl border bg-card px-5 py-3.5 text-xs text-muted-foreground">
        <BookOpenIcon className="mt-px size-4 shrink-0 text-[#0e9384]" />
        <p>
          <span className="font-medium text-foreground">Endereço base 0 × convenção:</span> “40001” é o holding register de endereço 0 no protocolo. A
          plataforma guarda o endereço base 0 e mostra a convenção ao lado. Em 32 bits, confirme a ordem das words (padrão CDAB) lendo um valor conhecido, como
          o contador.
        </p>
      </div>
    </div>
  )
}
