"use client";

import { useEffect, useRef } from "react";
export function LandingMotion({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const animations = new Set<Animation>();
    const easing = getComputedStyle(root).getPropertyValue("--ease").trim();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
        const element = entry.target;
        observer.unobserve(element);
        if (reduced.matches || element.contains(document.activeElement)) continue;
        const rise = element.hasAttribute("data-rise");
        const wipe = element.hasAttribute("data-wipe");
        const frames = rise
          ? [{ transform: "translateY(105%)" }, { transform: "translateY(0)" }]
          : wipe
            ? [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0)" }]
            : [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" }];
        const animation = element.animate(frames, {
          duration: rise ? 1200 : wipe ? 1100 : 1000,
          delay: (Number(element.dataset.rise ?? element.dataset.fade) || 0) * 1000,
          easing,
          fill: "backwards",
        });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    }, { rootMargin: "0px 0px -10% 0px" });

    // Content already on screen stays visible during hydration.
    root.querySelectorAll<HTMLElement>("[data-rise], [data-fade], [data-wipe]").forEach(element => {
      if (element.getBoundingClientRect().top >= window.innerHeight) observer.observe(element);
    });
    const cancel = () => {
      animations.forEach(animation => animation.cancel());
      animations.clear();
    };
    const onMotion = () => { if (reduced.matches) { observer.disconnect(); cancel(); } };
    reduced.addEventListener("change", onMotion);
    root.addEventListener("focusin", cancel);
    return () => {
      observer.disconnect();
      cancel();
      reduced.removeEventListener("change", onMotion);
      root.removeEventListener("focusin", cancel);
    };
  }, []);

  return <div ref={scope} className={className}>{children}</div>;
}
