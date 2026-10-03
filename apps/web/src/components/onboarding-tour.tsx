'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { tutorialNavigation } from '@/lib/navigation';
import { tutorialSteps, tutorialStorageKey, type TutorialAccess } from '@/lib/onboarding';

const TutorialContext = createContext<() => void>(() => {});
type View = 'closed' | 'welcome' | 'tour';
type Placement = { card: CSSProperties; spotlight: CSSProperties | null };

export function TutorialTrigger({ onOpen, className = '' }: { onOpen?: () => void; className?: string }) {
  const open = useContext(TutorialContext);
  return <button type="button" aria-label="Tutorial do Lume" data-tutorial="trigger" onClick={() => { onOpen?.(); open(); }}
    className={`flex min-h-11 w-full items-center gap-3 px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}>
    <CircleHelp className="size-4 shrink-0" aria-hidden="true" /><span className="nav-label">Tutorial</span>
  </button>;
}

export function OnboardingTour({ children, userId, officeId, whatsappEnabled, adsEnabled, platformAdmin }: TutorialAccess & { children: ReactNode; userId: string; officeId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const steps = useMemo(() => tutorialSteps({ whatsappEnabled, adsEnabled, platformAdmin }), [whatsappEnabled, adsEnabled, platformAdmin]);
  const storageKey = tutorialStorageKey(userId, officeId);
  const [view, setView] = useState<View>('closed');
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>({ card: {}, spotlight: null });
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const manuallyOpened = useRef(false);
  const step = steps[index];
  const currentHref = `${pathname}${params.size ? `?${params}` : ''}`;
  const ready = view === 'tour' && step?.href === currentHref;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (manuallyOpened.current) return;
      try {
        const saved = localStorage.getItem(storageKey);
        setIndex(Math.max(0, steps.findIndex(item => item.id === saved)));
        setView(saved === null ? 'welcome' : 'closed');
      } catch { setView('closed'); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, steps]);

  function save(value: string) {
    try { localStorage.setItem(storageKey, value); } catch { /* Storage may be unavailable in a private browser. */ }
  }

  function close(completed = false) {
    save(completed ? 'completed' : step?.id ?? 'dismissed');
    if (completed) setIndex(0);
    setView('closed');
  }

  function go(next: number) {
    const nextStep = steps[next];
    if (!nextStep) return;
    setIndex(next);
    save(nextStep.id);
    setView('tour');
    if (currentHref !== nextStep.href) router.push(nextStep.href, { scroll: true });
  }

  useEffect(() => {
    if (view !== 'tour' || !step) return;
    let frame = 0;
    const measure = () => {
      const findVisible = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
        .find(element => { const box = element.getBoundingClientRect(); return box.width > 4 && box.height > 4 && box.bottom > 0 && box.top < innerHeight; });
      const visible = ready ? findVisible(step.target) ?? findVisible('header.md\\:hidden') : undefined;
      const rect = visible?.getBoundingClientRect();
      const width = Math.min(380, innerWidth - 24);
      const height = card.current?.offsetHeight ?? 300;
      const mobile = innerWidth < 768;
      const top = mobile ? Math.max(12, innerHeight - height - 84) : rect && rect.bottom + height + 24 < innerHeight
        ? rect.bottom + 16 : Math.max(12, Math.min((rect?.top ?? 100) - height - 16, innerHeight - height - 12));
      const beside = !mobile && rect && rect.height > 200 && rect.right + width + 24 < innerWidth;
      const left = mobile ? 12 : beside ? rect.right + 16 : Math.max(12, Math.min(rect?.left ?? (innerWidth - width) / 2, innerWidth - width - 12));
      setPlacement({ card: { top, left, width }, spotlight: rect ? { top: Math.max(0, rect.top - 5), left: Math.max(0, rect.left - 5), width: Math.min(rect.width + 10, innerWidth), height: Math.min(rect.height + 10, innerHeight) } : null });
    };
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    queue();
    const observer = new MutationObserver(queue);
    const main = document.getElementById('main-content');
    if (main) observer.observe(main, { childList: true, subtree: true });
    const sizeObserver = new ResizeObserver(queue);
    if (card.current) sizeObserver.observe(card.current);
    window.addEventListener('resize', queue);
    window.addEventListener('scroll', queue, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); sizeObserver.disconnect(); window.removeEventListener('resize', queue); window.removeEventListener('scroll', queue, true); };
  }, [view, ready, step]);

  function open() {
    manuallyOpened.current = true;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { setIndex(Math.max(0, steps.findIndex(item => item.id === localStorage.getItem(storageKey)))); } catch { setIndex(0); }
    setView('welcome');
  }

  return <TutorialContext value={open}>
    {children}
    <DialogPrimitive.Root open={view !== 'closed'} onOpenChange={open => { if (!open) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`fixed inset-0 z-50 ${view === 'tour' && ready && placement.spotlight ? '' : 'bg-overlay/40'}`} />
        {view === 'tour' && ready && placement.spotlight && <div aria-hidden="true" data-tutorial="spotlight" className="pointer-events-none fixed z-[51] border-2 border-brand shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] motion-safe:transition-[top,left,width,height] motion-safe:duration-300" style={placement.spotlight} />}
        <DialogPrimitive.Content ref={card} aria-describedby="tutorial-description" onInteractOutside={event => event.preventDefault()}
          onCloseAutoFocus={event => { event.preventDefault(); const target = opener.current?.isConnected && opener.current.getBoundingClientRect().width ? opener.current : document.getElementById('main-content'); target?.focus(); }}
          className={`fixed z-[52] grid max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto border border-line bg-popover p-5 text-popover-foreground shadow-[var(--shadow-float)] outline-none ${view === 'welcome' ? 'top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2' : 'motion-safe:transition-[top,left] motion-safe:duration-300'}`}
          style={view === 'tour' ? placement.card : undefined}>
          <p className="label-mono text-muted-foreground" aria-live="polite">{view === 'welcome' ? 'Primeiros passos' : `${index + 1} de ${steps.length}`}</p>
          <DialogPrimitive.Title className="text-xl font-medium tracking-tight">{view === 'welcome' ? 'Conheça o Lume' : step?.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description id="tutorial-description" className="text-sm leading-relaxed text-muted-foreground">
            {view === 'welcome' ? 'Um passeio pelas telas para você encontrar o que precisa. Avance no seu ritmo ou saia a qualquer momento. O tutorial não altera seus dados.' : step?.description}
          </DialogPrimitive.Description>
          {view === 'tour' && !ready && <p role="status" className="text-sm">Abrindo a tela… <button type="button" className="underline" onClick={() => go(index)}>Tentar novamente</button></p>}
          {view === 'welcome' ? <div className="grid gap-2">
            <Button className="min-h-11" onClick={() => go(index)}>{index > 0 ? 'Continuar tutorial' : 'Começar tutorial'}</Button>
            {index > 0 && <Button variant="outline" className="min-h-11" onClick={() => go(0)}>Recomeçar</Button>}
            <Button asChild variant="outline" className="min-h-11"><Link href={tutorialNavigation.href} onClick={() => close()}>Ver vídeos por módulo</Link></Button>
            <Button variant="ghost" className="min-h-11" onClick={() => close()}>Agora não</Button>
          </div> : <>
            <div role="progressbar" aria-label="Progresso do tutorial" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1} className="h-0.5 bg-muted"><div className="h-full bg-brand" style={{ width: `${(index + 1) / steps.length * 100}%` }} /></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" className="min-h-11 px-2" onClick={() => close()}>Sair do tutorial</Button>
              <Button variant="outline" className="min-h-11 px-3" disabled={index === 0} onClick={() => go(index - 1)}>Voltar</Button>
              <Button className="min-h-11 px-3" disabled={!ready} onClick={() => index === steps.length - 1 ? close(true) : go(index + 1)}>{index === steps.length - 1 ? 'Concluir' : 'Próximo'}</Button>
            </div>
          </>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  </TutorialContext>;
}
