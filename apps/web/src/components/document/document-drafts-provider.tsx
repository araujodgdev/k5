'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
    invalidate(id: string) {
      saves.delete(id);
      drafts.invalidate(id);
    },
    async saveOpen() {
      const results = await Promise.all([...saves.entries()].map(async ([id, save]) => {
        const draft = drafts.get(id);
        const saved = await save();
        return saved || draft.getSnapshot() === null;
      }));
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
