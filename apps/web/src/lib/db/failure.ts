import { z } from 'zod';

const errorShape = z.object({ code: z.string().optional(), name: z.string().optional(), cause: z.unknown().optional() });

/** Classifies a PostgreSQL or network error that stops writes, following AggregateError members and causes. */
export function databaseFailure(error: unknown, depth = 0): 'disk_full' | 'read_only' | 'database_unavailable' | null {
  if (depth > 3) return null;
  if (error instanceof AggregateError) {
    for (const nested of error.errors.slice(0, 10)) {
      const failure = databaseFailure(nested, depth + 1);
      if (failure) return failure;
    }
  }
  const parsed = errorShape.safeParse(error);
  if (!parsed.success) return null;
  const { code, cause } = parsed.data;
  if (code === '53100' || code === 'ENOSPC') return 'disk_full';
  if (code === '25006' || code === 'pg_readonly') return 'read_only';
  if (code?.startsWith('08') || ['57P01','57P02','57P03','53300','ECONNREFUSED','ECONNRESET','EPIPE'].includes(code ?? '')) return 'database_unavailable';
  return cause && cause !== error ? databaseFailure(cause, depth + 1) : null;
}
