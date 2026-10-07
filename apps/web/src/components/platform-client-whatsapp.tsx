'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { CircleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { AdminBlock, AdminBlockHead, AdminFact, AdminFacts, adminButton, adminQuietAction } from './admin/admin-blocks';
import { cn } from '@/lib/utils';

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

  const situation = state.kind !== 'ready' ? null
    : !state.status.globalEnabled ? 'Pausado no controle geral' : state.status.enabled ? 'Ativo' : 'Desativado';
  return (
    <AdminBlock half card labelledBy="client-whatsapp">
      <AdminBlockHead id="client-whatsapp" level={3} title="WhatsApp Business" actions={state.kind === 'ready' && (
        <Button variant="outline" className={adminButton} disabled={saving || !state.status.globalEnabled} onClick={() => void toggle()}>
          {saving ? 'Salvando…' : state.status.enabled ? 'Desativar WhatsApp' : 'Ativar WhatsApp'}
        </Button>
      )} />
      <div aria-live="polite" aria-busy={saving || state.kind === 'loading'} className="flex flex-col gap-3">
        {state.kind === 'loading' && <p className="text-[13.5px] text-muted-foreground">Consultando ativação…</p>}
        {state.kind === 'error' && <>
          <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{state.message}</p>
          <button type="button" className={cn(adminQuietAction, 'self-start')} onClick={() => { setMessage(''); void refresh(); }}>Atualizar estado</button>
        </>}
        {situation && <AdminFacts><AdminFact label="Situação">{situation}</AdminFact></AdminFacts>}
        {message && <p className="text-[12.5px] text-muted-foreground">{message}</p>}
      </div>
    </AdminBlock>
  );
}
