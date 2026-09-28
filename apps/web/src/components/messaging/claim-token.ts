import { z } from 'zod';

const claimToken = z.string().regex(/^[A-Za-z0-9_-]{32,512}$/);

export function parseMessageClaimToken(value: unknown) {
  const parsed = claimToken.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
