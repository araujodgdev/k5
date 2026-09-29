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

type Person = { id: string; name: string; email: string; role?: string; canInvite?: boolean; avatarVersion?: string | null };
type Invitation = { id: string; kind: string; email: string; role: string; canInvite: boolean; status: string; expiresAt: string; officeName: string; caseName: string | null; inviterName: string };
type Overview = { members: Person[]; associates: Person[]; participants: Person[]; incoming: Invitation[]; outgoing: Invitation[];
  history: { id: string; action: string; createdAt: string; actorName: string; targetName: string | null }[];
  canManage: boolean; canAssociate: boolean; canManageParticipants: boolean; external: boolean; caseRole?: string; viewerId: string };
const roleLabels: Record<string, string> = { administrator: 'Administrador', lawyer: 'Advogado', reviewer: 'Revisor', viewer: 'Consulta', editor: 'Colaboração' };
const kindLabels: Record<string, string> = { team: 'Equipe', associate: 'Associação', case: 'Caso' };
// A history line reads as a sentence after the actor's name: "criou um convite para Rafael", "removeu Rafael da equipe".
const historyActions: Record<string, (target: string | null) => string> = {
  'invitation.created': target => target ? `criou um convite para ${target}` : 'criou um convite',
  'invitation.accepted': () => 'aceitou o convite',
  'invitation.declined': () => 'recusou o convite',
  'invitation.revoked': target => target ? `cancelou o convite de ${target}` : 'cancelou um convite',
  'member.updated': target => `alterou o papel de ${target ?? 'uma pessoa'}`,
  'member.removed': target => `removeu ${target ?? 'uma pessoa'} da equipe`,
  'participant.updated': target => `alterou o acesso de ${target ?? 'uma pessoa'}`,
  'participant.removed': target => `removeu ${target ?? 'uma pessoa'} do caso`,
  'associate.removed': target => `removeu ${target ?? 'uma pessoa'} dos associados`,
};
const historyLine = (action: string, target: string | null) => historyActions[action]?.(target) ?? `${action} ${target ?? ''}`;
const selectClass = 'min-h-11 max-w-full border border-input bg-background px-3 text-sm md:min-h-9';

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
  return result as { path?: string; deliveredInApp?: boolean; caseId?: string | null };
}

export function CollaborationPanel({ view = 'team', caseId }: { view?: 'team' | 'associates' | 'invites'; caseId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(caseId ? 'viewer' : 'lawyer');
  const [canInvite, setCanInvite] = useState(false);
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
    const kind = caseId ? 'case' : view === 'associates' ? 'associate' : 'team';
    const result = await act({ action: 'invite', invitation: { kind, email: email.trim(), ...(kind !== 'associate' ? { role } : {}), ...(caseId ? { caseId, canInvite } : {}) } });
    if (result?.path) {
      setLink(`${window.location.origin}${result.path}`); setEmail(''); setFormOpen(false);
      setNotice(result.deliveredInApp ? 'Convite disponível na conta da pessoa. Você também pode compartilhar o link.' : 'Convite criado. Copie o link e envie para a pessoa. Não enviamos um e-mail.');
    }
  }
  const canSend = caseId ? data?.canManage : view === 'team' ? data?.canManage : view === 'associates' ? data?.canAssociate : false;
  const people = caseId ? data?.participants : view === 'team' ? data?.members : data?.associates;
  const outgoing = data?.outgoing.filter(item => caseId || item.kind === (view === 'team' ? 'team' : 'associate')) ?? [];
  const remove = (person: Person) => ({ action: caseId ? 'participant' : view === 'team' ? 'member' : 'associate', userId: person.id, ...(caseId ? { caseId } : {}), ...(view === 'team' || caseId ? { role: null } : {}) });
  return <div className={caseId ? 'min-w-0 [&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9' : 'flex min-w-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10 [&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-9'}>
    {!caseId && <><h1 className="page-title border-b pb-5 max-md:sr-only">Escritório</h1><OfficeNavigation view={view} /></>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{caseId ? 'A equipe do escritório tem acesso a este caso. Convide parceiros para participar com acesso restrito a ele.' : view === 'team' ? 'A equipe acessa os casos, arquivos e atividades compartilhados do escritório, conforme o papel.' : view === 'associates' ? 'Seus parceiros no Lume. A associação facilita novos convites; o acesso aos arquivos depende da participação em cada caso.' : 'Convites recebidos em sua conta, de todos os escritórios.'}</p>
      {canSend && <Button disabled={busy} onClick={() => setFormOpen(value => !value)} aria-expanded={formOpen}>{formOpen ? 'Fechar convite' : caseId ? 'Convidar participante' : view === 'team' ? 'Convidar para equipe' : 'Convidar associado'}</Button>}
    </div>
    {error && <p role="alert" className="py-3 text-sm text-destructive">{error} <Button variant="ghost" onClick={() => void refresh()}>Tentar novamente</Button></p>}
    {notice && <p role="status" className="py-3 text-sm">{notice}</p>}
    {link && <div className="flex flex-wrap gap-2 border-b pb-4"><Input aria-label="Link do convite" value={link} readOnly className="min-w-0 flex-1" /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(link); setNotice('Link copiado.'); } catch { setNotice('Selecione e copie o link acima.'); } }}>Copiar link</Button></div>}
    {formOpen && canSend && <form onSubmit={submit} className="grid gap-4 border-b py-5 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor="invite-email">E-mail da pessoa</Label><Input id="invite-email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} list={caseId ? 'associate-emails' : undefined} autoFocus />
        <InviteeHint email={email} />
        {caseId && <datalist id="associate-emails">{data?.associates.map(person => <option key={person.id} value={person.email}>{person.name}</option>)}</datalist>}
      </div>
      {(caseId || view === 'team') && <div className="grid gap-1.5"><Label htmlFor="invite-role">{caseId ? 'Permissão' : 'Papel no escritório'}</Label><select id="invite-role" value={role} onChange={event => setRole(event.target.value)} className={selectClass}>{(caseId ? (data?.external && data.caseRole === 'reviewer' ? ['viewer'] : ['viewer', 'editor']) : ['lawyer', 'reviewer', 'administrator']).map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></div>}
      {caseId && !data?.external && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={canInvite} onChange={event => setCanInvite(event.target.checked)} className="size-5 accent-primary" />Pode convidar outras pessoas para este caso</label>}
      <p className="text-sm text-muted-foreground sm:col-span-2">{caseId ? 'Consulta permite ler e baixar. Colaboração também permite enviar, editar e remover arquivos. O convite expira em 7 dias.' : 'O convite expira em 7 dias. A pessoa precisa entrar com este e-mail para aceitar.'}</p>
      <Button type="submit" disabled={busy} className="justify-self-start">{busy ? 'Criando convite…' : 'Criar convite'}</Button>
    </form>}
    {loading && !data && <p role="status" className="py-8 text-sm text-muted-foreground">Carregando pessoas e convites…</p>}
    {data && view !== 'invites' && <>
      {caseId && data.members.length > 0 && <details className="border-b py-4"><summary className="cursor-pointer text-sm">Equipe do escritório ({data.members.length})</summary>{data.members.map(person => <p key={person.id} className="pt-3 text-sm">{person.name} <span className="text-muted-foreground">— {roleLabels[person.role ?? '']}</span></p>)}</details>}
      {people?.length === 0 && <p className="py-8 text-sm text-muted-foreground">{caseId ? 'Nenhum participante externo neste caso.' : view === 'associates' ? 'Nenhum associado ainda. Convide um parceiro pelo e-mail.' : 'Nenhum membro encontrado.'}</p>}
      {people?.map(person => { const manageable = (caseId ? data.canManageParticipants : view === 'team' ? data.canManage : data.canAssociate) && person.id !== data.viewerId; return <div key={person.id} className="flex flex-wrap items-center gap-3 border-b py-4">
        <div className="flex min-w-0 basis-full items-start gap-3 sm:basis-auto sm:flex-1"><Avatar name={person.name} src={avatarUrl(person.id, person.avatarVersion ?? null)} /><div className="min-w-0"><p className="break-words text-sm font-medium">{person.name}{person.id === data.viewerId && <span className="font-normal text-muted-foreground"> · você</span>}</p><PersonHoverCard email={person.email} className="text-[13px] text-muted-foreground" />{/* With the controls on the row, the role shows once: in its select. */}{person.role && !manageable && <p className="mt-1 text-[13px] text-muted-foreground">{roleLabels[person.role]}{person.canInvite ? ' · Pode convidar' : ''}</p>}</div></div>
        {/* Your own row has no controls: another administrator changes or removes your access. */}
        {manageable && <div className="flex flex-wrap items-center gap-2">
          {person.role && <select aria-label={`Papel de ${person.name}`} className={selectClass} value={person.role} disabled={busy} onChange={event => void act({ action: caseId ? 'participant' : 'member', userId: person.id, role: event.target.value, ...(caseId ? { caseId, canInvite: person.canInvite } : {}) })}>{(caseId ? ['viewer', 'editor'] : ['administrator', 'lawyer', 'reviewer']).map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>}
          {caseId && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={`Permitir que ${person.name} convide`} checked={Boolean(person.canInvite)} disabled={busy} onChange={event => void act({ action: 'participant', caseId, userId: person.id, role: person.role, canInvite: event.target.checked })} />Pode convidar</label>}
          <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" disabled={busy}>Remover</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remover {person.name}?</AlertDialogTitle><AlertDialogDescription>{view === 'associates' && !caseId ? 'A pessoa sai da lista de associados. A participação nos casos permanece e pode ser removida em cada caso.' : caseId ? 'O acesso a este caso será revogado. Arquivos e alterações já feitos permanecem.' : 'O acesso a este escritório será revogado. Os arquivos e o escritório pessoal da pessoa permanecem.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void act(remove(person))}>Remover acesso</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </div>}
      </div>; })}
      {outgoing.length > 0 && <section className="mt-8"><h2 className="text-lg">Convites pendentes</h2>{outgoing.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b py-4"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><PersonHoverCard email={item.email} className="text-sm" /><p className="mt-1 text-[13px] text-muted-foreground">{roleLabels[item.role]} · Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'cancel', id: item.id })}>Cancelar convite</Button></div>)}</section>}
    </>}
    {data && view === 'invites' && <>{data.incoming.length === 0 && <p className="py-8 text-sm text-muted-foreground">Nenhum convite pendente para sua conta.</p>}{data.incoming.map(item => <div key={item.id} className="flex flex-wrap items-center gap-4 border-b py-5"><div className="min-w-0 basis-full sm:basis-auto sm:flex-1"><p className="text-sm font-medium">{item.caseName ?? item.officeName}</p><p className="mt-1 text-sm text-muted-foreground">{kindLabels[item.kind]} · {item.inviterName} · {item.kind !== 'associate' ? roleLabels[item.role] : 'Sem acesso a arquivos'}</p><p className="mt-1 text-[13px] text-muted-foreground">Expira em {new Date(item.expiresAt).toLocaleDateString('pt-BR')}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'respond', id: item.id, accept: false })}>Recusar</Button><Button disabled={busy} onClick={async () => { const result = await act({ action: 'respond', id: item.id, accept: true }); if (result) { setNotice('Convite aceito.'); if (result.caseId) router.push(`/app/vault/cases/${result.caseId}`); } }}>Aceitar convite</Button></div>)}</>}
    {data && !caseId && view !== 'invites' && data.incoming.length > 0 && <Link href="/app/agenda?view=invites" className="my-5 text-sm underline underline-offset-4">Você tem {data.incoming.length} convite(s) para responder.</Link>}
    {data && data.history.length > 0 && <details className="mt-8"><summary className="cursor-pointer py-3 text-sm">Histórico de acessos</summary>{data.history.map(item => <p key={item.id} className="border-b py-3 text-sm">{item.actorName} {historyLine(item.action, item.targetName)}<span className="mt-1 block text-[13px] text-muted-foreground">{new Date(item.createdAt).toLocaleString('pt-BR')}</span></p>)}</details>}
  </div>;
}

export function InvitationAcceptance({ token }: { token: string }) {
  const [openedAt] = useState(() => Date.now());
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { let cancelled = false; void fetch(`/api/collaboration?token=${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async response => {
    const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!cancelled) setInvitation(result.invitation);
  }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível carregar o convite.'); }); return () => { cancelled = true; }; }, [token]);
  return <div className="mx-auto w-full max-w-xl px-5 py-10"><h1 className="page-title">Convite para colaborar</h1>
    {error && <p role="alert" className="mt-5 text-sm text-destructive">{error}</p>}
    {!invitation && !error && <p role="status" className="mt-5">Carregando convite…</p>}
    {done ? <p role="status" className="mt-5">Resposta registrada.</p> : invitation && <div className="mt-6 grid gap-4 border-y py-6"><p>{invitation.inviterName} convidou você para {invitation.caseName ?? invitation.officeName}.</p><p className="text-sm text-muted-foreground">{kindLabels[invitation.kind]} · {invitation.kind === 'associate' ? 'A associação não libera arquivos.' : roleLabels[invitation.role]}</p>
      {invitation.status !== 'pending' || Date.parse(invitation.expiresAt) <= openedAt ? <p>Este convite já foi respondido, cancelado ou expirou.</p> : <div className="flex gap-3">{[true, false].map(accept => <Button key={String(accept)} variant={accept ? 'default' : 'ghost'} disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { const result = await call({ action: 'respond', id: invitation.id, accept, token }); if (accept) window.location.assign(result.caseId ? `/app/vault/cases/${result.caseId}` : '/app/agenda?view=team'); else setDone(true); }
        catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível responder.'); } finally { setBusy(false); }
      }}>{accept ? 'Aceitar convite' : 'Recusar'}</Button>)}</div>}</div>}
    <Link href="/app/agenda?view=invites" className="mt-6 inline-block text-sm underline underline-offset-4">Ver meus convites</Link>
  </div>;
}
