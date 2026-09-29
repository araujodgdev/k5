import { cn } from '@/lib/utils';

/**
 * A section's tabs (Escritório, Pesquisa, Honorários, Integrações, Administração) look the same
 * everywhere: the text at the page margin, the active one in medium weight over a 2px ink rule,
 * 44px tall on a phone and 48px from `md`.
 */
export function sectionTab(active: boolean, className?: string) {
  return cn(
    'inline-flex min-h-11 shrink-0 items-center justify-center border-b-2 px-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-12 md:justify-start',
    active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
    className,
  );
}

/** The row of a few tabs, under a hairline. */
export const sectionTabRow = 'flex gap-5 border-b';

/** Three or more tabs: a 3-column grid on a phone (nothing scrolls or cuts a word), a row from `md`. */
export const sectionTabGrid = 'grid grid-cols-3 border-b md:flex md:gap-5 md:overflow-x-auto';
