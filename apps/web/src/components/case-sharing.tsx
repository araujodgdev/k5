'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { CollaborationPanel } from './collaboration-panel';
import { CaseLumePolicy } from './case-collaboration';
import { Avatar } from './profile/avatar';
import { agendaCall } from '@/lib/agenda-client';

export function CaseSharing({ caseId, name, onOpenChange }: { caseId: string; name: string; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/collaboration?caseId=${encodeURIComponent(caseId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (!abort.signal.aborted) setPeople([...(result.owner ? [result.owner] : []), ...result.participants]);
    }).catch(() => {});
    return () => abort.abort();
  }, [caseId, open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void agendaCall('k5_crm_list_clients', { caseId, limit: 100 }).then(result => { if (live) { setClients(result.clients.map(({ id, name }) => ({ id, name }))); setError(false); } }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [caseId, open]);
  return <div className="flex min-w-0 items-center gap-3">
    <div aria-label="Participantes do caso" className="hidden -space-x-2 sm:flex">{people.slice(0, 4).map(person => <span key={person.id} title={person.name}><Avatar name={person.name} className="size-8 border-2 border-background text-[10px]" /></span>)}</div>
    <Dialog open={open} onOpenChange={value => { setOpen(value); onOpenChange(value); }}>
      <Button variant="outline" className="min-h-11" onClick={() => { setOpen(true); onOpenChange(true); }}><Share2 aria-hidden="true" />Compartilhar</Button>
      <DialogContent className="lume-menu max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Compartilhar caso</DialogTitle><DialogDescription>{name}</DialogDescription></DialogHeader>
        <CollaborationPanel caseId={caseId} />
        <p className="border-b py-4 text-sm text-muted-foreground">Conversas com o Lume e a memória de cada pessoa continuam pessoais.</p>
        <CaseLumePolicy caseId={caseId} />
        <section aria-label="Portal do cliente" className="py-3"><h3 className="font-medium">Portal do cliente</h3><p className="mt-2 text-sm text-muted-foreground">O cliente vê só o que você publicar. O portal é gerenciado separadamente da permissão do Lume.</p>
          {error ? <p role="alert" className="mt-2 text-sm text-destructive">Não foi possível consultar os seus clientes vinculados. <Link className="underline" href="/app/agenda?view=clients">Abrir clientes</Link></p> : clients === null ? <p role="status" className="mt-2 text-sm text-muted-foreground">Carregando seus clientes vinculados…</p> : clients.length ? clients.map(client => <Link key={client.id} className="mt-2 flex min-h-11 items-center text-sm underline underline-offset-4" href={`/app/agenda/clients/${encodeURIComponent(client.id)}`}>Gerenciar portal de {client.name}</Link>) : <Link className="mt-2 flex min-h-11 items-center text-sm underline underline-offset-4" href="/app/agenda?view=clients">Vincular um cliente no seu escritório</Link>}
        </section>
        <Button className="min-h-11" onClick={() => { setOpen(false); onOpenChange(false); }}>Concluir</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
