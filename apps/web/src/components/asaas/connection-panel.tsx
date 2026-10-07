'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CanvasSection } from '@/components/canvas/canvas-page';
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
  const quiet = 'text-[13.5px] text-muted-foreground';
  const control = 'h-11 md:h-[34px]';
  return <CanvasSection title="Asaas" label="Asaas" action={connection && <span className="truncate text-[13px] text-muted-foreground">{asaasEnvironmentLabel(connection.environment)}</span>}>
    <p className={quiet}>Conecte a conta do Asaas do escritório para cobrar as parcelas dos honorários com PIX, boleto ou cartão.</p>
    {notice && <p role="status" className="text-[13.5px]">{notice}</p>}
    {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13.5px] text-destructive">{error}</p>
      {!status && <Button variant="outline" size="lg" className={control} disabled={loading} onClick={() => { setLoading(true); setError(''); setRevision(value => value + 1); }}>Tentar novamente</Button>}</div>}
    {loading && !status ? <p role="status" className={quiet}>Carregando conexão…</p> : status && <>
      {connection ? <dl className="flex flex-col text-[13.5px]">
        {[
          ['Conta', connection.account.name],
          ['CPF ou CNPJ', connection.account.document ?? 'Não informado'],
          ['Ambiente', asaasEnvironmentLabel(connection.environment)],
          ['Situação da conta', asaasAccountStatusLabel(connection.account.status)],
          ['Baixa automática', asaasWebhookLabel(connection.webhook)],
          ['Última verificação', new Date(connection.verifiedAt).toLocaleString('pt-BR')],
        ].map(([label, value]) => <div key={label} className="grid gap-0.5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd>
        </div>)}
      </dl> : <p className={quiet}>Nenhuma conta do Asaas conectada.</p>}
      {connection && status.canManage && <div className="flex flex-wrap gap-2">
        <Button size="lg" className={control} disabled={pending} onClick={() => void mutate('PATCH')}>{pending ? 'Aguarde…' : 'Verificar novamente'}</Button>
        <Button variant="outline" size="lg" className={control} disabled={pending} aria-expanded={editKey} onClick={() => { setEditKey(value => !value); setApiKey(''); }}>Atualizar chave</Button>
        <Button variant="outline" size="lg" className={control} disabled={pending} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
      </div>}
      {status.canManage && (!connection || editKey) && <form className="flex max-w-xl flex-col items-start gap-3" onSubmit={event => { event.preventDefault(); void mutate('POST'); }}>
        <div className="flex w-full flex-col gap-1.5">
          <Label htmlFor="asaas-api-key" className="text-xs font-normal text-muted-foreground">Chave de API do Asaas</Label>
          <Input id="asaas-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={400} required disabled={pending}
            className="h-11 md:h-9" value={apiKey} onChange={event => setApiKey(event.target.value)} aria-describedby="asaas-key-help" />
          <p id="asaas-key-help" className="text-xs leading-5 text-muted-foreground">Crie a chave no Asaas, em Integrações › Chaves de API, e cole-a completa, começando por $aact_. Uma chave de sandbox conecta o ambiente de testes. A chave é guardada criptografada e não aparece de novo.</p>
        </div>
        <Button type="submit" size="lg" className={control} disabled={pending || !apiKey.trim()}>{pending ? 'Verificando…' : connection ? 'Verificar e atualizar chave' : 'Verificar e conectar'}</Button>
      </form>}
      {!status.canManage && <p className={quiet}>Um administrador do escritório pode conectar a conta do Asaas.</p>}
    </>}
    <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
      <DialogContent>
        <DialogHeader><DialogTitle>Desconectar o Asaas?</DialogTitle><DialogDescription>O Lume apaga a chave e deixa de criar cobranças nesta conta. As cobranças já emitidas continuam no Asaas e podem ser pagas normalmente. A chave não é revogada no Asaas.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button><Button disabled={pending} onClick={() => void mutate('DELETE')}>{pending ? 'Desconectando…' : 'Desconectar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </CanvasSection>;
}
