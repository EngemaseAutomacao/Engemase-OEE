"use client"

import { useRef, useState } from "react"
import { FileIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PRIORITY_META } from "./help-meta"
import type { TicketPriority, TicketTarget, TicketVM } from "./help-types"

const MAX_FILE_MB = 10
const GENERAL = "geral"
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "critical"]

export interface TicketPrefill {
  subject?: string
  targetId?: string
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
}

/** Formulário de "Abrir chamado" (montado pelo `HelpProvider` a cada abertura, com o estado zerado). */
function TicketForm({
  prefill,
  targets,
  number,
  onDone,
  onCancel,
}: {
  prefill: TicketPrefill
  targets: TicketTarget[]
  number: number
  onDone: (t: TicketVM) => void
  onCancel: () => void
}) {
  const [subject, setSubject] = useState(prefill.subject ?? "")
  const [target, setTarget] = useState(prefill.targetId ?? GENERAL)
  const [priority, setPriority] = useState<TicketPriority>("normal")
  const [description, setDescription] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [grant, setGrant] = useState(false)
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const subjectError = subject.trim().length < 5 ? "Descreva o assunto em poucas palavras (mínimo 5 caracteres)." : null
  const descriptionError = description.trim().length < 20 ? "Conte o que aconteceu, desde quando e o que já foi tentado (mínimo 20 caracteres)." : null

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024)
    if (tooBig.length) toast.error(`Arquivo acima de ${MAX_FILE_MB} MB`, { description: tooBig.map((f) => f.name).join(", ") })
    setFiles((prev) => [...prev, ...incoming.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024)].slice(0, 5))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    if (subjectError || descriptionError) return
    setSending(true)
    window.setTimeout(() => {
      const t = targets.find((x) => x.id === target)
      const ticket: TicketVM = {
        id: `new-${number}`,
        number: `#${number}`,
        subject: subject.trim(),
        target: t?.label ?? null,
        priority,
        status: "open",
        owner: "Fila de suporte Engemase",
        openedLabel: "agora",
      }
      toast.success(`Chamado ${ticket.number} aberto`, {
        description: `Prioridade ${PRIORITY_META[priority].label.toLowerCase()}${files.length ? ` · ${files.length} anexo(s)` : ""}${grant ? " · acesso de suporte concedido por 4 h" : ""}. Você acompanha as respostas aqui, no sino e por e-mail.`,
      })
      onDone(ticket)
    }, 700)
  }

  const gateways = targets.filter((t) => t.group === "gateway")
  const machines = targets.filter((t) => t.group === "machine")

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="tk-subject">Assunto</Label>
        <Input
          id="tk-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Ex.: Injetora 04 sem comunicação desde as 10h"
          aria-invalid={tried && Boolean(subjectError)}
          maxLength={120}
          autoFocus
        />
        {tried && subjectError && <p className="text-xs text-destructive">{subjectError}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="tk-target">Máquina ou gateway</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger id="tk-target" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GENERAL}>Geral / não se aplica</SelectItem>
            {gateways.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Gateways</SelectLabel>
                  {gateways.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.label} <span className="text-xs text-muted-foreground">· {g.hint}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
            {machines.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Máquinas</SelectLabel>
                  {machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label} <span className="text-xs text-muted-foreground">· {m.hint}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Prioridade</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Prioridade">
          {PRIORITIES.map((p) => {
            const meta = PRIORITY_META[p]
            const active = priority === p
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPriority(p)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5",
                )}
              >
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.className)}>{meta.label}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{meta.hint}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="tk-desc">Descrição</Label>
        <Textarea
          id="tk-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="min-h-28"
          placeholder="O que aconteceu, desde quando, em quais máquinas e o que já foi tentado. Se houver mensagem de erro na tela, copie aqui."
          aria-invalid={tried && Boolean(descriptionError)}
        />
        {tried && descriptionError && <p className="text-xs text-destructive">{descriptionError}</p>}
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Anexos</span>
        <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.txt,.log,.csv,.zip" className="sr-only" tabIndex={-1} onChange={(e) => addFiles(e.target.files)} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          className={cn(
            "flex items-center gap-3 rounded-xl border border-dashed p-3 text-left text-xs text-muted-foreground transition hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PaperclipIcon className="size-4" />
          </span>
          <span>
            <span className="font-medium text-foreground">Clique ou arraste arquivos</span>
            <br />
            Fotos do painel, prints da tela, logs ou PDF · até {MAX_FILE_MB} MB cada, máx. 5
          </span>
        </button>
        {files.length > 0 && (
          <ul className="grid gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{fileSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Remover ${f.name}`}
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-xl border p-3">
        <Switch checked={grant} onCheckedChange={setGrant} className="mt-0.5" />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Conceder acesso de suporte por 4 h</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            A equipe de suporte da Engemase só vê seus cadastros e dashboards com concessão ativa. Fica registrado na Auditoria e expira sozinho.
          </span>
        </span>
      </label>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={sending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={sending}>
          {sending ? <Spinner /> : <SendIcon />}
          {sending ? "Enviando…" : "Abrir chamado"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function TicketDialog({
  open,
  onOpenChange,
  prefill,
  targets,
  number,
  formKey,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill: TicketPrefill
  targets: TicketTarget[]
  number: number
  formKey: number
  onCreated: (t: TicketVM) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Abrir chamado</DialogTitle>
          <DialogDescription>A equipe de suporte da Engemase responde pela plataforma e por e-mail. Quanto mais detalhes, mais rápido o atendimento.</DialogDescription>
        </DialogHeader>
        <TicketForm
          key={formKey}
          prefill={prefill}
          targets={targets}
          number={number}
          onCancel={() => onOpenChange(false)}
          onDone={(t) => {
            onCreated(t)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
