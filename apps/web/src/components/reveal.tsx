"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Fades and lifts every `[data-reveal]` descendant in order on mount. */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from("[data-reveal]", { autoAlpha: 0.4, y: 8, duration: .35, ease: "power3.out", stagger: .04, clearProps: "transform,opacity,visibility" });
    });
    return () => mm.revert();
  }, { scope });

  return <div ref={scope} className={className}>{children}</div>;
}
