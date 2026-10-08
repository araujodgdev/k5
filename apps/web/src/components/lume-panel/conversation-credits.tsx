'use client';

import { useEffect, useState } from 'react';

type Credits = { used: number; balance: number; trackingStartedAt: string };
const format = (amount: number) => (amount / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function ConversationCredits({ conversationId }: { conversationId: string | null }) {
  const [result, setResult] = useState<{ id: string; credits: Credits } | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    let request: AbortController | null = null;
    let generation = 0;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = ++generation;
      request?.abort(); request = new AbortController();
      try {
        const response = await fetch(`/api/conversation-credits?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store', signal: request.signal });
        if (current !== generation) return;
        if (response.status === 401) window.dispatchEvent(new Event('lume:session-ended'));
        if (!response.ok) throw new Error('unavailable');
        const credits = await response.json() as Credits;
        if (current === generation) setResult({ id: conversationId, credits });
      } catch { if (current === generation) setResult(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const changed = () => void refresh();
    window.addEventListener('lume:credits-changed', changed);
    document.addEventListener('visibilitychange', changed);
    return () => { generation++; request?.abort(); clearInterval(timer); window.removeEventListener('lume:credits-changed', changed); document.removeEventListener('visibilitychange', changed); };
  }, [conversationId]);
  const credits = result?.id === conversationId ? result.credits : null;
  return <span className="shrink-0 text-right font-mono text-[9px] leading-3 text-muted-foreground md:text-[10px]" title={credits ? `Créditos desta conversa contabilizados desde ${new Date(credits.trackingStartedAt).toLocaleDateString('pt-BR')}. Histórico anterior não incluído.` : 'Créditos indisponíveis'}>
    <span className="block" aria-label={`Créditos usados nesta conversa: ${credits ? format(credits.used) : 'indisponíveis'}`}>conversa {credits ? format(credits.used) : '—'}</span>
    <span className="block" aria-label={`Saldo de créditos: ${credits ? format(credits.balance) : 'indisponível'}`}>saldo {credits ? format(credits.balance) : '—'}</span>
  </span>;
}
