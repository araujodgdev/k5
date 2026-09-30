'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { DocumentDrafts } from '@/lib/document-drafts';

function createDraftContext() {
  const drafts = new DocumentDrafts();
  const saves = new Map<string, () => Promise<boolean>>();
  return {
    drafts,
    register(id: string, save: () => Promise<boolean>) {
      saves.set(id, save);
      return () => { if (saves.get(id) === save) saves.delete(id); };
    },
    hasOpenDraft() { return saves.size > 0; },
    async saveOpen() {
      const results = await Promise.all([...saves.values()].map(save => save()));
      return results.every(Boolean);
    },
  };
}

const DraftContext = createContext<ReturnType<typeof createDraftContext> | null>(null);

export function DocumentDraftsProvider({ children }: { children: ReactNode }) {
  const [context] = useState(createDraftContext);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!context.drafts.hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [context]);
  return <DraftContext value={context}>{children}</DraftContext>;
}

export function useDocumentDrafts() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('DocumentDraftsProvider is missing.');
  return context;
}

export function useDocumentDraft(id: string) {
  const { drafts } = useDocumentDrafts();
  return useMemo(() => drafts.get(id), [drafts, id]);
}

export function useSaveDocumentsBeforeExit() {
  const { drafts, saveOpen } = useDocumentDrafts();
  return useCallback(async () => await saveOpen() && !drafts.hasUnsaved(), [drafts, saveOpen]);
}

export function DocumentNavigationLink({ href, replace, scroll, ...props }: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { href: string }) {
  const router = useRouter();
  const { hasOpenDraft, saveOpen } = useDocumentDrafts();
  return <Link {...props} href={href} replace={replace} scroll={scroll} onNavigate={event => {
    if (!hasOpenDraft()) return;
    event.preventDefault();
    void saveOpen().then(saved => {
      if (saved) {
        if (replace) router.replace(href, { scroll });
        else router.push(href, { scroll });
      }
    });
  }} />;
}
