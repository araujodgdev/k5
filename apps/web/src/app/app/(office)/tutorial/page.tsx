import Link from 'next/link';
import { Play } from 'lucide-react';
import { requireWorkspace } from '@/lib/session';
import { database } from '@/lib/database';
import { isPlatformAdmin } from '@/lib/platform-core';
import { CanvasHeader, CanvasPage, CanvasRow, CanvasSection, CanvasSectionLink } from '@/components/canvas/canvas-page';
import { TutorialTrigger } from '@/components/onboarding-tour';
import { sectionTab, sectionTabRow } from '@/components/section-tabs';
import { tutorialLibrary, tutorialDuration } from '@/lib/tutorial-library';
import { tutorialNavigation } from '@/lib/navigation';

export const metadata = { title: 'Tutoriais do Lume' };

/** The video library: one tab per module, each video a row that opens its page. */
export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ modulo?: string }> }) {
  const { user } = await requireWorkspace();
  const modules = tutorialLibrary({ platformAdmin: await isPlatformAdmin(database, user.id) });
  const { modulo } = await searchParams;
  const selected = modulo ? modules.filter(module => module.id === modulo) : modules;
  return <CanvasPage className="md:gap-8">
    <div className="flex flex-col gap-4 md:gap-5">
      <CanvasHeader eyebrow="Vídeos curtos, com legendas em português" title="Tutoriais do Lume"
        actions={<TutorialTrigger className="h-11 w-auto rounded-sm border border-input text-foreground md:h-[34px] md:min-h-0" />} />
      <nav aria-label="Módulos dos tutoriais" className={sectionTabRow}>
        {[{ id: '', title: 'Todos os módulos' }, ...modules].map(module => <Link key={module.id}
          href={module.id ? `${tutorialNavigation.href}?modulo=${module.id}` : tutorialNavigation.href}
          aria-current={(modulo ?? '') === module.id ? 'page' : undefined} className={sectionTab((modulo ?? '') === module.id)}>
          {module.title}
        </Link>)}
      </nav>
    </div>
    {selected.length === 0 && <div className="flex flex-col items-start gap-2">
      <p className="text-[13.5px] text-muted-foreground">Nenhum tutorial disponível neste módulo.</p>
      {modulo && <CanvasSectionLink href={tutorialNavigation.href}>Ver todos os módulos</CanvasSectionLink>}
    </div>}
    {selected.map(module => <CanvasSection key={module.id} title={module.title} label={module.title}>
      <div className="flex flex-col gap-0.5">
        {module.videos.map(video => <CanvasRow key={video.id} stacked icon={<Play />} href={`${tutorialNavigation.href}/${video.id}`} label={`Assistir: ${video.title}`}
          title={video.title} detail={video.description} meta={tutorialDuration(video.durationSeconds)} />)}
      </div>
    </CanvasSection>)}
  </CanvasPage>;
}
