'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import { honorarioDetailDto, type HonorarioDetail } from '@/lib/honorarios/contracts';

type Operation = 'list' | 'get' | 'options' | 'create' | 'receive' | 'reverse' | 'cancel' | 'charge-get' | 'charge-prepare' | 'charge-sent';

export async function honorariosCall<T>(operation: Operation, input: Record<string, unknown>, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/honorarios/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal, cache: 'no-store' });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(body);
    throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente para continuar.' : failure.success ? failure.data.error : 'Não foi possível concluir. Tente novamente.');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new Error('Não foi possível conferir a resposta. Tente novamente.');
  return result.data;
}

export function useHonorarioMutation(saved: (detail: HonorarioDetail) => void) {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(operation: 'create' | 'receive' | 'reverse' | 'cancel', input: Record<string, unknown>) {
    if (running.current) return;
    const fingerprint = JSON.stringify([operation, input]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    running.current = true; setPending(true); setError('');
    try {
      const detail = await honorariosCall(operation, { ...input, idempotencyKey: attempt.current.key }, honorarioDetailDto);
      saved(detail);
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível falar com o Lume. Tente novamente.'); }
    finally { running.current = false; setPending(false); }
  }
  return { submit, pending, error, setError };
}
