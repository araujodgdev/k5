import { officePage } from '@/components/lume/canvas-leaf';
import { notFound } from 'next/navigation';
import { CircleHelp, Play } from 'lucide-react';
import { requireWorkspace } from '@/lib/session';
import { database } from '@/lib/database';
import { isPlatformAdmin } from '@/lib/platform-core';
import { CanvasTrail } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasRow, CanvasSection, CanvasSectionLink } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { tutorialLibrary, tutorialDuration } from '@/lib/tutorial-library';
import { tutorialNavigation } from '@/lib/navigation';
import { TutorialPlayer } from '@/components/tutorial-player';

export const metadata = { title: 'Vídeo tutorial do Lume' };

async function TutorialVideoPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { user } = await requireWorkspace();
  const { videoId } = await params;
  const modules = tutorialLibrary({ platformAdmin: await isPlatformAdmin(database, user.id) });
  const tutorialModule = modules.find(item => item.videos.some(video => video.id === videoId));
  const video = tutorialModule?.videos.find(item => item.id === videoId);
  if (!tutorialModule || !video) notFound();
  const others = tutorialModule.videos.filter(item => item.id !== video.id);
  return <>
    <CanvasMeta title="Tutorial" subject={{ kind: 'module', slug: 'tutorial', title: 'Tutorial' }} />
    <CanvasTrail back={{ href: `${tutorialNavigation.href}?modulo=${tutorialModule.id}`, label: `Tutoriais de ${tutorialModule.title}` }} icon={<CircleHelp />} current={video.title} />
    <CanvasPage className="md:gap-8">
      <div className="flex flex-col gap-3">
        <CanvasHeader eyebrow={`${tutorialModule.title} · ${tutorialDuration(video.durationSeconds)}`} title={video.title} />
        <p className="max-w-2xl text-[14.5px] leading-[1.6] text-muted-foreground">{video.description}</p>
        {video.notice && <p className="max-w-2xl text-[13.5px]">{video.notice}</p>}
      </div>
      <div className="flex flex-col gap-3">
        <TutorialPlayer key={`${video.id}:${video.revision}`} title={video.title} media={video.media} revision={video.revision} />
        <p className="text-xs text-muted-foreground">Os exemplos usam dados fictícios. As telas e a disponibilidade dos recursos podem variar conforme sua conta e a versão do Lume.</p>
      </div>
      <CanvasSection title={`Outros tutoriais de ${tutorialModule.title}`} label={`Outros tutoriais de ${tutorialModule.title}`}
        action={<CanvasSectionLink href={tutorialNavigation.href}>Ver todos os módulos</CanvasSectionLink>}>
        {others.length ? <div className="flex flex-col gap-0.5">
          {others.map(item => <CanvasRow key={item.id} stacked icon={<Play />} href={`${tutorialNavigation.href}/${item.id}`} label={`Assistir: ${item.title}`}
            title={item.title} detail={item.description} meta={tutorialDuration(item.durationSeconds)} />)}
        </div> : <p className="text-[13.5px] text-muted-foreground">Este é o único vídeo deste módulo.</p>}
      </CanvasSection>
    </CanvasPage>
  </>;
}

export default officePage('/app/tutorial/[videoId]', TutorialVideoPage);
