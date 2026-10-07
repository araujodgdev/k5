import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Width = "default" | "wide";

/** A view inside the canvas: one centered column, 880px for modules and 1120px for wide views. */
export function CanvasPage({ width = "default", className, children }: { width?: Width; className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-4 px-4 pt-[18px] pb-24 md:gap-10 md:px-12 md:pt-10 md:pb-16",
      width === "default" ? "max-w-[880px]" : "max-w-[1120px] md:px-10 md:pt-7", className)}>
      {children}
    </div>
  );
}

/** The view's header: a short line above the title, the title, and its actions on the right. */
export function CanvasHeader({ eyebrow, title, actions, className }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 md:gap-1.5">
        {eyebrow && <p className="text-[13px] text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-[24px] leading-[1.45] font-semibold tracking-[-0.02em] md:text-[26px]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block of a view, with an optional quiet action such as "Ver todos". */
export function CanvasSection({ title, action, label, className, children }: { title: ReactNode; action?: ReactNode; label?: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The quiet text action of a section header. */
export function CanvasSectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-7 items-center rounded-sm px-2 text-[13px] transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {children}
    </Link>
  );
}

type RowLead =
  | { icon?: ReactNode; control?: never }
  | {
    /** An interactive element in place of the icon, such as the checkbox that completes a task. */
    control: ReactNode;
    icon?: never;
  };

type RowProps = RowLead & {
  title: ReactNode;
  /** Context after the title on the same line (Início) or under it when `stacked`. On the phone it always goes under. */
  detail?: ReactNode;
  /** Mono text at the end: a time, a date or a value. */
  meta?: ReactNode;
  /** A second line under `meta` in stacked rows: a status in words. */
  status?: ReactNode;
  /** A brand dot before `meta`: the item needs the person soon. */
  urgent?: boolean;
  stacked?: boolean;
  href?: string;
  onClick?: () => void;
  /** Accessible name when the visible text is not the action's name, such as "Assistir: <título>". */
  label?: string;
  className?: string;
};

/** One row of a canvas list: 8px corners (10px on the phone), a quiet hover, the icon in the secondary ink. */
export function CanvasRow({ icon, control, title, detail, meta, status, urgent = false, stacked = false, href, onClick, label, className }: RowProps) {
  const interactive = Boolean(href || onClick);
  // A link or a button cannot hold another control, so with one the title takes the action and stretches over the row.
  const stretched = interactive && Boolean(control);
  const titleClass = cn("truncate text-[14.5px] font-medium md:text-sm", !stacked && "md:shrink-0 md:overflow-visible");
  const actionClass = cn(titleClass, "text-left outline-none after:absolute after:inset-0");
  const titleNode = !stretched ? <span className={titleClass}>{title}</span>
    : href ? <Link href={href} aria-label={label} data-row-action className={actionClass}>{title}</Link>
    : <button type="button" aria-label={label} data-row-action onClick={onClick} className={actionClass}>{title}</button>;
  const body = (
    <>
      {control ? <span className="relative z-[1] flex shrink-0">{control}</span>
        : icon && <span aria-hidden="true" className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className={cn("flex min-w-0 flex-1 flex-col gap-px", !stacked && "overflow-hidden md:flex-row md:items-baseline md:gap-2.5")}>
        {titleNode}
        {detail && <span className={cn("truncate text-[12.5px] text-muted-foreground", !stacked && "md:text-[13.5px]")}>{detail}</span>}
      </span>
      {urgent && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" />}
      {(meta || status) && (
        <span className="flex shrink-0 flex-col items-end gap-px md:min-w-[5.75rem]">
          {meta && <span className={cn("font-mono text-[12.5px]", stacked ? "text-foreground" : "text-muted-foreground")}>{meta}</span>}
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </span>
      )}
    </>
  );
  const rowClass = cn("-mx-2 flex items-center gap-3 rounded-[10px] px-2 text-left transition-colors md:-mx-3 md:rounded-md md:px-3",
    stacked ? "min-h-14 py-2" : "min-h-[52px] py-1.5 md:min-h-11",
    interactive && "outline-offset-[-2px] outline-ring hover:bg-accent",
    interactive && (stretched ? "relative has-[[data-row-action]:focus-visible]:outline-2" : "focus-visible:outline-2"),
    className);
  if (stretched || !interactive) return <div className={rowClass}>{body}</div>;
  if (href) return <Link href={href} aria-label={label} className={rowClass}>{body}</Link>;
  return <button type="button" aria-label={label} onClick={onClick} className={cn(rowClass, "w-[calc(100%+1rem)] md:w-[calc(100%+1.5rem)]")}>{body}</button>;
}

/** A raised card in a grid of the canvas: 12px corners, a hairline that darkens on hover. As a button, its children must be inline (spans). */
export function CanvasCard({ href, onClick, className, children }: { href?: string; onClick?: () => void; className?: string; children: ReactNode }) {
  const cardClass = cn("flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors",
    (href || onClick) && "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className);
  if (href) return <Link href={href} className={cardClass}>{children}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cardClass}>{children}</button>;
  return <div className={cardClass}>{children}</div>;
}
