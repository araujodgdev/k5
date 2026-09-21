"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Ellipsis, LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-provider";
import { InstallApp } from "@/components/pwa-provider";
import { navIcons } from "@/components/nav-icons";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { appNavigation, mobileTabs } from "@/lib/navigation";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

export function AppSidebar({ officeName, platformAdmin = false }: { officeName: string; platformAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const navRef = useRef<HTMLUListElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabbarRef = useRef<HTMLElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const placed = useRef(false);

  useEffect(() => {
    // Refresh the browser cookie on navigation, without a timer extending idle sessions.
    let mounted = true;
    authClient.getSession().then(({ data, error }) => {
      if (mounted && !error && !data) {
        router.replace("/sign-in");
        router.refresh();
      }
    }).catch(() => { /* A transient network error does not end a valid session. */ });
    return () => { mounted = false; };
  }, [pathname, router]);

  // Sidebar: slide the selection pill to the active item.
  useGSAP(() => {
    const indicator = indicatorRef.current;
    // Measure the list item: SidebarMenuItem is positioned, so the link's own offsetTop is always 0.
    const active = navRef.current?.querySelector('[aria-current="page"]')?.closest<HTMLElement>("li");
    if (!indicator) return;
    if (!active) { gsap.to(indicator, { autoAlpha: 0, duration: .2 }); return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = { y: active.offsetTop, height: active.offsetHeight, autoAlpha: 1 };
    if (!placed.current || reduced) gsap.set(indicator, target);
    else gsap.to(indicator, { ...target, duration: .45, ease: "power3.out" });
    placed.current = true;
  }, { dependencies: [pathname], scope: navRef });

  // Tab bar: small settle on the newly active icon.
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo("[data-tab-active] span", { scale: .82 }, { scale: 1, duration: .5, ease: "back.out(2.5)" });
  }, { dependencies: [pathname], scope: tabbarRef });

  useEffect(() => {
    const tabbar = tabbarRef.current;
    if (!tabbar) return;
    let last = window.scrollY;
    let hidden = false;
    let queued = false;
    const update = () => {
      queued = false;
      const y = Math.max(window.scrollY, 0);
      const delta = y - last;
      if (Math.abs(delta) < 6) return;
      last = y;
      const shouldHide = delta > 0 && y > 48;
      if (shouldHide === hidden) return;
      hidden = shouldHide;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(tabbar, { yPercent: shouldHide ? 130 : 0, duration: reduced ? 0 : .3, ease: "power2.out" });
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function logout() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("logout");
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Não foi possível sair. Tente novamente.");
      setPending(false);
    }
  }

  const overflow = appNavigation.filter((item) => !mobileTabs.includes(item.slug));
  const overflowActive = overflow.some((item) => pathname === `/app/${item.slug}`);

  return (
    <>
      <SidebarProvider className="hidden min-h-0 w-auto md:block">
        <Sidebar collapsible="none" className="h-dvh sticky top-0 border-0 bg-canvas p-2">
          <SidebarHeader className="gap-3 px-2 pt-3">
            <Link href="/app" aria-label="K5 — início" className="w-fit rounded-sm"><Logo height={16} /></Link>
            <p className="truncate font-medium text-sm" title={officeName}>{officeName}</p>
          </SidebarHeader>
          <SidebarContent className="px-0 pt-2">
            <SidebarMenu ref={navRef} className="relative gap-0.5 px-2">
              <span ref={indicatorRef} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 rounded-md bg-sidebar-accent" />
              {appNavigation.map((item) => {
                const href = `/app/${item.slug}`;
                const Icon = navIcons[item.slug];
                const active = pathname === href;
                return (
                  <SidebarMenuItem key={item.slug}>
                    <SidebarMenuButton asChild isActive={active} className="relative h-9 data-[active=true]:bg-transparent">
                      <Link href={href} aria-current={active ? "page" : undefined}>
                        <Icon aria-hidden="true" /><span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="px-2">
            <ThemeSwitch />
            <InstallApp />
            {platformAdmin && <Link href="/platform" className="rounded-md px-2 py-2 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">Administração da plataforma</Link>}
            {error && <p role="alert" className="px-2 text-destructive text-xs">{error}</p>}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={logout} disabled={pending} className="h-9" title="Encerrar sessão em todos os dispositivos">
                  <LogOut aria-hidden="true" />{pending ? "Saindo…" : "Sair"}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>

      <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/85 px-5 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <Link href="/app" aria-label="K5 — início" className="flex h-13 items-center"><Logo height={15} /></Link>
        <p className="truncate text-muted-foreground" title={officeName}>{officeName}</p>
      </header>

      <nav ref={tabbarRef} aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] grid-cols-5 border-t bg-background/90 px-2 pt-1.5 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {mobileTabs.map((slug) => {
          const item = appNavigation.find((entry) => entry.slug === slug)!;
          const href = `/app/${slug}`;
          const Icon = navIcons[slug];
          const active = pathname === href;
          return <TabItem key={slug} href={href} icon={<Icon className="size-[18px]" aria-hidden="true" />} label={item.short} active={active} />;
        })}
        <TabItem ref={moreButtonRef} icon={<Ellipsis className="size-[18px]" aria-hidden="true" />} label="Mais" active={overflowActive} onClick={() => setSheetOpen(true)} aria-haspopup="dialog" aria-expanded={sheetOpen} />
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="gap-1 p-2" onCloseAutoFocus={(event) => { event.preventDefault(); moreButtonRef.current?.focus(); }}>
          <SheetTitle className="px-3 py-2 pr-12 font-sans text-sm">Mais opções</SheetTitle>
          {overflow.map((item) => {
            const href = `/app/${item.slug}`;
            const Icon = navIcons[item.slug];
            const active = pathname === href;
            return (
              <Link key={item.slug} href={href} aria-current={active ? "page" : undefined} onClick={() => setSheetOpen(false)}
                className={cn("flex min-h-12 items-center gap-3 rounded-md px-3 text-base transition-colors", active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                <Icon className="size-[18px]" aria-hidden="true" />{item.label}
              </Link>
            );
          })}
          <Separator className="my-1.5" />
          <ThemeSwitch />
          <InstallApp />
          {platformAdmin && <Link href="/platform" onClick={() => setSheetOpen(false)} className="flex min-h-12 items-center rounded-md px-3 text-base text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">Administração da plataforma</Link>}
          {error && <p role="alert" className="px-3 text-destructive text-xs">{error}</p>}
          <button onClick={logout} disabled={pending} className="flex min-h-12 items-center gap-3 rounded-md px-3 text-base text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-60">
            <LogOut className="size-[18px]" aria-hidden="true" />{pending ? "Saindo…" : "Sair"}
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TabItem({ href, icon, label, active, ...props }: { href?: string; icon: React.ReactNode; label: string; active: boolean } & React.ComponentProps<"button">) {
  const content = (
    <>
      <span className={cn("grid h-[30px] w-10 place-items-center rounded-md transition-colors", active && "bg-primary text-primary-foreground")}>{icon}</span>
      {label}
    </>
  );
  const className = cn("flex flex-col items-center gap-0.5 text-[11px] font-medium", active ? "text-foreground" : "text-subtle-foreground");
  if (href) return <Link href={href} className={className} aria-current={active ? "page" : undefined} data-tab-active={active || undefined}>{content}</Link>;
  return <button type="button" className={className} data-tab-active={active || undefined} {...props}>{content}</button>;
}
