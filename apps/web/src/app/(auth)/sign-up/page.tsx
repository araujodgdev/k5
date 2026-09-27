import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Criar conta" };
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <AuthForm mode="sign-up" invite={typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite) ? invite : undefined} />;
}
