'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfficeNavigation } from './office-navigation';
import { Avatar } from './profile/avatar';
import { lookupProfile, PersonHoverCard } from './profile/person-card';
import { avatarUrl, type ProfileCard } from '@/lib/profile-contract';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

type Person = { id: string; name: string; email: string; avatarVersion?: string | null };
type Invitation = { id: string; email: string; status: string; expiresAt: string; inviterName: string };
type Overview = { associates: Person[]; participants: Person[]; owner: Person | null; incoming: Invitation[]; outgoing: Invitation[];
  history: { id: string; action: string; createdAt: string; actorName: string; targetName: string | null }[];
  isOwner: boolean; viewerId: string };
// A history line reads as a sentence after the actor's name: "criou um convite para Rafael", "incluiu Rafael no caso".
const historyActions: Record<string, (target: string | null) => string> = {
  'invitation.created': target => target ? `criou um convite para ${target}` : 'criou um convite',
  'invitation.accepted': () => 'aceitou o convite',
  'invitation.declined': () => 'recusou o convite',
  'invitation.revoked': target => target ? `cancelou o convite de ${target}` : 'cancelou um convite',
  'associate.removed': target => `removeu ${target ?? 'uma pessoa'} dos associados`,
  'participant.added': target => `incluiu ${target ?? 'uma pessoa'} no caso`,
  'participant.removed': target => `removeu ${target ?? 'uma pessoa'} do caso`,
};
const historyLine = (action: string, target: string | null) => historyActions[action]?.(target) ?? `${action} ${target ?? ''}`;
const selectClass = 'min-h-11 min-w-0 max-w-full flex-1 border border-input bg-background px-3 text-sm md:min-h-9 md:flex-none';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Under the invite field: whether the typed address already has a Lume account, with its card on hover. */
function InviteeHint({ email }: { email: string }) {
  const settled = useDebouncedValue(email.trim().toLowerCase(), 450);
  const [result, setResult] = useState<{ email: string; profile: ProfileCard | null } | { email: string; error: string } | null>(null);
  const valid = emailPattern.test(settled);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    lookupProfile(settled).then(profile => { if (active) setResult({ email: settled, profile }); })
      .catch(error => { if (active) setResult({ email: settled, error: error instanceof Error ? error.message : '' }); });
    return () => { active = false; };
  }, [settled, valid]);
  if (!valid || result?.email !== settled || email.trim().toLowerCase() !== settled) return null;
  if ('error' in result) return null;
  if (!result.profile) return <p className="text-[13px] text-muted-foreground" aria-live="polite">Ainda não tem conta no Lume. O convite gera um link para você enviar.</p>;
  const profile = result.profile;
  return <div className="flex min-w-0 items-center gap-2.5 text-[13px]" aria-live="polite">
    <Avatar name={profile.name} src={profile.avatarUrl} className="size-7 text-[10px]" />
    <p className="min-w-0 text-muted-foreground"><PersonHoverCard email={profile.email} className="font-medium text-foreground">{profile.name}</PersonHoverCard> já usa o Lume{profile.headline ? ` · ${profile.headline}` : ''}. O convite chega na conta da pessoa.</p>
  </div>;
}

async function call(body: unknown) {
  const response = await fetch('/api/collaboration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível concluir.');
  return result as { path?: string; deliveredInApp?: boolean };
}

function PersonRow({ person, viewerId, note, children }: { person: Person; viewerId: string; note?: string; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 border-b py-4">
    <div className="flex min-w-0 basis-full items-start gap-3 sm:basis-auto sm:flex-1"><Avatar name={person.name} src={avatarUrl(person.id, person.avatarVersion ?? null)} /><div className="min-w-0">
      <p className="break-words text-sm font-medium">{person.name}{person.id === viewerId && <span className="font-normal text-muted-foreground"> · você</span>}</p>
      <PersonHoverCard email={person.email} className="text-[13px] text-muted-foreground" />
      {note && <p className="mt-1 text-[13px] text-muted-foreground">{note}</p>}
    </div></div>
    {children}
  </div>;
}

function ConfirmRemoval({ title, description, action, busy, onConfirm }: { title: string; description: string; action: string; busy: boolean; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" disabled={busy}>{action}</Button></AlertDialogTrigger><AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}

export function CollaborationPanel({ view = 'associates', caseId }: { view?: 'associates' | 'invites'; caseId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState('');
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/collaboration${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''}`, { cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(next); setError('');
    } catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Não foi possível carregar.'); }
    finally { setLoading(false); }
  }, [caseId]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  async function act(body: unknown) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await call(body); await refresh(); router.refresh(); return result; }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await act({ action: 'invite', invitation: { email: email.trim() } });
    if (result?.path) {
      setLink(`${window.location.origin}${result.path}`); setEmail(''); setFormOpen(false);
      setNotice(result.deliveredInApp ? 'Convite disponível na conta da pessoa. Você também pode compartilhar o link.' : 'Convite criado. Copie o link e envie para a pessoa. Não enviamos um e-mail.');
    }
  }
  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    if (!caseId || !chosen) return;
    const result = await act({ action: 'participant', caseId, userId: chosen, add: true });
    if (result) { setChosen(''); setNotice('Participante incluído no caso.'); }
  }

  const feedback = <>
    {error && <p role="alert" className="py-3 text-sm text-destructive">{error} <Button variant="ghost" onClick={() => void refresh()}>Tentar novamente</Button></p>}
    {notice && <p role="status" className="py-3 text-sm">{notice}</p>}
  </>;
  const history = data && data.history.length > 0 && <details className="mt-8"><summary className="cursor-pointer py-3 text-sm">Histórico de acessos</summary>{data.history.map(item => <p key={item.id} className="border-b py-3 text-sm">{item.actorName} {historyLine(item.action, item.targetName)}<span className="mt-1 block text-[13px] text-muted-foreground">{new Date(item.createdAt).toLocaleString('pt-BR')}</span></p>)}</details>;
  const buttonSize = '[&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9';

  if (caseId) {
    const candidates = data ? data.associates.filter(person => !data.participants.some(item => item.id === person.id)) : [];
    return <div className={`min-w-0 ${buttonSize}`}>
      <p className="max-w-2xl border-b py-5 text-sm text-muted-foreground">Os participantes compartilham a pasta raiz do caso e as pastas públicas. Pastas privadas ou restritas ficam visíveis só para quem tem acesso a elas.</p>
      {feedback}
      {loading && !data && <p role="status" className="py-8 text-sm text-muted-foreground">Carregando participantes…</p>}
      {data && <>
        {data.isOwner && <form onSubmit={addParticipant} className="flex flex-wrap items-end gap-3 border-b py-5">
          {candidates.length ? <>
            <div className="grid min-w-0 flex-1 gap-1.5 sm:flex-none"><Label htmlFor="case-participant">Incluir associado</Label>
              <select id="case-participant" value={chosen} onChange={event => setChosen(event.target.value)} className={selectClass}>
                <option value="">Escolha um associado</option>
                {candidates.map(person => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
              </select></div>
            <Button type="submit" disabled={busy || !chosen}>{busy ? 'Incluindo…' : 'Incluir no caso'}</Button>
          </> : <p className="text-sm text-muted-foreground">{data.associates.length ? 'Todos os seus associados já participam deste caso.' : 'Você ainda não tem associados.'} <Link href="/app/agenda?view=associates" className="underline underline-offset-4">Convidar associados</Link></p>}
        </form>}
        {data.owner && <PersonRow person={data.owner} viewerId={data.viewerId} note="Responsável pelo caso" />}
        {data.participants.length === 0 && <p className="py-8 text-sm text-subtle-foreground">Nenhum participante além do responsável.</p>}
        {data.participants.map(person => <PersonRow key={person.id} person={person} viewerId={data.viewerId} note="Participante">
          {data.isOwner ? <ConfirmRemoval busy={busy} action="Remover" title={`Remover ${person.name} do caso?`}
            description="O acesso a este caso será revogado. As pastas privadas dessa pessoa no caso continuam guardadas e fora do alcance dos demais."
            onConfirm={() => void act({ action: 'participant', caseId, userId: person.id, add: false })} />
            : person.id === data.viewerId && <ConfirmRemoval busy={busy} action="Sair do caso" title="Sair deste caso?"
              description="Você deixa de ver o caso. Para voltar, o responsável precisa incluir você de novo."
              onConfirm={async () => { if (await act({ action: 'participant', caseId, userId: person.id, add: false })) router.push('/app/vault'); }} />}
        </PersonRow>)}
        {history}
      </>}
    </div>;
  }

  return <div className={`flex min-w-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10 ${buttonSize}`}>
    <h1 className="page-title border-b pb-5 max-md:sr-only">Escritório</h1><OfficeNavigation view={view} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{view === 'associates' ? 'Advogados que trabalham com você. Cada um pode incluir o outro como participante nos próprios casos.' : 'Convites de associação recebidos em sua conta.'}</p>
      {view === 'associates' && <Button disabled={busy} onClick={() => setFormOpen(value => !value)} aria-expanded={formOpen}>{formOpen ? 'Fechar convite' : 'Convidar associado'}</Button>}
    </div>
    {feedback}
    {link && <div className="flex flex-wrap gap-2 border-b pb-4"><Input aria-label="Link do convite" value={link} readOnly className="min-w-0 flex-1" /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(link); setNotice('Link copiado.'); } catch { setNotice('Selecione e copie o link acima.'); } }}>Copiar link</Button></div>}
    {formOpen && view === 'associates' && <form onSubmit={submit} className="grid gap-4 border-b py-5 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor="invite-email">E-mail do advogado</Label><Input id="invite-email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoFocus />
        <InviteeHint email={email} />
      </div>
      <p className="text-sm text-muted-foreground sm:col-span-2">A associação sozinha não libera nenhum arquivo: cada um escolhe em quais dos próprios casos o outro participa. O convite expira em 7 dias, e a pessoa precisa entrar com este e-mail para aceitar.</p>
      <Button type="submit" disabled={busy} className="justify-self-start">{busy ? 'Criando convite…' : 'Criar convite'}</Button>
    </form>}
    {loading && !data && <p role="status" className="py-8 text-sm text-muted-foreground">Carregando associados e convites…</p>}
    {data && view === 'associates' && <>
      {data.associates.length === 0 && <p className="py-8 text-sm text-subtle-foreground">Nenhum associado ainda. Convide um advogado pelo e-mail.</p>}
      {data.associates.map(person => <PersonRow key={person.id} person={person} viewerId={data.viewerId}>
        <ConfirmRemoval busy={busy} action="Remover" title={`Remover ${person.name} dos associados?`}
          description="Vocês deixam de ser associados e cada um sai dos casos do outro. Arquivos e alterações já feitos permanecem."
          onConfirm={() => void act({ action: 'associate', userId: person.id })} />
      </PersonRow>)}
      {data.outgoing.length > 0 && <section className="mt-8"><h2 className="text-lg">Convites pendentes</h2>{data.outgoing.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b py-4"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><PersonHoverCard email={item.email} className="text-sm" /><p className="mt-1 text-[13px] text-muted-foreground">Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'cancel', id: item.id })}>Cancelar convite</Button></div>)}</section>}
      {data.incoming.length > 0 && <Link href="/app/agenda?view=invites" className="my-5 text-sm underline underline-offset-4">Você tem {data.incoming.length === 1 ? '1 convite' : `${data.incoming.length} convites`} para responder.</Link>}
      {history}
    </>}
    {data && view === 'invites' && <>{data.incoming.length === 0 && <p className="py-8 text-sm text-subtle-foreground">Nenhum convite pendente para sua conta.</p>}{data.incoming.map(item => <div key={item.id} className="flex flex-wrap items-center gap-4 border-b py-5"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><p className="text-sm font-medium">{item.inviterName}</p><p className="mt-1 text-sm text-muted-foreground">Convidou você para ser associado</p><p className="mt-1 text-[13px] text-muted-foreground">Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'respond', id: item.id, accept: false })}>Recusar</Button><Button disabled={busy} onClick={async () => { if (await act({ action: 'respond', id: item.id, accept: true })) setNotice('Convite aceito. Vocês agora são associados.'); }}>Aceitar convite</Button></div>)}</>}
  </div>;
}

export function InvitationAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const [openedAt] = useState(() => Date.now());
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { let cancelled = false; void fetch(`/api/collaboration?token=${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async response => {
    const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!cancelled) setInvitation(result.invitation);
  }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível carregar o convite.'); }); return () => { cancelled = true; }; }, [token]);
  return <div className="mx-auto w-full max-w-xl px-5 py-10"><h1 className="page-title">Convite para colaborar</h1>
    {error && <p role="alert" className="mt-5 text-sm text-destructive">{error}</p>}
    {!invitation && !error && <p role="status" className="mt-5">Carregando convite…</p>}
    {done ? <p role="status" className="mt-5">Resposta registrada.</p> : invitation && <div className="mt-6 grid gap-4 border-y py-6"><p>{invitation.inviterName} convidou você para ser associado no Lume.</p><p className="text-sm text-muted-foreground">A associação não libera arquivos: cada um escolhe em quais dos próprios casos o outro participa.</p>
      {invitation.status !== 'pending' || Date.parse(invitation.expiresAt) <= openedAt ? <p>Este convite já foi respondido, cancelado ou expirou.</p> : <div className="flex gap-3">{[true, false].map(accept => <Button key={String(accept)} variant={accept ? 'default' : 'ghost'} disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { await call({ action: 'respond', id: invitation.id, accept, token }); if (accept) { router.push('/app/agenda?view=associates'); router.refresh(); } else setDone(true); }
        catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível responder.'); } finally { setBusy(false); }
      }}>{accept ? 'Aceitar convite' : 'Recusar'}</Button>)}</div>}</div>}
    <Link href="/app/agenda?view=invites" className="mt-6 inline-block text-sm underline underline-offset-4">Ver meus convites</Link>
  </div>;
}
