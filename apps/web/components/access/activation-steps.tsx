"use client"

import { useState } from "react"
import { DownloadIcon, GlobeIcon, RefreshCwIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { GATEWAY_URL, PLATFORM_HOST } from "@/lib/site"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CopyBlock, CopyCode } from "./copy-block"
import { LATEST_AGENT as AGENT_VERSION, activationCode } from "./labels"

type Arch = "arm64" | "amd64"

/** Estado do código de ativação (com "gerar novo código"). Novo código vale 24 h a partir de agora. */
export function useActivationCode(seed: string, initial: { code: string; expired: boolean; expiresLabel: string }, freshExpiresLabel: string) {
  const [state, setState] = useState({ ...initial, round: 0 })
  const regenerate = () => {
    const next = activationCode(`${seed}:${state.code}:${state.round + 1}`)
    setState((s) => ({ code: next, expired: false, expiresLabel: freshExpiresLabel, round: s.round + 1 }))
    toast.success("Novo código de ativação gerado", { description: `${next} · válido por 24 h. O código anterior (${state.code}) deixou de valer.` })
  }
  return { code: state.code, expired: state.expired, expiresLabel: state.expiresLabel, regenerate }
}

function Step({ n, title, children, last = false, muted = false }: { n: number; title: string; children: React.ReactNode; last?: boolean; muted?: boolean }) {
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border" />}
      <span
        className={cn(
          "z-[1] flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {n}
      </span>
      <div className={cn("flex min-w-0 flex-col gap-2", !last && "pb-5")}>
        <div className="pt-1 text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  )
}

/**
 * Fluxo de ativação de um gateway: código de uso único + comandos de instalação copiáveis.
 * Usado no diálogo "Novo gateway", nas instruções do card e no detalhe de um gateway aguardando ativação.
 */
export function ActivationSteps({
  code,
  expiresLabel,
  expired = false,
  onRegenerate,
  className,
}: {
  code: string
  expiresLabel: string
  expired?: boolean
  onRegenerate?: () => void
  className?: string
}) {
  const [arch, setArch] = useState<Arch>("arm64")
  const pkg = `oee-gateway_${AGENT_VERSION}_${arch}.deb`

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
          expired ? "border-state-fault/30 bg-state-fault/5" : "bg-muted/40",
        )}
      >
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Código de ativação</span>
          {expired ? (
            <span className="w-fit rounded-md border bg-muted/60 px-3 py-1.5 font-mono text-xl font-semibold tracking-[0.18em] text-muted-foreground line-through sm:text-2xl">
              {code}
            </span>
          ) : (
            <CopyCode value={code} label="Código" />
          )}
        </div>
        <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:items-end sm:text-right">
          {expired ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-state-fault">
              <TriangleAlertIcon className="size-3.5" />
              Expirou em {expiresLabel}
            </span>
          ) : (
            <span>
              Uso único · válido até <span className="font-medium text-foreground tabular-nums">{expiresLabel}</span>
            </span>
          )}
          {onRegenerate && (
            <Button type="button" variant={expired ? "default" : "ghost"} size="sm" onClick={onRegenerate}>
              <RefreshCwIcon />
              Gerar novo código
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">Arquitetura do gateway</span>
        <ToggleGroup type="single" size="sm" variant="outline" value={arch} onValueChange={(v) => v && setArch(v as Arch)}>
          <ToggleGroupItem value="arm64" className="px-3 font-mono text-xs">
            arm64
          </ToggleGroupItem>
          <ToggleGroupItem value="amd64" className="px-3 font-mono text-xs">
            amd64
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <ol className="flex flex-col">
        <Step n={1} title="Instale o pacote do agente no gateway (Debian 12 ou superior)">
          <CopyBlock code={`sudo apt install ./${pkg}`} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => toast.success("Download iniciado", { description: `${pkg} · assinatura verificada pelo apt na instalação` })}
            >
              <DownloadIcon />
              Baixar {pkg}
            </Button>
          </div>
        </Step>
        <Step n={2} title="Ative com o código (troca o código pela credencial do gateway)" muted={expired}>
          {expired ? (
            <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              O código anterior venceu. Gere um novo código para liberar o comando de ativação.
            </p>
          ) : (
            <CopyBlock code={`sudo oee-gateway enroll --url ${GATEWAY_URL} --code ${code}`} />
          )}
        </Step>
        <Step n={3} title="Inicie o serviço e habilite na inicialização">
          <CopyBlock code="sudo systemctl enable --now oee-gateway" />
        </Step>
        <Step n={4} title="Confirme aqui" last>
          <p className="text-sm text-muted-foreground">
            O status muda para <span className="font-medium text-state-running">Online</span> no primeiro sincronismo (em até 30 s). Depois cadastre as conexões
            Modbus e as tags do gateway.
          </p>
        </Step>
      </ol>

      <div className="grid gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <GlobeIcon className="mt-px size-3.5 shrink-0" />
          <span>Rede de TI: só saída HTTPS (porta 443) para {PLATFORM_HOST} e NTP. Nenhuma porta de entrada.</span>
        </div>
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-px size-3.5 shrink-0" />
          <span>A credencial fica em /etc/oee-gateway (0600). O gateway não roteia entre a rede OT e a de TI.</span>
        </div>
      </div>
    </div>
  )
}
