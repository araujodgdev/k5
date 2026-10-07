'use client';

import { useEffect, useId, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdminBlock, AdminBlockHead, AdminFact, AdminFacts, AdminNote, adminButton } from '@/components/admin/admin-blocks';
import type { CredentialRotationStatus } from '@/lib/credential-rotation';

type Status = CredentialRotationStatus & { enabled: boolean };

async function loadStatus(signal?: AbortSignal): Promise<Status> {
  const response = await fetch('/api/platform/credentials', { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível conferir as credenciais.');
  return body;
}

/** "9 credenciais armazenadas · nenhuma pendente de atualização" */
function summary(status: Status) {
  const stored = `${status.total} ${status.total === 1 ? 'credencial armazenada' : 'credenciais armazenadas'}`;
  const pending = status.pending === 0 ? 'nenhuma pendente de atualização' : `${status.pending} ${status.pending === 1 ? 'pendente' : 'pendentes'} de atualização`;
  return `${stored} · ${pending}`;
}

/** The stored credentials' protection: how many there are, and the manual rotation to a new key. */
export function CredentialRotation() {
  const titleId = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal).then(setStatus).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message);
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
      setStatus(await loadStatus());
      setReady(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }

  const canRotate = Boolean(status?.enabled && ready && status.unreadable === 0 && status.pending > 0);
  return (
    <AdminBlock labelledBy={titleId}>
      <AdminBlockHead id={titleId} title="Credenciais" sub={status ? summary(status) : error ? undefined : 'Conferindo credenciais…'} actions={<>
        <Button variant="outline" className={adminButton} disabled={busy} onClick={() => void run(false)}>{busy ? 'Conferindo…' : 'Conferir novamente'}</Button>
        <Button variant="outline" className={adminButton} disabled={busy || !canRotate} onClick={() => void run(true)}>Atualizar proteção das credenciais</Button>
      </>} />
      <AdminNote>As chaves ficam cifradas. Trocar a proteção é sempre manual e fica fora do Lume.</AdminNote>
      {error && <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p>}
      {message && <p role="status" className="text-[12.5px] text-muted-foreground">{message}</p>}
      {status && <>
        <AdminFacts><AdminFact label="Chave ativa" mono>{status.keyId}</AdminFact></AdminFacts>
        {status.unreadable > 0 && <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Não foi possível ler {status.unreadable} credenciais. Verifique o chaveiro do ambiente antes de continuar.</p>}
        {!status.enabled && <p className="text-[13.5px] text-muted-foreground">Nenhuma rotação preparada. A nova chave deve ser configurada pelo responsável pela infraestrutura.</p>}
        {status.enabled && status.pending > 0 && <label className="flex items-start gap-2.5 text-[13.5px]">
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={ready} disabled={busy} onChange={event => setReady(event.target.checked)} />
          <span>Confirmei que a nova chave está salva e que todos os processadores já usam o novo chaveiro.</span>
        </label>}
      </>}
    </AdminBlock>
  );
}
