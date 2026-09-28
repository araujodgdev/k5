import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { parseMessageClaimToken } from '@/components/messaging/claim-token';

export const metadata: Metadata = { title: "Entrar", referrer: 'no-referrer' };
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ invite?: string; messageClaim?: string }> }) {
  const { invite, messageClaim } = await searchParams;
  return <AuthForm mode="sign-in" invite={typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite) ? invite : undefined} messageClaim={parseMessageClaimToken(messageClaim)} />;
}
