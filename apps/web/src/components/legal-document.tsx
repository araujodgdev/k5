import Link from "next/link";
import type { ReactNode } from "react";
import { LumeMark } from "@/components/lume-mark";
import { ThemeSwitch } from "@/components/theme-provider";

export type LegalSection = {
  id: string;
  title: string;
  paragraphs: ReactNode[];
};

export const legalCompany = "WEB STAR STUDIO DESENVOLVIMENTO DE SOFTWARE LTDA";
export const legalAddress = "Avenida Ipiranga, nº 6681, TECNOPUC, Prédio 96E, Sala 103, Porto Alegre/RS, CEP 90619-900, Brasil";
export const legalContact = <a href="mailto:info@lume.software">info@lume.software</a>;

export function LegalDocument({ title, introduction, sections }: {
  title: string;
  introduction: string;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground print:bg-white print:text-black print:[&_*]:text-black">
      <a href="#documento" className="sr-only focus:not-sr-only focus:block focus:p-4">Ir para o documento</a>
      <header className="flex h-15 items-center border-b border-line print:hidden">
        <Link href="/" aria-label="Lume, página inicial" className="grid h-full w-15 place-items-center bg-foreground text-background focus-visible:outline-2 focus-visible:outline-brand">
          <LumeMark width={22} height={22} aria-hidden="true" />
        </Link>
        <Link href="/" className="px-5 text-lg font-medium">Lume</Link>
        <div className="ml-auto flex items-center gap-4 px-5"><Link href="/sign-in" className="inline-flex min-h-11 items-center underline underline-offset-4">Entrar</Link><ThemeSwitch /></div>
      </header>
      <main id="documento" tabIndex={-1} className="mx-auto max-w-7xl outline-none">
        <div id="inicio" className="border-b border-line px-5 py-12 md:px-10 md:py-16">
          <p className="label-mono mb-5 text-muted-foreground">Documentos legais · Versão 1.0</p>
          <h1 className="display max-w-4xl text-[clamp(40px,6vw,80px)]">{title}</h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed">{introduction}</p>
          <p className="mt-6 text-sm text-muted-foreground">Última atualização: <time dateTime="2026-09-29">29 de setembro de 2026</time></p>
        </div>
        <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] print:block">
          <nav aria-label="Índice do documento" className="border-b border-line px-5 py-8 lg:border-r lg:border-b-0 lg:px-10 print:hidden">
            <p className="label-mono mb-4 text-muted-foreground">Nesta página</p>
            <ol className="space-y-1">
              {sections.map((section, index) => <li key={section.id}><a href={`#${section.id}`} className="flex min-h-11 items-center gap-3 py-2 text-sm hover:underline focus-visible:outline-2 focus-visible:outline-brand"><span className="font-mono text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>{section.title}</a></li>)}
            </ol>
          </nav>
          <article className="min-w-0 px-5 md:px-10 lg:px-12 [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-brand-ink [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-brand">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titulo`} className="scroll-mt-6 border-b border-border py-9 last:border-b-0 print:py-4">
                <h2 id={`${section.id}-titulo`} className="mb-5 text-2xl font-medium tracking-tight print:break-after-avoid">{index + 1}. {section.title}</h2>
                <div className="max-w-prose space-y-4 text-[15px] leading-7 [overflow-wrap:anywhere]">{section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <footer className="border-t border-line px-5 py-8 text-sm md:px-10 [&_a]:underline [&_a]:underline-offset-4">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 md:flex-row">
          <div className="max-w-xl space-y-2"><p>{legalCompany}</p><p>CNPJ 57.717.768/0001-06</p><p className="text-muted-foreground">{legalAddress}</p><p>{legalContact}</p></div>
          <nav aria-label="Documentos legais" className="flex flex-col items-start gap-4 print:hidden"><Link href="/termos-de-uso">Termos e condições de uso</Link><Link href="/politica-privacidade">Política de privacidade</Link><a href="#inicio">Voltar ao início</a></nav>
        </div>
      </footer>
    </div>
  );
}
