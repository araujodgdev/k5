'use client';

import { useState, type FormEvent } from 'react';
import { CircleAlert, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProfileSectionHead } from './section-head';

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
    <section aria-labelledby="profile-data" className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <ProfileSectionHead id="profile-data" title="Seus dados">Leve uma cópia de tudo o que o escritório guarda no Lume, ou peça a exclusão da conta.</ProfileSectionHead>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Exportar dados</h3>
            <p className="text-[13.5px] text-muted-foreground">Um arquivo ZIP com clientes, casos, agenda, honorários, conversas e documentos do Lume, além do original de cada documento do Cofre. Pode levar alguns minutos em um acervo grande.</p>
          </div>
          <Button asChild variant="outline" size="lg" className="justify-self-start">
            <a href="/api/office/export" download><Download className="size-4" aria-hidden="true" />Exportar dados</a>
          </Button>
        </div>

        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Excluir conta e escritório</h3>
            {deletion
              ? <p role="status" className="text-[13.5px]">Exclusão agendada para {day(deletion.scheduledFor)}. Até lá, você pode cancelar e continuar usando o Lume normalmente.</p>
              : <p className="text-[13.5px] text-muted-foreground">Apaga clientes, casos, documentos, conversas e o acesso. Você terá 7 dias para cancelar. Registros de pagamento e de auditoria ficam guardados pelo prazo legal. Exporte antes o que quiser manter.</p>}
          </div>
          {error && <p role="alert" className="flex items-center gap-2 text-[13.5px] text-destructive"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{error}</p>}
          {deletion
            ? <Button variant="outline" size="lg" disabled={busy} onClick={() => void cancel()} className="justify-self-start">{busy ? 'Cancelando…' : 'Cancelar exclusão'}</Button>
            : confirming
              ? <form onSubmit={request} noValidate className="grid gap-3 rounded-lg border border-border bg-card p-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="deletion-password" className="text-xs font-normal text-muted-foreground">Senha atual</Label>
                    <Input id="deletion-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="destructive" size="lg" disabled={busy}>{busy ? 'Agendando…' : 'Agendar exclusão'}</Button>
                    <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={() => { setConfirming(false); setPassword(''); setError(''); }}>Voltar</Button>
                  </div>
                </form>
              : <Button variant="destructive" size="lg" onClick={() => setConfirming(true)} className="justify-self-start">Excluir conta</Button>}
        </div>
      </div>
    </section>
  );
}
