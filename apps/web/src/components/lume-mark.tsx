import type { SVGProps } from "react";

/**
 * Lume: a cube cut by an S-shaped beam of light, two dark halves with the beam between them.
 * Every drawing of the symbol reads this geometry; public/lume.svg, public/offline.html and
 * src/app/icon.svg keep static copies of the halves.
 */
export const LUME_MARK = {
  viewBox: "0 0 100 100",
  halves: [
    "M55.37 3.05L3 42.91L34.43 81.75C34.85 79.68 34.04 74.28 33.95 71.75C33.68 64.53 33.83 57.38 36.18 50.5C41.44 35.07 64.8 28.37 58.89 11.05C57.95 8.29 56.86 5.55 55.37 3.05Z",
    "M63.56 18.86C63.79 21.39 64.29 23.97 64.59 26.52C65.65 35.55 65.88 45.48 61.92 53.84C58 62.1 50.2 66.77 44.14 73.21C41 76.55 37.89 81.04 38.89 85.86C39.31 87.89 41.4 89.9 42.62 91.52L46.72 96.95L97 59.46L63.56 18.86Z",
  ],
  beam: "M55.37 3.05C56.86 5.55 57.95 8.29 58.89 11.05C64.8 28.37 41.44 35.07 36.18 50.5C33.83 57.38 33.68 64.53 33.95 71.75C34.04 74.28 34.85 79.68 34.43 81.75L42.62 91.52C41.4 89.9 39.31 87.89 38.89 85.86C37.89 81.04 41 76.55 44.14 73.21C50.2 66.77 58 62.1 61.92 53.84C65.88 45.48 65.65 35.55 64.59 26.52C64.29 23.97 63.79 21.39 63.56 18.86L55.37 3.05Z",
} as const;

/** The still mark: the two halves in the current color. Decorative unless it gets a label. */
export function LumeMark(props: SVGProps<SVGSVGElement>) {
  const labelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={LUME_MARK.viewBox} width="24" height="24" fill="currentColor"
    role={labelled ? "img" : undefined} aria-hidden={labelled ? undefined : true} {...props}>
    {LUME_MARK.halves.map((d) => <path key={d} d={d} />)}
  </svg>;
}
