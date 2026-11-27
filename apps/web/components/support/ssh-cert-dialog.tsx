"use client"

import { useState } from "react"
import { CopyIcon, DownloadIcon, KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { timeOf } from "./remote-labels"
import { useRemote } from "./remote-provider"
import type { RemoteSessionVM } from "./remote-types"

interface Emitido {
  certificado: string
  validoAteMs: number
  fingerprint: string
  usuario: string
  vpnIp: string | null
}

const arquivo = (s: RemoteSessionVM) => `oee-${s.hostname.replace(/[^a-z0-9-]/gi, "") || "gateway"}-cert.pub`

/**
 * "Certificado SSH" da sessão (só quem pediu, sistema real): o técnico cola a chave pública Ed25519 e recebe o
 * certificado da CA Engemase, válido só para este gateway e até o fim da sessão. A chave privada nunca sai do
 * computador dele.
 */
export function SshCertDialog({ s }: { s: RemoteSessionVM }) {
  const { issueSshCert } = useRemote()
  const [open, setOpen] = useState(false)
  const [chave, setChave] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [emitido, setEmitido] = useState<Emitido | null>(null)
  if (!issueSshCert || !s.mine) return null

  const emitir = async () => {
    setEnviando(true)
    setErro(null)
    const r = await issueSshCert(s.id, chave)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.mensagem)
      return
    }
    setEmitido(r.dados)
  }

  const baixar = (e: Emitido) => {
    const url = URL.createObjectURL(new Blob([e.certificado + "\n"], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = arquivo(s)
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const comando = (e: Emitido) => `ssh -i ~/.ssh/id_ed25519 -o CertificateFile=~/Downloads/${arquivo(s)} ${e.usuario}@${e.vpnIp ?? "<IP na VPN>"}`

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setEmitido(null)
          setErro(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="sm:flex-1">
          <KeyRoundIcon />
          Certificado SSH
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Certificado SSH · {s.gatewayName}</DialogTitle>
          <DialogDescription>
            Vale só para este gateway e até o fim da sessão{s.expiresMs ? ` (${timeOf(s.expiresMs)})` : ""}. Cole a sua chave pública; a privada nunca sai do seu computador.
          </DialogDescription>
        </DialogHeader>

        {emitido === null ? (
          <div className="grid gap-2">
            <Label htmlFor={`chave-${s.id}`}>Chave pública (ssh-ed25519)</Label>
            <Textarea
              id={`chave-${s.id}`}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder="ssh-ed25519 AAAA… voce@computador"
              rows={3}
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
              aria-invalid={erro !== null}
              aria-describedby={`chave-ajuda-${s.id}`}
            />
            <p id={`chave-ajuda-${s.id}`} className="text-xs text-muted-foreground">
              É o conteúdo do <code className="font-mono">~/.ssh/id_ed25519.pub</code>. Não tem? Gere com <code className="font-mono">ssh-keygen -t ed25519</code>.
            </p>
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <p>
              Certificado emitido, válido até <span className="font-semibold">{timeOf(emitido.validoAteMs)}</span>. Chave <span className="font-mono text-xs break-all">{emitido.fingerprint}</span>.
            </p>
            <Button variant="outline" onClick={() => baixar(emitido)} className="justify-self-start">
              <DownloadIcon />
              Baixar {arquivo(s)}
            </Button>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {emitido.vpnIp ? "Com o Tailscale ligado no seu computador:" : "Quando o gateway ligar a VPN, o IP aparece aqui. Comando:"}
              </span>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{comando(emitido)}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copiar comando"
                  onClick={() => void navigator.clipboard.writeText(comando(emitido)).then(() => toast.success("Comando copiado"))}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {emitido === null ? (
            <Button onClick={() => void emitir()} disabled={enviando || chave.trim().length < 20}>
              {enviando ? <Spinner /> : <KeyRoundIcon />}
              {enviando ? "Emitindo…" : "Emitir certificado"}
            </Button>
          ) : (
            <Button onClick={() => setOpen(false)}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
