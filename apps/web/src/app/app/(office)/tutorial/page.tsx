import Image from 'next/image';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { requireWorkspace } from '@/lib/session';
import { database } from '@/lib/database';
import { isPlatformAdmin } from '@/lib/platform-core';
import { TutorialTrigger } from '@/components/onboarding-tour';
import { tutorialLibrary, tutorialDuration } from '@/lib/tutorial-library';
import { tutorialNavigation } from '@/lib/navigation';

export const metadata = { title: 'Tutoriais do Lume' };

export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ modulo?: string }> }) {
  const { user } = await requireWorkspace();
  const modules = tutorialLibrary({ platformAdmin: await isPlatformAdmin(database, user.id) });
  const { modulo } = await searchParams;
  const selected = modulo ? modules.filter(module => module.id === modulo) : modules;
  return <div className="px-5 py-6 md:px-10 md:py-10">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
      <h1 className="page-title">Tutoriais do Lume</h1>
      <div className="shrink-0"><TutorialTrigger className="w-auto border border-input" /></div>
    </header>
    <p className="mb-5 max-w-2xl text-sm text-muted-foreground">Escolha um módulo e assista ao passo que você precisa. Cada vídeo tem legendas em português.</p>
    <nav aria-label="Módulos dos tutoriais" className="mb-6 flex flex-wrap gap-x-5 gap-y-1">
      {[{ id: '', title: 'Todos os módulos' }, ...modules].map(module => <Link key={module.id}
        href={module.id ? `${tutorialNavigation.href}?modulo=${module.id}` : tutorialNavigation.href}
        aria-current={(modulo ?? '') === module.id ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center border-b-2 text-sm hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand ${(modulo ?? '') === module.id ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground'}`}>
        {module.title}
      </Link>)}
    </nav>
    {selected.length === 0 && <div className="border-t border-line py-6">
      <p className="text-sm">Nenhum tutorial disponível neste módulo.</p>
      {modulo && <Link href={tutorialNavigation.href} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Ver todos os módulos</Link>}
    </div>}
    {selected.map(module => <section key={module.id} aria-labelledby={`module-${module.id}`} className="border-t border-line pb-6">
      <h2 id={`module-${module.id}`} className="py-4 text-lg font-medium tracking-tight">{module.title}</h2>
      <div className="divide-y divide-border">
        {module.videos.map(video => <Link key={video.id} href={`${tutorialNavigation.href}/${video.id}`} aria-label={`Assistir: ${video.title}`}
          className="group flex min-w-0 items-center gap-3 py-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-brand md:gap-5">
          <Image src={`${video.media.poster}?v=${video.revision}`} alt="" width={160} height={90} unoptimized className="aspect-video w-24 shrink-0 border border-border object-cover md:w-40" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium md:text-base">{video.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{video.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">{tutorialDuration(video.durationSeconds)}</p>
          </div>
          <Play className="mr-1 size-4 shrink-0 text-muted-foreground group-hover:text-brand-ink" aria-hidden="true" />
        </Link>)}
      </div>
    </section>)}
  </div>;
}
