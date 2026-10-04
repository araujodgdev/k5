"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile() {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile indisponível."));
    script.onerror = () => { loading = null; reject(new Error("Turnstile indisponível.")); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare's human check for the sign-up form. The token it hands back is single use, so the form
 * bumps `resetKey` after every attempt to get a fresh one.
 */
export function TurnstileWidget({ siteKey, action, resetKey, onToken, onError }: {
  siteKey: string; action: string; resetKey: number; onToken: (token: string) => void; onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const handlers = useRef({ onToken, onError });
  useEffect(() => { handlers.current = { onToken, onError }; });

  useEffect(() => {
    let live = true;
    loadTurnstile().then(api => {
      if (!live || !container.current) return;
      widget.current = api.render(container.current, {
        sitekey: siteKey, language: "pt-br", appearance: "interaction-only", action,
        callback: (token: string) => handlers.current.onToken(token),
        "expired-callback": () => handlers.current.onToken(""),
        "error-callback": () => { handlers.current.onToken(""); handlers.current.onError("A verificação não carregou. Recarregue a página e tente de novo."); },
      });
    }).catch(() => handlers.current.onError("A verificação não carregou. Confira sua conexão e recarregue a página."));
    return () => {
      live = false;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey && widget.current && window.turnstile) { handlers.current.onToken(""); window.turnstile.reset(widget.current); }
  }, [resetKey]);

  return <div ref={container} className="min-h-0" />;
}
