const path =
  "M0 0h96v366H0zM386 0 116 247q-14 8-14-12v-58q0-18 12-30L274 0zM144 226l31-24q24-15 46-12 9 2 17 10l162 166H279zM340 184V76l78-76h198v64H386v56h134c58 0 98 48 98 118 0 74-52 128-124 128h-68l-48-48h102c30 0 52-28 52-66s-24-68-56-68z";

/** K5 mark. Inherits `color`; size via `height` (width follows the 618:366 ratio). */
export function Logo({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <svg viewBox="0 0 618 366" height={height} width={(height * 618) / 366} className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}
