import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../scripts/service-worker.js", import.meta.url), "utf8");
type WorkerEvent = {
  request?: { url: string; method: string; mode: string; headers: Headers };
  data?: unknown;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
};

type CacheBuckets = Map<string, Map<string, Response>>;

function worker({ version = "__K5_BUILD__", buckets = new Map(), clients = [] }: {
  version?: string; buckets?: CacheBuckets; clients?: { id: string }[];
} = {}) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const cached = new Map<string, Response>();
  buckets.set(`k5-public-${version}`, cached);
  const deleted: string[] = [];
  let networkCalls = 0;
  let offline = false;
  let skipped = false;
  let response = new Response("network");
  Object.defineProperty(response, "type", { value: "basic" });
  const key = (request: string | { url: string }) => typeof request === "string" ? request : request.url;
  const open = async (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const entries = buckets.get(name)!;
    return {
      addAll: async (paths: string[]) => { paths.forEach((path) => entries.set(path, new Response(path))); },
      match: async (request: string | { url: string }) => entries.get(key(request))?.clone(),
      put: async (request: { url: string }, value: Response) => { entries.set(key(request), value); },
    };
  };
  runInNewContext(source.replace("__K5_BUILD__", version), {
    URL, Response,
    self: {
      location: { origin: "https://k5.test" },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => listeners.set(name, handler),
      clients: {
        claim: async () => {},
        matchAll: async (options: unknown) => {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), { includeUncontrolled: true, type: "all" });
          return clients;
        },
      },
      skipWaiting: async () => { skipped = true; },
    },
    caches: {
      open,
      match: async (request: string | { url: string }) => {
        for (const entries of buckets.values()) {
          const response = entries.get(key(request));
          if (response) return response.clone();
        }
      },
      keys: async () => [...buckets.keys()],
      delete: async (name: string) => { deleted.push(name); return buckets.delete(name); },
    },
    fetch: async () => {
      networkCalls++;
      if (offline) throw new TypeError("offline");
      const result = response.clone();
      Object.defineProperty(result, "type", { value: response.type });
      return result;
    },
  });
  async function dispatch(name: string, input: Partial<WorkerEvent> = {}) {
    let result: Promise<Response> | undefined;
    const work: Promise<unknown>[] = [];
    listeners.get(name)!({ ...input, waitUntil: (promise) => work.push(promise), respondWith: (promise) => { result = promise; } });
    await Promise.all(work);
    return result;
  }
  return {
    cached, deleted, dispatch, buckets,
    get networkCalls() { return networkCalls; },
    get skipped() { return skipped; },
    setOffline() { offline = true; },
    setResponse(value: Response) { response = value; },
    fetch(path: string, mode = "cors", method = "GET", headers = new Headers()) {
      return dispatch("fetch", { request: { url: new URL(path, "https://k5.test").href, mode, method, headers } });
    },
  };
}

test("PWA: install caches only the public offline screen and icons; activation preserves other apps", async () => {
  const sw = worker({ buckets: new Map([["another-app", new Map()], ["k5-public-old", new Map()]]) });
  await sw.dispatch("install");
  assert.equal(sw.cached.size, 5);
  assert.ok([...sw.cached.keys()].every((key) => key === "/offline.html" || key.startsWith("/icons/")));
  assert.equal(sw.skipped, false);
  await sw.dispatch("activate");
  assert.deepEqual(sw.deleted, ["k5-public-old"]);
  assert.ok(sw.buckets.has("another-app"));
  assert.ok(sw.buckets.has("k5-public-__K5_BUILD__"));
  await sw.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(sw.skipped, true);
});

test("PWA: accepted update keeps old-tab chunks available after the deployment removes them", async () => {
  const old = worker({ version: "old" });
  await old.fetch("/_next/static/chunks/old-hash.js");
  await old.fetch("/_next/static/css/old-hash.css");
  const next = worker({ version: "new", buckets: old.buckets, clients: [{ id: "old-tab" }, { id: "updating-tab" }] });
  await next.dispatch("install");
  await next.dispatch("message", { data: { type: "SKIP_WAITING" } });
  await next.dispatch("activate");
  next.setResponse(new Response("Removed by deployment", { status: 404 }));
  for (const asset of ["/_next/static/chunks/old-hash.js", "/_next/static/css/old-hash.css"]) {
    const response = await next.fetch(asset);
    assert.equal(response?.status, 200, "an old tab must still be able to load its cached chunk");
    assert.equal(await response?.text(), "network");
  }
  assert.equal(next.networkCalls, 0);
  const newest = worker({ version: "newest", buckets: old.buckets, clients: [{ id: "old-tab" }] });
  await newest.dispatch("activate");
  newest.setOffline();
  assert.equal((await newest.fetch("/_next/static/chunks/old-hash.js"))?.status, 200);
});

test("PWA: retained caches cannot supply stale offline pages or other apps' assets", async () => {
  const old = worker({ version: "old" });
  old.cached.set("/offline.html", new Response("old offline"));
  old.cached.set("https://k5.test/icons/icon-192.png", new Response("old icon"));
  old.buckets.set("another-app", new Map([["https://k5.test/_next/static/foreign.js", new Response("foreign")]]));
  const next = worker({ version: "new", buckets: old.buckets, clients: [{ id: "old-tab" }] });
  await next.dispatch("install");
  await next.dispatch("activate");
  next.cached.delete("/icons/icon-192.png");
  assert.equal(await (await next.fetch("/icons/icon-192.png"))?.text(), "network");
  assert.equal(await (await next.fetch("/_next/static/foreign.js"))?.text(), "network");
  next.setOffline();
  assert.equal(await (await next.fetch("/app", "navigate"))?.text(), "/offline.html");
  assert.equal(next.deleted.length, 0);
});

test("PWA: private HTML always reaches the server and never enters Cache Storage", async () => {
  const sw = worker();
  for (const route of ["/app/vault", "/app/documents/123", "/platform/clients", "/sign-in"]) {
    assert.equal(await (await sw.fetch(route, "navigate"))?.text(), "network");
  }
  assert.equal(sw.networkCalls, 4);
  assert.equal(sw.cached.size, 0);
  sw.setResponse(new Response("Unauthorized", { status: 401 }));
  assert.equal((await sw.fetch("/app", "navigate"))?.status, 401);
});

test("PWA: disconnected navigation has a public fallback, never stale office data", async () => {
  const sw = worker();
  await sw.dispatch("install");
  sw.setOffline();
  assert.equal(await (await sw.fetch("/app/vault", "navigate"))?.text(), "/offline.html");
  sw.cached.clear();
  assert.equal((await sw.fetch("/app", "navigate"))?.status, 503);
});

test("PWA: APIs, downloads, actions, RSC and foreign requests bypass the worker", async () => {
  const sw = worker();
  const paths = ["/api/auth/get-session", "/api/vault/documents/1/download", "/app?_rsc=123", "/uploads/client.pdf", "https://other.test/_next/static/app.js"];
  for (const path of paths) assert.equal(await sw.fetch(path), undefined);
  assert.equal(await sw.fetch("/api/vault/documents/1/download", "navigate"), undefined);
  assert.equal(await sw.fetch("/app", "cors", "POST"), undefined);
  assert.equal(await sw.fetch("/_next/static/app.js", "cors", "GET", new Headers({ RSC: "1" })), undefined);
  assert.equal(sw.networkCalls, 0);
  assert.equal(sw.cached.size, 0);
});

test("PWA: errors and private responses cannot poison the public asset cache", async () => {
  const sw = worker();
  for (const response of [new Response("error", { status: 500 }), new Response("private", { headers: { "Cache-Control": "private, no-store" } })]) {
    Object.defineProperty(response, "type", { value: "basic" });
    sw.setResponse(response);
    await sw.fetch("/_next/static/app.js");
    assert.equal(sw.cached.size, 0);
  }
});

test("PWA: public assets can be reused offline", async () => {
  const sw = worker();
  assert.equal(await (await sw.fetch("/_next/static/app.js"))?.text(), "network");
  assert.equal(sw.cached.size, 1);
  sw.setOffline();
  assert.equal(await (await sw.fetch("/_next/static/app.js"))?.text(), "network");
  assert.equal(sw.networkCalls, 1);
});
