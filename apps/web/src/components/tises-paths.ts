/*
 * Tises geometry, shared by the logo components and the landing backdrop. Plain data, so server
 * components can read it. Keep src/app/icon.svg and public/tises.svg in sync with `tisesPaths`.
 */

/** The mark, the Carimbo: a seal ring (outer radius 9.5, hole 4.2, centred on the 24-unit grid) cut
 *  in two across a 45° slit as wide as the old T's, and a diamond of light (`beam`) where the slit
 *  leaves the ring at the top right. Each half is its own path so they can part and close again. */
export const tisesPaths = {
  upper: "M17.93 4.57A9.5 9.5 0 0 0 4.57 17.93L8.38 14.12A4.2 4.2 0 0 1 14.12 8.38Z",
  lower: "M6.07 19.43A9.5 9.5 0 0 0 19.43 6.07L15.62 9.88A4.2 4.2 0 0 1 9.88 15.62Z",
  beam: "M18.2 3.6 20.4 1.4 22.6 3.6 20.4 5.8Z",
} as const;

/** The name, drawn with one 3-unit stroke: straight runs and tight 2.5-unit turns. One path per
 *  stroke, in writing order; the t has two. */
export const wordmarkStrokes = [
  "M4 3v14a2.5 2.5 0 0 0 2.5 2.5H8.5",
  "M0 9.5h8.5",
  "M12.5 8v13",
  "M26 9.5h-5.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5h-7",
  "M31.5 14.5H40V12a2.5 2.5 0 0 0-2.5-2.5H34a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 2.5 2.5h6",
  "M53.5 9.5H48a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5h-7",
] as const;

/** The tittle of the i: the mark's diamond. */
export const wordmarkTittle = "M10.6 4.6 12.5 2.7 14.4 4.6 12.5 6.5Z";
