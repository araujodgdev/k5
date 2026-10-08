import 'server-only';
import { captureOperationalError } from './observability/report';
import { getSession, requireWorkspace } from './session';
import { auth } from './auth';
import { ensureOfficeForUser, findOfficeForUser } from './offices';
import { database } from './database';
import { ZodError } from 'zod';
import { VaultHttpError } from './vault';
import { AiConnectionError } from './ai-connections-core';
import { CredentialKeyError } from './platform-crypto';
import { NotificationRequestError } from './notifications/contracts';

import { CapabilityError, statusForCapabilityError } from './capabilities/errors';
import { isTrustedOrigin } from './trusted-origins';
import { ApiError } from './api-error';
import { assertTermsAccepted } from './legal-acceptance';

export { ApiError } from './api-error';

export async function apiWorkspace(request: Request, write = false) {
  const session = await getSession();
  if (!session) throw new ApiError(401, 'Entre novamente para continuar.');
  await assertTermsAccepted(database, session.user.id);
  if (session.user.accountKind === 'client' && !await findOfficeForUser(database, session.user.id)) throw new ApiError(403, 'Esta conta tem acesso ao portal do cliente.');
  const workspace = await requireWorkspace();
  if (write && !isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
  return workspace;
}

export function apiError(error: unknown) {
  if (error instanceof CapabilityError) return Response.json({ error: error.message, code: error.code }, { status: statusForCapabilityError(error) });
  if (error instanceof ApiError || error instanceof VaultHttpError) {
    if (error.status >= 500) captureOperationalError(error, 'api.operational');
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AiConnectionError) {
    if (error.code === 'credential' || error.code === 'provider') captureOperationalError(error, `ai.connection.${error.code}`);
    if (error.code === 'not_found' || error.code === 'disabled') {
      return Response.json({ error: 'O Lume não está disponível para esta tarefa. Fale com o suporte da plataforma.' }, { status: 409 });
    }
    if (error.code === 'credential') return Response.json({ error: 'Serviço de IA temporariamente indisponível. Fale com o suporte da plataforma.' }, { status: 503 });
    return Response.json({ error: 'Não foi possível concluir. Confira a configuração ou tente novamente.' }, { status: 500 });
  }
  if (error instanceof CredentialKeyError) {
    captureOperationalError(error, 'ai.credentials');
    return Response.json({ error: 'Serviço de IA temporariamente indisponível. Tente novamente em instantes.' }, { status: 503 });
  }
  if (error instanceof NotificationRequestError) return Response.json({ error: error.message }, { status: error.status });
  // Custom issues carry messages written for the person (pt-BR); built-in Zod messages do not.
  if (error instanceof ZodError && error.issues[0]?.code === 'custom') return Response.json({ error: error.issues[0].message }, { status: 400 });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: 'Confira os dados enviados.' }, { status: 400 });
  // Keep the public response deliberately generic, but preserve enough private Worker telemetry
  // to diagnose production-only adapter failures without logging request bodies or credentials.
  captureOperationalError(error, 'api.unhandled');
  console.error('[api] erro não tratado', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: 'Não foi possível concluir. Confira a configuração ou tente novamente.' }, { status: 500 });
}

/**
 * Automatic reads explicitly disable Better Auth's sliding refresh so polling never keeps an idle
 * session alive.
 */
export async function apiPersonalWorkspace(request: Request, write = false) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session) throw new ApiError(401, 'Entre novamente para continuar.');
  await assertTermsAccepted(database, session.user.id);
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

/** Bounds bytes before multipart parsing, including chunked requests and misleading length headers. */
export function limitedFormData(request: Request, max: number): Promise<FormData> {
  return limitedBody(request, max, response => response.formData());
}

export function limitedBlob(request: Request, max: number): Promise<Blob> {
  return limitedBody(request, max, response => response.blob());
}

async function limitedBody<T>(request: Request, max: number, parse: (response: Response) => Promise<T>): Promise<T> {
  if (Number(request.headers.get('content-length')) > max) {
    await request.body?.cancel().catch(() => undefined);
    throw new ApiError(413, 'Solicitação muito grande.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Envie os dados da solicitação.');
  let size = 0;
  let exceeded = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) { controller.close(); return; }
        size += value.byteLength;
        if (size > max) {
          exceeded = true;
          await reader.cancel().catch(() => undefined);
          controller.error(new ApiError(413, 'Solicitação muito grande.'));
          return;
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  try {
    return await parse(new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }));
  } catch {
    throw new ApiError(exceeded ? 413 : 400, exceeded ? 'Solicitação muito grande.' : 'Confira o arquivo enviado.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
