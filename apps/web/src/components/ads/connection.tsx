'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArrowUpRight } from 'lucide-react';
import { BetaLabel } from '@/components/ads/beta-label';
import { CanvasHeader, CanvasPage, CanvasSection } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const quiet = 'text-[13.5px] text-muted-foreground';
  const control = 'h-11 md:h-[34px]';
  return <CanvasPage className="md:gap-8">
    <CanvasMeta title="Anúncios" subject={{ kind: 'module', slug: 'ads', title: 'Anúncios' }} />
    <CanvasHeader eyebrow={<span className="flex items-center gap-2">Conta de anúncios do escritório<BetaLabel /></span>} title="Anúncios"
      actions={<Button asChild variant="outline" size="lg" className={control}><a href="https://ads.openai.com" target="_blank" rel="noopener noreferrer">Abrir OpenAI Ads<ArrowUpRight className="size-3.5" aria-hidden="true" /><span className="sr-only">, abre em nova aba</span></a></Button>} />
    <CanvasSection title="Conta do ChatGPT Ads" label="Conta do ChatGPT Ads">
      <p className={quiet}>Conecte a conta de anúncios do escritório e confira o acesso à OpenAI. Este beta valida a conexão; criação, publicação e gestão de campanhas ainda não estão disponíveis no Lume.</p>
      {notice && <p role="status" className="text-[13.5px]">{notice}</p>}
      {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{error}</p>
        <Button variant="outline" size="lg" className={control} disabled={pending || loading} onClick={() => void reload()}>Recarregar conexão</Button></div>}
      {loading ? <p role="status" className={quiet}>Carregando conexão…</p> : status && <>
        {connection ? <>
          <dl className="flex flex-col text-[13.5px]">
            {[
              ['Conta', connection.account.name], ['Identificador', connection.account.id],
              ['Moeda', connection.account.currency_code], ['Fuso horário', connection.account.timezone],
              ['Situação da conta', adsStatusLabel(connection.account.status)],
              ['Revisão da marca', adsStatusLabel(connection.account.review?.status)],
              ['Revisão da conta', adsStatusLabel(connection.account.account_integrity_review?.review?.status)],
              ['Última verificação', new Date(connection.verifiedAt).toLocaleString('pt-BR')],
            ].map(([label, value]) => <div key={label} className="grid gap-0.5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd>
            </div>)}
          </dl>
          <p className="text-xs text-muted-foreground">O acesso à API não confirma a liberação para veicular anúncios. Países disponíveis, revisões e condições de veiculação precisam ser conferidos no OpenAI Ads.</p>
          {status.canManage && <div className="flex flex-wrap gap-2">
            <Button size="lg" className={control} disabled={pending} onClick={() => void mutate('PATCH')}>{pending ? 'Aguarde…' : 'Verificar novamente'}</Button>
            <Button size="lg" variant="outline" className={control} disabled={pending} onClick={() => { setEditKey(value => !value); setApiKey(''); }}>Atualizar chave</Button>
            <Button size="lg" variant="ghost" className={control} disabled={pending} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
          </div>}
          {confirmDisconnect && <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <p className="text-[13.5px]">Desconectar remove a chave do Lume. Campanhas existentes continuam no OpenAI Ads; esta ação não pausa anúncios nem revoga a chave na OpenAI.</p>
            <div className="flex flex-wrap gap-2"><Button variant="destructive" size="lg" className={control} disabled={pending} onClick={() => void mutate('DELETE')}>Confirmar desconexão</Button>
              <Button variant="ghost" size="lg" className={control} disabled={pending} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button></div>
          </div>}
        </> : <p className={quiet}>Nenhuma conta de anúncios conectada.</p>}
        {status.canManage && (!connection || editKey) && <form className="flex max-w-xl flex-col items-start gap-3" onSubmit={event => { event.preventDefault(); void mutate('POST'); }}>
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="ads-api-key" className="text-xs font-normal text-muted-foreground">Chave da Ads API</Label>
            <Input id="ads-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={2000} required disabled={pending}
              className="h-11 md:h-9" value={apiKey} onChange={event => setApiKey(event.target.value)} aria-describedby="ads-key-help" />
            <p id="ads-key-help" className="text-xs leading-5 text-muted-foreground">Use a chave da conta do escritório, criada nas configurações do OpenAI Ads. Ela será armazenada criptografada e não será exibida novamente.</p>
          </div>
          <Button type="submit" size="lg" className={control} disabled={pending || !apiKey.trim()}>{pending ? 'Verificando…' : connection ? 'Verificar e atualizar chave' : 'Verificar e conectar'}</Button>
        </form>}
        {!status.canManage && <p className={quiet}>Um administrador do escritório pode conectar e verificar a conta.</p>}
      </>}
    </CanvasSection>
  </CanvasPage>;
}
