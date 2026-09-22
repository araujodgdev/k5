import 'server-only';
import { captureOperationalError } from './observability/report';
import { getSession, requireWorkspace } from './session';
import { auth } from './auth';
import { ensureOfficeForUser } from './offices';
import { database } from './database';
import { ZodError } from 'zod';
import { VaultHttpError } from './vault';
import { AiConnectionError } from './ai-connections-core';
import { CredentialKeyError } from './platform-crypto';
import { NotificationRequestError } from './notifications/contracts';

import { CapabilityError, statusForCapabilityError } from './capabilities/errors';
import { isTrustedOrigin } from './trusted-origins';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function apiWorkspace(request: Request, write = false) {
  if (!await getSession()) throw new ApiError(401, 'Entre novamente para continuar.');
  const workspace = await requireWorkspace();
  if (write) {
    if (!isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
    if ((workspace.office).role === 'reviewer') throw new ApiError(403, 'Seu papel permite apenas consultas.');
  }
  return workspace;
}

export function apiError(error: unknown) {
  if (error instanceof CapabilityError) return Response.json({ error: error.message, code: error.code }, { status: statusForCapabilityError(error) });
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof VaultHttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof AiConnectionError) {
    if (error.code === 'not_found' || error.code === 'disabled') {
      return Response.json({ error: 'O escritório não tem um modelo de IA ativo para esta tarefa. Fale com o suporte da plataforma.' }, { status: 409 });
    }
    if (error.code === 'credential') return Response.json({ error: 'Serviço de IA temporariamente indisponível. Fale com o suporte da plataforma.' }, { status: 503 });
    return Response.json({ error: 'Não foi possível concluir. Confira a configuração ou tente novamente.' }, { status: 500 });
  }
  if (error instanceof CredentialKeyError) return Response.json({ error: 'Serviço de IA temporariamente indisponível. Tente novamente em instantes.' }, { status: 503 });
  if (error instanceof NotificationRequestError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: 'Confira os dados enviados.' }, { status: 400 });
  // Keep the public response deliberately generic, but preserve enough private Worker telemetry
  // to diagnose production-only adapter failures without logging request bodies or credentials.
  captureOperationalError(error, 'api.unhandled');
  console.error('[api] erro não tratado', error instanceof Error
    ? { name: error.name, message: error.message }
    : { type: typeof error });
  return Response.json({ error: 'Não foi possível concluir. Confira a configuração ou tente novamente.' }, { status: 500 });
}

/**
 * Personal settings and inbox writes are available to every current member, including reviewers.
 * Automatic reads explicitly disable Better Auth's sliding refresh so polling never keeps an idle
 * session alive. Business writes continue to use apiWorkspace and its role gate.
 */
export async function apiPersonalWorkspace(request: Request, write = false) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session) throw new ApiError(401, 'Entre novamente para continuar.');
  if (write && !isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
  const office = await ensureOfficeForUser(database, session.user);
  return { user: session.user, office, session: { id: session.session?.id } };
}

export async function limitedJson(request: Request, max = 256_000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Envie os dados da solicitação.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new ApiError(413, 'Solicitação muito grande.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
