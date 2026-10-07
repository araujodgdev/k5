import { CanvasSection } from '@/components/canvas/canvas-page';
import { LumeMark } from '@/components/lume-mark';
import { doneLabel } from './today';
import type { LumeWork } from './types';

/** What the Lume wrote for the person since yesterday. The phone board leaves it out. */
export function LumeWorkList({ work, now }: { work: LumeWork[] | null; now: Date | null }) {
  return (
    <CanvasSection title="O que o Lume fez hoje" label="O que o Lume fez" className="max-md:hidden">
      {work === null ? <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar o que o Lume fez.</p>
        : work.length ? (
          <ul className="flex flex-col gap-1.5">
            {work.map((item) => (
              <li key={item.id} className="flex min-h-9 items-center gap-3">
                <LumeMark className="size-4 shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 text-sm">{item.text}</span>
                <time dateTime={item.at} className="shrink-0 font-mono text-[12.5px] text-muted-foreground">{now && doneLabel(item.at, now)}</time>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nada ainda hoje.</p>}
    </CanvasSection>
  );
}
