"use client";

import { useSyncExternalStore } from "react";
import { DocumentWorkspace, type DocumentAsk } from "@/components/document/document-workspace";

/**
 * Inside the office shell a document opens in the canvas, away from the conversation. This bridge
 * lets the document reach the Lume panel: a selection's "Pedir ao Lume" goes into the panel's
 * conversation, and a change the Lume makes reloads the open document.
 */
type Ask = (request: DocumentAsk) => Promise<void>;
let ask: Ask | null = null;
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The panel registers how to send a document question while it is mounted. */
export function registerDocumentAsk(handler: Ask) {
  ask = handler;
  notify();
  return () => { if (ask === handler) { ask = null; notify(); } };
}

/** The Lume changed this document; an open copy reloads. */
export function documentChanged(id: string) {
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  notify();
}

/** The document page inside the shell, connected to the Lume panel when there is one. */
export function LumeDocument({ artifactId }: { artifactId: string }) {
  const onAsk = useSyncExternalStore(subscribe, () => ask, () => null);
  const revision = useSyncExternalStore(subscribe, () => revisions.get(artifactId) ?? 0, () => 0);
  return <DocumentWorkspace artifactId={artifactId} variant="page" onAsk={onAsk ?? undefined} revision={revision} />;
}
