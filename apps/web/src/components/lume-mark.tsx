import type { SVGProps } from "react";

/** Lume: a light beam meeting an open, geometric L. Keep public/lume.svg in sync. */
export function LumeMark(props: SVGProps<SVGSVGElement>) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" {...props}>
    <path d="M5 4h3v10.5l-3 3V4Z" />
    <path d="m6.5 19 3-3H20v3H6.5Z" />
    <path d="m11 11.5 6.5-6.5L19 6.5 12.5 13 11 11.5Z" />
  </svg>;
}
