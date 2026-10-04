import { z } from 'zod';
import { auth } from '@/lib/auth';
import { database } from '@/lib/database';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import { ApiError, apiError, limitedJson } from '@/lib/workspace-api';
import { legalDocumentKinds, recordAcceptance, type LegalDocumentKind } from '@/lib/legal-acceptance';

const input = z.object({ document: z.enum(legalDocumentKinds as [LegalDocumentKind, ...LegalDocumentKind[]]) });

/** Accepts the current version of a document for the signed-in person, office or client portal. */
export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (!session) throw new ApiError(401, 'Entre novamente para continuar.');
    const { document } = input.parse(await limitedJson(request, 1_024));
    await recordAcceptance(database, session.user.id, document, request.headers);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
