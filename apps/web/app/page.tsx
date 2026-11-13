import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ActivityIcon,
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
  TabletIcon,
  TimerIcon,
  UsersIcon,
  WifiOffIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/shell/brand"
import { COMPANY, SALES_EMAIL, whatsappHref } from "@/lib/site"

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
  { icon: ShieldCheckIcon, text: "Verificação em duas etapas para administradores e auditoria de todas as ações." },
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

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-lg text-pretty text-muted-foreground">{text}</p>}
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#1f3a57]/95 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image src="/brand/engemase-icone.png" alt="" width={32} height={32} className="size-8" priority />
            <span className="font-semibold whitespace-nowrap">Engemase OEE</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-6 text-sm text-white/80 md:flex">
            <a href="#como-funciona" className="hover:text-white">Como funciona</a>
            <a href="#recursos" className="hover:text-white">Recursos</a>
            <a href="#implantacao" className="hover:text-white">Implantação</a>
            <a href="#planos" className="hover:text-white">Planos</a>
            <a href="#contato" className="hover:text-white">Contato</a>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-4">
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild size="sm" className="hidden bg-[#e96549] text-white hover:bg-[#cf5539] sm:inline-flex">
              <a href={demoHref} target="_blank" rel="noopener noreferrer">Agendar demonstração</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Herói */}
      <section className="relative bg-gradient-to-b from-[#1f3a57] via-[#2c4e73] to-[#275993] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm">
              <ActivityIcon className="size-4" /> OEE em tempo real, direto do CLP
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Saiba quanto suas máquinas produzem de verdade, a cada minuto.
            </h1>
            <p className="mt-5 text-lg text-pretty text-white/80">
              O Engemase OEE lê o CLP de cada máquina, mostra o OEE ao vivo para a gestão, a linha e o operador, e
              aponta onde está a perda. A Engemase instala, configura e cuida de tudo.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#e96549] text-white hover:bg-[#cf5539]">
                <a href={demoHref} target="_blank" rel="noopener noreferrer">Agendar demonstração</a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <a href="#como-funciona">Como funciona</a>
              </Button>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-white/60">Na tela</dt>
                <dd className="mt-1 text-xl font-semibold">em segundos</dd>
              </div>
              <div>
                <dt className="text-white/60">Sem internet</dt>
                <dd className="mt-1 text-xl font-semibold">até 30 dias</dd>
              </div>
              <div>
                <dt className="text-white/60">No CLP</dt>
                <dd className="mt-1 text-xl font-semibold">só leitura</dd>
              </div>
            </dl>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-white/15 shadow-2xl shadow-black/40">
              <Image
                src="/produto/visao-geral.png"
                alt="Visão geral do Engemase OEE com o OEE do turno, máquinas por estado e meta do mês"
                width={2160}
                height={1350}
                priority
                sizes="(min-width: 1024px) 600px, 100vw"
                className="h-auto w-full"
              />
            </div>
            <div className="absolute -bottom-8 -left-4 hidden w-32 overflow-hidden rounded-2xl border-4 border-[#1f3a57] shadow-xl sm:block">
              <Image src="/produto/celular.png" alt="Engemase OEE no celular" width={585} height={1266} className="h-auto w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* Problema */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle
          eyebrow="Por que medir"
          title="A máquina parada que ninguém anotou é a perda que ninguém corrige"
          text="Apontamento em papel chega atrasado e incompleto. Com o OEE medido no CLP, cada parada, cada peça refugada e cada minuto abaixo do ritmo aparecem na hora, com o motivo."
        />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            { k: "Disponibilidade", v: "Quanto do tempo planejado a máquina produziu" },
            { k: "Performance", v: "Quão perto do ciclo ideal ela trabalhou" },
            { k: "Qualidade", v: "Quantas das peças saíram boas" },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border bg-card p-6 text-center shadow-xs">
              <p className="text-lg font-semibold">{c.k}</p>
              <p className="mt-2 text-sm text-muted-foreground">{c.v}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          OEE = Disponibilidade × Performance × Qualidade, somado corretamente por linha e por unidade.
        </p>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-20 border-y bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle eyebrow="Como funciona" title="Do CLP à tela em poucos segundos" />
          <ol className="mt-12 grid gap-4 md:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border bg-card p-6 shadow-xs">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">Passo {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Recursos com telas */}
      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionTitle eyebrow="Recursos" title="Uma tela certa para cada pessoa da fábrica" />
        <div className="mt-16 space-y-20">
          {features.map((f, i) => (
            <div key={f.title} className="grid items-center gap-10 lg:grid-cols-2">
              <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                <p className="text-sm font-semibold tracking-wide text-primary uppercase">{f.tag}</p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-balance">{f.title}</h3>
                <ul className="mt-6 space-y-3">
                  {f.points.map((p) => (
                    <li key={p} className="flex gap-3">
                      <CheckIcon className="mt-0.5 size-5 shrink-0 text-[var(--state-running)]" />
                      <span className="text-muted-foreground">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="overflow-hidden rounded-xl border shadow-lg">
                <Image src={f.img} alt={f.title} width={f.w} height={f.h} sizes="(min-width: 1024px) 560px, 100vw" className="h-auto w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Diferenciais */}
      <section className="border-y bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle eyebrow="Diferenciais" title="Feito por quem entende de automação" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((h) => (
              <div key={h.title} className="rounded-xl border bg-card p-6 shadow-xs">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <h.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{h.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Para quem */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow="Para quem" title="Da diretoria ao operador, cada um vê o que precisa" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((r) => (
            <div key={r.title} className="rounded-xl border bg-card p-6 shadow-xs">
              <r.icon className="size-6 text-primary" />
              <h3 className="mt-4 font-semibold">{r.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{r.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Implantação */}
      <section id="implantacao" className="scroll-mt-20 bg-[#1f3a57] py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-wide text-[#e96549] uppercase">Implantação</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">A Engemase faz a implantação de ponta a ponta</h2>
            <p className="mt-4 text-lg text-white/75">Você acompanha os resultados. O gateway fica em comodato: sem compra de equipamento.</p>
          </div>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rollout.map((r, i) => (
              <li key={r.title} className="rounded-xl border border-white/15 bg-white/5 p-6">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#e96549] text-sm font-bold">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{r.title}</h3>
                <p className="mt-2 text-sm text-white/75">{r.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Segurança */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow="Segurança" title="Seus dados e sua planta protegidos" />
        <div className="mx-auto mt-12 grid max-w-4xl gap-x-10 gap-y-6 sm:grid-cols-2">
          {security.map((s) => (
            <div key={s.text} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </span>
              <p className="pt-2 text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-20 border-y bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle
            eyebrow="Planos"
            title="Assinatura mensal por máquina monitorada"
            text="Contrato mínimo de 12 meses, taxa de implantação e gateway em comodato. Fale com a Engemase para uma proposta."
          />
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "relative rounded-2xl border-2 border-primary bg-card p-8 shadow-lg"
                    : "rounded-2xl border bg-card p-8 shadow-xs"
                }
              >
                {p.featured && (
                  <span className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Mais escolhido
                  </span>
                )}
                <h3 className="text-xl font-bold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.who}</p>
                <p className="mt-6 text-2xl font-bold">Sob consulta</p>
                <p className="text-sm text-muted-foreground">{p.min}</p>
                <ul className="mt-6 space-y-3 text-sm">
                  {p.items.map((it) => (
                    <li key={it} className="flex gap-2">
                      <CheckIcon className="size-4 shrink-0 text-primary" />
                      {it}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full" variant={p.featured ? "default" : "outline"}>
                  <a href={proposalHref} target="_blank" rel="noopener noreferrer">Pedir proposta</a>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Perguntas */}
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow="Dúvidas" title="Perguntas frequentes" />
        <div className="mt-10 divide-y rounded-xl border bg-card">
          {faq.map((f) => (
            <details key={f.q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Chamada final */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl bg-gradient-to-r from-[#2c4e73] to-[#257bb4] px-6 py-14 text-center text-white sm:px-12">
          <TimerIcon className="mx-auto size-10 text-white/80" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-balance">Comece por uma linha</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">
            Fazemos um piloto numa linha da sua fábrica e conferimos os números junto com a sua equipe.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-white text-[#1f3a57] hover:bg-white/90">
              <a href={demoHref} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon className="size-4" /> WhatsApp {COMPANY.whatsapp}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <a href={contactHref}>
                <MailIcon className="size-4" /> {COMPANY.email}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Rodapé */}
      <footer id="contato" className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <BrandLogo width={160} className="dark:hidden" />
            <BrandLogo variant="selo" width={56} className="hidden dark:block" />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
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
                  className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition hover:border-primary/40 hover:text-primary"
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
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6">
            <p>© {COMPANY.name} · Engemase OEE</p>
            <Link href="/login" className="hover:text-foreground">Acesso de clientes</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
