import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Halftone } from "@/components/halftone";
import { LumeMark } from "@/components/lume-mark";
import { ThemeSwitch } from "@/components/theme-provider";
import { LandingClock, LandingDial } from "@/components/landing/landing-clock";
import { LandingMotion } from "@/components/landing/landing-motion";
import { GlyphAgenda, GlyphLume, GlyphResearch, GlyphVault } from "@/components/landing/landing-glyphs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Lume — o espaço de trabalho do escritório" },
  description: "A plataforma do escritório de advocacia. Pesquise, redija e acompanhe prazos com um agente que conhece o caso inteiro.",
};

const modules = [
  {
    name: "Lume", Glyph: GlyphLume,
    text: "Pesquise, redija e revise peças com um agente que trabalha a partir do caso inteiro. Ele informa o que fez e pede confirmação antes de apagar, sobrescrever um rascunho ou falar com um tribunal.",
    points: ["Peças em DOCX", "Citações conferidas", "Voz e anexos", "Documento ao lado da conversa"],
  },
  {
    name: "Cofre", Glyph: GlyphVault,
    text: "Organize os documentos do escritório por caso, com leitura integral, inclusive de PDFs escaneados. Depois, encontre o que importa com uma busca ou uma pergunta ao Lume.",
    points: ["Pastas por caso", "Leitura de PDFs escaneados", "Anexos nomeados para o PJe", "Busca no conteúdo"],
  },
  {
    name: "Pesquisa", Glyph: GlyphResearch,
    text: "Encontre jurisprudência e acompanhe andamentos sem sair do caso. Salve cada decisão como referência ou use-a como ponto de partida de uma peça.",
    points: ["Jurisprudência na web", "Andamentos processuais", "Vínculo com o caso", "Rascunho a partir da decisão"],
  },
  {
    name: "Agenda", Glyph: GlyphAgenda,
    text: "Controle prazos, tarefas e reuniões em um só calendário, ligado a clientes e casos, com avisos no celular.",
    points: ["Tarefas com prazo", "Reuniões", "Clientes e casos", "Avisos no celular"],
  },
];

const marquee = ["Lume", "Cofre", "Pesquisa", "Agenda", "Documentos", "E-mails", "Notificações", "Integrações"];

/** An action in mono caps with an arrow; the brand sweeps in from the left on hover. */
function ArrowLink({ href, children, tone = "ink", className }: { href: string; children: React.ReactNode; tone?: "ink" | "clear"; className?: string }) {
  return (
    <Link href={href} className={cn(
      "hover-sweep group/arrow label-mono inline-flex h-12 items-center justify-between gap-10 px-4 transition-colors duration-700 ease-(--ease) hover:text-brand-foreground focus-visible:text-brand-foreground focus-visible:outline-none",
      tone === "ink" ? "bg-foreground text-background" : "text-current",
      className)}>
      {children}
      <ArrowRight className="size-4 transition-transform duration-500 ease-(--ease) group-hover/arrow:translate-x-1" aria-hidden="true" />
    </Link>
  );
}

/** A mono section label led by a small square. */
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("label-mono flex items-center gap-2.5", className)}><span className="square-dot" aria-hidden="true" />{children}</p>;
}

/** Words that rise out of their own line box as they scroll in. */
function Rise({ children, delay, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return <span className={cn("block overflow-hidden pb-[.08em]", className)}><span className="block" data-rise={delay}>{children}</span></span>;
}

export default function Landing() {
  return (
    <LandingMotion className="min-h-dvh bg-background text-foreground">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>

      <header className="sticky top-0 z-30 grid h-[calc(3.75rem+env(safe-area-inset-top))] grid-cols-[1fr_auto] border-b border-line bg-background pt-[env(safe-area-inset-top)] md:grid-cols-2">
        <div className="flex min-w-0 items-stretch">
          <Link href="/" aria-label="Lume — início" className="hover-sweep grid w-15 shrink-0 place-items-center bg-foreground text-background transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:text-brand-foreground focus-visible:outline-none">
            <LumeMark width={22} height={22} aria-hidden="true" focusable="false" />
          </Link>
          <p className="self-center px-5 text-lg font-medium tracking-[-0.04em] md:hidden">Lume</p>
          <LandingClock className="hidden self-center px-6 text-sm tabular-nums md:block lg:px-24" />
        </div>
        <div className="flex items-stretch md:border-l md:border-line">
          <nav aria-label="Seções" className="hidden items-stretch lg:flex">
            {[["#modulos", "Módulos"], ["#escritorio", "Padrões"], ["#comecar", "Começar"]].map(([href, label]) => (
              <a key={href} href={href} className="hover-rise flex items-center px-4 text-[15px] transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:text-brand-foreground">{label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center px-2"><ThemeSwitch /></div>
          <Link href="/sign-in" className="hover-sweep group/cta flex items-center justify-between gap-6 bg-foreground px-5 text-[15px] font-medium text-background transition-colors duration-700 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:text-brand-foreground md:w-60">
            Entrar<ArrowRight className="size-4 transition-transform duration-500 ease-(--ease) group-hover/cta:translate-x-1" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="conteudo">
        {/* Hero: the name, the field, and what the Lume is, set on the grid. */}
        <section aria-labelledby="hero-title" className="grid border-b border-line md:grid-cols-2">
          <div className="flex min-h-[38svh] items-end px-5 pb-4 md:min-h-[54svh] md:px-6">
            <h1 id="hero-title" className="display overflow-hidden pb-[.12em] text-[clamp(104px,19vw,280px)] leading-[.85]">
              <span className="rise-in block">Lume</span>
            </h1>
          </div>
          <Halftone seed={3} density={-.08} className="fade-in h-44 border-t border-line [--delay:.2s] md:h-auto md:border-t-0 md:border-l" />
          <Halftone seed={7} mark={{ x: .56, y: .58, size: .95 }} className="fade-in hidden border-t border-line [--delay:.35s] md:block md:min-h-[46svh]" />
          <div className="grid border-t border-line sm:grid-cols-2 md:border-l">
            <div className="flex min-h-72 flex-col justify-between gap-10 bg-foreground p-5 text-background md:p-6">
              <p className="fade-in text-[clamp(22px,2vw,30px)] leading-[1.12] tracking-[-0.035em] [--delay:.45s]">A plataforma do escritório de advocacia. Pesquise, redija e acompanhe prazos com um agente que conhece o caso inteiro.</p>
              <ArrowLink href="/sign-up" tone="clear" className="-mx-4 -mb-3">Criar conta</ArrowLink>
            </div>
            <div className="flex min-h-72 flex-col justify-between gap-10 overflow-hidden bg-brand text-brand-foreground">
              <p className="fade-in p-5 text-[clamp(22px,2vw,30px)] leading-[1.12] tracking-[-0.035em] [--delay:.55s] md:p-6">O melhor trabalho do escritório em cada caso, com mais tempo para os clientes.</p>
              <div className="marquee overflow-hidden border-t border-brand-foreground/25 py-4" aria-label="Módulos do Lume">
                <ul className="marquee-track flex w-max gap-10 pr-10 text-xl font-medium tracking-[-0.04em]">
                  {[...marquee, ...marquee].map((name, index) => (
                    <li key={index} aria-hidden={index >= marquee.length || undefined} className="flex items-center gap-10">{name}<span className="square-dot size-1.5" aria-hidden="true" /></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Statement band. */}
        <section aria-label="Do prazo à peça" className="grid border-b border-line md:grid-cols-2">
          <div className="flex min-h-[44svh] flex-col justify-end bg-foreground px-5 py-6 text-background md:px-6">
            <p className="display text-[clamp(64px,10.5vw,176px)] leading-[.86] uppercase">
              <Rise>Do prazo</Rise>
              <Rise delay={.08}>à peça.</Rise>
            </p>
          </div>
          <div className="grid min-h-[44svh] grid-rows-[1fr_auto] border-t border-line bg-panel text-panel-foreground md:border-t-0 md:border-l">
            <p className="display self-end px-5 pb-6 text-[clamp(56px,8vw,140px)] md:px-6"><Rise>Num lugar só.</Rise></p>
            <div className="border-t border-line px-5 py-5 md:px-6"><p className="max-w-md text-base leading-snug" data-fade>Casos, documentos, prazos e pesquisa na mesma plataforma, com advogados e agente trabalhando a partir do mesmo contexto.</p></div>
          </div>
        </section>

        {/* Modules. */}
        <section id="modulos" aria-labelledby="modulos-title" className="grid scroll-mt-15 border-b border-line md:grid-cols-2">
          <div className="border-line bg-panel text-panel-foreground md:border-r">
            <div className="flex flex-col gap-10 px-5 py-8 md:sticky md:top-15 md:min-h-[calc(100svh-3.75rem)] md:justify-between md:px-6 md:py-6">
              <Label>Módulos</Label>
              <h2 id="modulos-title" className="display text-[clamp(56px,7.4vw,128px)] leading-[.88] uppercase">
                <Rise>Feito</Rise>
                <Rise delay={.06} className="md:text-right">para a</Rise>
                <Rise delay={.12}>advocacia</Rise>
              </h2>
              <div className="flex max-w-md flex-col gap-8 self-end" data-fade>
                <p className="text-base leading-snug">Quatro módulos sobre os mesmos casos. O Lume consulta os documentos do Cofre, e a Agenda acompanha os prazos de cada caso.</p>
                <ArrowLink href="/sign-up" className="w-full sm:w-64">Criar conta</ArrowLink>
              </div>
            </div>
          </div>
          <ol className="bg-foreground text-background">
            {modules.map(({ name, Glyph, text, points }, index) => (
              <li key={name} className="group grid gap-8 border-b border-background/15 px-5 py-10 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:px-6 lg:py-12">
                <div className="flex flex-col justify-between gap-10">
                  <h3 className="flex items-baseline gap-5 text-[clamp(36px,3.6vw,56px)] leading-none font-[450] tracking-[-0.045em]">
                    <span className="label-mono text-background/50">{String(index + 1).padStart(2, "0")}</span>{name}
                  </h3>
                  <div className="aspect-square w-36 text-background/80 lg:w-44" data-fade><Glyph /></div>
                </div>
                <div className="flex flex-col justify-between gap-10">
                  <p className="text-[17px] leading-snug tracking-[-0.02em]" data-fade>{text}</p>
                  <ul className="flex flex-col gap-2" data-fade>
                    {points.map((point) => (
                      <li key={point} className="label-mono flex items-center gap-3"><span className="square-dot text-brand" aria-hidden="true" />{point}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* The office: plain facts as large figures, on the grid's colors. */}
        <section id="escritorio" aria-labelledby="escritorio-title" className="scroll-mt-15 border-b border-line">
          <div className="flex items-end justify-between gap-6 border-b border-line px-5 py-8 md:px-6">
            <h2 id="escritorio-title" className="display text-[clamp(56px,9vw,150px)]"><Rise>Nos seus padrões</Rise></h2>
            <Label className="mb-3 hidden text-muted-foreground sm:flex">Formatos e isolamento de dados</Label>
          </div>
          <div className="grid md:grid-cols-4">
            <div className="flex min-h-[46svh] flex-col justify-between gap-10 bg-brand p-5 text-brand-foreground md:col-span-2 md:p-6" data-wipe>
              <p className="display text-[clamp(88px,11vw,190px)]">DOCX</p>
              <p className="max-w-xs self-end text-right text-[17px] leading-snug">Exporte peças no modelo do seu escritório, com fonte, margens e espaçamento preservados.</p>
            </div>
            <div className="flex min-h-72 flex-col justify-between gap-10 border-t border-line bg-foreground p-5 text-background md:border-t-0 md:border-l md:p-6" data-wipe>
              <p className="display text-[clamp(72px,7vw,120px)]">PJe</p>
              <p className="text-[17px] leading-snug">Envie anexos já divididos e nomeados no padrão do processo eletrônico.</p>
            </div>
            <div className="flex min-h-72 flex-col justify-between gap-10 border-t border-line bg-panel p-5 text-panel-foreground md:border-t-0 md:border-l md:p-6" data-wipe>
              <p className="display text-[clamp(72px,7vw,120px)]">0</p>
              <p className="text-[17px] leading-snug">Dados compartilhados entre escritórios. Cada escritório acessa apenas os próprios casos e documentos.</p>
            </div>
          </div>
        </section>

        {/* Call to action on the field. */}
        <section id="comecar" aria-labelledby="comecar-title" className="relative isolate grid min-h-[80svh] scroll-mt-15 place-items-center overflow-hidden border-b border-line">
          <Halftone seed={11} mark={{ x: .5, y: .5, size: 1.05 }} className="absolute inset-0 -z-10" />
          <h2 id="comecar-title" className="w-full">
            <Link href="/sign-up" className="group/start display block text-[clamp(52px,11.5vw,210px)] leading-[.9] uppercase focus-visible:outline-none">
              <span className="flex flex-wrap justify-between gap-y-2">
                <span className="bg-foreground px-3 pt-2 pb-1 text-background" data-fade>Abra</span>
                <span className="bg-foreground px-3 pt-2 pb-1 text-background" data-fade=".1">o seu</span>
              </span>
              <span className="mt-2 flex justify-center">
                <span className="flex items-stretch bg-background" data-fade=".2">
                  <span className="px-3 pt-2 pb-1">escritório</span>
                  <span className="grid w-[1.1em] place-items-center bg-brand text-brand-foreground transition-colors duration-700 ease-(--ease) group-hover/start:bg-foreground group-hover/start:text-background group-focus-visible/start:bg-foreground group-focus-visible/start:text-background">
                    <ArrowRight className="size-[.6em] stroke-[1.25] transition-transform duration-700 ease-(--ease) group-hover/start:translate-x-[.08em]" aria-hidden="true" />
                  </span>
                </span>
              </span>
              <span className="sr-only">: criar conta</span>
            </Link>
          </h2>
        </section>
      </main>

      <footer className="grid md:grid-cols-2">
        <div className="flex min-h-72 flex-col justify-between gap-10 border-b border-line p-5 md:p-6">
          <p className="display text-[clamp(36px,3.4vw,52px)] leading-[1]">O espaço de trabalho<br />do escritório.</p>
        </div>
        <div className="grid grid-cols-2 border-b border-line md:border-l">
          <nav aria-label="Rodapé" className="flex flex-col gap-3 p-5 text-[17px] md:p-6">
            <Link href="/sign-in" className="w-fit underline decoration-transparent underline-offset-4 transition-colors duration-300 hover:decoration-brand">Entrar</Link>
            <Link href="/sign-up" className="w-fit underline decoration-transparent underline-offset-4 transition-colors duration-300 hover:decoration-brand">Criar conta</Link>
            <a href="#modulos" className="w-fit underline decoration-transparent underline-offset-4 transition-colors duration-300 hover:decoration-brand">Módulos</a>
          </nav>
          <div className="flex items-start gap-4 border-l border-line p-5 md:p-6">
            <LandingDial className="size-12 shrink-0" />
            <div>
              <p className="text-[17px] font-medium">São Paulo</p>
              <LandingClock label={null} className="label-mono text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="flex min-h-80 flex-col justify-between gap-10 bg-foreground p-5 text-background md:min-h-[56svh] md:p-6">
          <div className="flex flex-1 items-center justify-center gap-[.18em] text-[clamp(72px,10vw,168px)] font-medium tracking-[-0.05em]">
            <LumeMark className="size-[.82em]" aria-hidden="true" focusable="false" />Lume
          </div>
          <p className="label-mono text-background/60">© 2026 Lume</p>
        </div>
        <Link href="/sign-up" className="group/foot relative flex min-h-64 flex-col justify-between gap-10 border-t border-background/15 bg-foreground p-5 text-background focus-visible:outline-none md:min-h-[56svh] md:border-t-0 md:border-l md:p-6">
          <span className="display text-[clamp(36px,3.4vw,52px)] leading-[1]">Leve o Lume para<br />o seu escritório</span>
          <span className="flex items-end justify-between">
            <span className="text-[17px] font-medium underline decoration-transparent underline-offset-4 transition-colors duration-300 group-hover/foot:decoration-brand">Criar conta</span>
            <ArrowUpRight className="size-28 stroke-[.5] transition-[transform,color] duration-700 ease-(--ease) group-hover/foot:translate-x-1 group-hover/foot:-translate-y-1 group-hover/foot:text-brand md:size-36" aria-hidden="true" />
          </span>
        </Link>
      </footer>
    </LandingMotion>
  );
}
