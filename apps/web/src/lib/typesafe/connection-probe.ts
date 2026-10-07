import 'server-only';
import { requirePlatformRequest } from '@/lib/platform';
import { payloadDigest } from '@/lib/content-result';
import { evaluate } from './client';

/** The administrative probe has fixed application text and no caller-provided content. */
export async function testTypeSafeConnection(request: Request) {
  const { user } = await requirePlatformRequest(request,{ mutation: true });
  const input = { state: 'A reunião está marcada para segunda-feira.', questionVersion: 'connection-test-v1',
    questions: { meeting: { type: 'noul' as const, instructions: 'O texto menciona uma reunião?' } } };
  return evaluate({ officeId: null,userId: user.id },'rag',input,{ test: true,signal: request.signal,deadlineMs: 10000,
    admission: { applicationDigest: payloadDigest(input), async admit(signal) {
      signal?.throwIfAborted();
      const current = await requirePlatformRequest(request,{ mutation: true });
      if (current.user.id !== user.id) throw new Error('Probe authority changed.');
      signal?.throwIfAborted();
    } } });
}
