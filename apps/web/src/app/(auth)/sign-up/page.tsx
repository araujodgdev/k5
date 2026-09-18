import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Criar conta" };
export default function SignUpPage() { return <AuthForm mode="sign-up" />; }
