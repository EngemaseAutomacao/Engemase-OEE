"use client"

import { useState } from "react"
import { DownloadIcon, ExternalLinkIcon } from "lucide-react"
import { toast } from "sonner"

import { listarVersoesAgenteAction, type VersaoDoAgente } from "@/app/(shell)/[cliente]/config/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { Chip } from "./status-chip"

/**
 * "Atualizar agente" (só a equipe Engemase, com banco): lista as versões publicadas no GitHub Releases e
 * manda o agent.update da escolhida. O gateway confere a assinatura, baixa, instala e reinicia; se a versão
 * nova não sincronizar em 5 min, volta sozinho para a anterior.
 */
export function AgentUpdateDialog({
  slug,
  gatewayName,
  current,
  offline,
  busy,
  onSend,
}: {
  slug: string
  gatewayName: string
  current: string | null
  offline: boolean
  busy: boolean
  onSend: (version: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [versoes, setVersoes] = useState<VersaoDoAgente[]>([])
  const [escolhida, setEscolhida] = useState<string>("")

  const carregar = async () => {
    setLoading(true)
    setErro(null)
    try {
      const r = await listarVersoesAgenteAction({ slug })
      if (!r.ok) {
        setErro(r.mensagem)
        return
      }
      setVersoes(r.dados)
      const primeira = r.dados.find((v) => !v.prerelease && v.version !== current) ?? r.dados.find((v) => v.version !== current)
      setEscolhida(primeira?.version ?? "")
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.")
    } finally {
      setLoading(false)
    }
  }

  const enviar = () => {
    if (!escolhida) return
    setOpen(false)
    onSend(escolhida)
    if (offline) toast.info("O gateway está offline", { description: "A atualização fica na fila por 30 min e é entregue se ele voltar a sincronizar." })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void carregar()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Spinner /> : <DownloadIcon />}
          Atualizar agente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar o agente do {gatewayName}</DialogTitle>
          <DialogDescription>
            Versão em uso: <span className="font-medium text-foreground">{current ? `v${current}` : "desconhecida"}</span>. O gateway baixa o pacote, confere a assinatura e
            reinicia o agente (a coleta pausa uns segundos; as leituras ficam no buffer). Se a versão nova não sincronizar em 5 min, ele volta sozinho para a anterior.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Buscando as versões publicadas…
          </div>
        ) : erro ? (
          <div className="flex flex-col items-start gap-3 py-2 text-sm">
            <p className="text-destructive">{erro}</p>
            <Button variant="outline" size="sm" onClick={() => void carregar()}>
              Tentar de novo
            </Button>
          </div>
        ) : versoes.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nenhuma versão do agente publicada ainda. Publique uma com a tag gateway-v&lt;versão&gt; no GitHub.</p>
        ) : (
          <RadioGroup value={escolhida} onValueChange={setEscolhida} aria-label="Versão do agente" className="max-h-72 gap-2 overflow-y-auto">
            {versoes.map((v) => {
              const id = `versao-${v.version}`
              const emUso = v.version === current
              return (
                <div key={v.version} className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value={v.version} id={id} disabled={emUso} />
                  <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      v{v.version}
                      {emUso && <Chip className="bg-muted text-muted-foreground">Em uso</Chip>}
                      {v.prerelease && <Chip className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">Pré-lançamento</Chip>}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {v.publishedLabel ? `Publicada em ${v.publishedLabel}` : "Publicada"} · {v.archs.join(", ")}
                    </span>
                  </Label>
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
                    aria-label={`Notas da versão ${v.version} no GitHub`}
                  >
                    <ExternalLinkIcon className="size-4" />
                  </a>
                </div>
              )
            })}
          </RadioGroup>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button onClick={enviar} disabled={loading || !escolhida || escolhida === current}>
            <DownloadIcon />
            {escolhida ? `Atualizar para v${escolhida}` : "Atualizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
