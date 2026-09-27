/*
 * Tises geometry, shared by the logo components and the landing backdrop. Plain data, so server
 * components can read it. Keep src/app/icon.svg and public/tises.svg in sync with `tisesPaths`.
 */

/** The mark: the old Tises geometry as a T. Two pieces cut at 45° meet across a narrow diagonal
 *  slit (the left arm; the stem joined to the right arm), and a beam leaves the slit on that diagonal. */
export const tisesPaths = {
  arm: "M4 4H12L9 7H4Z",
  body: "M10.5 20V8.5L15 4H20V7H13.5V20Z",
  beam: "M4.25 11.75 7.5 8.5 9 10 5.75 13.25Z",
} as const;

/** The name, drawn with one 3-unit stroke (the thickness of the mark's pieces): straight runs and
 *  tight 2.5-unit turns. One path per stroke, in writing order; the t has two. */
export const wordmarkStrokes = [
  "M4 3v14a2.5 2.5 0 0 0 2.5 2.5H8.5",
  "M0 9.5h8.5",
  "M12.5 8v13",
  "M26 9.5h-5.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5h-7",
  "M31.5 14.5H40V12a2.5 2.5 0 0 0-2.5-2.5H34a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 2.5 2.5h6",
  "M53.5 9.5H48a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5h-7",
] as const;

/** The tittle of the i: a small beam on the mark's diagonal. */
export const wordmarkTittle = "M10.4 5.3 13.2 2.5 14.6 3.9 11.8 6.7Z";
