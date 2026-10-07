"use client";

import { createContext } from "react";
import type { ApprovalDecision } from "@/lib/chat-approval-state";
import type { CanvasCommand } from "@/lib/canvas-protocol";

/**
 * Where documents open: beside the conversation on the Lume page, in the canvas inside the office
 * shell. `follow` moves the canvas after the Lume or a confirmation changed something.
 */
export type DocumentLinks = { open: (id: string, title?: string) => void; follow: (command: CanvasCommand) => void };
export const DocumentLinksContext = createContext<DocumentLinks | null>(null);

export const ConversationIdContext = createContext("");

export type ApprovalDecisions = {
  decisions: ReadonlyMap<string, ApprovalDecision>;
  record: (id: string, decision: ApprovalDecision) => void;
};
export const ApprovalDecisionsContext = createContext<ApprovalDecisions | null>(null);

/** What the Lume is doing in the running turn ("Consultando o Cofre…"), sent by the server as it goes. */
export const WorkingContext = createContext("");

/** The panel is narrow and floats; the page centers a wider column, like the prototype's Foco. */
export type ThreadLayout = "panel" | "page";

const DOCUMENT_PREFIX = "/app/documents/";
export const documentIdFrom = (href?: string) => href?.startsWith(DOCUMENT_PREFIX) ? decodeURIComponent(href.slice(DOCUMENT_PREFIX.length)) : null;
export const documentHref = (id: string) => `${DOCUMENT_PREFIX}${encodeURIComponent(id)}`;
