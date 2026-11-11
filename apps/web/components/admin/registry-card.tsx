"use client"

import { MailIcon, ShieldCheckIcon } from "lucide-react"

import { initials } from "@/lib/format"
import { SectionCard } from "@/components/dashboard/section-card"
import { InfoRow, SoftBadge } from "./bits"
import { useClientDetail } from "./client-detail-context"
import { MANAGEMENT_HINT, MANAGEMENT_LABEL, PLATFORM_HOST } from "./labels"

function Person({ name, detail, badge }: { name: string; detail: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(name)}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {badge}
    </li>
  )
}

/** Contatos do cliente (contato principal, admins e responsáveis Engemase). */
export function ContactsCard({
  admins,
  engemase,
  remotePolicy,
}: {
  admins: { id: string; name: string; login: string; status: "active" | "invited" | "disabled" }[]
  engemase: { name: string; role: string }[]
  remotePolicy: string
}) {
  const { info } = useClientDetail()
  return (
    <SectionCard title="Contatos" description="Com quem falar no cliente e na Engemase">
      <div className="grid gap-4">
        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Contato principal</h3>
          <ul>
            <Person
              name={info.contactName}
              detail={
                <a href={`mailto:${info.contactEmail}`} className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                  <MailIcon className="size-3" aria-hidden />
                  {info.contactEmail}
                </a>
              }
            />
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Admins do cliente</h3>
          {admins.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum admin cadastrado.</p>
          ) : (
            <ul className="grid gap-2.5">
              {admins.map((a) => (
                <Person
                  key={a.id}
                  name={a.name}
                  detail={a.login}
                  badge={
                    a.status === "invited" ? (
                      <SoftBadge tone="amber" dot>
                        Senha não definida
                      </SoftBadge>
                    ) : a.status === "disabled" ? (
                      <SoftBadge tone="slate" dot>
                        Desativado
                      </SoftBadge>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Engemase</h3>
          <ul className="grid gap-2.5">
            {engemase.map((p) => (
              <Person key={p.name + p.role} name={p.name} detail={p.role} />
            ))}
            {engemase.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma atribuição ou concessão ativa; o suporte entra por chamado.</li>}
            <li className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Acesso remoto aos gateways: {remotePolicy.toLowerCase()}.</span>
            </li>
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}

/** Dados cadastrais (refletem edições feitas nesta sessão). */
export function RegistryCard({ slug, cnpj, city, state, createdAt }: { slug: string; cnpj: string; city: string; state: string; createdAt: string }) {
  const { info } = useClientDetail()
  return (
    <SectionCard title="Dados cadastrais" description="Gravados só pela plataforma">
      <dl className="divide-y">
        <InfoRow label="Nome fantasia">{info.name}</InfoRow>
        <InfoRow label="Razão social">{info.legalName}</InfoRow>
        <InfoRow label="CNPJ">
          <span className="font-mono text-xs">{cnpj}</span>
        </InfoRow>
        <InfoRow label="Cidade/UF">
          {city}/{state}
        </InfoRow>
        <InfoRow label="Endereço">
          <span className="font-mono text-xs">
            {PLATFORM_HOST}/{slug}
          </span>
        </InfoRow>
        <InfoRow label="Gestão">
          <span className="block">{MANAGEMENT_LABEL[info.management]}</span>
          <span className="block text-xs font-normal text-muted-foreground">{MANAGEMENT_HINT[info.management]}</span>
        </InfoRow>
        <InfoRow label="Criado em">{createdAt}</InfoRow>
      </dl>
    </SectionCard>
  )
}
