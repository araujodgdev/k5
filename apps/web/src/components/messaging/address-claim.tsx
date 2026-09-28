'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { claimAddressOutput } from '@/lib/personal-chat/domain';
import { MessageAttachment } from '@/components/message-attachment';
import { Button } from '@/components/ui/button';
import { jsonPost, messageError, messageRequest } from './client';

export function AddressClaim({ token, email }: { token: string; email: string }) {
  const [result, setResult] = useState<z.infer<typeof claimAddressOutput> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function claim() {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { setResult(await messageRequest('address-claims', claimAddressOutput, jsonPost({ token }))); }
    catch (failure) { setError(messageError(failure)); }
    finally { running.current = false; setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-xl px-5 py-12 md:py-20">
    <Link href="/app/messages" className="text-sm underline underline-offset-4">Mensagens</Link>
    <h1 className="page-title mt-8">{result ? 'Endereço confirmado' : 'Confirmar seu endereço'}</h1>
    {result ? <div className="mt-6 space-y-5">
      <p role="status" className="text-sm leading-relaxed">{result.document ? 'O documento compartilhado está disponível para sua conta.' : 'As novas mensagens desta conversa aparecerão no Tises. Os e-mails anteriores continuam na sua caixa de e-mail.'}</p>
      {result.document && <div className="border-y py-5">
        <MessageAttachment filename={result.document.name} mimeType={result.document.mimeType} url={result.document.contentUrl} downloadUrl={`${result.document.contentUrl}?download=1`} />
        <p className="mt-2 text-xs text-muted-foreground">Versão {result.document.version}</p>
      </div>}
      <Button className="min-h-11 md:min-h-9" asChild><Link href={`/app/messages?thread=${encodeURIComponent(result.threadId)}`}>Abrir conversa</Link></Button>
    </div> : <div className="mt-6 space-y-5">
      <p className="text-sm leading-relaxed">Você está conectado como <span className="break-all font-medium">{email}</span>. Continue se este é o endereço que recebeu o convite.</p>
      <p className="text-sm text-muted-foreground">A confirmação permite receber novas mensagens no Tises. O acesso a documentos e casos depende do convite recebido.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => void claim()} className="min-h-11 md:min-h-9">{busy ? 'Confirmando…' : 'Confirmar meu endereço'}</Button>
      <p><Link href={`/sign-in?${new URLSearchParams({ messageClaim: token })}`} className="text-sm underline underline-offset-4">Entrar com outra conta</Link></p>
    </div>}
  </main>;
}
