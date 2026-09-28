'use client';

import { useEffect } from 'react';
import { z } from 'zod';

const apiError = z.object({ code: z.string().optional() });
const errorLabels: Record<string, string> = {
  UNAUTHORIZED: 'Sua sessão terminou. Entre novamente para continuar.',
  FORBIDDEN: 'Seu acesso permite apenas consultar as conversas.',
  WINDOW_CLOSED: 'O prazo de resposta terminou. Aguarde uma nova mensagem do cliente.',
  REPLY_WINDOW_CLOSED: 'O prazo de resposta terminou. Aguarde uma nova mensagem do cliente.',
  RECONNECT_REQUIRED: 'Reconecte a conta em Integrações para enviar mensagens.',
  NOT_CONNECTED: 'Conecte uma conta em Integrações para enviar mensagens.',
  RATE_LIMITED: 'Aguarde um momento antes de tentar novamente.',
};

export class WhatsAppRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) {
    super(message);
  }
}

export async function whatsappRequest<T>(path: string, schema: z.ZodType<T>, fallback: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/whatsapp/${path}`, { cache: 'no-store', credentials: 'same-origin', ...init });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new WhatsAppRequestError('Não foi possível se conectar. Verifique sua conexão.', true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiError.safeParse(body);
    const code = parsed.success ? parsed.data.code : undefined;
    throw new WhatsAppRequestError(code ? errorLabels[code.toUpperCase()] ?? fallback : fallback, response.status >= 500);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WhatsAppRequestError(fallback, true);
  return parsed.data;
}

export function requestMessage(error: unknown, fallback: string) {
  return error instanceof WhatsAppRequestError ? error.message : fallback;
}

export function useVisiblePoll(load: (signal: AbortSignal) => Promise<void>) {
  useEffect(() => {
    let controller: AbortController | null = null;
    const run = () => {
      if (document.visibilityState !== 'visible' || controller) return;
      const current = new AbortController();
      controller = current;
      void load(current.signal).finally(() => {
        if (controller === current) controller = null;
      });
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        controller?.abort();
        controller = null;
      } else run();
    };
    run();
    const timer = window.setInterval(run, 8_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', run);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', run);
    };
  }, [load]);
}
