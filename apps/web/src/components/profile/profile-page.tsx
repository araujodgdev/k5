'use client';

import Link from "next/link";

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from '@/components/lume/canvas-navigation';
import { CircleAlert } from 'lucide-react';
import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authClient } from '@/lib/auth-client';
import { avatarMaxBytes, avatarSize, profileInput, type ProfileCard, type ProfileInput } from '@/lib/profile-contract';
import { Avatar } from './avatar';
import { ProfileSummary } from './person-card';
import { DataSection, type DeletionRequest } from './data-section';
import { ProfileSectionHead } from './section-head';

type Fields = ProfileInput;
const fieldsOf = (profile: ProfileCard): Fields => ({ name: profile.name, headline: profile.headline, oab: profile.oab, location: profile.location, bio: profile.bio });

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Não foi possível salvar. Tente novamente.');
  return body.profile as ProfileCard;
}

/** Crops the middle square and redraws it small, so the server stores a light, re-encoded image. */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Não foi possível ler esta imagem. Use PNG, JPEG ou WebP.'); });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = avatarSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Seu navegador não conseguiu preparar a foto.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, avatarSize, avatarSize);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.88));
  // Browsers without a WebP encoder hand back PNG; JPEG keeps those small.
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  if (!blob || blob.size > avatarMaxBytes) throw new Error('Não foi possível reduzir a foto. Tente outra imagem.');
  return blob;
}

function FormError({ message }: { message: string }) {
  return message ? <p role="alert" className="flex items-center gap-2 text-[13.5px] text-destructive"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{message}</p> : null;
}

function Done({ message }: { message: string }) {
  return message ? <p role="status" className="text-[13.5px]">{message}</p> : null;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-subtle-foreground">{hint}</p>}
    </div>
  );
}

function authMessage(error: { status?: number; code?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.status === 429) return 'Muitas tentativas seguidas. Aguarde um minuto.';
  if (error.code === 'INVALID_PASSWORD') return 'Senha atual incorreta.';
  if (error.code === 'PASSWORD_TOO_SHORT') return 'A nova senha precisa ter pelo menos 8 caracteres.';
  if (error.code === 'PASSWORD_TOO_LONG') return 'A nova senha pode ter até 128 caracteres.';
  return fallback;
}

/** `emailConfirmation`: a new address must open a link before it replaces the current one. */
export function ProfilePage({ initial, deletion, emailConfirmation = false }: { initial: ProfileCard; deletion: DeletionRequest | null; emailConfirmation?: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(initial));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(fields) !== JSON.stringify(fieldsOf(profile));
  const set = (key: keyof Fields) => (event: { target: { value: string } }) => {
    setFields(current => ({ ...current, [key]: event.target.value }));
    setFieldErrors(current => ({ ...current, [key]: undefined }));
    setSaved('');
  };
  const invalid = (key: keyof Fields) => ({ 'aria-invalid': Boolean(fieldErrors[key]) || undefined, 'aria-describedby': fieldErrors[key] ? `profile-${key}-error` : undefined });

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = profileInput.safeParse(fields);
    if (!parsed.success) {
      const errors: Partial<Record<keyof Fields, string>> = {};
      parsed.error.issues.forEach(issue => { errors[issue.path[0] as keyof Fields] ??= issue.message; });
      setFieldErrors(errors);
      document.getElementById(`profile-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setSaving(true); setSaveError(''); setSaved('');
    try {
      const next = await send('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) });
      setProfile(next); setFields(fieldsOf(next)); setSaved('Perfil salvo.');
      router.refresh();
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true); setPhotoError('');
    try {
      const body = new FormData();
      body.append('file', await squarePhoto(file), 'foto');
      setProfile(await send('/api/profile/avatar', { method: 'POST', body }));
      router.refresh();
    } catch (error) { setPhotoError(error instanceof Error ? error.message : 'Não foi possível enviar a foto.'); }
    finally { setPhotoBusy(false); if (photoInput.current) photoInput.current.value = ''; }
  }

  async function removePhoto() {
    setPhotoBusy(true); setPhotoError('');
    try { setProfile(await send('/api/profile/avatar', { method: 'DELETE' })); router.refresh(); }
    catch (error) { setPhotoError(error instanceof Error ? error.message : 'Não foi possível remover a foto.'); }
    finally { setPhotoBusy(false); }
  }

  const preview: ProfileCard = { ...profile, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()])) as Fields };

  return (
    <CanvasPage width="wide" className="md:gap-14 [&_[data-slot=button]]:min-h-11 md:[&_[data-slot=button]]:min-h-[34px] [&_[data-slot=input]]:min-h-11 md:[&_[data-slot=input]]:min-h-9">
      <CanvasMeta title="Perfil" subject={{ kind: 'module', slug: 'profile', title: 'Perfil' }} />
      <CanvasHeader eyebrow={profile.email} title="Perfil" />

      <section aria-labelledby="profile-about" className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <div className="grid content-start gap-4">
          <ProfileSectionHead id="profile-about" title="Sobre você" />
          <Avatar name={fields.name || profile.name} src={profile.avatarUrl} className="size-24 text-2xl" />
          <div className="flex flex-wrap gap-2">
            <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => void changePhoto(event.target.files?.[0])} />
            <Button type="button" variant="outline" disabled={photoBusy} onClick={() => photoInput.current?.click()}>
              {photoBusy ? 'Enviando…' : profile.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}
            </Button>
            {profile.avatarUrl && <Button type="button" variant="ghost" disabled={photoBusy} onClick={() => void removePhoto()}>Remover</Button>}
          </div>
          <FormError message={photoError} />
          <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP. A foto é recortada em quadrado.</p>
        </div>

        <form onSubmit={save} noValidate className="grid content-start gap-4 sm:grid-cols-2">
          <Field id="profile-name" label="Nome" error={fieldErrors.name}>
            <Input id="profile-name" autoComplete="name" maxLength={120} value={fields.name} onChange={set('name')} {...invalid('name')} />
          </Field>
          <Field id="profile-headline" label="Atuação" error={fieldErrors.headline}>
            <Input id="profile-headline" maxLength={120} placeholder="Advocacia trabalhista" value={fields.headline} onChange={set('headline')} {...invalid('headline')} />
          </Field>
          <Field id="profile-oab" label="OAB" error={fieldErrors.oab}>
            <Input id="profile-oab" maxLength={40} placeholder="SP 123.456" value={fields.oab} onChange={set('oab')} {...invalid('oab')} />
          </Field>
          <Field id="profile-location" label="Cidade" error={fieldErrors.location}>
            <Input id="profile-location" autoComplete="address-level2" maxLength={120} placeholder="São Paulo, SP" value={fields.location} onChange={set('location')} {...invalid('location')} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="profile-bio" label="Sobre" error={fieldErrors.bio} hint={`${fields.bio.length} de 600 caracteres`}>
              <Textarea id="profile-bio" rows={4} maxLength={600} placeholder="Áreas, experiência, como prefere trabalhar em parceria." value={fields.bio} onChange={set('bio')} {...invalid('bio')} />
            </Field>
          </div>
          <div className="grid gap-3 sm:col-span-2">
            <FormError message={saveError} />
            <Done message={saved} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="lg" disabled={saving || !dirty}>{saving ? 'Salvando…' : 'Salvar perfil'}</Button>
              {dirty && !saving && <Button type="button" variant="ghost" onClick={() => { setFields(fieldsOf(profile)); setFieldErrors({}); }}>Descartar alterações</Button>}
            </div>
          </div>
        </form>
      </section>

      <section aria-labelledby="profile-card" className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <ProfileSectionHead id="profile-card" title="Como os outros veem">Quem pesquisa seu e-mail para convidar você a um caso ou como associado vê este resumo.</ProfileSectionHead>
        <div className="max-w-sm rounded-lg border border-border bg-card p-4"><ProfileSummary profile={preview} /></div>
      </section>

      <Access email={profile.email} emailConfirmation={emailConfirmation} onEmailChanged={email => { setProfile(current => ({ ...current, email })); router.refresh(); }} />
      <section aria-labelledby="profile-lume" className="grid gap-6 border-y border-line py-8 lg:grid-cols-[16rem_1fr]" data-reveal>
        <div className="grid content-start gap-3">
          <ProfileSectionHead title="Lume" id="profile-lume" />
          <p className="text-sm text-muted-foreground">Suas regras, conhecimentos e modelo de Word para o assistente.</p>
        </div>
        <Button asChild variant="outline" className="justify-self-start"><Link href="/app/profile/lume">Personalizar Lume</Link></Button>
      </section>
      <DataSection initial={deletion} />
    </CanvasPage>
  );
}

function Access({ email, emailConfirmation, onEmailChanged }: { email: string; emailConfirmation: boolean; onEmailChanged: (email: string) => void }) {
  return (
    <section aria-labelledby="profile-access" className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <ProfileSectionHead id="profile-access" title="Acesso">O e-mail e a senha que você usa para entrar. As duas mudanças pedem a senha atual{emailConfirmation ? ', e um novo e-mail só vale depois de confirmado' : ''}.</ProfileSectionHead>
      <div className="grid gap-10 md:grid-cols-2">
        <EmailForm email={email} confirmation={emailConfirmation} onChanged={onEmailChanged} />
        <PasswordForm />
      </div>
    </section>
  );
}

function EmailForm({ email, confirmation, onChanged }: { email: string; confirmation: boolean; onChanged: (email: string) => void }) {
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = newEmail.trim().toLowerCase();
    setError(''); setDone('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setError('Informe um e-mail válido.'); return; }
    if (next === email.toLowerCase()) { setError('Este já é o seu e-mail.'); return; }
    if (!password) { setError('Informe sua senha atual.'); return; }
    setBusy(true);
    try {
      // The body carries the current password for the server hook that guards the change.
      const result = await authClient.$fetch('/change-email', { method: 'POST', body: { newEmail: next, currentPassword: password } });
      if (result.error) throw result.error;
      // An address that already has an account is answered like a success and left unchanged.
      const session = await authClient.getSession({ query: { disableCookieCache: true } });
      if (session.data?.user.email.toLowerCase() !== next) {
        if (!confirmation) throw new Error('Este e-mail já está em uso por outra conta.');
        // The new address confirms the change; whether it belongs to another account stays private.
        setNewEmail(''); setPassword('');
        setDone(`Se ${next} puder ser usado, enviamos um link para ele. O e-mail muda quando o link for aberto; até lá, continue entrando com ${email}.`);
        return;
      }
      setNewEmail(''); setPassword(''); setDone(`Pronto. Agora você entra com ${next}.`);
      onChanged(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : authMessage(failure as { status?: number; code?: string }, 'Não foi possível alterar o e-mail.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate className="grid content-start gap-4" aria-labelledby="email-form-title">
      <div className="grid gap-1">
        <h3 id="email-form-title" className="text-sm font-medium">E-mail</h3>
        <p className="break-all font-mono text-[12.5px] text-muted-foreground">{email}</p>
      </div>
      <Field id="new-email" label="Novo e-mail">
        <Input id="new-email" type="email" autoComplete="email" maxLength={254} value={newEmail} onChange={event => setNewEmail(event.target.value)} />
      </Field>
      <Field id="email-password" label="Senha atual">
        <Input id="email-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
      </Field>
      <FormError message={error} />
      <Done message={done} />
      <Button type="submit" variant="outline" size="lg" disabled={busy} className="justify-self-start">{busy ? 'Alterando…' : 'Alterar e-mail'}</Button>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setDone('');
    if (!current) { setError('Informe sua senha atual.'); return; }
    if (next.length < 8) { setError('A nova senha precisa ter pelo menos 8 caracteres.'); return; }
    if (next !== confirm) { setError('A confirmação não é igual à nova senha.'); return; }
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revokeOthers });
      if (result.error) { setError(authMessage(result.error, 'Não foi possível alterar a senha.')); return; }
      setCurrent(''); setNext(''); setConfirm('');
      setDone(revokeOthers ? 'Senha alterada. As outras sessões foram encerradas.' : 'Senha alterada.');
    } catch { setError('Não foi possível alterar a senha. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate className="grid content-start gap-4" aria-labelledby="password-form-title">
      <div className="grid gap-1">
        <h3 id="password-form-title" className="text-sm font-medium">Senha</h3>
        <p className="text-[13px] text-muted-foreground">Pelo menos 8 caracteres.</p>
      </div>
      <Field id="current-password" label="Senha atual">
        <Input id="current-password" type="password" autoComplete="current-password" maxLength={128} value={current} onChange={event => setCurrent(event.target.value)} />
      </Field>
      <Field id="new-password" label="Nova senha">
        <Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={next} onChange={event => setNext(event.target.value)} />
      </Field>
      <Field id="confirm-password" label="Confirmar nova senha">
        <Input id="confirm-password" type="password" autoComplete="new-password" maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} />
      </Field>
      <label className="flex min-h-11 items-center gap-2.5 text-[13.5px] md:min-h-9">
        <input type="checkbox" checked={revokeOthers} onChange={event => setRevokeOthers(event.target.checked)} className="size-4 accent-foreground" />
        Encerrar a sessão nos outros dispositivos
      </label>
      <FormError message={error} />
      <Done message={done} />
      <Button type="submit" variant="outline" size="lg" disabled={busy} className="justify-self-start">{busy ? 'Alterando…' : 'Alterar senha'}</Button>
    </form>
  );
}
