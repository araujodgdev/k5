import { z } from 'zod';
import { requirePlatformRequest } from '@/lib/platform';
import { withTransaction } from '@/lib/database';
import { parseCredentialKeyring } from '@/lib/platform-crypto';
import { credentialRotationStatus, CredentialRotationError, rotateCredentials } from '@/lib/credential-rotation';
import { PlatformRequestError, readPlatformJson, platformErrorResponse } from '@/lib/platform-core';

const headers = { 'Cache-Control': 'private, no-store' };
const input = z.object({ expectedKeyId: z.string().regex(/^[0-9a-f]{16}$/), runtimesReady: z.literal(true) }).strict();

function failure(error: unknown) {
  if (error instanceof CredentialRotationError) return Response.json({ error: error.message }, { status: 409, headers });
  const response = platformErrorResponse(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(request: Request) {
  try {
    const { db } = await requirePlatformRequest(request);
    const status = await credentialRotationStatus(db, parseCredentialKeyring());
    return Response.json({ ...status, enabled: Boolean(process.env.K5_CREDENTIALS_NEXT_KEY?.trim()) }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    if (!process.env.K5_CREDENTIALS_NEXT_KEY?.trim()) throw new PlatformRequestError(409, 'Prepare a nova chave no ambiente antes de iniciar a rotação.');
    const { expectedKeyId } = await readPlatformJson(request, input, 512);
    const ring = parseCredentialKeyring();
    const result = await withTransaction(tx => rotateCredentials(tx, ring, user.id, expectedKeyId));
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
