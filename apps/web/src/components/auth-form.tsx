"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { LumeMark } from "@/components/lume-mark";
import { ThemeSwitch } from "@/components/theme-provider";
import { InstallApp } from "@/components/pwa-provider";
import { Reveal } from "@/components/reveal";
import { Halftone } from "@/components/halftone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, signInSchema, signUpSchema } from "@/lib/auth-validation";
import { LEGAL_VERSION } from "@/lib/legal-version";
import { TurnstileWidget } from "@/components/turnstile-widget";

/** `challengeKey`: the Turnstile site key, when sign-up asks for a human check. */
export function AuthForm({ mode, invite, messageClaim, challengeKey }: { mode: "sign-in" | "sign-up"; invite?: string; messageClaim?: string; challengeKey?: string }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState("");
  const [challengeReset, setChallengeReset] = useState(0);
  const challenge = isSignUp && challengeKey ? challengeKey : undefined;
  // The light answers the form: it gathers while the password is typed, flares on submit, cools on an error.
  const mood = error ? "error" : pending ? "submit" : passwordFocus ? "focus" : "idle";

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
    if (isSignUp && values.acceptTerms !== "on") {
      setFieldErrors({ acceptTerms: "Para criar a conta, aceite os Termos de uso e a Política de privacidade." });
      const input = event.currentTarget.elements.namedItem("acceptTerms");
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    if (isSignUp && values.password !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: "As senhas precisam ser iguais." });
      const input = event.currentTarget.elements.namedItem("confirmPassword");
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    if (challenge && !challengeToken) {
      setError("Aguarde a verificação de segurança terminar e tente de novo.");
      return;
    }
    setPending(true);
    const destination = invite ? `/invite/${encodeURIComponent(invite)}` : messageClaim ? `/messages/claim/${encodeURIComponent(messageClaim)}` : '/app';
    try {
      // The confirmation link sent by e-mail returns to the same place the form would have.
      // The ticked version travels with the sign-up; the server records it with the new account.
      const signUp = () => ({ ...signUpSchema.parse(values), callbackURL: destination, acceptedLegalVersion: LEGAL_VERSION });
      const result = isSignUp
        ? await authClient.signUp.email(signUp(), challenge ? { headers: { "x-captcha-response": challengeToken } } : undefined)
        : await authClient.signIn.email({ ...signInSchema.parse(values), callbackURL: destination });
      if (result.error) {
        // A Turnstile token is good for one attempt.
        if (challenge) setChallengeReset(value => value + 1);
        setError(result.error.status === 429 ? authErrorMessage("TOO_MANY_REQUESTS") : authErrorMessage(result.error.code));
        setPending(false);
        return;
      }
      // Where e-mail confirmation is required, sign-up creates the account without a session.
      if (isSignUp && !result.data?.token) {
        setSentTo(String(values.email));
        setPending(false);
        return;
      }
      router.replace(destination);
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
    // 44px on touch, like every other field in the app (DESIGN.md); unchanged from md up.
    return { id: name, name, className: "h-11 md:h-8", "aria-invalid": !!fieldErrors[name], "aria-describedby": fieldErrors[name] ? `${name}-error` : undefined };
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_auto_1fr] bg-background md:grid-cols-[minmax(420px,1fr)_minmax(0,1fr)] md:grid-rows-[auto_1fr]">
      <header className="flex h-[calc(3.75rem+env(safe-area-inset-top))] items-stretch border-b border-line pt-[env(safe-area-inset-top)] md:col-span-2">
        <Link href="/" aria-label="Lume" className="hover-sweep grid w-15 shrink-0 place-items-center bg-foreground text-background transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:text-brand-foreground">
          <LumeMark width={22} height={22} aria-hidden="true" focusable="false" />
        </Link>
        <p className="self-center px-5 text-lg font-medium tracking-[-0.04em]">Lume</p>
        <div className="ml-auto flex items-center gap-1 border-l border-line px-3"><InstallApp /><ThemeSwitch /></div>
      </header>
      {/* The field answers the form: it tightens while the password is typed, flares on submit, stills on an error. */}
      <Halftone mood={mood} mark={{ x: .5, y: .56, size: .78 }} markTone="brand" seed={isSignUp ? 5 : 2} className="h-36 border-b border-line md:order-last md:h-auto md:border-b-0 md:border-l" />
      <div className="flex min-w-0 flex-col px-6 pt-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:px-12 md:py-10 lg:px-16">
      <section className="w-full max-w-[420px] md:my-auto" aria-labelledby="auth-title">
        <Reveal>
          <p className="label-mono mb-5 flex items-center gap-2.5 text-muted-foreground" data-reveal><span className="square-dot" aria-hidden="true" />{isSignUp ? "Novo escritório" : "Acesso"}</p>
          <h1 id="auth-title" className="display mb-8 text-[44px] md:mb-10 md:text-[64px]" data-reveal>{sentTo ? "Confira seu e-mail" : isSignUp ? "Crie sua conta" : "Entre no Lume"}</h1>
          {sentTo ? <div className="grid gap-4 text-base leading-relaxed" role="status">
            <p>Enviamos um link de confirmação para <strong className="break-all font-medium">{sentTo}</strong>. Abra o link em até 24 horas para entrar no Lume.</p>
            <p className="text-sm text-muted-foreground">Se a mensagem não chegar em alguns minutos, confira a caixa de spam. Ao tentar entrar com o e-mail ainda não confirmado, enviamos um novo link.</p>
            <Link href={`/sign-in${invite ? `?invite=${encodeURIComponent(invite)}` : messageClaim ? `?messageClaim=${encodeURIComponent(messageClaim)}` : ''}`} className="inline-flex min-h-11 w-fit items-center text-sm font-medium underline underline-offset-4">Ir para o acesso</Link>
          </div> : <>
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
                  <Input {...fieldProps("password")} onFocus={() => setPasswordFocus(true)} onBlur={() => setPasswordFocus(false)} type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} placeholder={isSignUp ? "Pelo menos 8 caracteres" : "Sua senha"} required maxLength={128} className="h-11 pr-11 md:h-8" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}
                    className="absolute inset-y-1 right-1 h-auto text-muted-foreground hover:bg-transparent hover:text-foreground">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                {fieldError("password")}
                {!isSignUp && <Link href="/recover-password" className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4">Esqueci minha senha</Link>}
              </div>
              {isSignUp && <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword">Confirmar senha</Label>
                <Input {...fieldProps("confirmPassword")} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repita sua senha" required maxLength={128} />
                {fieldError("confirmPassword")}
              </div>}
              {error && <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
              {isSignUp ? <div className="grid gap-1.5">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed">
                  <input id="acceptTerms" name="acceptTerms" type="checkbox" className="mt-1 size-4 shrink-0 accent-foreground"
                    aria-invalid={!!fieldErrors.acceptTerms} aria-describedby={fieldErrors.acceptTerms ? "acceptTerms-error" : undefined} />
                  <span>Li e aceito os <Link href="/termos-de-uso" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Termos de uso<span className="sr-only"> (abre em nova aba)</span></Link>
                    {" e a "}<Link href="/politica-privacidade" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Política de privacidade<span className="sr-only"> (abre em nova aba)</span></Link>.</span>
                </label>
                {fieldError("acceptTerms")}
              </div> : <p className="text-sm leading-relaxed text-muted-foreground">
                {"Consulte os "}
                <Link href="/termos-de-uso" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">Termos de uso<span className="sr-only"> (abre em nova aba)</span></Link>
                {" e a "}<Link href="/politica-privacidade" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">Política de privacidade<span className="sr-only"> (abre em nova aba)</span></Link>.
              </p>}
              {challenge && <TurnstileWidget siteKey={challenge} action="sign-up" resetKey={challengeReset} onToken={setChallengeToken} onError={setError} />}
              <Button type="submit" size="lg" className="mt-3 h-12 w-full justify-between px-4 text-[15px] md:h-12">
                {pending ? (isSignUp ? "Criando conta…" : "Entrando…") : (isSignUp ? "Criar conta" : "Entrar")}
                {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
              </Button>
            </fieldset>
          </form>
          <p className="mt-6 text-muted-foreground text-sm" data-reveal>
            {isSignUp ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}
            <Link href={`${isSignUp ? '/sign-in' : '/sign-up'}${invite ? `?invite=${encodeURIComponent(invite)}` : messageClaim ? `?messageClaim=${encodeURIComponent(messageClaim)}` : ''}`} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors duration-300 hover:decoration-brand">{isSignUp ? "Entrar" : "Criar conta"}</Link>
          </p>
          </>}
        </Reveal>
      </section>
      </div>
    </main>
  );
}
