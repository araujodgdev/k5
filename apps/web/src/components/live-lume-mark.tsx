'use client';
import type { SVGProps } from 'react';
import { LumeMark } from '@/components/lume-mark';
import { cn } from '@/lib/utils';
export type LumeMarkState = 'still' | 'idle' | 'working' | 'attention';
export function LiveLumeMark({ state, className, ...props }: { state: LumeMarkState } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 340 340" width="24" height="24" {...props} aria-hidden={!props['aria-label'] && !props['aria-labelledby'] || undefined} data-state={state} className={cn('lume-live-mark', className)}>
    <LumeMark className="lume-mark-still" x="0" y="0" width="340" height="340" />
    <image className="lume-mark-animation" href="/lume-reflexo.gif" x="-154" y="-145" width="640" height="640" />
  </svg>;
}
