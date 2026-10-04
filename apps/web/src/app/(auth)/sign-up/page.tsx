import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { parseMessageClaimToken } from '@/components/messaging/claim-token';
import { turnstileSiteKey } from '@/lib/turnstile';

export const metadata: Metadata = { title: "Criar conta", referrer: 'no-referrer' };
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ invite?: string; messageClaim?: string }> }) {
  const { invite, messageClaim } = await searchParams;
  return <AuthForm mode="sign-up" invite={typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite) ? invite : undefined} messageClaim={parseMessageClaimToken(messageClaim)} challengeKey={turnstileSiteKey()} />;
}
