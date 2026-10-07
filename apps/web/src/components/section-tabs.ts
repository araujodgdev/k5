import { cn } from '@/lib/utils';

/**
 * A section's tabs (Escritório, Pesquisa, Honorários, Integrações, Administração) look the same
 * everywhere: 40px tall, the active one in medium weight over a 2px ink rule that covers the
 * strip's hairline.
 */
export function sectionTab(active: boolean, className?: string) {
  return cn(
    'inline-flex h-10 shrink-0 items-center whitespace-nowrap text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:text-[13.5px]',
    active ? 'font-medium text-foreground shadow-[inset_0_-2px_0_var(--foreground)]' : 'text-muted-foreground hover:text-foreground',
    className,
  );
}

/**
 * The strip of tabs under a hairline; on a phone it scrolls sideways instead of wrapping. The
 * hairline is an inset shadow because the scroll clips at the padding box: a border would sit below
 * the tabs, where the active rule cannot cover it.
 */
export const sectionTabRow = 'flex gap-[18px] overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] md:gap-5';
