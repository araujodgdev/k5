'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { tutorialMedia } from '@k5/tutorial-library';
import { trailAction } from '@/components/canvas/canvas-controls';
import { Button } from '@/components/ui/button';

export function TutorialPlayer({ title, media, revision }: { title: string; media: ReturnType<typeof tutorialMedia>; revision: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const source = `${media.video}?v=${revision}`;
  useEffect(() => {
    const element = player.current;
    let mounted = true;
    queueMicrotask(() => {
      if (mounted && element && (element.error || element.networkState === element.NETWORK_NO_SOURCE)) setFailed(true);
    });
    return () => { mounted = false; element?.pause(); };
  }, []);
  return <div className="flex flex-col gap-2">
    <video ref={player} src={source} controls preload="metadata" playsInline poster={`${media.poster}?v=${revision}`} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}
      className="aspect-video w-full rounded-lg border border-border bg-foreground" aria-label={`Tutorial: ${title}`}>
      <track kind="captions" src={`${media.captions}?v=${revision}`} srcLang="pt-BR" label="Português" />
      Seu navegador não conseguiu abrir o vídeo. <a href={source}>Baixar vídeo</a>.
    </video>
    {failed && <div role="alert" aria-label="Falha no vídeo" className="flex flex-wrap items-center gap-2">
      <p className="text-[13.5px]">Não foi possível carregar o vídeo. Tente novamente ou baixe o arquivo para assistir.</p>
      <Button type="button" variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={() => { setFailed(false); player.current?.load(); }}>Tentar novamente</Button>
    </div>}
    <div className="-ml-2.5 flex flex-wrap gap-1">
      <Button asChild variant="ghost" className={trailAction}><a href={source} download><Download aria-hidden="true" />Baixar vídeo</a></Button>
      <Button asChild variant="ghost" className={trailAction}><a href={`${media.captions}?v=${revision}`} download><Download aria-hidden="true" />Baixar legendas</a></Button>
    </div>
  </div>;
}
