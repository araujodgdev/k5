'use client';

import { useEffect, useRef, useState } from 'react';
import type { tutorialMedia } from '@k5/tutorial-library';

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
  return <>
    <video ref={player} src={source} controls preload="metadata" playsInline poster={`${media.poster}?v=${revision}`} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}
      className="aspect-video w-full border border-line bg-foreground" aria-label={`Tutorial: ${title}`}>
      <track kind="captions" src={`${media.captions}?v=${revision}`} srcLang="pt-BR" label="Português" />
      Seu navegador não conseguiu abrir o vídeo. <a href={source}>Baixar vídeo</a>.
    </video>
    {failed && <div role="alert" aria-label="Falha no vídeo" className="mt-4 text-sm">
      <p>Não foi possível carregar o vídeo. Tente novamente ou baixe o arquivo para assistir.</p>
      <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => { setFailed(false); player.current?.load(); }}>Tentar novamente</button>
    </div>}
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
      <a href={source} download className="inline-flex min-h-11 items-center underline underline-offset-4">Baixar vídeo</a>
      <a href={`${media.captions}?v=${revision}`} download className="inline-flex min-h-11 items-center underline underline-offset-4">Baixar legendas</a>
    </div>
  </>;
}
