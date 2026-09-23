"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";

const query = "(max-width: 1023px)";
const mobile = () => window.matchMedia(query).matches;
const desktopOnServer = () => false;
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** Keep the same editor mounted when resizing; only the small-screen focus scope is modal. */
export function DocumentPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const isMobile = useSyncExternalStore(subscribe, mobile, desktopOnServer);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!isMobile || !panel) return;
    const previous = document.activeElement;
    panel.focus();
    const restoreAccessibility = hideOthers(panel);
    return () => {
      restoreAccessibility();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isMobile]);

  return (
    <FocusScope asChild trapped={isMobile} loop={isMobile}
      onMountAutoFocus={event => event.preventDefault()} onUnmountAutoFocus={event => event.preventDefault()}>
      <section ref={panelRef} id="document-panel" tabIndex={-1} role={isMobile ? "dialog" : "region"}
        aria-modal={isMobile || undefined} aria-label="Documento"
        className="fixed inset-0 z-50 flex min-w-0 flex-col bg-background pt-[env(safe-area-inset-top)] outline-none lg:static lg:z-auto lg:min-w-[28rem] lg:flex-1 lg:pt-0"
        onKeyDown={event => {
          if (event.key !== "Escape" || event.defaultPrevented || (event.target as HTMLElement).closest("[data-radix-popper-content-wrapper]")) return;
          event.preventDefault();
          onClose();
        }}>
        {children}
      </section>
    </FocusScope>
  );
}
