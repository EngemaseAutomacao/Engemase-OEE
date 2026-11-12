"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  FactoryIcon,
  GaugeIcon,
  PlusIcon,
  PlugZapIcon,
  RocketIcon,
  RouterIcon,
  SaveIcon,
  TagsIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { UsageMeter } from "@/components/config/plan-usage"
import { isNetworkProtocol } from "@/lib/mock/types"
import { PROTOCOL_LABEL, PROTOCOL_SHORT, ROLE_DEFAULTS, STATE_MODE_LABEL, seconds } from "@/components/config/labels"
import { ConnectionStep, type ConnTest } from "@/components/config/wizard-connection"
import { IdentStep, RulesStep } from "@/components/config/wizard-steps"
import { ReviewStep, type ReviewCheck } from "@/components/config/wizard-review"
import { TagsStep } from "@/components/config/wizard-tags"
import {
  BUILTIN_TEMPLATES,
  connSignature,
  connWarnings,
  defaultConn,
  defaultRules,
  emptyIdent,
  hasErrors,
  missingRoles,
  simulatedLatency,
  simulatedValue,
  tagFromSpec,
  toNum,
  validateConn,
  validateIdent,
  validateRules,
  validateTags,
  type ConnDraft,
  type IdentDraft,
  type MachineTemplate,
  type RulesDraft,
  type TagDraft,
  type WizardDevice,
  type WizardGateway,
  type WizardLine,
  type WizardUnit,
} from "@/components/config/wizard-model"

const STEPS: { title: string; hint: string; icon: LucideIcon; tone: IconTone; description: string }[] = [
  {
    title: "Identificação",
    hint: "Nome e linha",
    icon: FactoryIcon,
    tone: "navy",
    description: "Como a máquina aparece no dashboard, na TV e na tela do operador, e em que linha ela fica.",
  },
  {
    title: "Conexão",
    hint: "Gateway Modbus",
    icon: PlugZapIcon,
    tone: "blue",
    description: "Gateway da unidade que lê o CLP e os parâmetros Modbus TCP ou RTU (RS-485).",
  },
  {
    title: "Sinais",
    hint: "Tags por papel",
    icon: TagsIcon,
    tone: "teal",
    description: "Registradores do CLP que dizem se a máquina está rodando, em falha e quanto produziu.",
  },
  {
    title: "Regras de OEE",
    hint: "Estado e ciclo",
    icon: GaugeIcon,
    tone: "orange",
    description: "Como transformar os sinais em estados de OEE e qual é a velocidade nominal da máquina.",
  },
  {
    title: "Revisão",
    hint: "Conferir e ativar",
    icon: RocketIcon,
    tone: "green",
    description: "Confira tudo antes de publicar a nova versão de configuração no gateway.",
  },
]

const COMMISSIONING = [
  "Confirmar que não há outro mestre no barramento RS-485 (IHM).",
  "Testar a conexão e ler cada sinal com “Ler agora”.",
  "Validar o contador com um valor conhecido (ordem das words).",
  "Forçar uma parada e uma falha e conferir o estado ao vivo.",
  "Desligar a rede IT por alguns minutos: nenhuma contagem pode se perder.",
]

export function NewMachineWizard({
  clientSlug,
  clientName,
  managedByEngemase,
  units,
  lines,
  gateways,
  devices,
  existingCodes,
  machineTypes,
  machineTemplates,
  machineCount,
  machineLimit,
}: {
  clientSlug: string
  clientName: string
  managedByEngemase: boolean
  units: WizardUnit[]
  lines: WizardLine[]
  gateways: WizardGateway[]
  devices: WizardDevice[]
  existingCodes: string[]
  machineTypes: string[]
  machineTemplates: MachineTemplate[]
  machineCount: number
  machineLimit: number
}) {
  const firstUnit = units[0]?.id ?? ""
  const initialIdent = () => emptyIdent(firstUnit, lines.find((l) => l.unitId === firstUnit)?.id ?? "")
  const initialConn = () => defaultConn(gateways.find((g) => g.unitId === firstUnit)?.id ?? "")

  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [shown, setShown] = useState<boolean[]>([false, false, false, false, false])
  const [ident, setIdent] = useState<IdentDraft>(initialIdent)
  const [conn, setConn] = useState<ConnDraft>(initialConn)
  const [tags, setTags] = useState<TagDraft[]>([])
  const [rules, setRules] = useState<RulesDraft>(defaultRules)
  const [test, setTest] = useState<ConnTest>({ status: "idle" })
  const [readingKeys, setReadingKeys] = useState<string[]>([])
  const [activated, setActivated] = useState<{ name: string; version: number; gatewayId: string; pending: boolean } | null>(null)
  const counter = useRef(0)
  const nextKey = () => `t${++counter.current}`

  // ---------------------------------------------------------------------------
  // Derivados e validações
  // ---------------------------------------------------------------------------
  const unitGateways = gateways.filter((g) => g.unitId === ident.unitId)
  const gateway = unitGateways.find((g) => g.id === conn.gatewayId)
  const gwDevices = devices.filter((d) => d.gatewayId === conn.gatewayId)
  const busDevices =
    conn.protocol === "modbus-rtu" && conn.serialPort ? gwDevices.filter((d) => d.protocol === "modbus-rtu" && d.serialPort === conn.serialPort) : []
  const canTest = !!gateway && (gateway.status === "online" || gateway.status === "degraded")

  const identErrors = validateIdent(ident, existingCodes)
  const connErrors = validateConn(conn, gateway, busDevices)
  const warnings = connWarnings(conn, gateway, gwDevices, busDevices)
  const tagCheck = validateTags(tags)
  const rulesErrors = validateRules(rules, tags)
  const testValid = test.status === "ok" && test.signature === connSignature(conn)
  const atLimit = machineCount >= machineLimit

  const valid = [
    !hasErrors(identErrors),
    !hasErrors(connErrors),
    !tagCheck.global && Object.keys(tagCheck.rows).length === 0,
    !hasErrors(rulesErrors),
  ]
  const allValid = valid.every(Boolean)
  const canGoTo = (i: number) => i <= maxReached || valid.slice(0, i).every(Boolean)

  const unitName = units.find((u) => u.id === ident.unitId)?.name ?? "—"
  const line = lines.find((l) => l.id === ident.lineId)
  const nextVersion = gateway ? gateway.configVersion + 1 : null
  const readCount = tags.filter((t) => t.lastValue !== null).length

  // ---------------------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------------------
  const changeIdent = (patch: Partial<IdentDraft>) => {
    setIdent((d) => ({ ...d, ...patch }))
    if (patch.unitId !== undefined && patch.unitId !== ident.unitId) {
      const gw = gateways.find((g) => g.unitId === patch.unitId)
      setConn((c) => ({ ...c, gatewayId: gw?.id ?? "", serialPort: "", protocol: gw && gw.serialPorts.length === 0 ? "modbus-tcp" : c.protocol }))
    }
  }

  const changeConn = (patch: Partial<ConnDraft>) => {
    setConn((c) => {
      const next = { ...c, ...patch }
      if (patch.gatewayId !== undefined) {
        const gw = gateways.find((g) => g.id === patch.gatewayId)
        if (gw && gw.serialPorts.length === 0) next.protocol = "modbus-tcp"
      }
      return next
    })
  }

  const runTest = () => {
    if (!gateway) return
    const signature = connSignature(conn)
    setTest({ status: "testing" })
    window.setTimeout(() => {
      const latencyMs = simulatedLatency(conn.protocol, signature)
      setTest({ status: "ok", latencyMs, signature })
      toast.success("Conexão OK", {
        description:
          isNetworkProtocol(conn.protocol)
            ? `${gateway.name} leu o CLP em ${conn.host}:${conn.port} (unit ID ${conn.tcpUnitId}) em ${latencyMs} ms.`
            : `${gateway.name} leu o escravo ${conn.rtuUnitId} em ${conn.serialPort} em ${latencyMs} ms.`,
      })
    }, 1100)
  }

  const readTags = (keys: string[]) => {
    if (keys.length === 0) return
    setReadingKeys((r) => [...new Set([...r, ...keys])])
    keys.forEach((key, i) => {
      window.setTimeout(
        () => {
          const tick = ++counter.current
          setTags((list) =>
            list.map((t) =>
              t.key === key
                ? { ...t, lastValue: simulatedValue(t, rules.stateMap, tick), lastLatencyMs: simulatedLatency(conn.protocol, `${key}:${tick}`) }
                : t,
            ),
          )
          setReadingKeys((r) => r.filter((k) => k !== key))
          if (keys.length > 1 && i === keys.length - 1) toast.success(`${keys.length} sinais lidos`, { description: "Confira os contadores com um valor conhecido." })
        },
        450 + i * 140,
      )
    })
  }

  const applyTemplate = (tpl: MachineTemplate) => {
    const prevTags = tags
    const prevRules = rules
    setTags(tpl.tags.map((s) => tagFromSpec(s, nextKey())))
    setRules((r) => ({
      ...r,
      stateMode: tpl.stateMode,
      idealCycleS: r.idealCycleS || (tpl.idealCycleS ? String(tpl.idealCycleS).replace(".", ",") : ""),
    }))
    toast.success(`${tpl.label}: ${tpl.tags.length} sinais`, {
      description: `Modo de estado ajustado para “${STATE_MODE_LABEL[tpl.stateMode]}”.`,
      action:
        prevTags.length > 0
          ? {
              label: "Desfazer",
              onClick: () => {
                setTags(prevTags)
                setRules(prevRules)
              },
            }
          : undefined,
    })
  }

  const addTag = () => {
    const role = tags.some((t) => t.role === "count.total") ? "custom" : "count.total"
    const d = ROLE_DEFAULTS[role]
    setTags((list) => [
      ...list,
      {
        key: nextKey(),
        name: d.name,
        role,
        area: d.area,
        address: "",
        dataType: d.dataType,
        byteOrder: d.dataType === "uint32" ? "CDAB" : "ABCD",
        pollMs: d.pollMs,
        lastValue: null,
        lastLatencyMs: null,
      },
    ])
  }

  const goTo = (i: number) => {
    if (!canGoTo(i)) return
    setStep(i)
    setMaxReached((m) => Math.max(m, i))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const next = () => {
    setShown((s) => s.map((v, i) => (i === step ? true : v)))
    if (!valid[step]) {
      toast.error("Revise os campos destacados", { description: `A etapa “${STEPS[step].title}” tem pendências.` })
      return
    }
    goTo(step + 1)
  }

  const activate = () => {
    setShown([true, true, true, true, true])
    if (!allValid || !gateway || atLimit) return
    const pending = !canTest
    setActivated({ name: ident.name.trim(), version: gateway.configVersion + 1, gatewayId: gateway.id, pending })
    toast.success(`${ident.name.trim()} ativada`, {
      description: pending
        ? `Configuração v${gateway.configVersion + 1} criada. Fica pendente até ${gateway.name} se conectar.`
        : `Configuração v${gateway.configVersion + 1} publicada em ${gateway.name}. Dados ao vivo em ≈ 10 s.`,
    })
  }

  const reset = () => {
    setStep(0)
    setMaxReached(0)
    setShown([false, false, false, false, false])
    setIdent(initialIdent())
    setConn(initialConn())
    setTags([])
    setRules(defaultRules())
    setTest({ status: "idle" })
    setActivated(null)
  }

  // ---------------------------------------------------------------------------
  // Revisão: checagens antes de ativar
  // ---------------------------------------------------------------------------
  const missing = missingRoles(tags, rules.stateMode)
  const checks: ReviewCheck[] = [
    {
      id: "ident",
      label: "Identificação",
      detail: valid[0] ? `${ident.code.toUpperCase()} · ${line?.name ?? "—"}` : "Há campos pendentes na etapa 1.",
      status: valid[0] ? "ok" : "error",
    },
    {
      id: "test",
      label: "Teste de conexão",
      detail: testValid
        ? `CLP respondeu em ${test.latencyMs} ms.`
        : canTest
          ? "Não testada com os parâmetros atuais. Recomendado antes de ativar."
          : "Gateway sem conexão: a configuração ficará pendente.",
      status: !valid[1] ? "error" : testValid ? "ok" : "warn",
    },
    {
      id: "roles",
      label: "Sinais obrigatórios",
      detail: missing.length === 0 ? `${tags.length} sinais mapeados, papéis obrigatórios presentes.` : `Faltam: ${missing.length} papel(is) obrigatório(s).`,
      status: valid[2] && missing.length === 0 ? "ok" : "error",
    },
    {
      id: "read",
      label: "Leitura de teste",
      detail: tags.length === 0 ? "Nenhum sinal para ler." : readCount === tags.length ? "Todos os sinais responderam." : `${readCount} de ${tags.length} sinais lidos.`,
      status: tags.length > 0 && readCount === tags.length ? "ok" : "warn",
    },
    {
      id: "rules",
      label: "Regras de OEE",
      detail: valid[3] ? `${STATE_MODE_LABEL[rules.stateMode]} · ciclo ideal ${seconds(toNum(rules.idealCycleS))}` : "Há campos pendentes na etapa 4.",
      status: valid[3] ? "ok" : "error",
    },
    {
      id: "plan",
      label: "Limite do plano",
      detail: atLimit ? `${machineCount} de ${machineLimit} máquinas: limite atingido.` : `Ficará com ${machineCount + 1} de ${machineLimit} máquinas.`,
      status: atLimit ? "error" : "ok",
    },
  ]

  // Resumo curto para cada etapa (usado no stepper)
  const stepSub = [
    ident.code ? ident.code.toUpperCase() : STEPS[0].hint,
    gateway && valid[1]
      ? isNetworkProtocol(conn.protocol)
        ? `${PROTOCOL_SHORT[conn.protocol]} ${conn.host}`
        : `${PROTOCOL_SHORT[conn.protocol]} ${conn.serialPort.replace("/dev/", "")} · ID ${conn.rtuUnitId}`
      : STEPS[1].hint,
    tags.length ? `${tags.length} sinais` : STEPS[2].hint,
    valid[3] ? `${STATE_MODE_LABEL[rules.stateMode]} · ${seconds(toNum(rules.idealCycleS))}` : STEPS[3].hint,
    STEPS[4].hint,
  ]

  // ---------------------------------------------------------------------------
  // Concluído
  // ---------------------------------------------------------------------------
  if (activated) {
    return (
      <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-5 py-12 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <IconCircle icon={CircleCheckIcon} tone="green" size="lg" />
        <div>
          <h2 className="text-xl font-bold">{activated.name} cadastrada</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {activated.pending
              ? `A configuração v${activated.version} foi criada e será aplicada assim que o gateway se conectar. Até lá, a máquina aparece como “Sem comunicação”.`
              : `A configuração v${activated.version} foi publicada. Em alguns segundos a máquina aparece ao vivo no dashboard de ${clientName}.`}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={`/${clientSlug}/config/maquinas`}>Ir para o cadastro de máquinas</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/${clientSlug}/config/gateways/${activated.gatewayId}`}>
              <RouterIcon />
              Ver gateway
            </Link>
          </Button>
          <Button variant="ghost" onClick={reset}>
            <PlusIcon />
            Cadastrar outra máquina
          </Button>
        </div>
      </section>
    )
  }

  const S = STEPS[step]

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Etapas em "setas", no estilo do funil da referência */}
        <nav aria-label="Etapas do cadastro" className="rounded-2xl border bg-card p-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <ol className="grid grid-cols-5 gap-1">
            {STEPS.map((s, i) => {
              const current = i === step
              const done = !current && i < 4 && i <= maxReached && valid[i]
              const reachable = canGoTo(i)
              return (
                <li key={s.title} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    disabled={!reachable}
                    aria-current={current ? "step" : undefined}
                    aria-label={`Etapa ${i + 1}: ${s.title}`}
                    className={cn(
                      "flex h-12 w-full min-w-0 items-center justify-center gap-2 pr-3 pl-4 text-left transition md:justify-start",
                      current ? "bg-primary text-primary-foreground" : done ? "bg-primary/12 text-primary hover:bg-primary/18" : "bg-muted text-muted-foreground",
                      reachable && !current && "cursor-pointer",
                      !reachable && "cursor-not-allowed opacity-70",
                    )}
                    style={{
                      clipPath:
                        i === 0
                          ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
                          : i === STEPS.length - 1
                            ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)"
                            : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)",
                      borderRadius: i === 0 ? "10px 0 0 10px" : i === STEPS.length - 1 ? "0 10px 10px 0" : undefined,
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        current ? "bg-white/20" : done ? "bg-primary text-primary-foreground" : "bg-background/70",
                      )}
                    >
                      {done ? <CheckIcon className="size-3.5" /> : i + 1}
                    </span>
                    <span className="hidden min-w-0 leading-tight md:block">
                      <span className="block truncate text-[13px] font-semibold">{s.title}</span>
                      <span className="block truncate text-[11px] opacity-80">{stepSub[i]}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs md:hidden">
            <span className="text-muted-foreground">
              Etapa {step + 1} de {STEPS.length}
            </span>
            <span className="truncate font-semibold">{S.title}</span>
          </div>
        </nav>

        {/* Conteúdo da etapa */}
        <section className="flex min-w-0 flex-col rounded-2xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <header className="flex items-start gap-3 border-b px-5 py-4">
            <IconCircle icon={S.icon} tone={S.tone} soft />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Etapa {step + 1} de {STEPS.length}
              </div>
              <h2 className="text-base font-semibold">{S.title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{S.description}</p>
            </div>
          </header>

          <div className="min-w-0 px-5 py-5">
            {step === 0 && (
              <IdentStep draft={ident} onChange={changeIdent} errors={identErrors} show={shown[0]} units={units} lines={lines} machineTypes={machineTypes} />
            )}
            {step === 1 && (
              <ConnectionStep
                clientSlug={clientSlug}
                draft={conn}
                onChange={changeConn}
                errors={connErrors}
                show={shown[1]}
                warnings={warnings}
                gateways={unitGateways}
                gateway={gateway}
                busDevices={busDevices}
                test={test}
                testValid={testValid}
                onTest={runTest}
              />
            )}
            {step === 2 && (
              <TagsStep
                tags={tags}
                stateMode={rules.stateMode}
                builtinTemplates={BUILTIN_TEMPLATES}
                machineTemplates={machineTemplates}
                machineType={ident.type}
                rowErrors={tagCheck.rows}
                globalError={tagCheck.global}
                show={shown[2]}
                canRead={canTest && !hasErrors(connErrors)}
                readingKeys={readingKeys}
                onChangeTag={(key, patch) => setTags((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)))}
                onAdd={addTag}
                onRemove={(key) => setTags((list) => list.filter((t) => t.key !== key))}
                onApplyTemplate={applyTemplate}
                onRead={(key) => readTags([key])}
                onReadAll={() => readTags(tags.map((t) => t.key))}
              />
            )}
            {step === 3 && <RulesStep draft={rules} onChange={(p) => setRules((r) => ({ ...r, ...p }))} errors={rulesErrors} show={shown[3]} />}
            {step === 4 && (
              <div className="flex flex-col gap-4">
                {atLimit && (
                  <Alert variant="destructive">
                    <ClipboardListIcon />
                    <AlertTitle>Limite do plano atingido</AlertTitle>
                    <AlertDescription>
                      {clientName} já usa {machineCount} de {machineLimit} máquinas. Desative uma máquina ou fale com a Engemase para ampliar o plano.
                    </AlertDescription>
                  </Alert>
                )}
                <ReviewStep
                  ident={ident}
                  conn={conn}
                  tags={tags}
                  rules={rules}
                  unitName={unitName}
                  lineName={line?.name ?? "—"}
                  gateway={gateway}
                  checks={checks}
                  nextVersion={nextVersion}
                  onEdit={goTo}
                />
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                toast.success("Rascunho salvo", { description: `${ident.name.trim() || "Nova máquina"} fica salva como rascunho, sem publicar no gateway.` })
              }
            >
              <SaveIcon />
              <span className="sr-only sm:not-sr-only">Salvar rascunho</span>
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0}>
                <ArrowLeftIcon />
                Voltar
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={next}>
                  Continuar
                  <ArrowRightIcon />
                </Button>
              ) : (
                <Button type="button" onClick={activate} disabled={!allValid || !gateway || atLimit}>
                  <RocketIcon />
                  Ativar máquina
                </Button>
              )}
            </div>
          </footer>
        </section>
      </div>

      {/* Lateral: resumo e checklist de comissionamento */}
      <aside className="grid gap-4 md:grid-cols-2 xl:sticky xl:top-20 xl:grid-cols-1">
        <SectionCard title="Resumo" description={managedByEngemase ? "Cliente gerenciado pela Engemase" : "Autogestão pelo cliente"}>
          <dl className="grid gap-2.5 text-xs">
            {[
              { k: "Máquina", v: ident.name.trim() ? `${ident.name.trim()}${ident.code ? ` · ${ident.code.toUpperCase()}` : ""}` : "—" },
              { k: "Linha", v: line ? `${line.name} · ${unitName}` : "—" },
              { k: "Gateway", v: gateway ? gateway.name : "—" },
              {
                k: "Conexão",
                v: gateway && valid[1] ? (isNetworkProtocol(conn.protocol) ? `${PROTOCOL_LABEL[conn.protocol]} · ${conn.host}:${conn.port}` : `Modbus RTU · ${conn.serialPort}`) : "—",
              },
              { k: "Sinais", v: tags.length ? `${tags.length} mapeados · ${readCount} lidos` : "—" },
              { k: "Ciclo ideal", v: toNum(rules.idealCycleS) > 0 ? seconds(toNum(rules.idealCycleS)) : "—" },
            ].map((r) => (
              <div key={r.k} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{r.k}</dt>
                <dd className="min-w-0 truncate text-right font-medium">{r.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t pt-4">
            <UsageMeter item={{ label: "Máquinas do plano", used: machineCount, limit: machineLimit, icon: FactoryIcon }} />
          </div>
        </SectionCard>

        <SectionCard title="Comissionamento" description="Checklist de campo (guia Modbus)" href={`/${clientSlug}/ajuda`} linkLabel="Ajuda">
          <ol className="grid gap-2 text-xs">
            {COMMISSIONING.map((c, i) => (
              <li key={c} className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                <span className="text-muted-foreground">{c}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      </aside>
    </div>
  )
}
