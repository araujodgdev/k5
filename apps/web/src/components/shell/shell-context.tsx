"use client";

import { createContext, useContext, useEffect } from "react";
import type { CanvasSubject } from "@/lib/canvas-protocol";

export type { CanvasSubject };

/**
 * What the Lume is doing. The collapsed mark, the canvas tabs and a case's strip show it. `place` is
 * the tab of what the Lume touched last in the running turn.
 */
export type LumeActivity = { state: "idle" | "working" | "attention"; caseId?: string; place?: string };

/** Who asked the canvas to move: the person, or the Lume while it works. */
export type OpenedBy = "person" | "lume";

export type PanelState = "open" | "collapsed";

export type Shell = {
  subject: CanvasSubject;
  /** The open tabs, as the Lume reads them with each message. */
  places: readonly { href: string; title: string }[];
  /**
   * Opens a route in the canvas: activates its tab, or adds one, and navigates there. On a phone a
   * place the person opens takes the screen; one the Lume opens waits behind the conversation.
   */
  open(href: string, title?: string, by?: OpenedBy): void;
  /** A view names its tab and says what it shows. */
  describe(href: string, title: string, subject: CanvasSubject): void;
  panel: PanelState;
  setPanel(state: PanelState): void;
  activity: LumeActivity;
  setActivity(activity: LumeActivity): void;
};

export const ShellContext = createContext<Shell | null>(null);

/** Null outside the office shell (sign-in, landing, client portal). */
export function useShell(): Shell | null {
  return useContext(ShellContext);
}

/** Rendered by a view, server pages included, to title its canvas tab and set the canvas subject. */
export function CanvasMeta({ title, subject }: { title: string; subject: CanvasSubject }) {
  const shell = useShell();
  const describe = shell?.describe;
  const key = JSON.stringify(subject);
  useEffect(() => {
    describe?.(window.location.pathname, title, JSON.parse(key) as CanvasSubject);
  }, [describe, title, key]);
  return null;
}
