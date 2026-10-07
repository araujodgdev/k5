import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The blocks of the administration canvas (`Main.dc.html`, `admBloco`): a two-column grid of
 * sections, each a flat block or a raised card, made of a head, a note, a bar of filters, facts,
 * fields and a footer. Tables, chips and KPIs come from `canvas/canvas-controls`.
 */

/** Two columns 16px apart, blocks 24px apart; one column on the phone. */
export function AdminGrid({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 gap-x-4 gap-y-6 md:grid-cols-2">{children}</div>;
}

export function AdminBlock({ half = false, card = false, label, labelledBy, className, children }: {
  /** Takes one of the two columns instead of the whole row. */
  half?: boolean;
  /** A raised 12px card with 16px of padding. */
  card?: boolean;
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} aria-labelledby={labelledBy}
      className={cn("flex min-w-0 flex-col gap-3.5", !half && "md:col-span-2", card && "rounded-lg border border-border bg-card p-4", className)}>
      {children}
    </section>
  );
}

/** A block's title, an optional quieter line under it, and its actions on the right. */
export function AdminBlockHead({ id, title, sub, actions, level = 2 }: { id?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <Heading id={id} className="text-[15px] font-semibold tracking-normal">{title}</Heading>
        {sub && <p className="text-[12.5px] leading-[1.45] text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A quiet line led by a 14px icon: what the block keeps or why something is off. */
export function AdminNote({ icon: Icon = Lock, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[12.5px] leading-normal text-muted-foreground">
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Filter chips on the left, the block's actions pushed to the right. On a phone the chips scroll sideways in one line. */
export function AdminBar({ label, actions, children }: { label?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children && (
        <div role="group" aria-label={label} className="-mx-4 -my-1 flex max-w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:my-0 md:max-w-none md:flex-wrap md:overflow-visible md:px-0 md:py-0">
          {children}
        </div>
      )}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** Labelled values in a row that wraps: 12px labels, 14px values (mono for figures). */
export function AdminFacts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-8 gap-y-3">{children}</dl>;
}

export function AdminFact({ label, mono = false, children }: { label: ReactNode; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", mono ? "font-mono text-[13.5px]" : "text-sm")}>{children}</dd>
    </div>
  );
}

/** Fields side by side, bottom-aligned with the button that submits them. */
export function AdminFields({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2.5">{children}</div>;
}

/** The block's last line: a total, a page, a caveat. */
export function AdminFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">{children}</div>;
}

/** A link inside a footer line: the ink of the text, underlined on hover. */
export const adminFooterLink = "rounded-sm text-foreground underline-offset-[3px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The footer of a paged table: "Página 1 de 2 · Próxima", with an optional total before it. */
export function AdminPages({ label, page, pages, href, summary }: {
  label: string;
  /** From 1. */
  page: number;
  pages: number;
  href: (page: number) => string;
  summary?: ReactNode;
}) {
  const items = [
    summary,
    `Página ${page} de ${Math.max(1, pages)}`,
    page > 1 && <Link key="previous" href={href(page - 1)} className={adminFooterLink}>Anterior</Link>,
    page < pages && <Link key="next" href={href(page + 1)} className={adminFooterLink}>Próxima</Link>,
  ].filter(Boolean);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted-foreground">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1.5">{index > 0 && <span aria-hidden>·</span>}{item}</span>
      ))}
    </nav>
  );
}

/** A record opened inside a section: the way back, its name and one line about it. */
export function AdminDetailHead({ back, title, sub, actions }: { back: { href: string; label: string }; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Link href={back.href} className="-ml-1.5 inline-flex h-10 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-[26px]">
        <ArrowLeft aria-hidden className="size-3.5" />{back.label}
      </Link>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-[-0.015em] break-words">{title}</h2>
          {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A record's name in a table cell that opens it: 14px medium over a quiet underline. */
export const adminLink = "rounded-sm text-sm font-medium underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A secondary action written as text, such as "Comprovante" or "Editar". */
export const adminQuietAction = "inline-flex items-center rounded-sm text-[13.5px] max-md:min-h-11 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";

/** The 32px buttons of a block (13px), 44px on the phone. */
export const adminButton = "h-11 px-3 text-[13px] md:h-8";

/** A native select sized and outlined like the canvas inputs. */
export const adminSelect = "h-11 w-full min-w-0 rounded-md border bg-background text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:h-9";

/** The canvas input, 44px on the phone. */
export const adminInput = "h-11 md:h-9";
