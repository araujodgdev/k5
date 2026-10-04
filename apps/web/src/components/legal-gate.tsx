"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { LegalDocumentKind } from "@/lib/legal-acceptance";

async function accept(document: LegalDocumentKind) {
  const response = await fetch("/api/legal/acceptance", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document }),
  });
  if (!response.ok) throw new Error();
}

function useAcceptance(document: LegalDocumentKind) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setPending(true);
    setError("");
    try {
      await accept(document);
      router.refresh();
    } catch {
      setError("Não foi possível registrar. Confira sua conexão e tente novamente.");
      setPending(false);
    }
  }
  return { pending, error, submit };
}

const failure = (error: string) => error
  ? <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>
  : null;

/** Shown instead of the app until the person accepts the current Termos de uso and Política de privacidade. */
export function TermsGate({ version, updatedLabel, firstTime, signInHref = "/sign-in" }: { version: string; updatedLabel: string; firstTime: boolean; signInHref?: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAcceptance("terms");
  const [checked, setChecked] = useState(false);
  const [missing, setMissing] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-10">
      <section aria-labelledby="terms-title" className="w-full max-w-[560px]">
        <p className="label-mono mb-5 flex items-center gap-2.5 text-muted-foreground"><span className="square-dot" aria-hidden="true" />Documentos legais · Versão {version}</p>
        <h1 id="terms-title" className="display mb-6 text-[40px] md:text-[56px]">{firstTime ? "Antes de continuar" : "Atualizamos os termos"}</h1>
        <div className="grid gap-4 text-base leading-relaxed">
          <p>{firstTime
            ? "Para usar o Lume, leia e aceite os Termos de uso e a Política de privacidade."
            : `Os Termos de uso e a Política de privacidade foram atualizados em ${updatedLabel}. Para continuar, leia e aceite a nova versão.`}</p>
          <p className="text-sm text-muted-foreground">
            <Link href="/termos-de-uso" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">Termos de uso<span className="sr-only"> (abre em nova aba)</span></Link>
            {" · "}
            <Link href="/politica-privacidade" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">Política de privacidade<span className="sr-only"> (abre em nova aba)</span></Link>
          </p>
          <div className="grid gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-foreground" checked={checked}
                aria-invalid={missing} aria-describedby={missing ? "terms-missing" : undefined}
                onChange={event => { setChecked(event.target.checked); setMissing(false); }} />
              <span>Li e aceito os Termos de uso e a Política de privacidade.</span>
            </label>
            {missing && <p id="terms-missing" className="text-destructive text-xs">Marque a opção para continuar.</p>}
          </div>
          {failure(error)}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="lg" className="h-12 min-w-56 justify-between px-4" disabled={pending}
              onClick={() => { if (!checked) { setMissing(true); return; } void submit(); }}>
              {pending ? "Registrando…" : "Aceitar e continuar"}
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
            </Button>
            <Button variant="ghost" className="min-h-11" disabled={pending}
              onClick={async () => { await authClient.signOut(); router.replace(signInHref); router.refresh(); }}>Sair</Button>
          </div>
        </div>
      </section>
    </main>
  );
}

/** Shown in place of the chat until the person reads, once, how their content reaches the AI providers. */
export function AiDataNotice() {
  const { pending, error, submit } = useAcceptance("ai_notice");
  return (
    <section aria-labelledby="ai-notice-title" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 md:px-8">
      <div className="border-l-2 border-brand pl-5">
        <h1 id="ai-notice-title" className="page-title mb-5">Antes de usar o Lume</h1>
        <div className="grid gap-4 text-base leading-relaxed">
          <p>Para responder, o Lume envia a provedores de inteligência artificial, como OpenAI, Anthropic e Google, o que você escreve, os anexos e os trechos dos documentos consultados. Esse conteúdo é processado como enviado, <strong className="font-medium">sem anonimização</strong>.</p>
          <p>Inclua somente os dados pessoais e as informações sigilosas necessários à tarefa. Antes de tratar dados de clientes ou de terceiros, considere o sigilo profissional e a base legal aplicável. Dados sensíveis, como informações de saúde ou de crianças e adolescentes, pedem cuidado redobrado.</p>
          <p>As respostas podem conter erros. Confira fatos, citações e fontes antes de usá-las em um caso.</p>
          <p className="text-sm text-muted-foreground">Mais detalhes na <Link href="/politica-privacidade#inteligencia-artificial" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">Política de privacidade<span className="sr-only"> (abre em nova aba)</span></Link>.</p>
          {failure(error)}
          <Button size="lg" className="mt-2 h-12 w-fit min-w-48 justify-between px-4" disabled={pending} onClick={() => void submit()}>
            {pending ? "Registrando…" : "Entendi"}
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </section>
  );
}
