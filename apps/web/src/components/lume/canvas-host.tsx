'use client';

import { Activity, createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { CanvasResource } from '@/lib/lume-workspace';

export type CanvasLeaf = { href: string; nonce: string | null; resource: CanvasResource; children: ReactNode };
export const CanvasRegistry = createContext<((leaf: CanvasLeaf) => void) | null>(null);
export const CanvasFailure = createContext<(() => void) | null>(null);
const CanvasLocation = createContext<{ href: string; active: boolean; revision: string | null } | null>(null);

export function useCanvasLocation() { return useContext(CanvasLocation); }
export function useCanvasRevision() { return useCanvasLocation()?.revision ?? null; }
export function useCanvasActive() { return useCanvasLocation()?.active ?? true; }
export function useCanvasLoadError() {
  const failed = useContext(CanvasFailure);
  useLayoutEffect(() => { failed?.(); }, [failed]);
}

export function canvasViewKey(href: string) {
  const url = new URL(href, 'https://lume.invalid');
  const structural = new URLSearchParams();
  for (const key of ['view', 'folder', 'mode']) { const value = url.searchParams.get(key); if (value) structural.set(key, value); }
  return url.pathname + (structural.size ? `?${structural}` : '');
}

export function PublishCanvasLeaf({ href, nonce, resource, children }: CanvasLeaf) {
  const publish = useContext(CanvasRegistry);
  // vinext commits the browser URL in a parent layout effect before this publication.
  useEffect(() => { publish?.({ href, nonce, resource, children }); }, [publish, href, nonce, resource, children]);
  return null;
}

export function CanvasHost({ leaves, active }: { leaves: readonly CanvasLeaf[]; active: string | null }) {
  return leaves.map(leaf => <CanvasSlot key={canvasViewKey(leaf.href)} leaf={leaf} active={canvasViewKey(leaf.href) === active} />);
}

function CanvasSlot({ leaf, active }: { leaf: CanvasLeaf; active: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  useLayoutEffect(() => {
    if (!active) return;
    const main = document.getElementById('main-content');
    const node = element.current;
    const savedScroll = scroll.current;
    const rememberScroll = () => { if (main) scroll.current = main.scrollTop; };
    const frame = requestAnimationFrame(() => {
      if (main) main.scrollTop = savedScroll;
      main?.addEventListener('scroll', rememberScroll, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      main?.removeEventListener('scroll', rememberScroll);
      node?.querySelectorAll('video,audio').forEach(media => (media as HTMLMediaElement).pause());
    };
  }, [active]);
  const content = <div ref={element} data-canvas-view={canvasViewKey(leaf.href)} data-canvas-active={active} inert={!active}
    hidden={!active} className="flex min-h-0 flex-1 flex-col" style={!active ? {display:'none'} : undefined}>{leaf.children}</div>;
  return <CanvasLocation value={{ href: leaf.href, active, revision: leaf.nonce }}>
    {/* Tiptap destroys its editor on Activity cleanup. Document effects use the active gate instead. */}
    {leaf.resource.kind === 'document' ? content : <Activity mode={active ? 'visible' : 'hidden'}>{content}</Activity>}
  </CanvasLocation>;
}
