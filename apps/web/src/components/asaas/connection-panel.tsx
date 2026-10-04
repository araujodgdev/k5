'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { asaasAccountStatusLabel, asaasEnvironmentLabel, asaasStatus, asaasWebhookLabel, type AsaasStatus } from '@/lib/asaas/contracts';

const apiFailure = z.object({ error: z.string() });

async function readStatus(signal?: AbortSignal) {
  const response = await fetch('/api/asaas/connection', { cache: 'no-store', signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiFailure.safeParse(body).data?.error ?? 'Não foi possível carregar a conexão do Asaas.');
  return asaasStatus.parse(body);
}

export function AsaasConnectionPanel() {
  const [status, setStatus] = useState<AsaasStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) setStatus(value);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a conexão do Asaas.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE') {
    if (!status || pending) return;
    setPending(true); setError(''); setNotice('');
    const body = { expectedVersion: status.connection?.version ?? null, ...(method === 'POST' ? { apiKey } : {}) };
    setApiKey('');
    try {
      const response = await fetch('/api/asaas/connection', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiFailure.safeParse(result).data?.error ?? 'Não foi possível concluir. Tente novamente.');
      setStatus(asaasStatus.parse(result));
      setEditKey(false); setConfirmDisconnect(false);
      setNotice(method === 'DELETE' ? 'Conta do Asaas desconectada do Lume.' : 'Acesso à conta do Asaas verificado.');
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { setPending(false); }
  }

  const connection = status?.connection;
  return <section aria-labelledby="asaas-connection-title" className="space-y-4 border-t border-line pt-8 [&_button]:min-h-11 md:[&_button]:min-h-9">
    <div>
      <h2 id="asaas-connection-title" className="text-lg font-medium">Asaas</h2>
      <p className="mt-1 text-sm text-muted-foreground">Conecte a conta do Asaas do escritório para cobrar as parcelas dos honorários com PIX, boleto ou cartão.</p>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{error}</p>
      {!status && <Button variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(''); setRevision(value => value + 1); }}>Tentar novamente</Button>}</div>}
    {loading && !status ? <p role="status" className="text-sm text-muted-foreground">Carregando conexão…</p> : status && <>
      {connection ? <dl className="border-y border-line text-sm">
        {[
          ['Conta', connection.account.name],
          ['CPF ou CNPJ', connection.account.document ?? 'Não informado'],
          ['Ambiente', asaasEnvironmentLabel(connection.environment)],
          ['Situação da conta', asaasAccountStatusLabel(connection.account.status)],
          ['Baixa automática', asaasWebhookLabel(connection.webhook)],
          ['Última verificação', new Date(connection.verifiedAt).toLocaleString('pt-BR')],
        ].map(([label, value]) => <div key={label} className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd>
        </div>)}
      </dl> : <p className="text-sm text-muted-foreground">Nenhuma conta do Asaas conectada.</p>}
      {connection && status.canManage && <div className="flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => void mutate('PATCH')}>{pending ? 'Aguarde…' : 'Verificar novamente'}</Button>
        <Button variant="outline" disabled={pending} aria-expanded={editKey} onClick={() => { setEditKey(value => !value); setApiKey(''); }}>Atualizar chave</Button>
        <Button variant="outline" disabled={pending} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
      </div>}
      {status.canManage && (!connection || editKey) && <form className="grid max-w-xl gap-4" onSubmit={event => { event.preventDefault(); void mutate('POST'); }}>
        <div className="grid gap-1.5">
          <Label htmlFor="asaas-api-key">Chave de API do Asaas</Label>
          <Input id="asaas-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={400} required disabled={pending}
            className="h-11 md:h-9" value={apiKey} onChange={event => setApiKey(event.target.value)} aria-describedby="asaas-key-help" />
          <p id="asaas-key-help" className="text-sm text-muted-foreground">Crie a chave no Asaas, em Integrações › Chaves de API, e cole-a completa, começando por $aact_. Uma chave de sandbox conecta o ambiente de testes. A chave é guardada criptografada e não aparece de novo.</p>
        </div>
        <Button type="submit" className="justify-self-start" disabled={pending || !apiKey.trim()}>{pending ? 'Verificando…' : connection ? 'Verificar e atualizar chave' : 'Verificar e conectar'}</Button>
      </form>}
      {!status.canManage && <p className="text-sm text-muted-foreground">Um administrador do escritório pode conectar a conta do Asaas.</p>}
    </>}
    <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
      <DialogContent>
        <DialogHeader><DialogTitle>Desconectar o Asaas?</DialogTitle><DialogDescription>O Lume apaga a chave e deixa de criar cobranças nesta conta. As cobranças já emitidas continuam no Asaas e podem ser pagas normalmente. A chave não é revogada no Asaas.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button><Button disabled={pending} onClick={() => void mutate('DELETE')}>{pending ? 'Desconectando…' : 'Desconectar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
