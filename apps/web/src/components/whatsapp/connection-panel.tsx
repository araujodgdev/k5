'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { connectionStatusDto, type ConnectionStatus } from '@/lib/whatsapp/domain';
import { requestMessage, useVisiblePoll, whatsappRequest } from './client';

const connectResult = z.object({ url: z.string().url().refine(value => value.startsWith('https://')) });
const disconnectResult = z.object({ status: z.string() });
const connectionLabels = {
  pending: 'Aguardando a conexão no WhatsApp Business.',
  connected: 'Conectado ao escritório.',
  reconnect_required: 'Reconexão necessária. As conversas já recebidas continuam disponíveis.',
  disconnecting: 'Desconectando a conta…',
  disconnected: 'Conta desconectada.',
} satisfies Record<NonNullable<ConnectionStatus['connection']>['status'], string>;

export function WhatsAppConnectionPanel({ initialStatus }: { initialStatus?: ConnectionStatus }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(initialStatus ?? null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<'idle' | 'connecting' | 'disconnecting'>('idle');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [revision, setRevision] = useState(0);
  const actionController = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await whatsappRequest('status', connectionStatusDto, 'Não foi possível carregar a conexão do WhatsApp.', { signal });
      if (!signal.aborted) { setStatus(next); setError(''); }
    } catch (failure) {
      if (!signal.aborted) setError(requestMessage(failure, 'Não foi possível carregar a conexão do WhatsApp.'));
    }
  }, []);
  const poll = useCallback((signal: AbortSignal) => {
    void revision;
    return load(signal);
  }, [load, revision]);
  useVisiblePoll(poll);
  useEffect(() => () => actionController.current?.abort(), []);

  async function connect() {
    if (actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setAction('connecting'); setError(''); setNotice('');
    try {
      const result = await whatsappRequest('connect', connectResult, 'Não foi possível iniciar a conexão. Tente novamente.', { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) window.location.assign(result.url);
    } catch (failure) {
      if (!controller.signal.aborted) setError(requestMessage(failure, 'Não foi possível iniciar a conexão.'));
    } finally {
      if (!controller.signal.aborted) setAction('idle');
      actionController.current = null;
    }
  }

  async function disconnect() {
    if (actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setAction('disconnecting'); setError(''); setNotice('');
    try {
      await whatsappRequest('disconnect', disconnectResult, 'Não foi possível desconectar a conta. Tente novamente.', { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) {
        setConfirmDisconnect(false);
        setNotice('Desconexão solicitada.');
        await load(controller.signal);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(requestMessage(failure, 'Não foi possível desconectar a conta.'));
    } finally {
      if (!controller.signal.aborted) setAction('idle');
      actionController.current = null;
    }
  }

  if (status && !status.enabled && !status.connection) return null;
  const connection = status?.connection;
  const busy = action !== 'idle';
  const connected = connection?.status === 'connected';
  const canConnect = status?.enabled && status.configured && status.canManage && !connected && connection?.status !== 'disconnecting';

  return <section aria-labelledby="whatsapp-connection-title" className="space-y-4 border-t border-line pt-8 [&_button]:min-h-11 md:[&_button]:min-h-9">
    <div>
      <h2 id="whatsapp-connection-title" className="text-lg font-medium">WhatsApp Business</h2>
      <p className="mt-1 text-sm text-muted-foreground">Uma conta compartilhada pelo escritório. As conversas ficam disponíveis para a equipe.</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!status ? <>{!error && <p role="status" className="text-sm text-muted-foreground">Carregando conexão…</p>}{error && <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button>}</> : <>
      <div className="space-y-1 text-sm">
        {connection?.label && <p className="font-medium">{connection.label}</p>}
        {connection?.number && <p>{connection.number}</p>}
        <p className="text-muted-foreground">{connection ? connectionLabels[connection.status] : 'Nenhuma conta conectada.'}</p>
      </div>
      {!status.enabled && <p className="text-sm text-muted-foreground">O WhatsApp está desativado para este escritório. A conta ainda pode ser desconectada.</p>}
      {status.enabled && !status.configured && <p className="text-sm text-muted-foreground">A conexão com o WhatsApp ainda precisa ser configurada pela plataforma.</p>}
      {!status.canManage && <p className="text-sm text-muted-foreground">Um administrador do escritório pode conectar ou desconectar a conta.</p>}
      <div className="flex flex-wrap gap-3">
        {canConnect && <Button disabled={busy} onClick={() => void connect()}>{action === 'connecting' ? 'Abrindo conexão…' : connection?.status === 'reconnect_required' || connection?.status === 'pending' ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}</Button>}
        {status.enabled && connection && connection.status !== 'disconnected' && <Button variant="outline" asChild><Link href="/app/whatsapp">Abrir conversas</Link></Button>}
        {status.canManage && connection && connection.status !== 'disconnected' && <Button variant="outline" disabled={busy || connection.status === 'disconnecting'} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>}
      </div>
    </>}
    <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
      <DialogContent>
        <DialogHeader><DialogTitle>Desconectar o WhatsApp?</DialogTitle><DialogDescription>O Tises deixará de receber e enviar mensagens desta conta. Você poderá conectar a conta novamente em Integrações.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button><Button disabled={busy} onClick={() => void disconnect()}>{action === 'disconnecting' ? 'Desconectando…' : 'Desconectar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
