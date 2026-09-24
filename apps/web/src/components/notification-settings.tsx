"use client";

import { uploadPushSubscription } from "@/lib/notifications/push-client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NotificationCategory } from "@/lib/notifications/contracts";

/**
 * Notification preferences and push devices. Taken out of the notifications panel to keep it
 * direct; not mounted until the profile/settings page exists.
 */
type Preferences = {
  timezone: string; quietEnabled: boolean; quietStart: string | null; quietEnd: string | null;
  pushEnabled: boolean; categories: Record<NotificationCategory, boolean>; authorizationGeneration: number;
};
type Device = {
  id: string; deviceId: string; deviceLabel: string | null; state: string;
  subscribedAt: string; revokedAt: string | null; lastReconciledAt: string; vapidKeyId: string;
};
type PushConfig = { available: boolean; publicKey: string | null; keyId: string | null; authorizationGeneration: number };

const categoryLabels: Record<Exclude<NotificationCategory, "system">, string> = {
  agenda: "Tarefas e agenda", vault: "Cofre", documents: "Lume e documentos", judicial: "Judicial",
};

function readError(response: Response, fallback: string) {
  return response.json().then((value: { error?: string }) => value.error || fallback).catch(() => fallback);
}

function deviceId() {
  const key = "k5-push-device";
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

function applicationServerKey(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function supportState(config: PushConfig | null) {
  if (!config?.available) return "unavailable" as const;
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return "unsupported" as const;
  if (Notification.permission === "denied") return "blocked" as const;
  return "ready" as const;
}

export function NotificationSettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pushStatus, setPushStatus] = useState<"idle" | "activating" | "active" | "failed">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const [preferenceResponse, configResponse, devicesResponse] = await Promise.all([
        fetch("/api/notifications/preferences", { cache: "no-store" }),
        fetch("/api/notifications/config", { cache: "no-store" }),
        fetch("/api/notifications/subscriptions", { cache: "no-store" }),
      ]);
      if (preferenceResponse.ok) setPreferences(await preferenceResponse.json() as Preferences);
      const nextConfig = configResponse.ok ? await configResponse.json() as PushConfig : null;
      if (nextConfig) setConfig(nextConfig);
      if (devicesResponse.ok) {
        const value = await devicesResponse.json() as { subscriptions: Device[] };
        setDevices(value.subscriptions);
        const current = value.subscriptions.find((entry) => entry.deviceId === deviceId() && entry.state === "active");
        if (current && "serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          const localSubscription = await registration.pushManager.getSubscription();
          if (!localSubscription) {
            const revoke = await fetch(`/api/notifications/subscriptions/${encodeURIComponent(current.id)}`, { method: "DELETE" });
            if (revoke.ok) setDevices((devices) => devices.map((device) => device.id === current.id ? { ...device, state: "revoked" } : device));
            setPushStatus("idle");
          } else {
            if (nextConfig?.keyId === current.vapidKeyId) {
              await uploadPushSubscription(localSubscription, {
                deviceId: current.deviceId, deviceLabel: current.deviceLabel,
                vapidKeyId: current.vapidKeyId, authorizationGeneration: nextConfig.authorizationGeneration,
              });
            }
            setPushStatus(nextConfig?.keyId === current.vapidKeyId ? "active" : "idle");
          }
        }
      }
    } catch { /* Settings stay empty if they cannot load. */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0);
    const onWorkerMessage = (event: MessageEvent) => { if (event.data?.type === "K5_PUSH_SUBSCRIPTION_CHANGED") void loadSettings(); };
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => { window.clearTimeout(timer); navigator.serviceWorker?.removeEventListener("message", onWorkerMessage); };
  }, [loadSettings]);

  async function write(path: string, body?: unknown, method = "POST") {
    const response = await fetch(path, {
      method, headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readError(response, "Não foi possível salvar a alteração."));
    return response;
  }

  async function savePreferences() {
    if (!preferences) return;
    setBusy("preferences"); setError(""); setNotice("");
    try {
      const response = await write("/api/notifications/preferences", {
        timezone: preferences.timezone,
        quietEnabled: preferences.quietEnabled,
        quietStart: preferences.quietStart,
        quietEnd: preferences.quietEnd,
        pushEnabled: preferences.pushEnabled,
        categories: preferences.categories,
      }, "PATCH");
      setPreferences(await response.json() as Preferences); setNotice("Preferências salvas.");
    } catch (value) { setError(value instanceof Error ? value.message : "Não foi possível salvar as preferências."); }
    finally { setBusy(null); }
  }

  async function activatePush() {
    if (!config?.available || !config.publicKey || !config.keyId) return;
    setPushStatus("activating"); setError(""); setNotice("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPushStatus(permission === "denied" ? "idle" : "failed"); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && currentDevice?.vapidKeyId !== config.keyId) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey),
      });
      const response = await uploadPushSubscription(subscription, {
        deviceId: deviceId(), deviceLabel: navigator.userAgent.slice(0, 120),
        vapidKeyId: config.keyId, authorizationGeneration: config.authorizationGeneration,
      });
      const value = await response.json() as { subscriptions: Device[] };
      setDevices(value.subscriptions); setPushStatus("active"); setNotice("Notificações ativadas neste dispositivo.");
    } catch (value) {
      setPushStatus("failed");
      setError(value instanceof Error ? value.message : "Falha ao ativar neste dispositivo.");
    }
  }

  async function revokeDevice(device: Device) {
    setBusy(device.id); setError(""); setNotice("");
    try {
      await write(`/api/notifications/subscriptions/${encodeURIComponent(device.id)}`, undefined, "DELETE");
      if (device.deviceId === deviceId() && "serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await (await registration.pushManager.getSubscription())?.unsubscribe();
        registration.active?.postMessage({ type: "CLOSE_K5_NOTIFICATIONS" });
        setPushStatus("idle");
      }
      await loadSettings(); setNotice("Dispositivo revogado.");
    } catch (value) { setError(value instanceof Error ? value.message : "Não foi possível revogar o dispositivo."); }
    finally { setBusy(null); }
  }

  async function sendTest(device: Device) {
    setBusy(`test-${device.id}`); setError(""); setNotice("");
    try { await write("/api/notifications/test", { subscriptionId: device.id }); setNotice("Teste enfileirado. O aviso será enviado pelo worker."); }
    catch (value) { setError(value instanceof Error ? value.message : "Não foi possível enviar o teste."); }
    finally { setBusy(null); }
  }

  const currentDevice = devices.find((device) => device.deviceId === (typeof window === "undefined" ? "" : deviceId()) && device.state === "active");
  const support = typeof window === "undefined" ? "unavailable" : supportState(config);

  return (
    <section aria-labelledby="notification-preferences" className="grid gap-6">
      <h2 id="notification-preferences" className="text-lg font-medium">Notificações</h2>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {preferences && <>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="notification-timezone">Fuso horário</Label><Input id="notification-timezone" value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })} /></div>
          <div className="grid gap-1.5">
            <Label>Horário de silêncio</Label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={preferences.quietEnabled} onChange={(event) => setPreferences({ ...preferences, quietEnabled: event.target.checked })} />Adiar avisos do sistema operacional</label>
            {preferences.quietEnabled && <div className="flex gap-2"><Input aria-label="Início do silêncio" type="time" value={preferences.quietStart ?? "22:00"} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} /><Input aria-label="Fim do silêncio" type="time" value={preferences.quietEnd ?? "07:00"} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} /></div>}
          </div>
        </div>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">Categorias</legend>{Object.entries(categoryLabels).map(([key, label]) => <label key={key} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={preferences.categories[key as NotificationCategory]} onChange={(event) => setPreferences({ ...preferences, categories: { ...preferences.categories, [key]: event.target.checked } })} />{label}</label>)}</fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={preferences.pushEnabled} onChange={(event) => setPreferences({ ...preferences, pushEnabled: event.target.checked })} />Permitir avisos do sistema nos dispositivos ativados</label>
        <Button className="w-fit min-h-11 md:min-h-9" disabled={busy === "preferences"} onClick={() => void savePreferences()}>{busy === "preferences" ? "Salvando…" : "Salvar preferências"}</Button>
      </>}

      <div className="border-t pt-5">
        <h3 className="font-medium">Avisos neste dispositivo</h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {support === "unsupported" && <p className="text-sm">Sem suporte neste navegador.</p>}
          {support === "unavailable" && <p className="text-sm">Avisos do sistema ainda não estão configurados neste ambiente.</p>}
          {support === "blocked" && <p className="text-sm">Permissão bloqueada. Libere as notificações nas configurações do navegador.</p>}
          {support === "ready" && pushStatus !== "active" && <Button variant="outline" className="min-h-11 md:min-h-9" disabled={pushStatus === "activating"} onClick={() => void activatePush()}><Bell aria-hidden="true" />{pushStatus === "activating" ? "Ativando…" : pushStatus === "failed" ? "Tentar ativar novamente" : "Ativar neste dispositivo"}</Button>}
          {pushStatus === "active" && <p className="text-sm font-medium">Ativadas neste dispositivo</p>}
          {pushStatus === "active" && currentDevice && <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy === `test-${currentDevice.id}`} onClick={() => void sendTest(currentDevice)}>{busy === `test-${currentDevice.id}` ? "Enfileirando…" : "Enviar teste"}</Button>}
        </div>
        {(support === "unsupported" || support === "blocked") && /iPhone|iPad/.test(navigator.userAgent) && <p className="mt-3 text-sm text-muted-foreground">No iPhone ou iPad, instale o Lume na Tela de Início pelo Safari e ative os avisos dentro do aplicativo instalado.</p>}
      </div>

      {devices.length > 0 && <div className="border-t pt-5"><h3 className="font-medium">Dispositivos</h3><div className="mt-2">{devices.map((device) => <div key={device.id} className="flex flex-wrap items-center gap-3 border-b py-3 text-sm"><span className="min-w-0 flex-1 truncate">{device.deviceId === (typeof window === "undefined" ? "" : deviceId()) ? "Este dispositivo" : device.deviceLabel || "Dispositivo"}</span><span className="text-muted-foreground">{device.state === "active" ? "Ativo" : "Revogado"}</span>{device.state === "active" && <Button variant="ghost" className="min-h-11 md:min-h-9" disabled={busy === device.id} onClick={() => void revokeDevice(device)}>{busy === device.id ? "Revogando…" : "Revogar"}</Button>}</div>)}</div></div>}
    </section>
  );
}
