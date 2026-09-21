import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-provider";
import { requirePlatformPage } from "@/lib/platform";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformPage();
  if (!session) {
    const { getSession } = await import("@/lib/session");
    if (!(await getSession())) redirect("/sign-in");
    notFound();
  }
  return (
    <div className="min-h-dvh bg-canvas md:p-2">
      <a href="#platform-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>
      <div className="mx-auto flex min-h-dvh max-w-7xl flex-col bg-background md:min-h-[calc(100dvh-1rem)] md:rounded-2xl md:border">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b px-5 pt-[env(safe-area-inset-top)] md:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/platform/clients" className="flex shrink-0 items-center gap-2 font-medium"><Logo height={16} /> Plataforma</Link>
            <Link href="/platform/feedback" className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2">Avaliações</Link>
            <Link href="/app" className="rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Voltar ao aplicativo</Link>
          </div>
          <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate text-muted-foreground text-xs">{session.user.email}</span><ThemeSwitch /></div>
        </header>
        <main id="platform-content" className="flex-1 px-5 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
