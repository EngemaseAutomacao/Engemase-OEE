import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRightIcon,
  BellRingIcon,
  BuildingIcon,
  CableIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  CloudIcon,
  CpuIcon,
  FileSpreadsheetIcon,
  GaugeIcon,
  HardDriveIcon,
  LockKeyholeIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
  MonitorIcon,
  PaletteIcon,
  RouterIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  TabletIcon,
  TimerIcon,
  UsersIcon,
  WifiOffIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/shell/brand"
import { COMPANY, SALES_EMAIL, whatsappHref } from "@/lib/site"

import "./apresentacao.css"

export const metadata: Metadata = {
  title: { absolute: "Engemase OEE · OEE em tempo real direto do CLP" },
  description:
    "Engemase OEE: monitoramento de OEE em tempo real direto do CLP, com gateway industrial próprio e operação pela Engemase.",
}

const contactHref = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Demonstração do Engemase OEE")}`
const demoHref = whatsappHref("Olá! Quero agendar uma demonstração do Engemase OEE.")
const proposalHref = whatsappHref("Olá! Quero uma proposta do Engemase OEE.")

/** Ícones das redes sociais (o lucide não traz marcas). */
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3Z" />
    </svg>
  )
}
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.5h4V21H3V9.5Zm7 0h3.8v1.6h.1c.5-1 1.8-2 3.7-2 4 0 4.4 2.6 4.4 6V21h-4v-5.2c0-1.2 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V21h-4V9.5Z" />
    </svg>
  )
}

const steps = [
  {
    icon: CpuIcon,
    title: "CLP da máquina",
    text: "Um bloco OEE padrão no CLP expõe estado, contadores, refugo e falhas. Sem sensor extra.",
  },
  {
    icon: RouterIcon,
    title: "Gateway Engemase",
    text: "Lê o CLP por Modbus TCP ou RS-485, calcula os minutos e guarda até 30 dias se a internet cair.",
  },
  {
    icon: CloudIcon,
    title: "Plataforma na nuvem",
    text: "Recebe os dados por HTTPS, só de saída, e calcula o OEE de máquina, linha e unidade.",
  },
  {
    icon: MonitorIcon,
    title: "Gestão, TV e tablet",
    text: "Painéis ao vivo, relatórios, TV Andon na linha e tela do operador no tablet.",
  },
]

const features = [
  {
    img: "/produto/linha.png",
    w: 2160,
    h: 1350,
    tag: "Ao vivo",
    title: "Cada linha e cada máquina em tempo real",
    points: [
      "Estado de cada máquina: produzindo, parada, falha, setup ou sem comunicação",
      "OEE do turno com disponibilidade, performance e qualidade",
      "Linha do tempo de paradas e produção hora a hora",
    ],
  },
  {
    img: "/produto/andon.png",
    w: 2400,
    h: 1350,
    tag: "TV Andon",
    title: "A linha inteira enxerga o mesmo número",
    points: [
      "OEE da linha, peças boas, refugo e ritmo da meta em letras grandes",
      "Cores de estado iguais em todas as telas",
      "TV pareada por código, sem login de pessoa",
    ],
  },
  {
    img: "/produto/operador.png",
    w: 1920,
    h: 1200,
    tag: "Chão de fábrica",
    title: "O operador explica as paradas na hora",
    points: [
      "Classificar parada com dois toques no tablet",
      "Lançar refugo e trocar produto sem papel",
      "Feita para tablet ao lado da máquina, com letras grandes",
    ],
  },
  {
    img: "/produto/relatorio.png",
    w: 2160,
    h: 1350,
    tag: "Relatórios",
    title: "Onde está a perda, por turno, máquina e produto",
    points: [
      "OEE por período, turno, máquina e produto",
      "Pareto dos motivos de parada",
      "Exportação para Excel",
    ],
  },
]

const highlights = [
  { icon: WifiOffIcon, title: "Não perde dados", text: "Sem internet, o gateway guarda até 30 dias e envia tudo na volta, sem duplicar." },
  { icon: CableIcon, title: "Direto do CLP", text: "Siemens, Schneider, Rockwell e ABB, por Modbus TCP ou RS-485." },
  { icon: WrenchIcon, title: "Operado pela Engemase", text: "A Engemase instala, configura máquinas e gateways e atualiza o software à distância." },
  { icon: SmartphoneIcon, title: "Em qualquer tela", text: "Navegador, celular (instala como app), TV na linha e tablet na máquina." },
  { icon: BellRingIcon, title: "Alertas", text: "Avisos de máquina parada, OEE abaixo da meta e gateway sem comunicação." },
  { icon: PaletteIcon, title: "Com a sua marca", text: "Cores e logotipo da sua empresa, tema claro ou escuro." },
]

const roles = [
  { icon: BuildingIcon, title: "Diretoria e gestão", text: "OEE das plantas e linhas, metas do mês e tendência." },
  { icon: GaugeIcon, title: "Supervisão", text: "Situação do turno, paradas sem motivo e ranking das máquinas." },
  { icon: TabletIcon, title: "Operação", text: "Tela da própria máquina: produção, ritmo, paradas e refugo." },
  { icon: UsersIcon, title: "TI e administração", text: "Usuários, acesso por unidade ou por máquina, auditoria." },
]

const rollout = [
  { title: "Diagnóstico", text: "Levantamento das máquinas, CLPs, rede e turnos." },
  { title: "Programação do CLP", text: "Bloco OEE padrão Engemase no CLP de cada máquina." },
  { title: "Instalação do gateway", text: "Gateway pré-montado e testado na Engemase, instalado no painel." },
  { title: "Configuração", text: "Máquinas, produtos, turnos, motivos e telas, feitos pela Engemase." },
  { title: "Treinamento", text: "Gestores, supervisores e operadores, cada um no seu papel." },
  { title: "Acompanhamento", text: "Conferência dos números com a planta e reuniões de resultado." },
]

const security = [
  { icon: LockKeyholeIcon, text: "Cada cliente vê só os próprios dados, com isolamento no banco e testes automáticos." },
  { icon: ShieldCheckIcon, text: "Verificação em duas etapas opcional, com QR code, e auditoria de todas as ações." },
  { icon: HardDriveIcon, text: "Dados hospedados em São Paulo, com backup e restauração a qualquer instante." },
  { icon: ClipboardCheckIcon, text: "Somente leitura no CLP: o sistema nunca escreve na sua máquina." },
  { icon: RouterIcon, text: "O gateway só faz conexões de saída: nenhuma porta aberta na sua rede." },
  { icon: FileSpreadsheetIcon, text: "Contrato e tratamento de dados conforme a LGPD." },
]

const plans = [
  {
    name: "Starter",
    who: "Uma planta, poucas linhas",
    min: "A partir de 5 máquinas",
    items: ["Painéis ao vivo e relatórios de OEE", "TV Andon e tela do operador", "Alertas no app", "Suporte em horário comercial"],
  },
  {
    name: "Pro",
    who: "Várias linhas, gestão completa",
    min: "A partir de 10 máquinas",
    featured: true,
    items: ["Tudo do Starter", "Pareto, MTBF e MTTR", "Alertas por e-mail e relatórios agendados", "Sua marca na plataforma", "Plantão para casos críticos"],
  },
  {
    name: "Enterprise",
    who: "Várias plantas",
    min: "A partir de 40 máquinas",
    items: ["Tudo do Pro", "Plantão 24×7 para casos críticos", "Reuniões mensais de resultado", "Integrações e API"],
  },
]

const faq = [
  {
    q: "Preciso trocar meus CLPs?",
    a: "Não. O gateway lê o CLP existente por Modbus TCP ou RS-485. A Engemase programa um bloco OEE padrão no CLP, sem mexer na lógica da máquina. Para CLPs sem Modbus, usamos um módulo da própria marca ou um conversor de protocolo.",
  },
  {
    q: "E se a internet da fábrica cair?",
    a: "A coleta continua. O gateway guarda até 30 dias de dados e envia tudo quando a conexão volta, sem perder nem duplicar peças.",
  },
  {
    q: "O sistema altera alguma coisa na máquina?",
    a: "Não. A plataforma só lê o CLP. Nenhum comando é enviado à máquina.",
  },
  {
    q: "O que a TI da fábrica precisa liberar?",
    a: "Só a saída HTTPS (porta 443) do gateway para o endereço da plataforma. Não é preciso abrir portas de entrada. A Engemase entrega uma ficha técnica para a TI.",
  },
  {
    q: "Quem cuida da configuração?",
    a: "A Engemase. Ela cadastra máquinas, gateways, produtos e turnos e acompanha a saúde dos equipamentos. O administrador da sua empresa cuida apenas dos usuários.",
  },
  {
    q: "Como é cobrado?",
    a: "Assinatura mensal por máquina monitorada, com contrato mínimo de 12 meses e taxa de implantação. O gateway fica em comodato, sem compra de equipamento.",
  },
]

/** Largura útil da página: aproveita o monitor inteiro e só limita em telas muito largas (> 1760 px). */
const WRAP = "mx-auto w-full max-w-[1760px] px-5 sm:px-8 lg:px-12 2xl:px-16"

/** Selos que passam na faixa abaixo do topo (marcas de CLP compatíveis e protocolos). */
const ticker = ["Siemens", "Schneider", "Rockwell", "ABB", "Modbus TCP", "Modbus RTU · RS-485", "HTTPS só de saída", "Buffer de 30 dias", "Dados em São Paulo", "LGPD"]

/** Exemplo de OEE do bloco "Por que medir" (ilustrativo). */
const oeeExample = [
  { k: "Disponibilidade", v: 89, text: "Quanto do tempo planejado a máquina produziu", color: "var(--state-running)" },
  { k: "Performance", v: 82, text: "Quão perto do ciclo ideal ela trabalhou", color: "var(--brand-blue)" },
  { k: "Qualidade", v: 97, text: "Quantas das peças saíram boas", color: "var(--state-setup)" },
]

function SectionTitle({ eyebrow, title, text, dark }: { eyebrow: string; title: string; text?: string; dark?: boolean }) {
  return (
    <div className="lp-reveal max-w-3xl">
      <p className={`flex items-center gap-3 text-sm font-semibold tracking-[0.18em] uppercase ${dark ? "text-[var(--brand-orange-light)]" : "text-primary"}`}>
        <span className={`h-px w-8 ${dark ? "bg-[var(--brand-orange-light)]" : "bg-primary"}`} aria-hidden />
        {eyebrow}
      </p>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl xl:text-5xl">{title}</h2>
      {text && <p className={`mt-5 text-lg text-pretty ${dark ? "text-white/70" : "text-muted-foreground"}`}>{text}</p>}
    </div>
  )
}

/** Botão principal (laranja da marca, escurecido para o texto branco passar no contraste AA). */
const ctaClass = "bg-[var(--lp-cta)] text-white shadow-lg shadow-[var(--lp-cta)]/30 hover:bg-[var(--lp-cta-hover)]"

export default function HomePage() {
  return (
    <div className="lp min-h-screen overflow-x-clip bg-background text-foreground">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--lp-ink)]/85 text-white backdrop-blur-md">
        <div className={`${WRAP} flex h-16 items-center gap-4`}>
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image src="/brand/engemase-icone.png" alt="" width={32} height={32} className="size-8" priority />
            <span className="font-semibold whitespace-nowrap">Engemase OEE</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm text-white/75 md:flex">
            {[
              ["#como-funciona", "Como funciona"],
              ["#recursos", "Recursos"],
              ["#implantacao", "Implantação"],
              ["#planos", "Planos"],
              ["#contato", "Contato"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-4">
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild size="sm" className={`hidden sm:inline-flex ${ctaClass}`}>
              <a href={demoHref} target="_blank" rel="noopener noreferrer">Agendar demonstração</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Topo */}
      <section className="relative isolate overflow-hidden bg-[var(--lp-ink)] text-white">
        <div className="lp-grid absolute inset-0 -z-10" aria-hidden />
        <div className="absolute -top-40 right-[-10%] -z-10 size-[42rem] rounded-full bg-[var(--brand-blue)]/30 blur-3xl" aria-hidden />
        <div className="absolute bottom-[-30%] left-[-10%] -z-10 size-[36rem] rounded-full bg-[var(--brand-orange)]/20 blur-3xl" aria-hidden />

        <div className={`${WRAP} grid items-center gap-14 pt-14 pb-24 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10 lg:py-16 2xl:gap-20`}>
          <div>
            <p className="lp-intro inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm backdrop-blur">
              <span className="relative flex size-2.5">
                <span className="lp-ping absolute inline-flex size-full rounded-full bg-[var(--state-running)]" aria-hidden />
                <span className="relative inline-flex size-2.5 rounded-full bg-[var(--state-running)]" />
              </span>
              OEE em tempo real, direto do CLP
            </p>
            <h1 className="lp-intro mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl xl:text-6xl 2xl:text-[4.25rem] 2xl:leading-[1.05]" style={{ ["--lp-d" as string]: "0.1s" }}>
              Saiba quanto suas máquinas produzem{" "}
              <span className="bg-gradient-to-r from-[#7cc0ec] via-white to-[#f3a28f] bg-clip-text text-transparent">de verdade</span>, a cada
              minuto.
            </h1>
            <p className="lp-intro mt-6 max-w-xl text-lg text-pretty text-white/75 xl:text-xl" style={{ ["--lp-d" as string]: "0.2s" }}>
              O Engemase OEE lê o CLP de cada máquina, mostra o OEE ao vivo para a gestão, a linha e o operador, e aponta onde está a
              perda. A Engemase instala, configura e cuida de tudo.
            </p>
            <div className="lp-intro mt-9 flex flex-wrap gap-3" style={{ ["--lp-d" as string]: "0.3s" }}>
              <Button asChild size="lg" className={`h-12 px-6 text-base ${ctaClass}`}>
                <a href={demoHref} target="_blank" rel="noopener noreferrer">
                  Agendar demonstração <ArrowRightIcon className="size-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-white/25 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white">
                <a href="#como-funciona">Como funciona</a>
              </Button>
            </div>
            <dl className="lp-intro mt-12 grid max-w-lg grid-cols-3 divide-x divide-white/10 border-y border-white/10 py-5" style={{ ["--lp-d" as string]: "0.4s" }}>
              {[
                ["Na tela", "em segundos"],
                ["Sem internet", "até 30 dias"],
                ["No CLP", "só leitura"],
              ].map(([k, v]) => (
                <div key={k} className="px-4 first:pl-0">
                  <dt className="text-sm text-white/60">{k}</dt>
                  <dd className="mt-1 text-lg font-semibold xl:text-xl">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Tela do produto inclinada, saindo pela borda direita no computador, com cartões flutuando. */}
          <div className="relative lg:-mr-12 2xl:-mr-16">
            <div className="lp-intro-tilt relative [transform:perspective(1800px)_rotateY(-8deg)_rotateX(2deg)] lg:origin-left">
              <div className="overflow-hidden rounded-2xl border border-white/15 shadow-[0_40px_120px_-20px_rgb(0_0_0/70%)] lg:rounded-r-none">
                <Image
                  src="/produto/visao-geral.png"
                  alt="Visão geral do Engemase OEE com o OEE do turno, máquinas por estado e meta do mês"
                  width={2160}
                  height={1350}
                  priority
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="h-auto w-full"
                />
              </div>
            </div>

            <div className="lp-float absolute -top-6 left-4 hidden items-center gap-3 rounded-2xl border border-white/15 bg-[var(--lp-ink-2)]/85 p-3 pr-5 shadow-2xl backdrop-blur-md sm:flex lg:-left-10">
              <svg viewBox="0 0 100 100" className="size-14 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 12%)" strokeWidth="10" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--state-running)" strokeWidth="10" strokeLinecap="round" strokeDasharray="264" strokeDashoffset="90" className="lp-ring" />
              </svg>
              <div>
                <p className="text-xs text-white/60">OEE do turno</p>
                <p className="text-2xl font-bold tabular-nums">
                  <span className="sr-only">66%</span>
                  <span aria-hidden className="lp-num lp-count" style={{ ["--lp-n" as string]: 66 }} />
                  <span aria-hidden>%</span>
                </p>
              </div>
            </div>

            <div className="lp-float-2 absolute -bottom-8 left-1/3 hidden items-center gap-3 rounded-2xl border border-white/15 bg-[var(--lp-ink-2)]/85 px-4 py-3 shadow-2xl backdrop-blur-md sm:flex">
              <span className="relative flex size-3">
                <span className="lp-ping absolute inline-flex size-full rounded-full bg-[var(--state-running)]" aria-hidden />
                <span className="relative inline-flex size-3 rounded-full bg-[var(--state-running)]" />
              </span>
              <div className="text-sm leading-tight">
                <p className="font-semibold">Injetora 01</p>
                <p className="text-white/60">Produzindo · 18 s/ciclo</p>
              </div>
            </div>

            <div className="lp-float-3 absolute top-1/3 right-6 hidden items-center gap-3 rounded-2xl border border-white/15 bg-[var(--lp-ink-2)]/85 px-4 py-3 shadow-2xl backdrop-blur-md xl:flex 2xl:right-24">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--state-stopped)]/20 text-[var(--state-stopped)]">
                <TimerIcon className="size-5" />
              </span>
              <div className="text-sm leading-tight">
                <p className="font-semibold">Parada classificada</p>
                <p className="text-white/60">Falta de material · 14 min</p>
              </div>
            </div>

            <div className="lp-float-3 absolute -bottom-14 -left-2 hidden w-28 overflow-hidden rounded-[1.4rem] border-4 border-[var(--lp-ink-2)] shadow-2xl md:block lg:-left-8 xl:w-36">
              <Image src="/produto/celular.png" alt="Engemase OEE no celular" width={585} height={1266} sizes="144px" className="h-auto w-full" />
            </div>
          </div>
        </div>

        {/* Faixa corrida com marcas de CLP e protocolos */}
        <div className="lp-marquee-wrap relative border-t border-white/10 bg-white/[0.03] py-5 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <p className="sr-only">Compatível com {ticker.join(", ")}.</p>
          <div className="lp-marquee flex w-max gap-12 pr-12" aria-hidden>
            {[...ticker, ...ticker].map((t, i) => (
              <span key={i} className="flex items-center gap-3 text-sm font-medium whitespace-nowrap text-white/60">
                <span className="size-1.5 rounded-full bg-[var(--brand-orange-light)]" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Por que medir */}
      <section className={`${WRAP} grid gap-12 py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-16 xl:py-32`}>
        <div>
          <SectionTitle
            eyebrow="Por que medir"
            title="A máquina parada que ninguém anotou é a perda que ninguém corrige"
            text="Apontamento em papel chega atrasado e incompleto. Com o OEE medido no CLP, cada parada, cada peça refugada e cada minuto abaixo do ritmo aparecem na hora, com o motivo."
          />
          <p className="lp-reveal mt-8 inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground">
            <GaugeIcon className="size-4 text-primary" /> OEE = Disponibilidade × Performance × Qualidade, somado corretamente por linha e por unidade.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 2xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] 2xl:items-stretch">
          {oeeExample.map((c, i) => (
            <div key={c.k} className="lp-reveal group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-xs transition hover:-translate-y-1 hover:shadow-lg">
              <p className="text-sm font-semibold text-muted-foreground">{c.k}</p>
              <p className="mt-3 text-5xl font-bold tracking-tight tabular-nums">
                <span className="sr-only">{c.v}%</span>
                <span aria-hidden className="lp-num lp-count-view" style={{ ["--lp-n" as string]: c.v }} />
                <span aria-hidden className="text-2xl text-muted-foreground">%</span>
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="lp-grow h-full origin-left rounded-full" style={{ width: `${c.v}%`, background: c.color }} />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{c.text}</p>
              <span className="absolute top-5 right-5 text-xs font-semibold text-muted-foreground/70" aria-hidden>
                {i < 2 ? "×" : "="}
              </span>
            </div>
          ))}
          <div className="lp-reveal flex flex-col justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-navy)] to-[var(--lp-ink)] p-6 text-white shadow-lg sm:col-span-3 2xl:col-span-1 2xl:min-w-44">
            <p className="text-sm font-semibold text-white/70">OEE</p>
            <p className="mt-3 text-6xl font-bold tracking-tight tabular-nums">
              <span className="sr-only">71%</span>
              <span aria-hidden className="lp-num lp-count-view" style={{ ["--lp-n" as string]: 71 }} />
              <span aria-hidden className="text-2xl text-white/60">%</span>
            </p>
            <p className="mt-2 text-sm text-white/70">Exemplo: 0,89 × 0,82 × 0,97</p>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="relative scroll-mt-16 overflow-hidden border-y bg-muted/40 py-24 xl:py-32">
        <div className={WRAP}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionTitle eyebrow="Como funciona" title="Do CLP à tela em poucos segundos" />
            <p className="lp-reveal max-w-md text-muted-foreground lg:text-right">
              Os dados saem da máquina, passam pelo gateway da Engemase e chegam à nuvem por HTTPS, sem abrir nenhuma porta na sua rede.
            </p>
          </div>
          <ol className="relative mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-4 xl:gap-8">
            {/* Fio por onde os dados correm, ligando os 4 passos (computador). */}
            <div className="absolute top-8 right-[12.5%] left-[12.5%] hidden h-0.5 xl:block" aria-hidden>
              <div className="lp-wire h-full w-full" />
              {[0, 1.2, 2.4].map((d) => (
                <span
                  key={d}
                  className="lp-packet absolute top-1/2 -ml-1.5 size-3 -translate-y-1/2 rounded-full bg-[var(--brand-orange-light)] shadow-[0_0_12px_2px_var(--brand-orange-light)]"
                  style={{ animationDelay: `${d}s` }}
                />
              ))}
            </div>
            {steps.map((s, i) => (
              <li key={s.title} className="lp-reveal relative flex flex-col items-start xl:items-center xl:text-center">
                <span className="relative z-10 flex size-16 items-center justify-center rounded-2xl border bg-card text-primary shadow-md ring-8 ring-background/60">
                  <s.icon className="size-7" />
                  <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 max-w-xs text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Recursos com telas: o print encosta na borda da tela no computador */}
      <section id="recursos" className="scroll-mt-16 py-24 xl:py-32">
        <div className={WRAP}>
          <SectionTitle eyebrow="Recursos" title="Uma tela certa para cada pessoa da fábrica" />
        </div>
        <div className="mt-16 space-y-24 xl:space-y-32">
          {features.map((f, i) => {
            const flip = i % 2 === 1
            return (
              <div key={f.title} className={`${WRAP} grid items-center gap-10 lg:grid-cols-12 lg:gap-16`}>
                <div className={`lp-reveal lg:col-span-4 ${flip ? "lg:order-2" : ""}`}>
                  <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{i + 1}</span>
                    {f.tag}
                  </p>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight text-balance xl:text-4xl">{f.title}</h3>
                  <ul className="mt-7 space-y-4">
                    {f.points.map((p) => (
                      <li key={p} className="flex gap-3">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--state-running)]/15">
                          <CheckIcon className="size-4 text-[var(--state-running)]" />
                        </span>
                        <span className="text-muted-foreground xl:text-lg">{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  className={`relative lg:col-span-8 ${flip ? "lp-reveal-left lg:order-1 lg:-ml-12 2xl:-ml-16" : "lp-reveal-right lg:-mr-12 2xl:-mr-16"}`}
                >
                  <div
                    className={`absolute inset-0 -z-10 translate-y-6 rounded-3xl bg-gradient-to-br blur-2xl ${flip ? "from-[var(--brand-orange)]/20 to-[var(--brand-blue)]/20" : "from-[var(--brand-blue)]/25 to-[var(--state-setup)]/15"}`}
                    aria-hidden
                  />
                  <div className={`overflow-hidden rounded-2xl border bg-card shadow-2xl ${flip ? "lg:rounded-l-none" : "lg:rounded-r-none"}`}>
                    <Image src={f.img} alt={f.title} width={f.w} height={f.h} sizes="(min-width: 1024px) 66vw, 100vw" className="h-auto w-full" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Diferenciais e para quem */}
      <section className="border-y bg-muted/40 py-24 xl:py-32">
        <div className={`${WRAP} grid gap-14 xl:grid-cols-12 xl:gap-16`}>
          <div className="xl:col-span-4">
            <div className="xl:sticky xl:top-28">
              <SectionTitle
                eyebrow="Diferenciais"
                title="Feito por quem entende de automação"
                text="A Engemase vive dentro de fábrica há anos. O Engemase OEE nasceu do que faltava nos sistemas que a gente instalava."
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:col-span-8 2xl:grid-cols-3">
            {highlights.map((h) => (
              <div
                key={h.title}
                className="lp-reveal group relative overflow-hidden rounded-2xl border bg-card p-7 shadow-xs transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl"
              >
                <div className="absolute -top-16 -right-16 size-40 rounded-full bg-primary/10 opacity-0 blur-2xl transition duration-500 group-hover:opacity-100" aria-hidden />
                <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                  <h.icon className="size-6" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{h.title}</h3>
                <p className="mt-2 text-muted-foreground">{h.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${WRAP} mt-24 xl:mt-32`}>
          <SectionTitle eyebrow="Para quem" title="Da diretoria ao operador, cada um vê o que precisa" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {roles.map((r, i) => (
              <div key={r.title} className="lp-reveal relative overflow-hidden rounded-2xl border bg-card p-7 shadow-xs">
                <span className="absolute -right-2 -bottom-6 text-8xl font-black text-muted/80 select-none" aria-hidden>
                  0{i + 1}
                </span>
                <r.icon className="relative size-7 text-primary" />
                <h3 className="relative mt-5 text-lg font-semibold">{r.title}</h3>
                <p className="relative mt-2 text-muted-foreground">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Implantação */}
      <section id="implantacao" className="relative isolate scroll-mt-16 overflow-hidden bg-[var(--lp-ink)] py-24 text-white xl:py-32">
        <div className="lp-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
        <div className="absolute top-1/2 left-1/2 -z-10 h-[30rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand-blue)]/20 blur-3xl" aria-hidden />
        <div className={WRAP}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionTitle
              dark
              eyebrow="Implantação"
              title="A Engemase faz a implantação de ponta a ponta"
              text="Você acompanha os resultados. O gateway fica em comodato: sem compra de equipamento."
            />
            <Button asChild size="lg" className={`lp-reveal h-12 w-fit px-6 text-base ${ctaClass}`}>
              <a href={demoHref} target="_blank" rel="noopener noreferrer">
                Começar o diagnóstico <ArrowRightIcon className="size-4" />
              </a>
            </Button>
          </div>
          <ol className="relative mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <div className="absolute top-5 right-0 left-0 hidden h-px bg-white/10 2xl:block" aria-hidden>
              <div className="lp-grow h-full origin-left bg-gradient-to-r from-[var(--brand-orange-light)] to-[var(--brand-blue)]" />
            </div>
            {rollout.map((r, i) => (
              <li key={r.title} className="lp-reveal relative rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition hover:border-white/25 hover:bg-white/[0.07] 2xl:border-0 2xl:bg-transparent 2xl:p-0 2xl:pr-4 2xl:backdrop-blur-none 2xl:hover:bg-transparent">
                <span className="relative flex size-10 items-center justify-center rounded-full bg-[var(--lp-cta)] text-sm font-bold ring-8 ring-[var(--lp-ink)]">{i + 1}</span>
                <h3 className="mt-5 text-lg font-semibold">{r.title}</h3>
                <p className="mt-2 text-white/70">{r.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Segurança */}
      <section className={`${WRAP} grid items-center gap-14 py-24 lg:grid-cols-12 xl:py-32`}>
        <div className="lg:col-span-5">
          <SectionTitle eyebrow="Segurança" title="Seus dados e sua planta protegidos" text="Feito para passar pela TI da fábrica: nada entra na sua rede e nada é escrito na sua máquina." />
          <div className="relative mx-auto mt-12 hidden aspect-square w-72 lg:block xl:w-80" aria-hidden>
            <div className="lp-spin absolute inset-0 rounded-full border-2 border-dashed border-primary/30" />
            <div className="lp-spin-rev absolute inset-8 rounded-full border border-dashed border-[var(--brand-orange-light)]/50" />
            <div className="absolute inset-16 rounded-full bg-gradient-to-br from-primary/15 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-navy)] text-white shadow-2xl shadow-primary/30">
                <ShieldCheckIcon className="size-12" />
              </span>
            </div>
            {[LockKeyholeIcon, RouterIcon, HardDriveIcon, ClipboardCheckIcon].map((Icon, i) => (
              <span
                key={i}
                className="absolute flex size-11 items-center justify-center rounded-xl border bg-card text-primary shadow-md"
                style={{ top: `${50 - 46 * Math.cos((i * Math.PI) / 2)}%`, left: `${50 + 46 * Math.sin((i * Math.PI) / 2)}%`, transform: "translate(-50%, -50%)" }}
              >
                <Icon className="size-5" />
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          {security.map((s) => (
            <div key={s.text} className="lp-reveal flex gap-4 rounded-2xl border bg-card p-6 shadow-xs transition hover:border-primary/40">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </span>
              <p className="pt-1 text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-16 border-y bg-muted/40 py-24 xl:py-32">
        <div className={WRAP}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionTitle eyebrow="Planos" title="Assinatura mensal por máquina monitorada" />
            <p className="lp-reveal max-w-md text-muted-foreground lg:text-right">
              Contrato mínimo de 12 meses, taxa de implantação e gateway em comodato. Fale com a Engemase para uma proposta.
            </p>
          </div>
          <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-3 xl:gap-8">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`lp-reveal relative flex flex-col rounded-3xl p-8 xl:p-10 ${
                  p.featured ? "lp-glow-border shadow-2xl shadow-primary/15 lg:-my-4 lg:py-12" : "border bg-card shadow-xs"
                }`}
              >
                {p.featured && (
                  <span className="absolute -top-3.5 left-8 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-md">
                    <SparklesIcon className="size-3.5" /> Mais escolhido
                  </span>
                )}
                <h3 className="text-2xl font-bold">{p.name}</h3>
                <p className="mt-1 text-muted-foreground">{p.who}</p>
                <p className="mt-7 text-3xl font-bold tracking-tight">Sob consulta</p>
                <p className="text-sm text-muted-foreground">{p.min}</p>
                <ul className="mt-7 flex-1 space-y-3.5">
                  {p.items.map((it) => (
                    <li key={it} className="flex gap-2.5">
                      <CheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                      {it}
                    </li>
                  ))}
                </ul>
                <Button asChild size="lg" className="mt-9 h-12 w-full text-base" variant={p.featured ? "default" : "outline"}>
                  <a href={proposalHref} target="_blank" rel="noopener noreferrer">Pedir proposta</a>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Perguntas */}
      <section className={`${WRAP} grid gap-12 py-24 lg:grid-cols-12 lg:gap-16 xl:py-32`}>
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <SectionTitle eyebrow="Dúvidas" title="Perguntas frequentes" text="Não achou a sua? Fale direto com a equipe da Engemase." />
            <Button asChild variant="outline" size="lg" className="lp-reveal mt-8 h-12">
              <a href={demoHref} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon className="size-4" /> Perguntar no WhatsApp
              </a>
            </Button>
          </div>
        </div>
        <div className="grid content-start gap-3 lg:col-span-8">
          {faq.map((f) => (
            <details key={f.q} className="lp-reveal group rounded-2xl border bg-card px-6 py-5 shadow-xs transition open:border-primary/40 open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted transition group-open:rotate-180 group-open:bg-primary group-open:text-primary-foreground">
                  <ChevronDownIcon className="size-4" />
                </span>
              </summary>
              <p className="mt-3 max-w-3xl text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Chamada final */}
      <section className="relative isolate overflow-hidden bg-[var(--lp-ink)] text-white">
        <div className="lp-grid absolute inset-0 -z-10" aria-hidden />
        <div className="absolute -right-40 -bottom-40 -z-10 size-[40rem] rounded-full bg-[var(--brand-orange)]/25 blur-3xl" aria-hidden />
        <div className="absolute -top-40 -left-40 -z-10 size-[36rem] rounded-full bg-[var(--brand-blue)]/30 blur-3xl" aria-hidden />
        <div className={`${WRAP} grid items-center gap-10 py-20 lg:grid-cols-12 xl:py-28`}>
          <div className="lp-reveal lg:col-span-7">
            <p className="flex items-center gap-3 text-sm font-semibold tracking-[0.18em] text-[var(--brand-orange-light)] uppercase">
              <span className="h-px w-8 bg-[var(--brand-orange-light)]" aria-hidden /> Piloto
            </p>
            <h2 className="mt-4 text-4xl font-bold tracking-tight text-balance xl:text-6xl">Comece por uma linha.</h2>
            <p className="mt-5 max-w-xl text-lg text-white/75">
              Fazemos um piloto numa linha da sua fábrica e conferimos os números junto com a sua equipe.
            </p>
          </div>
          <div className="lp-reveal flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:flex-col lg:items-end">
            <Button asChild size="lg" className={`h-14 w-full px-7 text-base sm:w-auto ${ctaClass}`}>
              <a href={demoHref} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon className="size-5" /> WhatsApp {COMPANY.whatsapp}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14 w-full border-white/25 bg-white/5 px-7 text-base text-white hover:bg-white/10 hover:text-white sm:w-auto">
              <a href={contactHref}>
                <MailIcon className="size-5" /> {COMPANY.email}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Rodapé */}
      <footer id="contato" className="scroll-mt-16 bg-card">
        <div className={`${WRAP} grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]`}>
          <div>
            <BrandLogo width={160} className="dark:hidden" />
            <BrandLogo variant="selo" width={56} className="hidden dark:block" />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              Engemase Engenharia: automação industrial e o Engemase OEE, monitoramento de eficiência direto do CLP.
            </p>
            <div className="mt-5 flex gap-2">
              {[
                { href: COMPANY.social.facebook, label: "Facebook", Icon: FacebookIcon },
                { href: COMPANY.social.instagram, label: "Instagram", Icon: InstagramIcon },
                { href: COMPANY.social.linkedin, label: "LinkedIn", Icon: LinkedinIcon },
                { href: COMPANY.site, label: "Site da Engemase", Icon: GlobeIcon },
              ].map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex size-11 items-center justify-center rounded-xl border text-muted-foreground transition hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Contato</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <a href={COMPANY.phoneHref} className="flex items-center gap-2 hover:text-foreground">
                  <PhoneIcon className="size-4 shrink-0" /> {COMPANY.phone}
                </a>
              </li>
              <li>
                <a href={demoHref} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground">
                  <MessageCircleIcon className="size-4 shrink-0" /> WhatsApp {COMPANY.whatsapp}
                </a>
              </li>
              <li>
                <a href={contactHref} className="flex items-center gap-2 break-all hover:text-foreground">
                  <MailIcon className="size-4 shrink-0" /> {COMPANY.email}
                </a>
              </li>
              <li>
                <a href={COMPANY.site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground">
                  <GlobeIcon className="size-4 shrink-0" /> engemase.com.br
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Localização</h3>
            <p className="mt-4 flex gap-2 text-sm text-muted-foreground">
              <MapPinIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {COMPANY.address.map((l) => (
                  <span key={l} className="block">{l}</span>
                ))}
              </span>
            </p>
          </div>
        </div>
        <div className="border-t">
          <div className={`${WRAP} flex flex-col items-center justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row`}>
            <p>© {COMPANY.name} · Engemase OEE</p>
            <Link href="/login" className="hover:text-foreground">Acesso de clientes</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
