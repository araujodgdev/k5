import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RowsLoading } from './agenda-rows';

/** The quiet way back above a detail's title (the prototype's "Voltar para clientes"). */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-ml-1.5 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:h-[26px]">
      <ArrowLeft aria-hidden="true" className="size-3.5" />{children}
    </Link>
  );
}

export type Fact = { label: string; value: ReactNode; mono?: boolean };

/** Labelled values side by side, wrapping: 12px labels over the value, 32px apart. */
export function Facts({ items, className }: { items: readonly Fact[]; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap gap-x-8 gap-y-3', className)}>
      {items.map(item => (
        <div key={item.label} className="flex min-w-0 max-w-full flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className={cn('min-w-0 break-words', item.mono ? 'font-mono text-[12.5px] leading-[21px]' : 'text-[13.5px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A module route while it loads: its title over rows standing in for the list. */
export function RouteLoading({ title, label }: { title: string; label: string }) {
  return (
    <CanvasPage className="gap-5 md:gap-5">
      <CanvasHeader eyebrow={<span aria-hidden="true">&nbsp;</span>} title={title} />
      <RowsLoading label={label} />
    </CanvasPage>
  );
}

/** A module route that failed: the title, one sentence and a way to try again. */
export function RouteError({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return (
    <CanvasPage className="gap-5 md:gap-5">
      <CanvasHeader eyebrow={<span aria-hidden="true">&nbsp;</span>} title={title} />
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-[13.5px] text-destructive">{message}</p>
        {retry && <Button variant="outline" onClick={retry}>Tentar novamente</Button>}
      </div>
    </CanvasPage>
  );
}
