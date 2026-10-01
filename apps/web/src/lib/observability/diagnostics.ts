import { z } from 'zod';

const fields = z.object({
  code: z.unknown().optional(),
  status: z.number().int().min(100).max(599).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  cause: z.unknown().optional(),
}).passthrough();

const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
const databaseCodes = new Set(['08000', '08001', '08003', '08006', '08004', '08007', '08P01', '22001', '22003', '22007', '22P02', '23502', '23503', '23505', '23514', '25006', 'pg_readonly', '28000', '28P01', '40001', '40P01', '42501', '42601', '42703', '42P01', '53100', '53300', '53400', '57014', '57P01', '57P02', '57P03']);

export function diagnosticTags(error: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth++) {
    seen.add(current);
    if (current instanceof Error && ['AbortError', 'TimeoutError'].includes(current.name)) tags.failure_kind = 'timeout';
    const parsed = fields.safeParse(current);
    if (!parsed.success) break;
    const { code, status, statusCode, cause } = parsed.data;
    const httpStatus = status ?? statusCode;
    if (httpStatus !== undefined && !tags.http_status) {
      tags.http_status = String(httpStatus);
      tags.failure_kind = httpStatus === 401 || httpStatus === 403 ? 'credential' : httpStatus === 429 ? 'rate_limit' : 'http';
    }
    if (typeof code === 'string' && databaseCodes.has(code)) {
      tags.database_code = code;
      tags.failure_kind = 'database';
    } else if (typeof code === 'string' && networkCodes.has(code)) {
      tags.network_code = code;
      tags.failure_kind = code.includes('TIMEOUT') || code === 'ETIMEDOUT' ? 'timeout' : 'network';
    }
    current = cause;
  }
  return tags;
}
