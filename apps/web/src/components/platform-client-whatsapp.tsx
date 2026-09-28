'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from './ui/button';

const statusSchema = z.object({ enabled: z.boolean(), globalEnabled: z.boolean(), revision: z.string() });
const errorSchema = z.object({ error: z.string() });
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; status: z.infer<typeof statusSchema> };

export function PlatformClientWhatsApp({ officeId }: { officeId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const endpoint = `/api/platform/offices/${encodeURIComponent(officeId)}/whatsapp`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(errorSchema.safeParse(data).data?.error ?? 'Não foi possível consultar o WhatsApp.');
    const status = statusSchema.safeParse(data);
    if (!status.success) throw new Error('Não foi possível verificar a ativação do WhatsApp.');
    return status.data;
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(status => {
      if (!controller.signal.aborted) setState({ kind: 'ready', status });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível consultar o WhatsApp.' });
    });
    return () => controller.abort();
  }, [load]);

  async function refresh() {
    setState({ kind: 'loading' });
    try { setState({ kind: 'ready', status: await load() }); }
    catch (error) { setState({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível consultar o WhatsApp.' }); }
  }

  async function toggle() {
    if (state.kind !== 'ready' || saving) return;
    const enabled = !state.status.enabled;
    setSaving(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, revision: state.status.revision }) });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(errorSchema.safeParse(data).data?.error ?? 'Não foi possível confirmar a alteração. Atualize o estado.');
      setMessage('Alteração salva. A atualização do acesso pode levar alguns instantes.');
      await refresh();
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível confirmar a alteração. Atualize o estado.' });
    } finally { setSaving(false); }
  }

  return <section aria-labelledby="client-whatsapp-title" className="border-t border-line pt-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2"><h3 id="client-whatsapp-title" className="label-mono">WhatsApp Business</h3>
        <p className="max-w-xl text-sm text-muted-foreground">Libere o acesso para este escritório. Depois, um administrador conecta o número em Integrações.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.kind === 'ready' && <Button variant="outline" className="h-11 md:h-9" disabled={saving || !state.status.globalEnabled} onClick={() => void toggle()}>
          {saving ? 'Salvando…' : state.status.enabled ? 'Desativar WhatsApp' : 'Ativar WhatsApp'}
        </Button>}
        <Button variant="ghost" className="h-11 md:h-9" disabled={saving || state.kind === 'loading'} onClick={() => { setMessage(''); void refresh(); }}>Atualizar estado</Button>
      </div>
    </div>
    <div className="mt-3 text-sm" aria-live="polite" aria-busy={saving || state.kind === 'loading'}>
      {state.kind === 'loading' && <p>Consultando ativação…</p>}
      {state.kind === 'error' && <p role="alert" className="text-destructive">{state.message}</p>}
      {state.kind === 'ready' && <p>{!state.status.globalEnabled ? 'O controle geral está pausado no Flagship.' : state.status.enabled ? 'Ativado para este escritório.' : 'Desativado para este escritório.'}</p>}
      {message && <p className="mt-2 text-muted-foreground">{message}</p>}
    </div>
  </section>;
}
