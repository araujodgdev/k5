import { z } from 'zod';

export class InpiImportError extends Error {
  constructor(readonly code: 'capacity' | 'source_changed' | 'invalid_source' | 'staging_corrupt' | 'duration' | 'suspended', message: string) {
    super(message);
  }
}

const errorShape = z.object({ code: z.string().optional(), name: z.string().optional(), cause: z.unknown().optional() });
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

export function inpiFailure(error: unknown) {
  const parsed = errorShape.safeParse(error);
  const code = parsed.success ? parsed.data.code : undefined;
  const database = code?.startsWith('INPI_') ? null : databaseFailure(error);
  if (database) return { code: database, suspend: true, condition: 'Restabelecer escrita e espaço livre no cluster; conferir capacidade e executar inpi:admin resume.' };
  if (error instanceof InpiImportError) return { code: error.code, suspend: true, condition: error.message };
  if (code === 'INPI_SOURCE_CHANGED') return { code: 'source_changed', suspend: true, condition: 'Conferir a identidade dos quatro arquivos e invalidar a carga antes de retomar.' };
  if (code === 'INPI_HTTP_INVALID' || code?.startsWith('CSV_') || ['23505','23514','42501','53200','54000','53400','57014','25P04'].includes(code ?? '')) {
    return { code: code ?? 'invalid_source', suspend: true, condition: 'Conferir layout, limites e resposta da fonte antes de retomar.' };
  }
  return { code: code === 'INPI_TRUNCATED' ? 'download_truncated' : code === 'INPI_NETWORK' ? 'network' : 'transient', suspend: false, condition: 'Verificar a falha após cinco tentativas e executar inpi:admin resume.' };
}
