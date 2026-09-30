'use client';
import { useEffect, useRef, useState } from 'react';
import { signatureConnectionDto } from '@/lib/signatures/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { controlClass, Failure, Field } from '@/components/honorarios/fields';
import { portalCall } from '@/components/client-portal/client';
import type { z } from 'zod';

export function SignatureConnection({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<z.output<typeof signatureConnectionDto> | null>(null);
  const [apiKey, setApiKey] = useState(''), [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [enabled, setEnabled] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void portalCall('/api/signatures/connection', { signal: controller.signal }).then(body => { const result = signatureConnectionDto.parse(body); setData(result); setEnvironment(result.environment); setEnabled(result.connected ? result.enabled : true); setError(''); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a conexão.'); });
    return () => controller.abort();
  }, [revision]);
  async function copyWebhook() {
    if (!data?.webhookUrl) return;
    try { await navigator.clipboard.writeText(data.webhookUrl); setNotice('URL do webhook copiada.'); setError(''); }
    catch { setError('Selecione e copie a URL do webhook.'); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!data || busy.current) return; busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = signatureConnectionDto.parse(await portalCall('/api/signatures/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() || undefined, environment, enabled, version: data.version }) }));
      setData(result); setApiKey(''); setNotice('Conexão de assinatura salva.');
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="border-t border-line pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">Assinatura eletrônica · ZapSign</h2><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => setRevision(value => value + 1)}>Atualizar conexão</Button></div>
    <p className="my-4 text-sm text-muted-foreground">Solicite a assinatura de PDFs publicados no Portal do cliente. A conta ZapSign precisa ter acesso à API; os custos são cobrados pelo provedor.</p>
    {!data ? <p role="status">{error ? 'Conexão indisponível.' : 'Carregando conexão…'}</p> : <><p className="mb-4 text-sm">{data.connected ? data.enabled ? 'Conexão cadastrada' : 'Novas solicitações desativadas' : 'Nenhuma conexão cadastrada'}</p>
      {canManage ? <form onSubmit={save} className="grid max-w-xl gap-4"><fieldset disabled={pending} className="grid gap-4"><Field label="Ambiente da conta ZapSign">{id => <select id={id} className={controlClass} value={environment} onChange={event => setEnvironment(event.target.value === 'production' ? 'production' : 'sandbox')}><option value="sandbox">Teste · sem assinatura de produção</option><option value="production">Produção</option></select>}</Field>
        <Field label={data.connected ? 'Nova chave de API (deixe vazio para manter)' : 'Chave de API ZapSign'}>{id => <Input id={id} className="min-h-11" type="password" autoComplete="new-password" maxLength={512} required={!data.connected} value={apiKey} onChange={event => setApiKey(event.target.value)} />}</Field>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Permitir novas solicitações de assinatura</label><Button className="min-h-11 justify-self-start" type="submit">{pending ? 'Salvando…' : 'Salvar conexão'}</Button></fieldset></form> : <p className="text-sm text-muted-foreground">O administrador do escritório configura esta conexão.</p>}</>}
    {canManage && data?.connected && <div className="mt-6 grid max-w-xl gap-3 border-t pt-4"><h3 className="text-sm font-medium">Webhook ZapSign</h3>
      {data.webhookUrl ? <><Field label="URL do webhook">{id => <Input id={id} className="min-h-11" readOnly value={data.webhookUrl ?? ''} onFocus={event => event.currentTarget.select()} />}</Field>
        <Button className="min-h-11 justify-self-start" variant="outline" onClick={() => void copyWebhook()}>Copiar URL do webhook</Button>
        <p className="text-sm text-muted-foreground">Na ZapSign, escolha Todos (documentos), deixe os condicionais vazios e habilite 5 tentativas com intervalo de 5 minutos. A URL já contém o segredo deste escritório. O Lume confirma o resultado pela API antes de guardar o PDF assinado.</p></>
        : <p className="text-sm text-muted-foreground">Salve a conexão para gerar a URL do webhook deste escritório.</p>}</div>}
    <Failure message={error} />{notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
  </section>;
}
