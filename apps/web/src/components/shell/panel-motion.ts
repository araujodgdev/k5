'use client';

import gsap from 'gsap';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { PanelMode } from '@/lib/lume-workspace';

/** The panel's computer width and its gap to the window's edge, as in `office-shell.tsx`. */
const panelWidth = (row: number) => Math.min(500, Math.max(360, row / 3));
const GAP = 10;
const DURATION = 0.5;

export type PanelMotionRefs = {
  row: RefObject<HTMLDivElement | null>;
  slot: RefObject<HTMLDivElement | null>;
  panel: RefObject<HTMLElement | null>;
  bar: RefObject<HTMLDivElement | null>;
  toggle: RefObject<HTMLButtonElement | null>;
};

/**
 * Collapsing folds the floating panel into the Lume's button on the bar while the canvas widens into
 * its place; opening unfolds it from the button. CSS already holds the state being entered, so the
 * tween runs from the state being left and then hands back to CSS. Only the computer's floating and
 * collapsed modes move. A phone, the focused mode and reduced motion switch at once.
 */
export function usePanelMotion(mode: PanelMode, mobile: boolean, refs: PanelMotionRefs) {
  const previous = useRef(mode);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = mode;
    const pair = new Set([from, mode]);
    if (from === mode || mobile || !pair.has('floating') || !pair.has('collapsed')) return;
    const row = refs.row.current, slot = refs.slot.current, panel = refs.panel.current, bar = refs.bar.current, toggle = refs.toggle.current;
    if (!row || !slot || !panel || !bar || !toggle || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const opening = mode === 'floating';
    const width = panelWidth(row.clientWidth);
    // The bar's side as wide as the panel, and as narrow as its buttons.
    bar.style.setProperty('width', 'auto');
    const narrow = bar.offsetWidth;
    bar.style.removeProperty('width');
    const rowBox = row.getBoundingClientRect();
    const target = toggle.getBoundingClientRect();
    const origin = `${target.left + target.width / 2 - rowBox.left - GAP}px ${target.top + target.height / 2 - rowBox.top}px`;
    const open = { slot: { width, marginLeft: GAP }, panel: { scale: 1, autoAlpha: 1, borderRadius: 16 }, bar: { width } };
    const folded = { slot: { width: 0, marginLeft: 0 }, panel: { scale: 0.04, autoAlpha: 0, borderRadius: 48 }, bar: { width: narrow } };
    const [start, end] = opening ? [folded, open] : [open, folded];

    const context = gsap.context(() => {
      const tween = { duration: DURATION, ease: 'expo.out', overwrite: true };
      gsap.fromTo(slot, start.slot, { ...end.slot, ...tween, clearProps: 'width,marginLeft' });
      gsap.fromTo(bar, start.bar, { ...end.bar, ...tween, clearProps: 'width' });
      // The panel keeps its width while it folds, so its content scales instead of reflowing.
      gsap.fromTo(panel, { ...start.panel, width, transformOrigin: origin },
        { ...end.panel, ...tween, ease: opening ? 'expo.out' : 'power3.inOut', duration: opening ? DURATION : DURATION * 0.8, clearProps: 'all' });
    });
    return () => context.revert();
  }, [mode, mobile, refs]);
}
