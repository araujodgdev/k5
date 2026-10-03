import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';
import { database } from '@/lib/database';
import { isPlatformAdmin } from '@/lib/platform-core';
import { tutorialLibrary, tutorialDuration } from '@/lib/tutorial-library';
import { tutorialNavigation } from '@/lib/navigation';
import { TutorialPlayer } from '@/components/tutorial-player';

export const metadata = { title: 'Vídeo tutorial do Lume' };

export default async function TutorialVideoPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { user } = await requireWorkspace();
  const { videoId } = await params;
  const modules = tutorialLibrary({ platformAdmin: await isPlatformAdmin(database, user.id) });
  const tutorialModule = modules.find(item => item.videos.some(video => video.id === videoId));
  const video = tutorialModule?.videos.find(item => item.id === videoId);
  if (!tutorialModule || !video) notFound();
  return <div className="px-5 py-6 md:px-10 md:py-10">
    <Link href={`${tutorialNavigation.href}?modulo=${tutorialModule.id}`} className="mb-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Voltar aos tutoriais de {tutorialModule.title}</Link>
    <header className="mb-5 border-b border-line pb-5">
      <h1 className="page-title">{video.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{tutorialModule.title} · {tutorialDuration(video.durationSeconds)}</p>
    </header>
    <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{video.description}</p>
    {video.notice && <p className="mb-5 max-w-2xl text-sm">{video.notice}</p>}
    <TutorialPlayer key={`${video.id}:${video.revision}`} title={video.title} media={video.media} revision={video.revision} />
    <p className="mt-5 max-w-2xl text-sm text-muted-foreground">Os exemplos usam dados fictícios. As telas e a disponibilidade dos recursos podem variar conforme sua conta e a versão do Lume.</p>
    <section className="mt-8 border-t border-line pt-5" aria-label={`Outros tutoriais de ${tutorialModule.title}`}>
      {tutorialModule.videos.filter(item => item.id !== video.id).map(item => <Link key={item.id} href={`${tutorialNavigation.href}/${item.id}`} className="block py-3 text-sm underline underline-offset-4">{item.title}</Link>)}
      <Link href={tutorialNavigation.href} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Ver todos os módulos</Link>
    </section>
  </div>;
}
