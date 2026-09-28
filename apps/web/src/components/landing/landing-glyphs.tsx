/* Line drawings for the landing's modules: one hairline figure each, in currentColor.
   They turn slowly while their row is hovered (the row carries `group`). */

const figure = "size-full transition-transform duration-[1600ms] ease-(--ease) group-hover:rotate-90 motion-reduce:transition-none";

/** Lume: rings turning around one axis, the agent working through a case. */
export function GlyphLume() {
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".8" aria-hidden="true" className={figure}>
      <circle cx="100" cy="100" r="96" strokeDasharray="1 3" />
      {[18, 34, 50, 66, 82].map((rx) => <ellipse key={rx} cx="100" cy="100" rx={rx} ry="60" />)}
      {[18, 34, 50, 66, 82].map((rx) => <ellipse key={`b${rx}`} cx="100" cy="100" rx={rx} ry="60" strokeDasharray="1 2.5" transform="rotate(90 100 100)" opacity=".6" />)}
    </svg>
  );
}

/** Cofre: a sphere of meridians inside a dotted frame, everything kept in one place. */
export function GlyphVault() {
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".8" aria-hidden="true" className={figure}>
      <rect x="4" y="4" width="192" height="192" strokeDasharray="1 3" />
      <line x1="4" y1="68" x2="196" y2="68" strokeDasharray="1 3" />
      <line x1="4" y1="132" x2="196" y2="132" strokeDasharray="1 3" />
      <circle cx="100" cy="100" r="92" />
      {[16, 36, 56, 76].map((rx) => <ellipse key={rx} cx="100" cy="100" rx={rx} ry="92" />)}
      {[-60, -30, 0, 30, 60].map((y) => <line key={y} x1={100 - Math.sqrt(92 ** 2 - y ** 2)} y1={100 + y} x2={100 + Math.sqrt(92 ** 2 - y ** 2)} y2={100 + y} />)}
    </svg>
  );
}

/** Pesquisa: two offset orbits with marked points, one decision leading to another. */
export function GlyphResearch() {
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".8" aria-hidden="true" className={figure}>
      <circle cx="84" cy="88" r="64" strokeDasharray="1 3" />
      <circle cx="112" cy="104" r="80" />
      <circle cx="100" cy="96" r="44" strokeDasharray="1 2" />
      <rect x="82" y="30" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="150" y="176" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="54" y="118" width="5" height="5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Agenda: a dial of hours with one deadline marked. */
export function GlyphAgenda() {
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".8" aria-hidden="true" className={figure}>
      <circle cx="100" cy="100" r="92" />
      <circle cx="100" cy="100" r="70" strokeDasharray="1 3" />
      {Array.from({ length: 60 }, (_, i) => (
        <line key={i} x1="100" y1="8" x2="100" y2={i % 5 ? 13 : 20} transform={`rotate(${i * 6} 100 100)`} />
      ))}
      <line x1="100" y1="100" x2="100" y2="44" />
      <line x1="100" y1="100" x2="146" y2="100" />
      <rect x="146" y="46" width="6" height="6" className="fill-brand" stroke="none" />
    </svg>
  );
}
