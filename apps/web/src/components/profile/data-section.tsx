'use client';

import { useState, type FormEvent } from 'react';
import { CircleAlert, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type DeletionRequest = { id: string; status: string; requestedAt: string; scheduledFor: string };

const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Perfil → Seus dados: download everything, or ask for the office and account to be deleted. */
export function DataSection({ initial }: { initial: DeletionRequest | null }) {
  const [deletion, setDeletion] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function request(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!password) { setError('Informe sua senha atual.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/office/deletion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível agendar a exclusão. Tente novamente.');
      setDeletion(body.request); setConfirming(false); setPassword('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível agendar a exclusão. Tente novamente.'); }
    finally { setBusy(false); }
  }

  async function cancel() {
    setError(''); setBusy(true);
    try {
      const response = await fetch('/api/office/deletion', { method: 'DELETE' });
      if (!response.ok && response.status !== 409) throw new Error();
      setDeletion(null);
    } catch { setError('Não foi possível cancelar. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="profile-data" className="grid gap-8 border-t border-line pt-8 lg:grid-cols-[16rem_1fr]" data-reveal>
      <div className="grid content-start gap-3">
        <p className="label-mono flex items-center gap-2.5 text-muted-foreground"><span className="square-dot" aria-hidden="true" /><span id="profile-data">Seus dados</span></p>
        <p className="text-sm text-muted-foreground">Leve uma cópia de tudo o que o escritório guarda no Lume, ou peça a exclusão da conta.</p>
      </div>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h2 className="font-medium">Exportar dados</h2>
            <p className="text-sm text-muted-foreground">Um arquivo ZIP com clientes, casos, agenda, honorários, conversas e documentos do Lume, além do original de cada documento do Cofre. Pode levar alguns minutos em um acervo grande.</p>
          </div>
          <Button asChild variant="outline" className="justify-self-start">
            <a href="/api/office/export" download><Download className="size-4" aria-hidden="true" />Exportar dados</a>
          </Button>
        </div>

        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h2 className="font-medium">Excluir conta e escritório</h2>
            {deletion
              ? <p role="status" className="border-l-2 border-brand pl-3 text-sm">Exclusão agendada para {day(deletion.scheduledFor)}. Até lá, você pode cancelar e continuar usando o Lume normalmente.</p>
              : <p className="text-sm text-muted-foreground">Apaga clientes, casos, documentos, conversas e o acesso. Você terá 7 dias para cancelar. Registros de pagamento e de auditoria ficam guardados pelo prazo legal. Exporte antes o que quiser manter.</p>}
          </div>
          {error && <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4" aria-hidden="true" />{error}</p>}
          {deletion
            ? <Button variant="outline" disabled={busy} onClick={() => void cancel()} className="justify-self-start">{busy ? 'Cancelando…' : 'Cancelar exclusão'}</Button>
            : confirming
              ? <form onSubmit={request} noValidate className="grid gap-4 border-l-2 border-destructive pl-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="deletion-password">Senha atual</Label>
                    <Input id="deletion-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Agendando…' : 'Agendar exclusão'}</Button>
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => { setConfirming(false); setPassword(''); setError(''); }}>Voltar</Button>
                  </div>
                </form>
              : <Button variant="destructive" onClick={() => setConfirming(true)} className="justify-self-start">Excluir conta</Button>}
        </div>
      </div>
    </section>
  );
}
