import { officePage } from '@/components/lume/canvas-leaf';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Reveal } from '@/components/reveal';
import { appNavigation } from '@/lib/navigation';
import { requireWorkspace } from '@/lib/session';

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ conversationId?: string; caseId?: string; doc?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: appNavigation.find(item => item.slug === section)?.label ?? 'Página não encontrada' };
}

async function SectionPage({ params, searchParams }: Props) {
  await requireWorkspace();
  const { section } = await params;
  const item = appNavigation.find(entry => entry.slug === section);
  if (!item) notFound();
  if (item.slug === 'agents') {
    const { conversationId, caseId, doc } = await searchParams;
    const destination = doc ? `/app/documents/${encodeURIComponent(doc)}` : caseId ? `/app/vault/cases/${encodeURIComponent(caseId)}` : '/app/command-center';
    const intent = new URLSearchParams({ lume: '1' });
    if (conversationId) intent.set('conversationId', conversationId);
    redirect(`${destination}?${intent}`);
  }
  return <Reveal className="w-full max-w-5xl px-5 py-6 md:px-10 md:py-10">
    <h1 className="page-title" data-reveal>{item.label}</h1>
    <p className="grid min-h-[50dvh] place-items-center text-subtle-foreground" data-reveal>Em breve</p>
  </Reveal>;
}

export default officePage('/app/[section]', SectionPage);
