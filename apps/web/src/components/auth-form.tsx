"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-provider";
import { InstallApp } from "@/components/pwa-provider";
import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, signInSchema, signUpSchema } from "@/lib/auth-validation";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setFieldErrors({});
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = (isSignUp ? signUpSchema : signInSchema).safeParse(values);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => { errors[String(issue.path[0])] ??= issue.message; });
      setFieldErrors(errors);
      const input = event.currentTarget.elements.namedItem(Object.keys(errors)[0]);
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    if (isSignUp && values.password !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: "As senhas precisam ser iguais." });
      const input = event.currentTarget.elements.namedItem("confirmPassword");
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    setPending(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email(signUpSchema.parse(values))
        : await authClient.signIn.email(signInSchema.parse(values));
      if (result.error) {
        setError(result.error.status === 429 ? authErrorMessage("TOO_MANY_REQUESTS") : authErrorMessage(result.error.code));
        setPending(false);
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Confira sua conexão e tente novamente.");
      setPending(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors[name] ? <p className="text-destructive text-xs" id={`${name}-error`}>{fieldErrors[name]}</p> : null;
  }

  function fieldProps(name: string) {
    return { id: name, name, "aria-invalid": !!fieldErrors[name], "aria-describedby": fieldErrors[name] ? `${name}-error` : undefined };
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-canvas px-5 py-4 md:px-8 md:py-6">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 pt-[env(safe-area-inset-top)]">
        <Link href="/" aria-label="K5"><Logo height={18} /></Link>
        <div className="flex items-center gap-1"><InstallApp /><ThemeSwitch /></div>
      </header>
      <section className="w-full max-w-[360px] place-self-center py-8 md:py-12" aria-labelledby="auth-title">
        <Reveal>
          <h1 id="auth-title" className="display mb-7 text-[32px] md:mb-8 md:text-4xl" data-reveal>{isSignUp ? "Crie sua conta" : "Entre no K5"}</h1>
          <form onSubmit={submit} noValidate aria-busy={pending} data-reveal>
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
              {isSignUp && <>
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Nome completo</Label>
                  <Input {...fieldProps("name")} autoComplete="name" placeholder="Seu nome completo" required maxLength={120} />
                  {fieldError("name")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="officeName">Nome do escritório</Label>
                  <Input {...fieldProps("officeName")} autoComplete="organization" placeholder="Seu escritório" required maxLength={160} />
                  {fieldError("officeName")}
                </div>
              </>}
              <div className="grid gap-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input {...fieldProps("email")} type="email" autoComplete="email" placeholder="voce@escritorio.com.br" required />
                {fieldError("email")}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input {...fieldProps("password")} type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} placeholder={isSignUp ? "Pelo menos 8 caracteres" : "Sua senha"} required maxLength={128} className="pr-11" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}
                    className="absolute inset-y-1 right-1 h-auto text-muted-foreground hover:bg-transparent hover:text-foreground">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                {fieldError("password")}
              </div>
              {isSignUp && <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword">Confirmar senha</Label>
                <Input {...fieldProps("confirmPassword")} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repita sua senha" required maxLength={128} />
                {fieldError("confirmPassword")}
              </div>}
              {error && <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
              <Button type="submit" size="lg" className="mt-2 w-full">
                {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {pending ? (isSignUp ? "Criando conta…" : "Entrando…") : (isSignUp ? "Criar conta" : "Entrar")}
              </Button>
            </fieldset>
          </form>
          <p className="mt-6 text-muted-foreground text-sm" data-reveal>
            {isSignUp ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}
            <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground">{isSignUp ? "Entrar" : "Criar conta"}</Link>
          </p>
        </Reveal>
      </section>
    </main>
  );
}
