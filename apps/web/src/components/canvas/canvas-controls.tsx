import type { ComponentProps, CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The controls of the prototype's module and administration views (`Main.dc.html`, `admBloco` and
 * `admTabela`): filter chips, status pills, the data table, KPI tiles, a labelled field, and the
 * trail over a page opened from a module.
 */

/**
 * The 44px bar over a page opened from a module (`v.pagina`): the way back in the secondary ink,
 * a slash, the current page in medium weight, and the page's quiet actions at the end.
 */
export function CanvasTrail({ back, icon, current, actions }: {
  /** Where the way back leads: a route, or a view of the same page (a list behind an open item). */
  back: { label: string } & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });
  icon: ReactNode;
  current: ReactNode;
  actions?: ReactNode;
}) {
  const backClass = "flex h-11 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:h-7 [&_svg]:size-3.5";
  const backBody = <><span aria-hidden="true" className="flex">{icon}</span>{back.label}</>;
  return (
    <div className="sticky top-0 z-[2] flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2 text-[13px] md:px-4">
      <nav aria-label="Trilha" className="flex min-w-0 flex-1 items-center gap-1.5">
        {back.href !== undefined ? <Link href={back.href} className={backClass}>{backBody}</Link>
          : <button type="button" onClick={back.onClick} className={backClass}>{backBody}</button>}
        <span aria-hidden="true" className="text-subtle-foreground">/</span>
        <span aria-current="page" className="min-w-0 truncate font-medium">{current}</span>
      </nav>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** A quiet action on the trail: 30px (44px on a phone) in the secondary ink. */
export const trailAction = "h-11 gap-1.5 px-2.5 text-[13px] text-muted-foreground md:h-[30px] [&_svg]:size-3.5";

/** A filter: 30px (44px on a phone), a hairline when off, the selected fill and medium weight when on. */
export function Chip({ pressed = false, menu = false, className, children, ...props }: ComponentProps<"button"> & {
  pressed?: boolean;
  /** Opens a menu of options (a dropdown trigger): shows a chevron and leaves aria-pressed to the toggles. */
  menu?: boolean;
}) {
  return (
    <button type="button" aria-pressed={menu ? undefined : pressed} className={cn(
      "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] max-md:h-11 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
      pressed ? "border-transparent bg-selected font-medium text-foreground" : "border-border text-muted-foreground hover:bg-accent",
      className)} {...props}>
      {children}
      {menu && <ChevronDown aria-hidden="true" className="size-3" />}
    </button>
  );
}

/** A status in words: muted by default, in the brand tint when it needs the person. */
export function Pill({ tone = "muted", className, children }: { tone?: "muted" | "accent"; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap",
      tone === "accent" ? "bg-brand-soft text-brand-ink" : "bg-muted text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/** A label above its control: 12px in the secondary ink, 6px apart. */
export function Field({ label, htmlFor, className, children }: { label: ReactNode; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Equal KPI tiles, 12px apart: two per line on a phone, one line from `md`. */
export function KpiRow({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn("grid grid-cols-2 gap-3 md:auto-cols-fr md:grid-flow-col md:grid-cols-none", className)}>{children}</dl>;
}

/** One figure on a raised 12px tile. Goes inside `KpiRow`. */
export function Kpi({ label, value, size = "default" }: { label: ReactNode; value: ReactNode; size?: "default" | "small" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3.5">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-mono leading-[1.45] tracking-[-0.01em]", size === "small" ? "text-lg" : "text-[21px]")}>{value}</dd>
    </div>
  );
}

export type DataColumn<Row> = {
  header: string;
  /** A grid track: a fixed width such as "96px", or "minmax(0, 1fr)" for the column that takes the rest. */
  width: string;
  align?: "start" | "end";
  mono?: boolean;
  /** 14px medium, for the name that identifies the row. */
  strong?: boolean;
  cell: (row: Row) => ReactNode;
  /** A quieter second line under the cell. */
  sub?: (row: Row) => ReactNode;
  /** The cell holds a control (a button, a link, a menu): it sits above the row link of `rowHref`. */
  interactive?: boolean;
  /** Left out on a phone, where the row stacks without headers: for figures that only read with their column name. */
  phone?: false;
};

/**
 * Rows on a shared grid under a 12px header and a hairline, 46px tall (58px with second lines).
 * On a phone each row stacks: the flexible column on top, the others on one quiet line below it,
 * and the header stays for screen readers only.
 */
export function DataTable<Row>({ label, columns, rows, rowKey, rowHref, tall = false, highlight, empty }: {
  label: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Opens the row: the flexible column becomes a link stretched over the whole row. */
  rowHref?: (row: Row) => string;
  tall?: boolean;
  /** Rows the Lume prepared or changed, in the brand tint. */
  highlight?: (row: Row) => boolean;
  empty?: ReactNode;
}) {
  const primary = Math.max(0, columns.findIndex(column => column.width.includes("fr")));
  const align = (column: DataColumn<Row>) => column.align === "end" ? "md:items-end md:text-right" : "items-start";
  return (
    <div role="table" aria-label={label} className="flex min-w-0 flex-col gap-0.5"
      style={{ "--columns": columns.map(column => column.width).join(" ") } as CSSProperties}>
      <div role="rowgroup" className="max-md:sr-only">
        <div role="row" className="grid grid-cols-(--columns) gap-4 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground">
          {columns.map((column, index) => (
            <span key={index} role="columnheader" className={cn("min-w-0 truncate", column.align === "end" && "text-right")}>{column.header}</span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="flex flex-col gap-0.5">
        {rows.length === 0 && empty ? (
          <div role="row" className="px-3 py-3"><span role="cell" className="text-[13.5px] text-muted-foreground">{empty}</span></div>
        ) : rows.map(row => (
          <div key={rowKey(row)} role="row" className={cn(
            "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2 transition-colors hover:bg-accent md:grid md:grid-cols-(--columns) md:items-center md:gap-4 md:py-[7px]",
            tall ? "md:min-h-[58px]" : "md:min-h-[46px]", highlight?.(row) && "bg-brand-soft hover:bg-brand-soft",
            rowHref && "relative outline-offset-[-2px] outline-ring has-[[data-row-link]:focus-visible]:outline-2")}>
            {columns.map((column, index) => {
              const textClass = cn("max-w-full truncate",
                column.mono ? "font-mono text-[12.5px]" : column.strong ? "text-sm font-medium" : "text-[13.5px]",
                index !== primary && !column.mono && "max-md:text-[12.5px]");
              return (
                <span key={index} role="cell" className={cn("flex min-w-0 flex-col gap-0.5", align(column),
                  index === primary ? "order-first basis-full md:order-none md:basis-auto" : "text-muted-foreground md:text-foreground",
                  rowHref && column.interactive && "relative z-[1]", column.phone === false && "max-md:hidden")}>
                  {rowHref && index === primary
                    ? <Link href={rowHref(row)} data-row-link className={cn(textClass, "outline-none after:absolute after:inset-0")}>{column.cell(row)}</Link>
                    : <span className={textClass}>{column.cell(row)}</span>}
                  {column.sub && <span className="max-w-full truncate text-xs text-muted-foreground">{column.sub(row)}</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
