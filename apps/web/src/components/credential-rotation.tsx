'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CredentialRotationStatus } from '@/lib/credential-rotation';

type Status = CredentialRotationStatus & { enabled: boolean };

async function loadStatus(signal?: AbortSignal): Promise<Status> {
  const response = await fetch('/api/platform/credentials', { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível conferir as credenciais.');
  return body;
}

export function CredentialRotation() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh() {
    setStatus(await loadStatus());
    setReady(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal).then(setStatus).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);

  async function run(rotate: boolean) {
    setBusy(true); setError(''); setMessage('');
    try {
      if (rotate && status) {
        const response = await fetch('/api/platform/credentials', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedKeyId: status.keyId, runtimesReady: ready }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a rotação.');
        setMessage(`${result.reencrypted} credenciais atualizadas. Os dados e as conexões foram preservados.`);
      }
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }

  return <section className="max-w-2xl space-y-5 py-6" aria-labelledby="credentials-title">
    <div className="space-y-2">
      <h2 id="credentials-title" className="text-lg font-medium">Credenciais</h2>
      <p className="text-sm text-muted-foreground">Atualize a proteção das credenciais sem reconectar os serviços ou reprocessar documentos.</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!status && !error && <p role="status" className="text-sm text-muted-foreground">Conferindo credenciais…</p>}
    {status && <div className="space-y-3 text-sm">
      <p>{status.total} credenciais armazenadas · {status.pending} pendentes de atualização.</p>
      <p className="text-muted-foreground">Identificador da chave ativa: <code>{status.keyId}</code></p>
      {status.unreadable > 0 && <p role="alert">Não foi possível ler {status.unreadable} credenciais. Verifique o chaveiro do ambiente antes de continuar.</p>}
      {!status.enabled ? <p className="text-muted-foreground">Nenhuma rotação preparada. A nova chave deve ser configurada pelo responsável pela infraestrutura.</p>
        : status.pending === 0 ? <p>Todas as credenciais usam a chave ativa.</p>
          : <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4 accent-current" checked={ready} disabled={busy} onChange={event => setReady(event.target.checked)} />
            <span>Confirmei que a nova chave está salva e que todos os processadores já usam o novo chaveiro.</span>
          </label>}
    </div>}
    <div className="flex flex-wrap gap-3">
      {status?.enabled && <Button disabled={busy || !ready || status.unreadable > 0 || status.pending === 0} onClick={() => void run(true)}>{busy ? 'Conferindo…' : 'Atualizar proteção das credenciais'}</Button>}
      <Button variant="outline" disabled={busy} onClick={() => void run(false)}>Conferir novamente</Button>
    </div>
  </section>;
}
