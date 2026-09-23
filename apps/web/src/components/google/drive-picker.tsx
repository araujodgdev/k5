'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type PickerConfig = { developerKey: string; appId: string; clientId: string; loginHint: string; scope: string; origin: string };
type TokenReply = { access_token?: string; scope?: string; error?: string };
type TokenError = { type?: string; message?: string };
type PickerReply = { action?: string; docs?: { id?: string }[] };
type PickerBuilder = {
  setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder; setLocale(locale: string): PickerBuilder; setMaxItems(count: number): PickerBuilder;
  setCallback(callback: (reply: PickerReply) => void): PickerBuilder; addView(view: unknown): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};
type GoogleBrowser = Window & {
  google?: {
    accounts?: { oauth2?: { initTokenClient(config: { client_id: string; scope: string; hint: string; include_granted_scopes: boolean;
      callback: (reply: TokenReply) => void; error_callback: (error: TokenError) => void }): { requestAccessToken(options: { prompt: string }): void } } };
    picker?: { PickerBuilder: new () => PickerBuilder; ViewId: { DOCS: unknown }; Action: { PICKED: string } };
  };
  gapi?: { load(name: string, callback: () => void): void };
};
function browser() { return window as GoogleBrowser; }
const scriptLoads = new Map<string, Promise<void>>();
function script(src: string) {
  if (src.includes('/gsi/client') && browser().google?.accounts?.oauth2) return Promise.resolve();
  if (src.includes('/js/api.js') && browser().gapi) return Promise.resolve();
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const loading = new Promise<void>((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (prior?.dataset.loaded === 'true') return resolve();
    const element = prior ?? document.createElement('script');
    element.addEventListener('load', () => { element.dataset.loaded = 'true'; resolve(); }, { once: true });
    element.addEventListener('error', () => reject(new Error('Não foi possível carregar o seletor do Google.')), { once: true });
    if (!prior) { element.src = src; element.async = true; document.head.appendChild(element); }
  });
  scriptLoads.set(src, loading);
  void loading.catch(() => scriptLoads.delete(src));
  return loading;
}
export function DrivePicker({ onPicked, disabled }: { onPicked: (ids: string[]) => Promise<void>; disabled?: boolean }) {
  const [config, setConfig] = useState<PickerConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      const response = await fetch('/api/integrations/google/picker', { method: 'POST', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'O seletor do Google Drive não está disponível.');
      if (body.origin !== window.location.origin) throw new Error('A origem do seletor não corresponde ao aplicativo.');
      await Promise.all([script('https://accounts.google.com/gsi/client'), script('https://apis.google.com/js/api.js')]);
      await new Promise<void>((resolve, reject) => {
        const gapi = browser().gapi;
        if (!gapi) return reject(new Error('O Google Picker não carregou.'));
        gapi.load('picker', resolve);
      });
      if (active) { setConfig(body as PickerConfig); setReady(true); }
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'O seletor não carregou.'); });
    return () => { active = false; };
  }, []);
  function open() {
    if (!config || !ready || disabled || busy) return;
    setError(''); setBusy(true);
    const api = browser().google;
    if (!api?.accounts?.oauth2 || !api.picker) { setError('O seletor não carregou.'); setBusy(false); return; }
    const picker = api.picker;
    try {
      // This browser token is intentionally separate from the server's combined OAuth grant.
      // It lives only in this callback and must contain exactly drive.file.
      api.accounts.oauth2.initTokenClient({
        client_id: config.clientId, scope: config.scope, hint: config.loginHint, include_granted_scopes: false,
        callback: reply => {
          const scopes = reply.scope?.split(/\s+/).filter(Boolean) ?? [];
          if (!reply.access_token || scopes.length !== 1 || scopes[0] !== config.scope) {
            setError('O Google não concedeu acesso restrito ao Drive. Tente conectar novamente.'); setBusy(false); return;
          }
          new picker.PickerBuilder().setOAuthToken(reply.access_token).setDeveloperKey(config.developerKey)
            .setAppId(config.appId).setOrigin(config.origin).setLocale('pt-BR').setMaxItems(20)
            .addView(picker.ViewId.DOCS).setCallback(data => {
              if (data.action === picker.Action.PICKED) {
                const ids = (data.docs ?? []).map(doc => doc.id).filter((id): id is string => !!id);
                void onPicked(ids).catch(e => setError(e instanceof Error ? e.message : 'Não foi possível registrar os arquivos.'))
                  .finally(() => setBusy(false));
              } else setBusy(false);
            }).build().setVisible(true);
        },
        error_callback: failure => {
          setError(failure.type === 'popup_closed'
            ? 'A seleção do Google Drive foi cancelada.'
            : 'Não foi possível abrir a autorização do Google. Verifique o bloqueio de pop-ups e tente novamente.');
          setBusy(false);
        },
      }).requestAccessToken({ prompt: 'consent' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível abrir o seletor.'); setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3">
    <Button type="button" variant="outline" onClick={open} disabled={!ready || disabled || busy}>
      {busy ? 'Abrindo Google Drive…' : 'Escolher no Google Drive'}
    </Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
