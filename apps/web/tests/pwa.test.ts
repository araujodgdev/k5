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

function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const cached = new Map<string, Response>();
  const deleted: string[] = [];
  let networkCalls = 0;
  let offline = false;
  let skipped = false;
  let response = new Response("network");
  Object.defineProperty(response, "type", { value: "basic" });
  const key = (request: string | { url: string }) => typeof request === "string" ? request : request.url;
  const cache = {
    addAll: async (paths: string[]) => { paths.forEach((path) => cached.set(path, new Response(path))); },
    match: async (request: string | { url: string }) => cached.get(key(request))?.clone(),
    put: async (request: { url: string }, value: Response) => { cached.set(key(request), value); },
  };
  runInNewContext(source, {
    URL, Response,
    self: {
      location: { origin: "https://k5.test" },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => listeners.set(name, handler),
      clients: { claim: async () => {} },
      skipWaiting: async () => { skipped = true; },
    },
    caches: {
      open: async () => cache,
      match: cache.match,
      keys: async () => ["another-app", "k5-public-old", "k5-public-__K5_BUILD__"],
      delete: async (name: string) => { deleted.push(name); },
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
    cached, deleted, dispatch,
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
  const sw = worker();
  await sw.dispatch("install");
  assert.equal(sw.cached.size, 5);
  assert.ok([...sw.cached.keys()].every((key) => key === "/offline.html" || key.startsWith("/icons/")));
  assert.equal(sw.skipped, false);
  await sw.dispatch("activate");
  assert.deepEqual(sw.deleted, ["k5-public-old"]);
  await sw.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(sw.skipped, true);
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
