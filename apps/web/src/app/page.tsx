import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { ThemeSwitch } from "@/components/theme-provider";
import { TisesMark, TisesWordmark } from "@/components/tises-logo";
import { Halftone } from "@/components/halftone";
import { LandingMotion, motionScript } from "@/components/landing/landing-motion";
import { LandingClock, LandingDial } from "@/components/landing/landing-clock";
import { GlyphAgenda, GlyphLume, GlyphResearch, GlyphVault } from "@/components/landing/landing-glyphs";
import { ScreenFrame } from "@/components/landing/landing-screens";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Tises — o espaço de trabalho do escritório" },
  description: "A plataforma do escritório de advocacia. Pesquise, redija e acompanhe prazos com um agente que conhece o caso inteiro.",
};

/*
 * The landing is a camera move built from the grid's own pieces (DESIGN.md, "Landing"): scenes
 * come from the back and pass the viewer, the modules slide by as a strip of cells, a statement
 * crosses on a diagonal, the standards arrive as colored blocks, and the invitation sits on the
 * pixel field. Without motion it is a plain page.
 */

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
    name: "Escritório", Glyph: GlyphAgenda,
    text: "Controle prazos, tarefas e reuniões em um só calendário, ligado a clientes e casos, com avisos no celular.",
    points: ["Tarefas com prazo", "Reuniões", "Clientes e casos", "Avisos no celular"],
  },
];

const marquee = ["Lume", "Cofre", "Pesquisa", "Escritório", "Documentos", "E-mails", "Notificações", "Integrações"];

const standards = [
  { figure: "DOCX", text: "Exporte peças no modelo do seu escritório, com fonte, margens e espaçamento preservados.", tone: "bg-brand text-brand-foreground" },
  { figure: "PJe", text: "Envie anexos já divididos e nomeados no padrão do processo eletrônico.", tone: "bg-foreground text-background" },
  { figure: "0", text: "Dados compartilhados entre escritórios. Cada escritório acessa apenas os próprios casos e documentos.", tone: "bg-panel text-panel-foreground" },
];

/** An action in mono caps with an arrow; the brand sweeps in from the left on hover. */
function ArrowLink({ href, children, tone = "ink", className }: { href: string; children: React.ReactNode; tone?: "ink" | "line"; className?: string }) {
  return (
    <Link href={href} className={cn(
      "hover-sweep group/arrow label-mono inline-flex h-12 items-center justify-between gap-10 px-4 transition-colors duration-700 ease-(--ease) hover:text-brand-foreground focus-visible:text-brand-foreground focus-visible:outline-none",
      tone === "ink" ? "bg-foreground text-background" : "border border-input",
      className)}>
      {children}
      <ArrowRight className="size-4 transition-transform duration-500 ease-(--ease) group-hover/arrow:translate-x-1" aria-hidden="true" />
    </Link>
  );
}

/** A mono section label led by a small square. */
function Label({ children, className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("label-mono flex items-center gap-2.5", className)} {...props}><span className="square-dot" aria-hidden="true" />{children}</p>;
}

/** Words set on a block of color, the way the grid's cells carry type. */
function Block({ children, tone, className, ...props }: React.ComponentProps<"span"> & { tone: string }) {
  return <span className={cn("inline-block px-3 pt-2 pb-1", tone, className)} {...props}>{children}</span>;
}

/** Visible only while the camera runs; the plain page doesn't need it. */
const inFilm = "hidden [[data-motion]_&]:block";

export default function Landing() {
  return (
    <LandingMotion className="relative min-h-dvh bg-background text-foreground">
      <script dangerouslySetInnerHTML={{ __html: motionScript }} />
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>

      <header className="appear fixed inset-x-0 top-0 z-30 grid h-[calc(3.75rem+env(safe-area-inset-top))] grid-cols-[1fr_auto] border-b border-line bg-background pt-[env(safe-area-inset-top)] [--delay:2.8s] md:grid-cols-2">
        <div className="flex min-w-0 items-stretch">
          <Link href="/" aria-label="Tises — início" className="tises-hover hover-sweep grid w-15 shrink-0 place-items-center bg-foreground text-background transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:text-brand-foreground focus-visible:outline-none [&_.tises-beam]:transition-[fill] [&_.tises-beam]:duration-500 hover:[&_.tises-beam]:fill-brand-foreground focus-visible:[&_.tises-beam]:fill-brand-foreground">
            <TisesMark width={22} height={22} aria-hidden="true" focusable="false" />
          </Link>
          <TisesWordmark className="ml-5 h-[18px] w-auto self-center md:hidden" aria-hidden="true" focusable="false" />
          <LandingClock className="hidden self-center px-6 text-sm tabular-nums md:block lg:px-24" />
        </div>
        <div className="flex items-stretch md:border-l md:border-line">
          <nav aria-label="Seções" className="hidden items-stretch lg:flex">
            {[["#modulos", "Módulos"], ["#padroes", "Padrões"], ["#comecar", "Começar"]].map(([href, label]) => (
              <a key={href} href={href} className="hover-rise flex items-center px-4 text-[15px] transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:text-brand-foreground">{label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center px-2"><ThemeSwitch /></div>
          <Link href="/sign-in" className="hover-sweep group/cta flex items-center justify-between gap-6 bg-foreground px-5 text-[15px] font-medium text-background transition-colors duration-700 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:text-brand-foreground md:w-60">
            Entrar<ArrowRight className="size-4 transition-transform duration-500 ease-(--ease) group-hover/cta:translate-x-1" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="conteudo" className="relative z-10">
        {/* 1. Forward: the name, then the promise on blocks of color that pass the viewer. */}
        <section aria-labelledby="hero-title" className="film depth" style={{ "--length": 4 } as React.CSSProperties}>
          <div className="film-stage">
            <div className="depth-scene relative min-h-svh">
              <div className="flex flex-col items-center gap-8 text-center md:gap-10">
                {/* The mark builds itself in metal; a spark leaves its beam and lights the i of the name. */}
                <TisesMark finish="metal" data-hero-mark className="tises-intro size-[clamp(84px,11vw,140px)] [--start:.1s]" aria-hidden="true" focusable="false" />
                <h1 id="hero-title" data-hero-word className="w-[clamp(250px,44vw,600px)]">
                  <TisesWordmark finish="metal" className="tises-write h-auto w-full [--start:1.2s]" role="img" aria-label="Tises" />
                </h1>
                <span data-spark aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-[3px] w-6 bg-brand opacity-0 shadow-[0_0_14px_3px_var(--brand)]" />
                <p className="settle max-w-2xl text-[clamp(18px,1.9vw,24px)] leading-snug tracking-[-0.03em] text-muted-foreground [--delay:2.45s]">
                  A plataforma do escritório de advocacia. Pesquise, redija e acompanhe prazos com um agente que conhece o caso inteiro.
                </p>
                <div className="settle flex flex-wrap justify-center gap-2 [--delay:2.6s]">
                  <ArrowLink href="/sign-up" className="w-56">Criar conta</ArrowLink>
                  <ArrowLink href="/sign-in" tone="line" className="w-56">Entrar</ArrowLink>
                </div>
              </div>
              <div className={cn("scroll-cue absolute bottom-3 left-1/2 h-8 w-px -translate-x-1/2 overflow-hidden bg-border", inFilm)} aria-hidden="true"><span className="block size-full bg-foreground" /></div>
            </div>
            <div className="depth-scene">
              <p className="display text-center text-[clamp(64px,11vw,184px)] leading-[.86] uppercase"><Block tone="bg-foreground text-background">Do prazo</Block></p>
            </div>
            <div className="depth-scene">
              <p className="display text-center text-[clamp(64px,11vw,184px)] leading-[.86] uppercase"><Block tone="bg-brand text-brand-foreground">à peça.</Block></p>
            </div>
            <div className="depth-scene">
              <div className="flex flex-col items-center gap-8 text-center">
                <p className="display text-[clamp(56px,9vw,150px)] leading-[.86]"><Block tone="bg-panel text-panel-foreground">Num lugar só.</Block></p>
                <p className="max-w-md text-base leading-snug text-muted-foreground md:text-[17px]">Casos, documentos, prazos e pesquisa na mesma plataforma, com advogados e agente trabalhando a partir do mesmo contexto.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Sideways: the modules slide by as a strip of cells, each screen turning as it crosses. */}
        <section id="modulos" data-track aria-labelledby="modulos-title" className="track scroll-mt-15 bg-foreground text-background" style={{ "--length": 5 } as React.CSSProperties}>
          <div className="track-stage">
            <div data-track-row className="track-row">
              <div data-track-panel className="track-panel flex flex-col justify-between gap-10 bg-panel px-5 pt-24 pb-12 text-panel-foreground md:px-[6vw] md:pb-[10svh]">
                <Label>Módulos</Label>
                <h2 id="modulos-title" className="display text-[clamp(56px,8vw,140px)] leading-[.88] uppercase" data-parallax=".15">
                  <span className="block">Feito</span>
                  <span className="block md:pl-[18vw]">para a</span>
                  <span className="block">advocacia</span>
                </h2>
                <div className="flex max-w-md flex-col gap-8 self-end">
                  <p className="text-base leading-snug">Quatro módulos sobre os mesmos casos. O Lume consulta os documentos do Cofre, e o Escritório acompanha os prazos de cada caso.</p>
                  <ArrowLink href="/sign-up" className="w-full sm:w-64">Criar conta</ArrowLink>
                </div>
              </div>
              {modules.map(({ name, Glyph, text, points }, index) => (
                <article key={name} data-track-panel className="group track-panel grid content-center gap-8 border-background/15 px-5 pt-20 pb-14 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-center md:gap-14 md:border-l md:px-[6vw] md:pb-[8svh]">
                  <div className="flex flex-col gap-6" data-parallax=".25">
                    <div className="flex items-center gap-5">
                      <div className="aspect-square w-16 shrink-0 text-background/80 md:w-24"><Glyph /></div>
                      <h3 className="display text-[clamp(44px,4.6vw,72px)]">{name}</h3>
                    </div>
                    <p className="max-w-md text-base leading-snug tracking-[-0.02em] md:text-[17px]">{text}</p>
                    <ul className="hidden flex-col gap-2 sm:flex">
                      {points.map((point) => (
                        <li key={point} className="label-mono flex items-center gap-3"><span className="square-dot text-brand" aria-hidden="true" />{point}</li>
                      ))}
                    </ul>
                  </div>
                  <div data-tilt><ScreenFrame index={index} className="h-64 text-foreground md:h-[27rem]" /></div>
                </article>
              ))}
            </div>
            <div className={cn("absolute inset-x-5 bottom-6 h-px bg-background/20 md:inset-x-[6vw]", inFilm)} aria-hidden="true">
              <div data-track-progress className="h-full origin-left bg-brand" />
            </div>
          </div>
        </section>

        {/* A strip of what the office gets, sliding slowly on the brand. */}
        <div className="marquee relative z-10 overflow-hidden border-b border-line bg-brand py-5 text-brand-foreground" aria-label="Módulos do Tises">
          <ul className="marquee-track flex w-max gap-12 pr-12 text-[clamp(32px,4.4vw,64px)] font-[450] tracking-[-0.045em]">
            {[...marquee, ...marquee].map((name, index) => (
              <li key={index} aria-hidden={index >= marquee.length || undefined} className="flex items-center gap-12">{name}<span className="square-dot size-2.5" aria-hidden="true" /></li>
            ))}
          </ul>
        </div>

        {/* 3. Across: how the agent behaves, crossing from the lower left to the upper right. */}
        <section data-diagonal aria-labelledby="age-title" className="film" style={{ "--length": 3 } as React.CSSProperties}>
          <div className="film-stage flex flex-col items-center justify-center gap-12 px-4 py-24 md:gap-16 [[data-motion]_&]:py-0">
            <div className="flex flex-col items-center gap-6">
              <Label className="text-muted-foreground" data-diag>O agente</Label>
              <h2 id="age-title" className="display text-center text-[clamp(40px,6.4vw,100px)] leading-[.9] uppercase">
                <span className="block" data-diag>Age, depois conta.</span>
                <span className="block text-subtle-foreground" data-diag>Pergunta antes de apagar.</span>
              </h2>
            </div>
            <div data-rise-from-back aria-hidden="true" className="flex w-full max-w-xl flex-col gap-5 border border-line bg-background p-5 text-[14px] leading-relaxed shadow-(--shadow-float) md:p-6">
              <div className="flex flex-col gap-1.5 text-muted-foreground">
                <p className="flex items-center gap-2"><Check className="size-4 text-brand-ink" />Conferiu 4 citações da contestação</p>
                <p className="flex items-center gap-2"><Check className="size-4 text-brand-ink" />Atualizou “Contestação — Silva”<span className="label-mono ml-auto text-foreground">Abrir</span></p>
              </div>
              <div className="relative flex flex-col gap-4 pl-4">
                <span data-rule className="absolute inset-y-0 left-0 w-0.5 bg-brand" />
                <p>Posso substituir o rascunho que você salvou ontem pela versão revisada?</p>
                <div className="flex gap-2">
                  <span className="inline-flex h-9 items-center bg-foreground px-3.5 text-sm font-medium text-background">Confirmar</span>
                  <span className="inline-flex h-9 items-center px-3.5 text-sm font-medium text-muted-foreground">Cancelar</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Forward again: the office's standards, each on its own block of color. */}
        <section id="padroes" aria-labelledby="padroes-title" className="film depth scroll-mt-15" style={{ "--length": 4 } as React.CSSProperties}>
          <div className="film-stage">
            <div className="depth-scene">
              <div className="flex flex-col items-center gap-6 text-center">
                <Label className="text-muted-foreground">Formatos e isolamento de dados</Label>
                <h2 id="padroes-title" className="display text-[clamp(56px,9vw,150px)] leading-[.9] uppercase">Nos seus padrões</h2>
              </div>
            </div>
            {standards.map(({ figure, text, tone }) => (
              <div key={figure} className="depth-scene">
                <div className={cn("flex aspect-[4/3] w-[min(86vw,640px)] flex-col justify-between p-5 md:p-6", tone)}>
                  <p className="display text-[clamp(88px,13vw,200px)]">{figure}</p>
                  <p className="max-w-xs self-end text-right text-[17px] leading-snug">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 5. The invitation: words on blocks over the pixel field, which leans toward the pointer. */}
        <section id="comecar" aria-labelledby="comecar-title" className="relative isolate grid min-h-[88svh] scroll-mt-15 place-items-center overflow-hidden border-y border-line">
          <div data-field-reveal className="absolute inset-0 -z-10">
            <Halftone seed={11} density={-.1} mark={{ x: .5, y: .5, size: 1.05 }} className="absolute inset-0" />
          </div>
          <h2 id="comecar-title" className="w-full">
            <Link href="/sign-up" className="group/start display block text-[clamp(52px,11.5vw,210px)] leading-[.9] uppercase focus-visible:outline-none">
              <span className="flex flex-wrap justify-between gap-y-2">
                <Block tone="bg-foreground text-background" data-fade>Abra</Block>
                <Block tone="bg-foreground text-background" data-fade=".1">o seu</Block>
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

      <footer className="relative z-10 grid bg-background md:grid-cols-2">
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
          <div className="flex flex-1 items-center justify-center gap-[.18em] text-[clamp(72px,10vw,168px)]">
            <TisesMark className="size-[.8em]" aria-hidden="true" focusable="false" />
            <TisesWordmark className="h-[.66em] w-auto" role="img" aria-label="Tises" />
          </div>
          <p className="label-mono text-background/60">© 2026 Tises</p>
        </div>
        <Link href="/sign-up" className="group/foot relative flex min-h-64 flex-col justify-between gap-10 border-t border-background/15 bg-foreground p-5 text-background focus-visible:outline-none md:min-h-[56svh] md:border-t-0 md:border-l md:p-6">
          <span className="display text-[clamp(36px,3.4vw,52px)] leading-[1]">Leve o Tises para<br />o seu escritório</span>
          <span className="flex items-end justify-between">
            <span className="text-[17px] font-medium underline decoration-transparent underline-offset-4 transition-colors duration-300 group-hover/foot:decoration-brand">Criar conta</span>
            <ArrowUpRight className="size-28 stroke-[.5] transition-[transform,color] duration-700 ease-(--ease) group-hover/foot:translate-x-1 group-hover/foot:-translate-y-1 group-hover/foot:text-brand md:size-36" aria-hidden="true" />
          </span>
        </Link>
      </footer>
    </LandingMotion>
  );
}
