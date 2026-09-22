"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const PwaContext = createContext<{ installed: boolean; install: () => Promise<boolean> }>({ installed: false, install: async () => true });

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const prompt = useRef<InstallPrompt | null>(null);
  const reloadOnUpdate = useRef(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const syncInstalled = () => setInstalled(standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const syncConnection = () => setOffline(!navigator.onLine);
    const onPrompt = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPrompt; };
    const onInstalled = () => { setInstalled(true); prompt.current = null; };
    syncInstalled();
    syncConnection();
    standalone.addEventListener("change", syncInstalled);
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      standalone.removeEventListener("change", syncInstalled);
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const cleanups: (() => void)[] = [];
    const observe = () => {
      if (registration?.waiting) setWaiting(registration.waiting);
      const worker = registration?.installing;
      if (!worker) return;
      const onState = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
      };
      worker.addEventListener("statechange", onState);
      cleanups.push(() => worker.removeEventListener("statechange", onState));
    };
    const onController = () => {
      // Other open tabs keep their drafts when one tab accepts an update.
      if (reloadOnUpdate.current) window.location.reload();
      else setWaiting(null);
    };
    const checkUpdate = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    document.addEventListener("visibilitychange", checkUpdate);
    window.addEventListener("online", checkUpdate);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((result) => {
      if (disposed) return;
      registration = result;
      observe();
      result.addEventListener("updatefound", observe);
      cleanups.push(() => result.removeEventListener("updatefound", observe));
    }).catch((error: unknown) => {
      // The regular online app still works if a browser disallows service workers.
      console.warn("Lume: não foi possível preparar o acesso offline.", error);
    });
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      document.removeEventListener("visibilitychange", checkUpdate);
      window.removeEventListener("online", checkUpdate);
    };
  }, []);

  async function install(): Promise<boolean> {
    const event = prompt.current;
    if (!event) return true;
    prompt.current = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      return false;
    } catch {
      return true;
    }
  }

  async function update() {
    if (!waiting || updating) return;
    setUpdating(true);
    setUpdateError("");
    try {
      // Do not replace a working open page with the offline fallback.
      const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      reloadOnUpdate.current = true;
      if (waiting.state === "activated" || waiting.state === "redundant") window.location.reload();
      else waiting.postMessage({ type: "SKIP_WAITING" });
    } catch {
      setUpdating(false);
      setUpdateError("Não foi possível atualizar. Confira sua conexão e tente novamente.");
    }
  }

  return (
    <PwaContext.Provider value={{ installed, install }}>
      {children}
      {(offline || waiting) && <aside aria-label="Estado do aplicativo" className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+.75rem)] z-50 mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-(--shadow-float)">
        {offline ? <p role="status" className="flex items-center gap-2 text-sm"><WifiOff className="size-4 shrink-0" aria-hidden="true" />Sem conexão. Conecte-se para salvar alterações.</p> : <>
          <p role="status" className="min-w-0 flex-1 text-sm">Nova versão disponível. Salve seu trabalho antes de atualizar.</p>
          <Button variant="outline" className="min-h-11 md:min-h-9" disabled={updating} onClick={update}>{updating ? "Atualizando…" : "Atualizar agora"}</Button>
          {updateError && <p role="alert" className="text-destructive text-xs">{updateError}</p>}
        </>}
      </aside>}
    </PwaContext.Provider>
  );
}

export function InstallApp() {
  const { installed, install } = useContext(PwaContext);
  const [help, setHelp] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (installed) return null;
  return <>
    <Button ref={button} variant="ghost" onClick={() => { void install().then(setHelp); }} className="min-h-11 justify-start px-2 text-muted-foreground md:min-h-9"><Download className="size-4" aria-hidden="true" />Instalar Lume</Button>
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); button.current?.focus(); }}>
        <DialogTitle>Instalar o Lume</DialogTitle>
        <DialogDescription>No iPhone ou iPad, abra o Lume no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.</DialogDescription>
        <p className="text-sm text-muted-foreground">No Android ou computador, procure “Instalar aplicativo” ou “Adicionar à tela inicial” no menu do navegador. Se a opção não aparecer, continue usando o Lume pelo navegador.</p>
        <p className="text-sm text-muted-foreground">O acesso aos dados do escritório precisa de internet.</p>
      </DialogContent>
    </Dialog>
  </>;
}
