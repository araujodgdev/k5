import { Folder } from 'lucide-react';
import { CanvasCard, CanvasSection, CanvasSectionLink } from '@/components/canvas/canvas-page';
import { initials, updatedLabel } from './today';
import type { RecentCase } from './types';

const AVATARS = 3;

function People({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="flex shrink-0">
      <span className="sr-only">Pessoas: {names.join(', ')}</span>
      {names.slice(0, AVATARS).map((name, index) => (
        <span key={`${name}-${index}`} aria-hidden="true"
          className="-ml-1.5 inline-flex size-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-card first:ml-0">
          {initials(name)}
        </span>
      ))}
    </span>
  );
}

function CaseCard({ item, now }: { item: RecentCase; now: Date | null }) {
  return (
    <CanvasCard href={`/app/vault/cases/${encodeURIComponent(item.id)}`} className="h-[172px]">
      <span className="flex w-full items-center gap-2 px-3.5 pt-[13px] pb-2">
        <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{item.name}</span>
      </span>
      <span className="min-h-0 flex-1 overflow-hidden px-3.5 text-[12.5px] leading-[1.5] text-muted-foreground">{item.summary}</span>
      <span className="flex w-full items-center gap-2 px-3.5 pt-2.5 pb-3 text-xs text-muted-foreground">
        <span className="min-h-[1lh] flex-1 truncate">{now && updatedLabel(item.updatedAt, now)}</span>
        <People names={item.people} />
      </span>
    </CanvasCard>
  );
}

/** The three cases changed most recently, as cards. */
export function RecentCases({ cases, now }: { cases: RecentCase[] | null; now: Date | null }) {
  return (
    <CanvasSection title="Casos recentes" label="Casos recentes" action={<CanvasSectionLink href="/app/vault">Ver todos</CanvasSectionLink>}>
      {cases === null ? <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar os casos.</p>
        : cases.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
            {cases.map((item) => <CaseCard key={item.id} item={item} now={now} />)}
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhum caso ainda.</p>}
    </CanvasSection>
  );
}
