'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BetaLabel } from './beta-label';
import { adsStatus, adsStatusLabel, type AdsStatus } from '@/lib/ads/contracts';

const apiFailure = z.object({ error: z.string() });

async function readStatus(signal?: AbortSignal) {
  const response = await fetch('/api/ads/connection', { cache: 'no-store', signal });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(apiFailure.safeParse(body).data?.error ?? 'Não foi possível carregar a conexão.');
  return adsStatus.parse(body);
}

export function AdsConnection() {
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function reload() {
    setLoading(true); setError('');
    try {
      setStatus(await readStatus());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a conexão.');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void readStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) setStatus(value);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a conexão.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE') {
    if (!status || pending) return;
    setPending(true); setError(''); setNotice('');
    const body = { expectedVersion: status.connection?.version ?? null, ...(method === 'POST' ? { apiKey } : {}) };
    setApiKey('');
    try {
      const response = await fetch('/api/ads/connection', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(apiFailure.safeParse(result).data?.error ?? 'Não foi possível concluir. Tente novamente.');
      setStatus(adsStatus.parse(result));
      setEditKey(false); setConfirmDisconnect(false);
      setNotice(method === 'DELETE' ? 'Conexão removida do Lume.' : 'Acesso à conta verificado.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { setPending(false); }
  }

  const connection = status?.connection;
  return <div className="px-5 py-6 md:px-10 md:py-10">
    <header className="mb-8 flex items-center gap-3 max-md:sr-only">
      <h1 className="page-title">Anúncios</h1><BetaLabel />
    </header>
    <section aria-labelledby="ads-account-title" className="max-w-3xl">
      <h2 id="ads-account-title" className="text-2xl tracking-tight">Conta do ChatGPT Ads</h2>
      <p className="mt-2 text-sm text-muted-foreground">Conecte a conta de anúncios do escritório e confira o acesso à OpenAI.</p>
      <p className="mt-2 text-sm text-muted-foreground">Este beta permite validar a conexão. Criação, publicação e gestão de campanhas ainda não estão disponíveis no Lume.</p>
      {notice && <p role="status" className="mt-5 text-sm">{notice}</p>}
      {error && <div className="mt-5 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="lg" disabled={pending || loading} onClick={() => void reload()}>Recarregar conexão</Button></div>}
      {loading ? <p role="status" className="mt-6 text-sm text-muted-foreground">Carregando conexão…</p> : status && <>
        {connection ? <>
          <dl className="mt-6 border-y border-line text-sm">
            {[
              ['Conta', connection.account.name], ['Identificador', connection.account.id],
              ['Moeda', connection.account.currency_code], ['Fuso horário', connection.account.timezone],
              ['Situação da conta', adsStatusLabel(connection.account.status)],
              ['Revisão da marca', adsStatusLabel(connection.account.review?.status)],
              ['Revisão da conta', adsStatusLabel(connection.account.account_integrity_review?.review?.status)],
              ['Última verificação', new Date(connection.verifiedAt).toLocaleString('pt-BR')],
            ].map(([label, value]) => <div key={label} className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">O acesso à API não confirma a liberação para veicular anúncios. Países disponíveis, revisões e condições de veiculação precisam ser conferidos no OpenAI Ads.</p>
          {status.canManage && <div className="mt-5 flex flex-wrap gap-3">
            <Button size="lg" disabled={pending} onClick={() => void mutate('PATCH')}>{pending ? 'Aguarde…' : 'Verificar novamente'}</Button>
            <Button size="lg" variant="outline" disabled={pending} onClick={() => { setEditKey(value => !value); setApiKey(''); }}>Atualizar chave</Button>
            <Button size="lg" variant="ghost" disabled={pending} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
          </div>}
          {confirmDisconnect && <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm">Desconectar remove a chave do Lume. Campanhas existentes continuam no OpenAI Ads; esta ação não pausa anúncios nem revoga a chave na OpenAI.</p>
            <div className="mt-3 flex flex-wrap gap-3"><Button variant="destructive" size="lg" disabled={pending} onClick={() => void mutate('DELETE')}>Confirmar desconexão</Button>
              <Button variant="ghost" size="lg" disabled={pending} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button></div>
          </div>}
        </> : <p className="mt-6 border-y border-line py-5 text-sm">Nenhuma conta de anúncios conectada.</p>}
        {status.canManage && (!connection || editKey) && <form className="mt-6 grid gap-4" onSubmit={event => { event.preventDefault(); void mutate('POST'); }}>
          <div className="grid gap-1.5">
            <Label htmlFor="ads-api-key">Chave da Ads API</Label>
            <Input id="ads-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={2000} required disabled={pending}
              className="h-11 md:h-9" value={apiKey} onChange={event => setApiKey(event.target.value)} aria-describedby="ads-key-help" />
            <p id="ads-key-help" className="text-sm text-muted-foreground">Use a chave da conta do escritório, criada nas configurações do OpenAI Ads. Ela será armazenada criptografada e não será exibida novamente.</p>
          </div>
          <Button type="submit" size="lg" className="justify-self-start" disabled={pending || !apiKey.trim()}>{pending ? 'Verificando…' : connection ? 'Verificar e atualizar chave' : 'Verificar e conectar'}</Button>
        </form>}
        {!status.canManage && <p className="mt-5 text-sm text-muted-foreground">Um administrador do escritório pode conectar e verificar a conta.</p>}
      </>}
      <a href="https://ads.openai.com" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Abrir OpenAI Ads</a>
    </section>
  </div>;
}
