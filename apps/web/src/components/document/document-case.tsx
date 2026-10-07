"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The case a page was opened from, for the trail at the top of the page. */
export type DocumentCaseLink = { id: string; name: string };

const DocumentCaseContext = createContext<DocumentCaseLink | null>(null);

export function DocumentCase({ value, children }: { value: DocumentCaseLink | null; children: ReactNode }) {
  return <DocumentCaseContext value={value}>{children}</DocumentCaseContext>;
}

export function useDocumentCase() {
  return useContext(DocumentCaseContext);
}
