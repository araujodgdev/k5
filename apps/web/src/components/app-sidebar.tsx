"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Ellipsis, LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-provider";
import { InstallApp } from "@/components/pwa-provider";
import { FeedbackDialog, FeedbackTrigger } from "@/components/feedback-dialog";
import { navIcons, navTone } from "@/components/nav-icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readNavCollapsed, subscribeNavCollapsed, writeNavCollapsed } from "@/lib/nav-collapse";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { adminNavigation, appNavigation, mobileTabs } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// Registration wakes GSAP's ticker; Workers forbid timers during SSR imports.
if (typeof window !== "undefined") gsap.registerPlugin(useGSAP);

export function AppSidebar({ officeName, platformAdmin = false }: { officeName: string; platformAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const [feedback, setFeedback] = useState<{ open: boolean; view: "form" | "history" }>({ open: false, view: "form" });
  const feedbackOpener = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabbarRef = useRef<HTMLElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreTitleRef = useRef<HTMLHeadingElement>(null);
  const placed = useRef(false);
  const collapsed = useSyncExternalStore(subscribeNavCollapsed, readNavCollapsed, () => false);

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

  useEffect(() => {
    let mounted = true;
    const load = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void fetch("/api/notifications/count", { cache: "no-store" }).then(async (response) => {
        if (!response.ok || !mounted) return;
        const value = await response.json() as { unread?: number };
        if (mounted) setUnread(Math.max(0, Number(value.unread ?? 0)));
      }).catch(() => {});
    };
    const onMessage = (event: MessageEvent) => { if (event.data?.type === "K5_NOTIFICATION") load(); };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("k5-notifications") : null;
    channel?.addEventListener("message", load);
    load();
    const timer = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("online", load);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("online", load);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [pathname]);

  // Notifications and old links open the dialog on the person's reports with ?feedback=relatos.
  const searchParams = useSearchParams();
  const reportsRequested = searchParams.get("feedback") === "relatos";
  const [reportsHandled, setReportsHandled] = useState(false);
  if (reportsRequested !== reportsHandled) {
    setReportsHandled(reportsRequested);
    if (reportsRequested) setFeedback({ open: true, view: "history" });
  }
  useEffect(() => {
    if (!reportsRequested) return;
    const rest = new URLSearchParams(searchParams);
    rest.delete("feedback");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [reportsRequested, searchParams, pathname, router]);

  function openFeedback(opener: HTMLElement) {
    feedbackOpener.current = opener;
    setSheetOpen(false);
    setFeedback({ open: true, view: "form" });
  }

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

  const adminActive = pathname === adminNavigation.href || pathname.startsWith(`${adminNavigation.href}/`);
  const overflow = appNavigation.filter((item) => !mobileTabs.includes(item.slug));
  const overflowActive = overflow.some((item) => pathname === `/app/${item.slug}`) || adminActive;
  const currentModule = pathname.startsWith("/app/documents/")
    ? "Cofre"
    : adminActive ? adminNavigation.label : appNavigation.find((item) => {
        const href = `/app/${item.slug}`;
        return pathname === href || pathname.startsWith(`${href}/`);
      })?.label ?? "Início";

  return (
    <>
      <TooltipProvider delayDuration={300}>
      <SidebarProvider open={!collapsed} onOpenChange={(open) => writeNavCollapsed(!open)} className="hidden min-h-0 w-auto md:block">
        <Sidebar collapsible="none" className="app-nav sticky top-0 h-dvh border-0 bg-canvas p-2 transition-[width] duration-200 ease-(--ease) motion-reduce:transition-none">
          <SidebarHeader className="gap-3 px-2 pt-3">
            <Link href="/app" aria-label="Lume — início" className="w-fit rounded-sm">
              <span className="nav-label"><Logo height={16} /></span><span className="nav-mark hidden"><Logo height={17} markOnly /></span>
            </Link>
            <p className="nav-label truncate font-medium text-sm" title={officeName}>{officeName}</p>
          </SidebarHeader>
          <SidebarContent className="px-0 pt-2">
            <SidebarMenu ref={navRef} className="relative gap-0.5 px-2">
              <span ref={indicatorRef} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 rounded-md bg-brand-soft" />
              {appNavigation.map((item) => {
                const href = `/app/${item.slug}`;
                const Icon = navIcons[item.slug];
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <SidebarMenuItem key={item.slug}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label} className="relative h-9 data-[active=true]:bg-transparent">
                      <Link href={href} aria-current={active ? "page" : undefined} aria-label={collapsed ? item.label : undefined}>
                        <Icon aria-hidden="true" className={navTone[item.slug]} /><span className="nav-label">{item.label}</span>
                        {item.slug === "notifications" && unread > 0 && <>
                          <span className="nav-label ml-auto text-xs text-muted-foreground" aria-label={`${unread} notificações não lidas`}>{unread}</span>
                          <span className="nav-dot absolute top-1.5 left-6 hidden size-1.5 rounded-full bg-brand" aria-hidden="true" />
                        </>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {platformAdmin && <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={adminActive} tooltip={adminNavigation.label} className="relative h-9 data-[active=true]:bg-transparent">
                  <Link href={adminNavigation.href} aria-current={adminActive ? "page" : undefined} aria-label={collapsed ? adminNavigation.label : undefined}>
                    <ShieldCheck aria-hidden="true" /><span className="nav-label">{adminNavigation.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="px-2">
            {error && <p role="alert" className="nav-label px-2 text-destructive text-xs">{error}</p>}
            <div className="nav-footer flex items-center gap-1">
              <SidebarMenu className="min-w-0 flex-1">
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={logout} disabled={pending} className="h-9" tooltip="Sair" aria-label={collapsed ? "Sair" : undefined} title="Encerrar sessão em todos os dispositivos">
                    <LogOut aria-hidden="true" /><span className="nav-label">{pending ? "Saindo…" : "Sair"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <FeedbackTrigger onOpen={openFeedback} />
              <InstallApp />
              <ThemeSwitch />
            </div>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
      </TooltipProvider>

      <header className="sticky top-0 z-10 flex h-[calc(3.25rem+env(safe-area-inset-top))] min-w-0 items-center gap-2.5 bg-background/85 px-5 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <Link href="/app" aria-label="Lume — início" className="flex shrink-0 items-center rounded-sm"><Logo height={17} markOnly /></Link>
        <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
        <p className="shrink-0 text-sm font-medium">{currentModule}</p>
        <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
        <p className="min-w-0 truncate text-sm text-muted-foreground" title={officeName}>{officeName}</p>
      </header>

      <nav ref={tabbarRef} aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] grid-cols-5 border-t bg-background/90 px-2 pt-1.5 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {mobileTabs.map((slug) => {
          const item = appNavigation.find((entry) => entry.slug === slug)!;
          const href = `/app/${slug}`;
          const Icon = navIcons[slug];
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return <TabItem key={slug} href={href} icon={<Icon className={cn("size-[18px]", !active && navTone[slug])} aria-hidden="true" />} label={item.short} active={active} />;
        })}
        <TabItem ref={moreButtonRef} icon={<Ellipsis className="size-[18px]" aria-hidden="true" />} label="Mais" active={overflowActive} onClick={() => setSheetOpen(true)} aria-haspopup="dialog" aria-expanded={sheetOpen} />
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="gap-1 p-2" onOpenAutoFocus={(event) => { event.preventDefault(); moreTitleRef.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); moreButtonRef.current?.focus(); }}>
          <SheetTitle ref={moreTitleRef} tabIndex={-1} className="px-3 py-2 pr-12 font-sans text-sm outline-none">Mais opções</SheetTitle>
          {overflow.map((item) => {
            const href = `/app/${item.slug}`;
            const Icon = navIcons[item.slug];
            const active = pathname === href;
            return (
              <Link key={item.slug} href={href} aria-current={active ? "page" : undefined} onClick={() => setSheetOpen(false)}
                className={cn("flex min-h-12 items-center gap-3 rounded-md px-3 text-base transition-colors", active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                <Icon className={cn("size-[18px]", navTone[item.slug])} aria-hidden="true" />{item.label}
                {item.slug === "notifications" && unread > 0 && <span className="ml-auto text-sm" aria-label={`${unread} notificações não lidas`}>{unread}</span>}
              </Link>
            );
          })}
          {platformAdmin && <Link href={adminNavigation.href} aria-current={adminActive ? "page" : undefined} onClick={() => setSheetOpen(false)}
            className={cn("flex min-h-12 items-center gap-3 rounded-md px-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", adminActive ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
            <ShieldCheck className="size-[18px]" aria-hidden="true" />{adminNavigation.label}</Link>}
          <Separator className="my-1.5" />
          {error && <p role="alert" className="px-3 text-destructive text-xs">{error}</p>}
          <div className="flex items-center gap-1">
            <button onClick={logout} disabled={pending} className="flex min-h-12 flex-1 items-center gap-3 rounded-md px-3 text-base text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-60">
              <LogOut className="size-[18px]" aria-hidden="true" />{pending ? "Saindo…" : "Sair"}
            </button>
            <FeedbackTrigger className="size-12" onOpen={openFeedback} />
            <InstallApp className="size-12" />
            <ThemeSwitch className="size-12" />
          </div>
        </SheetContent>
      </Sheet>

      <FeedbackDialog open={feedback.open} initialView={feedback.view} pathname={pathname}
        onOpenChange={(open) => setFeedback((current) => ({ ...current, open }))}
        onCloseFocus={() => {
          // The sheet that held the mobile trigger is gone by now; its "Mais" button takes the focus back.
          const opener = feedbackOpener.current;
          if (opener?.isConnected && opener.offsetParent !== null) opener.focus();
          else if (moreButtonRef.current?.offsetParent) moreButtonRef.current.focus();
          else document.getElementById("main-content")?.focus();
        }} />
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
