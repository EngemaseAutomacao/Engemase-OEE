"use client"

import { useState } from "react"
import { DownloadIcon, GlobeIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CopyBlock, CopyCode } from "./copy-block"
import { LATEST_AGENT as AGENT_VERSION } from "./labels"

export const PLATFORM_URL = "https://oee.engemase.com.br"

type Arch = "arm64" | "amd64"

function Step({ n, title, children, last = false }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border" />}
      <span className="z-[1] flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">{n}</span>
      <div className={cn("flex min-w-0 flex-col gap-2", !last && "pb-5")}>
        <div className="pt-1 text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  )
}

/**
 * Fluxo de ativação de um gateway: código de uso único + comandos de instalação copiáveis.
 * Usado no diálogo "Novo gateway" e no detalhe de um gateway aguardando ativação.
 */
export function ActivationSteps({ code, expiresLabel, className }: { code: string; expiresLabel: string; className?: string }) {
  const [arch, setArch] = useState<Arch>("arm64")
  const pkg = `oee-gateway_${AGENT_VERSION}_${arch}.deb`

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Código de ativação</span>
          <CopyCode value={code} label="Código" />
        </div>
        <div className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">
          Uso único · expira em 24 h
          <br />
          <span className="tabular-nums">{expiresLabel}</span>
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
        <Step n={2} title="Ative com o código (troca o código pela credencial do gateway)">
          <CopyBlock code={`sudo oee-gateway enroll --url ${PLATFORM_URL} --code ${code}`} />
        </Step>
        <Step n={3} title="Inicie o serviço e habilite na inicialização">
          <CopyBlock code="sudo systemctl enable --now oee-gateway" />
        </Step>
        <Step n={4} title="Confirme aqui" last>
          <p className="text-sm text-muted-foreground">
            O status muda para <span className="font-medium text-state-running">Online</span> no primeiro sincronismo (em até 30 s). Depois cadastre as conexões
            Modbus e as tags na aba Conexões.
          </p>
        </Step>
      </ol>

      <div className="grid gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <GlobeIcon className="mt-px size-3.5 shrink-0" />
          <span>Rede de TI: só saída HTTPS (porta 443) para oee.engemase.com.br e NTP. Nenhuma porta de entrada.</span>
        </div>
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-px size-3.5 shrink-0" />
          <span>A credencial fica em /etc/oee-gateway (0600). O gateway não roteia entre a rede OT e a de TI.</span>
        </div>
      </div>
    </div>
  )
}
