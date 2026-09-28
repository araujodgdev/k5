"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

// Registration wakes GSAP's ticker; Workers forbid timers during SSR imports.
if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

const reduce = "(prefers-reduced-motion: reduce)";

/**
 * Runs before the landing paints: with motion allowed, the scenes are stacked in their stages
 * from the first frame, so the page never shows the plain layout and then jumps.
 */
export const motionScript = `try{if(!matchMedia(${JSON.stringify(reduce)}).matches)document.currentScript.parentElement.setAttribute("data-motion","")}catch(e){}`;

const vw = (value: number) => () => window.innerWidth * value / 100;
const vh = (value: number) => () => window.innerHeight * value / 100;
const stage = (trigger: Element) => ({ trigger, start: "top top", end: "bottom bottom", scrub: 1 });

/**
 * A camera through the landing. Sections opt in with data attributes (layout in globals.css):
 * - `.depth`: its `.depth-scene`s come from the back, settle, and pass the viewer on a diagonal.
 * - `[data-track]`: its row travels sideways; inside, `[data-parallax]` layers drift at their own
 *   speed and `[data-tilt]` frames turn as they cross the screen.
 * - `[data-diagonal]`: `[data-diag]` elements cross the screen from bottom left to top right while
 *   `[data-rise-from-back]` comes forward and its `[data-rule]` draws down.
 * - `[data-fade]` lifts in once; `[data-field-reveal]`: the pixel field opens as it scrolls in.
 * - `[data-spark]`: light that leaves the hero mark's beam and becomes the tittle of `[data-hero-word]`.
 * Scrubbed motion is smoothed so it eases with the hand. Under reduced motion none of this runs and
 * every scene is a plain block in the page.
 */
export function LandingMotion({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = scope.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add({ still: reduce, moving: "(prefers-reduced-motion: no-preference)" }, (context) => {
      const { moving } = context.conditions as { still: boolean; moving: boolean };
      root.toggleAttribute("data-motion", moving);
      if (!moving) return;
      ScrollTrigger.refresh();

      // Depth: each scene arrives from the back and the lower right, rests, then passes the viewer
      // toward the upper left, so the camera seems to travel forward on a diagonal.
      root.querySelectorAll<HTMLElement>(".depth").forEach((section) => {
        const scenes = gsap.utils.toArray<HTMLElement>(section.querySelectorAll(".depth-scene"));
        const timeline = gsap.timeline({ scrollTrigger: stage(section), defaults: { ease: "none" } });
        scenes.forEach((scene, index) => {
          const side = index % 2 ? -1 : 1;
          if (index > 0) {
            timeline.fromTo(scene,
              { z: -1600, x: vw(22 * side), y: vh(14), autoAlpha: 0, filter: "blur(10px)" },
              { z: 0, x: 0, y: 0, autoAlpha: 1, filter: "blur(0px)", duration: .5, ease: "power2.out", immediateRender: true }, index - .45);
          }
          // The last scene stays; the stage carries it away, straight into the next section.
          if (index < scenes.length - 1) timeline.to(scene, { z: 520, x: vw(-12 * side), y: vh(-9), autoAlpha: 0, filter: "blur(8px)", duration: .5, ease: "power2.in" }, index + .25);
        });
      });

      // Track: the row moves sideways with the scroll; layers inside move at their own speed.
      root.querySelectorAll<HTMLElement>("[data-track]").forEach((section) => {
        const row = section.querySelector<HTMLElement>("[data-track-row]");
        if (!row) return;
        const distance = () => row.scrollWidth - window.innerWidth;
        const travel = gsap.to(row, { x: () => -distance(), ease: "none", scrollTrigger: { ...stage(section), invalidateOnRefresh: true } });
        const progress = section.querySelector("[data-track-progress]");
        if (progress) gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: stage(section) });
        section.querySelectorAll<HTMLElement>("[data-track-panel]").forEach((panel) => {
          const cross = { containerAnimation: travel, trigger: panel, start: "left right", end: "right left", scrub: true };
          panel.querySelectorAll<HTMLElement>("[data-parallax]").forEach((layer) => {
            const speed = Number(layer.dataset.parallax) || 0;
            gsap.fromTo(layer, { x: vw(speed * 30) }, { x: vw(-speed * 30), ease: "none", scrollTrigger: cross });
          });
          panel.querySelectorAll<HTMLElement>("[data-tilt]").forEach((frame) => {
            gsap.timeline({ scrollTrigger: cross })
              .fromTo(frame, { rotateY: -24, z: -260, autoAlpha: .35, transformPerspective: 1200 }, { rotateY: 0, z: 0, autoAlpha: 1, ease: "power2.out" })
              .to(frame, { rotateY: 20, z: -220, autoAlpha: .35, ease: "power2.in" });
          });
        });
      });

      // Diagonal: the words cross from the bottom left to the top right; the card comes forward.
      root.querySelectorAll<HTMLElement>("[data-diagonal]").forEach((section) => {
        const timeline = gsap.timeline({ scrollTrigger: stage(section), defaults: { ease: "none" } });
        section.querySelectorAll<HTMLElement>("[data-diag]").forEach((element, index) => {
          timeline.fromTo(element, { x: vw(-70), y: vh(55), autoAlpha: 0 }, { x: 0, y: 0, autoAlpha: 1, duration: 1, ease: "power3.out", immediateRender: true }, index * .25);
          timeline.to(element, { x: vw(70), y: vh(-55), autoAlpha: 0, duration: 1, ease: "power3.in" }, 2.1 + index * .15);
        });
        section.querySelectorAll<HTMLElement>("[data-rise-from-back]").forEach((card) => {
          timeline.fromTo(card, { z: -1400, y: vh(20), rotateX: 25, autoAlpha: 0, transformPerspective: 900 }, { z: 0, y: 0, rotateX: 0, autoAlpha: 1, duration: 1.1, ease: "power3.out", immediateRender: true }, .45);
          const rule = card.querySelector("[data-rule]");
          if (rule) timeline.fromTo(rule, { scaleY: 0 }, { scaleY: 1, transformOrigin: "top", duration: .5, ease: "power2.out", immediateRender: true }, 1.35);
          timeline.to(card, { z: 600, autoAlpha: 0, duration: 1, ease: "power3.in" }, 2.3);
        });
      });

      // Blocks lift into place as they come into view.
      root.querySelectorAll<HTMLElement>("[data-fade]").forEach((element) => {
        gsap.from(element, { autoAlpha: 0, y: 40, duration: 1.3, ease: "expo.out", delay: Number(element.dataset.fade) || 0, scrollTrigger: { trigger: element, start: "top 90%" } });
      });

      // The pixel field opens from a smaller window as the invitation scrolls in.
      root.querySelectorAll<HTMLElement>("[data-field-reveal]").forEach((field) => {
        gsap.fromTo(field, { clipPath: "inset(16% 16% 16% 16%)" }, { clipPath: "inset(0% 0% 0% 0%)", ease: "power2.out", scrollTrigger: { trigger: field, start: "top 95%", end: "top 20%", scrub: 1 } });
      });

      // The spark: once the hero's diamond has landed, light leaves it and
      // becomes the tittle of the i. It lives in the hero scene, so it travels with the camera.
      // Web Animations keep it on the same clock as the CSS intro, even in a background tab.
      const played: Animation[] = [];
      const spark = root.querySelector<HTMLElement>("[data-spark]");
      const beam = root.querySelector("[data-hero-mark] .tises-beam:not(.tises-glow)");
      const word = root.querySelector("[data-hero-word]");
      const tittle = word?.querySelector<SVGElement>(".tises-tittle:not(.tises-glow)");
      const tittleGlow = word?.querySelector<SVGElement>(".tises-tittle.tises-glow");
      const scene = spark?.offsetParent;
      if (spark && beam && tittle && scene) {
        const box = scene.getBoundingClientRect();
        const centre = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top };
        };
        // The beam is still flying in; its resting place is its box without the intro's transform.
        const from = centre(beam), to = centre(tittle);
        const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
        const at = (point: { x: number; y: number }, stretch: number) => `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) rotate(${angle}deg) scaleX(${stretch})`;
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const flight = 800, leave = 1850, land = leave + flight * .78;
        played.push(spark.animate([
          { transform: at(from, .2), opacity: 0 },
          { transform: at(from, .3), opacity: 1, offset: .06 },
          { transform: at(middle, 2.4), opacity: 1, offset: .5 },
          { transform: at(to, .35), opacity: 1, offset: .9 },
          { transform: at(to, .2), opacity: 0 },
        ], { duration: flight, delay: leave, easing: "cubic-bezier(.65, 0, .35, 1)", fill: "both" }));
        [tittle, tittleGlow].forEach((element) => { if (element) element.style.animation = "none"; });
        played.push(tittle.animate([
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1.4)", opacity: 1, offset: .5 },
          { transform: "scale(1)", opacity: 1 },
        ], { duration: 800, delay: land, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" }));
        if (tittleGlow) played.push(tittleGlow.animate([{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: .4 }], { duration: 1500, delay: land, easing: "ease-out", fill: "both" }));
      }

      return () => played.forEach((animation) => animation.cancel());
    });

    return () => mm.revert();
  }, { scope });

  return <div ref={scope} className={className} suppressHydrationWarning>{children}</div>;
}
