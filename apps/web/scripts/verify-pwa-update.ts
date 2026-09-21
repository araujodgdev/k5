/** Real multi-tab worker regression, isolated from the application and user data. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";

const template = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");
const assets = ["/_next/static/chunks/old-123abc.js", "/_next/static/css/old-456def.css"];
let release = 1;
const server = createServer((request, response) => {
  const path = request.url;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/sw.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(template.replace("__K5_BUILD__", `release-${release}`));
  } else if (path && assets.includes(path)) {
    if (release !== 1) { response.writeHead(404); response.end("Removed from deployment"); return; }
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.setHeader("Content-Type", path.endsWith(".js") ? "application/javascript" : "text/css");
    response.end(path.endsWith(".js") ? 'export const version = "old-release";' : "body { --old-release: available; }");
  } else if (path === "/tab") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><body><textarea aria-label="Draft"></textarea></body></html>');
  } else {
    // Only the worker's public install fixtures are requested here.
    response.end("public fixture");
  }
});
await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true }).catch((error: unknown) => { server.close(); throw error; });

try {
  const context = await browser.newContext();
  const updatingTab = await context.newPage();
  const oldTab = await context.newPage();
  for (const page of [updatingTab, oldTab]) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(`${origin}/tab`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(`(() => {
      document.documentElement.dataset.controllerChanges = "0";
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        document.documentElement.dataset.controllerChanges = String(Number(document.documentElement.dataset.controllerChanges) + 1);
      });
    })()`);
  }
  await oldTab.getByRole("textbox", { name: "Draft" }).fill("unsaved draft");
  // Warm the worker cache without populating the old tab's JS module map.
  for (const asset of assets) {
    assert.equal(await updatingTab.evaluate(async (path) => (await fetch(path)).status, asset), 200);
  }
  for (release = 2; release <= 3; release++) {
    await updatingTab.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => updatingTab.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    await updatingTab.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.waiting) throw new Error("No waiting worker");
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    });
    await expect(oldTab.locator("html")).toHaveAttribute("data-controller-changes", String(release - 1));
    await updatingTab.reload();
    await expect(oldTab.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved draft");
    for (const asset of assets) {
      // Bypass the worker to prove the origin has actually removed the asset.
      assert.equal((await context.request.get(`${origin}${asset}`)).status(), 404);
      assert.equal(await oldTab.evaluate(async (path) => (await fetch(path)).status, asset), 200);
    }
  }
  // Loading a previously unexecuted module/stylesheet still works under the new worker.
  assert.equal(await oldTab.evaluate(async (path) => (await import(path)).version as string, assets[0]), "old-release");
  await oldTab.addStyleTag({ url: `${origin}${assets[1]}` });
  assert.equal(await oldTab.evaluate(() => getComputedStyle(document.body).getPropertyValue("--old-release").trim()), "available");
  await expect(oldTab.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved draft");
  console.log("PASS: two accepted updates preserve an old tab's draft, lazy JS and CSS after origin removal, with the HTTP cache disabled.");
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
}
