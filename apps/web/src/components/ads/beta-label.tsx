import { cn } from '@/lib/utils';

export function BetaLabel({ className }: { className?: string }) {
  return <span className={cn('shrink-0 rounded-sm border border-current px-1 py-0.5 font-mono text-[10px] leading-none tracking-wide', className)}>BETA</span>;
}
