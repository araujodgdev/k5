/* Only public assets belong here. Never cache pages, RSC, API responses or uploads.
 * VERSION is stamped by the build script. New workers wait for
 * an explicit update so that a deployment cannot interrupt an unsaved draft. */
const VERSION = "__K5_BUILD__";
const PREFIX = "k5-public-";
const CACHE = `${PREFIX}${VERSION}`;
const OFFLINE = "/offline.html";
const PUBLIC_FILES = [OFFLINE, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // skipWaiting/claim can leave old application code running in other tabs.
    // Include clients still controlled by the previous worker (and web workers).
    // Without per-client build tracking, retain every prior version until an
    // activation sees no clients at all. Never evict by age or number of builds.
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "all" });
    if (clients.length === 0) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "CLOSE_K5_NOTIFICATIONS") {
    event.waitUntil(self.registration.getNotifications().then((items) => Promise.all(items.map((item) => item.close()))));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || payload.version !== 1 || typeof payload.id !== "string" || !/^[A-Za-z0-9-]{8,128}$/.test(payload.id)) return;
    if (typeof payload.expiresAt === "string" && Date.parse(payload.expiresAt) <= Date.now()) return;
    const tag = typeof payload.tag === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(payload.tag) ? payload.tag : `k5-${payload.id.slice(0, 24)}`;
    await self.registration.showNotification("K5", {
      body: "Você tem uma atualização no K5.",
      tag,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { notificationId: payload.id },
    });
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    for (const client of clients) client.postMessage({ type: "K5_NOTIFICATION", id: payload.id });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.notificationId;
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,128}$/.test(id)) return;
  event.waitUntil((async () => {
    const path = `/api/notifications/${encodeURIComponent(id)}/open`;
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    const visible = clients.find((client) => "focus" in client);
    if (visible) {
      await visible.focus();
      if ("navigate" in visible) await visible.navigate(path);
      return;
    }
    await self.clients.openWindow(path);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
    for (const client of clients) client.postMessage({ type: "K5_PUSH_SUBSCRIPTION_CHANGED" });
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Downloads/API navigation must keep their original semantics, even offline.
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await (await caches.open(CACHE)).match(OFFLINE)) ?? new Response("Sem conexão. Tente novamente.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    ));
    return;
  }
  if (request.headers.has("RSC") || request.headers.has("Next-Action") || url.search) return;
  const staticAsset = url.pathname.startsWith("/_next/static/") && /\.(?:js|css|woff2?|png|svg|webp)$/.test(url.pathname);
  if (!staticAsset && !PUBLIC_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Only content-addressed Next assets may fall back across releases. Public
    // files with stable URLs (especially offline.html) belong to this version.
    if (staticAsset) {
      const keys = await caches.keys();
      for (const key of keys.reverse()) {
        if (!key.startsWith(PREFIX) || key === CACHE) continue;
        const previous = await (await caches.open(key)).match(request);
        if (previous) return previous;
      }
    }
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && !response.redirected && !/private|no-store/i.test(response.headers.get("Cache-Control") ?? "")) {
      // Cache storage may be full or disabled; the network response still works.
      try { await cache.put(request, response.clone()); } catch { /* Best effort. */ }
    }
    return response;
  })());
});
