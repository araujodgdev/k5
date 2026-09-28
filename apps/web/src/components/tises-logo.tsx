"use client";

import { useId, type SVGProps } from "react";
import { tisesPaths, wordmarkStrokes, wordmarkTittle } from "@/components/tises-paths";
import { cn } from "@/lib/utils";

/*
 * Tises identity (geometry in tises-paths.ts). Two finishes:
 * - `flat`: the two halves in currentColor and the diamond in `brand`, for small places (header,
 *   shell, icons).
 * - `metal`: brushed metal halves (silver on dark, graphite on light, `--metal-*` in globals.css),
 *   a peach metal diamond with a glow layer behind it, and a band of light that can cross the metal
 *   parallel to the slit (`.tises-sheen`). For the large marks on the public pages.
 *
 * The motion is CSS in globals.css, so it runs from the first paint and stops under reduced motion:
 * `.tises-intro` assembles the mark, `.tises-write` draws the name and `.tises-hover` answers a hover.
 * Classes on the pieces are the hooks.
 */

type Finish = "flat" | "metal";

/** Brushed metal across `span` (the whole mark by default), and peach metal along the beam's axis. */
function MetalDefs({ id, span = [4, 4, 20, 20] }: { id: string; span?: [number, number, number, number] }) {
  const stops = (name: string, offsets: number[]) => offsets.map((offset, index) => (
    <stop key={index} offset={offset} style={{ stopColor: `var(--${name}-${index})` }} />
  ));
  return (
    <>
      <linearGradient id={`${id}-metal`} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={span[0]} y1={span[1]} x2={span[2]} y2={span[3]}>{stops("metal", [0, .3, .47, .53, .78, 1])}</linearGradient>
      <linearGradient id={`${id}-peach`} gradientUnits="objectBoundingBox" x1="0" y1="1" x2="1" y2="0">{stops("peach", [0, .38, .55, .8, 1])}</linearGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".5" stopColor="#fff" stopOpacity=".85" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-glow`} x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.4" /></filter>
    </>
  );
}

/** The mark: a seal ring cut in two halves across the slit, and a diamond of light. */
export function TisesMark({ finish = "flat", className, ...props }: SVGProps<SVGSVGElement> & { finish?: Finish }) {
  const id = useId().replace(/:/g, "");
  const metal = finish === "metal";
  const piece = metal ? `url(#${id}-metal)` : "currentColor";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" className={cn("tises-mark overflow-visible", className)} {...props}>
      {metal && <defs><MetalDefs id={id} span={[2.5, 2.5, 21.5, 21.5]} /><clipPath id={`${id}-clip`}><path d={tisesPaths.upper} /><path d={tisesPaths.lower} /></clipPath></defs>}
      {metal && <path className="tises-beam tises-glow" fill="var(--brand)" filter={`url(#${id}-glow)`} d={tisesPaths.beam} />}
      <path className="tises-upper" fill={piece} d={tisesPaths.upper} />
      <path className="tises-lower" fill={piece} d={tisesPaths.lower} />
      {metal && (
        <g clipPath={`url(#${id}-clip)`}>
          <g transform="rotate(45 12 12)"><rect className="tises-sheen" x="-2.5" y="-18" width="5" height="60" fill={`url(#${id}-sheen)`} /></g>
        </g>
      )}
      <path className={cn("tises-beam", !metal && "fill-brand")} fill={metal ? `url(#${id}-peach)` : undefined} d={tisesPaths.beam} />
    </svg>
  );
}

/** The name, drawn on the mark's grid, with a small beam as the tittle of the i. */
export function TisesWordmark({ finish = "flat", className, ...props }: SVGProps<SVGSVGElement> & { finish?: Finish }) {
  const id = useId().replace(/:/g, "");
  const metal = finish === "metal";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 1.5 57 21" width="57" height="21" className={cn("tises-wordmark overflow-visible", className)} {...props}>
      {metal && <defs><MetalDefs id={id} span={[0, 3, 24, 21]} /></defs>}
      <g fill="none" stroke={metal ? `url(#${id}-metal)` : "currentColor"} strokeWidth="3" strokeLinecap="butt" strokeLinejoin="miter">
        {wordmarkStrokes.map((d, index) => (
          <path key={index} className="tises-stroke" style={{ "--i": index } as React.CSSProperties} pathLength={1} d={d} />
        ))}
      </g>
      {metal && <path className="tises-tittle tises-glow" fill="var(--brand)" filter={`url(#${id}-glow)`} d={wordmarkTittle} />}
      <path className={cn("tises-tittle", !metal && "fill-brand")} fill={metal ? `url(#${id}-peach)` : undefined} d={wordmarkTittle} />
    </svg>
  );
}

/** The mark and the drawn name, for headers and the footer. `size` is the mark's height. */
export function TisesLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} style={{ gap: size * .3 }}>
      <TisesMark width={size} height={size} aria-hidden="true" focusable="false" />
      <TisesWordmark height={size * .8} width={size * .8 * 57 / 21} aria-hidden="true" focusable="false" />
    </span>
  );
}
