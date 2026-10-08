'use client';

import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react';
import type { DocumentAsk } from '@/components/document/document-workspace';
import { canonicalCanvasHref, type CanvasResource, type LumeWorkspaceController, type ResourceAccess } from '@/lib/lume-workspace';
import { useCanvasActive } from './canvas-host';

export type WorkspaceActions = {
  controller: LumeWorkspaceController;
  navigate: (href: string) => Promise<boolean>;
  openResource: (href: string, navigation?: number) => Promise<void>;
  invalidateResource: (access: ResourceAccess) => void;
  ask: (request: DocumentAsk) => Promise<void>;
  registerSender: (send: (text: string) => void) => () => void;
  conversationIntent: { id: string; serial: number } | null;
};
export const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useLumeWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('LumeWorkspace is missing.');
  return value;
}

export function useLumeState() {
  const { controller } = useLumeWorkspace();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** Rendered only by loaders that have authorized the resource for the current person. */
export function CanvasResource({ resource }: { resource: CanvasResource }) {
  const active = useCanvasActive();
  const { controller } = useLumeWorkspace();
  const { href } = useLumeState();
  useLayoutEffect(() => {
    const current = canonicalCanvasHref(window.location.pathname + window.location.search);
    // The previous route's children can briefly return while the next route commits.
    if (!active || current !== resource.href || href !== resource.href) return;
    controller.dispatch({ type: 'authorized', resource });
    return () => controller.dispatch({ type: 'unavailable', href: resource.href });
  }, [active, controller, href, resource]);
  return null;
}
