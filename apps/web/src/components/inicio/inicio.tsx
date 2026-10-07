'use client';

import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { LumeWorkList } from './lume-work';
import { RecentCases } from './recent-cases';
import { TodayList } from './today-list';
import { dateLine, dayOf } from './today';
import type { LumeWork, OfficeCases } from './types';
import { useNow } from './use-minute';

const NO_NAMES: Record<string, string> = {};

/** Início: the person's day, the cases that moved and what the Lume did, as in the prototype's "Hoje". */
export function Inicio({ cases, lume }: { cases: OfficeCases | null; lume: LumeWork[] | null }) {
  const now = useNow();
  return (
    <CanvasPage>
      <CanvasMeta title="Início" subject={{ kind: 'office' }} />
      <CanvasHeader title="Hoje" eyebrow={<span className="block min-h-[1lh]">{now && dateLine(now)}</span>} />
      <TodayList caseNames={cases?.names ?? NO_NAMES} today={now && dayOf(now).today} />
      <RecentCases cases={cases?.recent ?? null} now={now} />
      <LumeWorkList work={lume} now={now} />
    </CanvasPage>
  );
}
