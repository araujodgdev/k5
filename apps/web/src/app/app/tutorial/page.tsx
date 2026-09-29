import { requireWorkspace } from '@/lib/session';
import { TutorialTrigger } from '@/components/onboarding-tour';

export const metadata = { title: 'Tutorial do Lume' };

export default async function TutorialPage() {
  await requireWorkspace();
  return <div className="px-5 py-6 md:px-10 md:py-10">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
      <h1 className="page-title">Tutorial do Lume</h1>
      <div><TutorialTrigger className="w-auto border border-input" /></div>
    </header>
    <p className="mb-5 max-w-2xl text-sm text-muted-foreground">Conheça os módulos e acompanhe os passos na tela, com cliques destacados e legendas em português. Pause o vídeo para experimentar no seu escritório.</p>
    <video controls preload="metadata" playsInline poster="/tutorial/capa.jpg" className="aspect-video w-full border border-line bg-foreground" aria-label="Tutorial completo do Lume em português">
      <source src="/tutorial/tutorial-lume.mp4" type="video/mp4" />
      <track kind="captions" src="/tutorial/tutorial-lume.pt-BR.vtt" srcLang="pt-BR" label="Português" />
      Seu navegador não conseguiu abrir o vídeo. <a href="/tutorial/tutorial-lume.mp4">Baixar o tutorial</a>.
    </video>
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
      <a href="/tutorial/tutorial-lume.mp4" download className="underline underline-offset-4">Baixar vídeo</a>
      <a href="/tutorial/tutorial-lume.pt-BR.vtt" download className="underline underline-offset-4">Baixar legendas</a>
    </div>
    <p className="mt-5 max-w-2xl text-sm text-muted-foreground">Os exemplos de cadastro são fictícios. As telas de integrações usam um ambiente conectado; a disponibilidade depende das permissões e configurações da sua conta.</p>
  </div>;
}
