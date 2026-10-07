'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { OfficeNavigation } from './office-navigation';
import { Avatar } from './profile/avatar';
import { lookupProfile, PersonHoverCard } from './profile/person-card';
import { avatarUrl, type ProfileCard } from '@/lib/profile-contract';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { collaborationLine as historyLine } from '@/lib/audit-format';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

type Person = { id: string; name: string; email: string; avatarVersion?: string | null };
type Invitation = { id: string; email: string; status: string; expiresAt: string; inviterName: string };
type Overview = { associates: Person[]; incoming: Invitation[]; outgoing: Invitation[];
  history: { id: string; action: string; createdAt: string; actorName: string; targetName: string | null }[];
  viewerId: string };

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

/** A person as the share dialog draws one (`Compartilhar`): initials, the name over the e-mail, a quiet action on the right. */
function PersonRow({ person, viewerId, children }: { person: Person; viewerId: string; children?: React.ReactNode }) {
  return <div className="flex min-h-12 items-center gap-3 py-1">
    <Avatar name={person.name} src={avatarUrl(person.id, person.avatarVersion ?? null)} className="size-8 text-[11.5px] font-semibold" />
    <div className="flex min-w-0 flex-1 flex-col gap-px">
      <p className="truncate text-sm">{person.name}{person.id === viewerId && " (você)"}</p>
      <PersonHoverCard email={person.email} className="truncate text-[12.5px] text-muted-foreground" />
    </div>
    {children}
  </div>;
}

function ConfirmRemoval({ title, description, action, busy, onConfirm }: { title: string; description: string; action: string; busy: boolean; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="px-2 text-[13px] text-muted-foreground hover:text-foreground md:h-[30px]" disabled={busy}>{action}</Button></AlertDialogTrigger><AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}

export function CollaborationPanel({ view = 'associates' }: { view?: 'associates' | 'invites' }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/collaboration', { cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(next); setError('');
    } catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Não foi possível carregar.'); }
    finally { setLoading(false); }
  }, []);
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
  const feedback = <>
    {error && <p role="alert" className="py-3 text-sm text-destructive">{error} <Button variant="ghost" onClick={() => void refresh()}>Tentar novamente</Button></p>}
    {notice && <p role="status" className="py-3 text-sm">{notice}</p>}
  </>;
  const history = data && data.history.length > 0 && <details className="mt-8"><summary className="cursor-pointer py-3 text-sm">Histórico de acessos</summary>{data.history.map(item => <p key={item.id} className="border-b py-3 text-sm">{item.actorName} {historyLine(item.action, item.targetName)}<span className="mt-1 block text-[13px] text-muted-foreground">{new Date(item.createdAt).toLocaleString('pt-BR')}</span></p>)}</details>;
  const buttonSize = '[&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9';

  return <CanvasPage className={`gap-5 md:gap-5 ${buttonSize}`}>
    <CanvasHeader title={view === 'associates' ? 'Associados' : 'Convites'}
      eyebrow={view === 'associates' ? 'Advogados que trabalham com você. Cada um pode incluir o outro como participante nos próprios casos.' : 'Convites de associação recebidos em sua conta.'}
      actions={view === 'associates' && <Button variant="outline" size="lg" disabled={busy} onClick={() => setFormOpen(value => !value)} aria-expanded={formOpen}>{formOpen ? 'Fechar convite' : 'Convidar associado'}</Button>} />
    <OfficeNavigation view={view} />
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
      {data.associates.length > 0 && <div className="flex flex-col gap-0.5">{data.associates.map(person => <PersonRow key={person.id} person={person} viewerId={data.viewerId}>
        <ConfirmRemoval busy={busy} action="Remover" title={`Remover ${person.name} dos associados?`}
          description="Vocês deixam de ser associados e cada um sai dos casos do outro. Arquivos e alterações já feitos permanecem."
          onConfirm={() => void act({ action: 'associate', userId: person.id })} />
      </PersonRow>)}</div>}
      {data.outgoing.length > 0 && <section className="mt-8"><h2 className="text-lg">Convites pendentes</h2>{data.outgoing.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b py-4"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><PersonHoverCard email={item.email} className="text-sm" /><p className="mt-1 text-[13px] text-muted-foreground">Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'cancel', id: item.id })}>Cancelar convite</Button></div>)}</section>}
      {data.incoming.length > 0 && <Link href="/app/agenda?view=invites" className="my-5 text-sm underline underline-offset-4">Você tem {data.incoming.length === 1 ? '1 convite' : `${data.incoming.length} convites`} para responder.</Link>}
      {history}
    </>}
    {data && view === 'invites' && <>{data.incoming.length === 0 && <p className="py-8 text-sm text-subtle-foreground">Nenhum convite pendente para sua conta.</p>}{data.incoming.map(item => <div key={item.id} className="flex flex-wrap items-center gap-4 border-b py-5"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><p className="text-sm font-medium">{item.inviterName}</p><p className="mt-1 text-sm text-muted-foreground">Convidou você para ser associado</p><p className="mt-1 text-[13px] text-muted-foreground">Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'respond', id: item.id, accept: false })}>Recusar</Button><Button disabled={busy} onClick={async () => { if (await act({ action: 'respond', id: item.id, accept: true })) setNotice('Convite aceito. Vocês agora são associados.'); }}>Aceitar convite</Button></div>)}</>}
  </CanvasPage>;
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
