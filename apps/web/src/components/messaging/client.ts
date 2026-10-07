'use client';

import { useEffect } from 'react';
import { z } from 'zod';

const errorBody = z.object({ error: z.string().optional(), code: z.string().optional() });

export class MessageRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

async function responseFor(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = window.setTimeout(cancel, 20_000);
  init?.signal?.addEventListener('abort', cancel, { once: true });
  if (init?.signal?.aborted) cancel();
  try {
    const response = await fetch(`/api/messages/${path}`, { cache: 'no-store', credentials: 'same-origin', ...init, signal: controller.signal });
    const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    checkResponse(response, body);
    return body;
  }
  catch (error) {
    if (init?.signal?.aborted) throw error;
    if (error instanceof MessageRequestError) throw error;
    throw new MessageRequestError('Não foi possível conectar. Confira sua conexão.', true);
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', cancel);
  }
}

function checkResponse(response: Response, body: unknown) {
  if (response.ok) return;
  const parsed = errorBody.safeParse(body);
  const message = response.status === 401 ? 'Sua sessão terminou. Entre novamente para continuar.'
    : parsed.success && parsed.data.error ? parsed.data.error : 'Não foi possível concluir. Tente novamente.';
  throw new MessageRequestError(message, response.status >= 500 || response.status === 408);
}

export async function messageRequest<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const body = await responseFor(path, init);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MessageRequestError('Não foi possível confirmar a resposta. Confira a operação antes de continuar.', true);
  return parsed.data;
}

export async function revokeDocumentShare(id: string) {
  await responseFor(`document-shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function messageError(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
}

export function useMessagePoll(load: (signal: AbortSignal) => Promise<void>, reloadKey: string | number = 0) {
  useEffect(() => {
    let active: AbortController | null = null;
    const run = () => {
      if (document.visibilityState !== 'visible' || active) return;
      const controller = new AbortController();
      active = controller;
      void load(controller.signal).finally(() => { if (active === controller) active = null; });
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') { active?.abort(); active = null; }
      else run();
    };
    run();
    const timer = window.setInterval(run, 8_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', run);
    return () => {
      active?.abort(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', run);
    };
  }, [load, reloadKey]);
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export function messageDate(value: string) { return dateFormat.format(new Date(value)); }

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const dayKey = (date: Date) => date.toDateString();
/** The time at the end of a conversation row: "10:42" today, "ontem", then "dd/mm". */
export function messageWhen(value: string, now = new Date()) {
  const date = new Date(value);
  if (dayKey(date) === dayKey(now)) return timeFormat.format(date);
  if (dayKey(date) === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'ontem';
  return dayFormat.format(date);
}
