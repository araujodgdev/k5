"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

// Registration wakes GSAP's ticker; Workers forbid timers during SSR imports.
if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Scroll motion for the landing. Children opt in with data attributes:
 * - `data-rise`: the element slides up out of its line box (wrap it in `overflow-hidden`).
 * - `data-fade`: fades and lifts 24px.
 * - `data-wipe`: a color block uncovers itself from the bottom.
 * Each plays once as it enters. Reduced motion shows everything as is.
 */
export function LandingMotion({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ease = "expo.out";
      gsap.utils.toArray<HTMLElement>("[data-rise]").forEach((element) => {
        gsap.from(element, { yPercent: 105, duration: 1.2, ease, delay: Number(element.dataset.rise) || 0, scrollTrigger: { trigger: element.parentElement ?? element, start: "top 88%" } });
      });
      gsap.utils.toArray<HTMLElement>("[data-fade]").forEach((element) => {
        gsap.from(element, { autoAlpha: 0, y: 24, duration: 1, ease, delay: Number(element.dataset.fade) || 0, scrollTrigger: { trigger: element, start: "top 90%" } });
      });
      gsap.utils.toArray<HTMLElement>("[data-wipe]").forEach((element) => {
        gsap.from(element, { clipPath: "inset(100% 0 0 0)", duration: 1.1, ease, scrollTrigger: { trigger: element, start: "top 85%" } });
      });
    });
    return () => mm.revert();
  }, { scope });

  return <div ref={scope} className={className}>{children}</div>;
}
