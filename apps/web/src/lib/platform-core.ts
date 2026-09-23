import type { Database } from "./database";
import { z } from "zod";
import { AiConnectionError } from "./ai-connections-core";
import { CredentialKeyError } from "./platform-crypto";
import { captureOperationalError } from "./observability/report";

export async function isPlatformAdmin(db: Database, userId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM platform_admin WHERE user_id = ?").get(userId));
}

export async function assertPlatformAdmin(db: Database, userId: string): Promise<void> {
  if (!await isPlatformAdmin(db, userId)) throw new PlatformRequestError(403, "Acesso restrito aos administradores da plataforma.");
}

export async function findUserForPlatformGrant(db: Database, identifier: { email?: string; id?: string }) {
  const email = identifier.email?.trim().toLowerCase();
  const id = identifier.id?.trim();
  if ((email ? 1 : 0) + (id ? 1 : 0) !== 1) throw new Error("Informe exatamente um e-mail ou ID de usuário.");
  return await db.prepare(`SELECT id, email, name FROM user WHERE ${email ? "lower(email) = ?" : "id = ?"}`).get((email ?? id)!) as
    | { id: string; email: string; name: string }
    | undefined;
}

export async function grantPlatformAdmin(db: Database, userId: string, grantedByUserId: string | null = null): Promise<boolean> {
  const result = await db.prepare("INSERT INTO platform_admin (user_id, granted_by_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, grantedByUserId);
  return result.changes > 0;
}

export async function revokePlatformAdmin(db: Database, userId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM platform_admin WHERE user_id = ?").run(userId);
  return result.changes > 0;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new PlatformRequestError(403, "Origem da solicitação ausente.");
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) throw new PlatformRequestError(403, "Origem da solicitação não autorizada.");
  } catch (error) {
    if (error instanceof PlatformRequestError) throw error;
    throw new PlatformRequestError(403, "Origem da solicitação inválida.");
  }
}

export class PlatformRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// Session and role are read on every request, so revoking either applies to the next operation.
export async function authorizePlatformRequest<U extends { id: string }>(
  db: Database, getSession: (headers: Headers) => Promise<{ user: U } | null>, request: Request, options: { mutation?: boolean } = {},
) {
  if (options.mutation) assertSameOrigin(request);
  const session = await getSession(request.headers);
  if (!session) throw new PlatformRequestError(401, "Entre novamente para continuar.");
  await assertPlatformAdmin(db, session.user.id);
  return { user: session.user, db };
}

export const PLATFORM_BODY_LIMIT = 16_000;

export async function readPlatformJson<T>(request: Request, schema: z.ZodType<T>, max = PLATFORM_BODY_LIMIT): Promise<T> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new PlatformRequestError(413, "Solicitação muito grande.");
  const reader = request.body?.getReader();
  if (!reader) throw new PlatformRequestError(400, "Envie os dados da solicitação.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new PlatformRequestError(413, "Solicitação muito grande."); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new PlatformRequestError(400, "Corpo da solicitação inválido."); }
  const result = schema.safeParse(body);
  if (!result.success) throw new PlatformRequestError(400, "Confira os dados enviados.");
  return result.data;
}

// Never logs error messages or objects: SDK and database errors can carry request data or credentials.
export function platformErrorResponse(error: unknown) {
  if (error instanceof PlatformRequestError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof AiConnectionError) {
    if (error.code === 'provider' || error.code === 'credential') captureOperationalError(error, `platform.ai.${error.code}`);
    const status = { not_found: 404, conflict: 409, in_use: 409, disabled: 409, provider: 422, credential: 503, invalid: 400 }[error.code];
    return Response.json({ error: error.message }, { status });
  }
  if (error instanceof CredentialKeyError) {
    captureOperationalError(error, 'platform.credentials');
    return Response.json({ error: "A chave mestra de credenciais não está configurada corretamente." }, { status: 503 });
  }
  if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ error: "Confira os dados enviados." }, { status: 400 });
  captureOperationalError(error, 'platform.api.unhandled');
  console.error("Platform API error", error instanceof Error ? error.constructor.name : typeof error);
  return Response.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
}
