/** Run against pnpm build && pnpm start. Uses the existing local validation account. */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const artifacts = new URL("../playwright-report/pwa/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto("/sign-in");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifestResponse = await context.request.get("/manifest.webmanifest");
  const manifest = await manifestResponse.json() as { name: string; short_name: string; display: string; start_url: string; icons: { src: string }[] };
  expect(manifest.name).toBe("Lume — Seu escritório");
  expect(manifest.short_name).toBe("Lume");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/app");
  for (const icon of manifest.icons) expect((await context.request.get(icon.src)).ok()).toBe(true);
  expect((await context.request.get("/sw.js")).headers()["cache-control"]).toContain("no-store");
  const cdp = await context.newCDPSession(page);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  expect(installability.installabilityErrors).toEqual([]);

  const theme = page.getByRole("combobox", { name: "Tema" });
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#20201e");
  await page.reload();
  await expect(theme).toHaveValue("dark");
  await page.screenshot({ path: fileURLToPath(new URL("auth-dark.png", artifacts)) });
  const secondTab = await context.newPage();
  secondTab.on("pageerror", (error) => errors.push(error.message));
  await secondTab.goto("/sign-in");
  await expect(secondTab.getByRole("combobox", { name: "Tema" })).toBeEnabled();
  await theme.selectOption("light");
  await expect(secondTab.locator("html")).toHaveClass(/light/);
  await secondTab.close();
  await theme.selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  await theme.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(theme).toBeFocused();

  await page.evaluate(`(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => { document.documentElement.dataset.installPromptCalled = "true"; return Promise.resolve(); },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  })()`);
  await page.getByRole("button", { name: "Instalar Lume" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-install-prompt-called", "true");
  await page.getByRole("button", { name: "Instalar Lume" }).click();
  await expect(page.getByRole("dialog", { name: "Instalar o Lume" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Instalar Lume" })).toBeFocused();

  // Optional local release simulation. Restore the generated file even on failure.
  if (process.env.PWA_TEST_UPDATE === "1") {
    expect(new URL(baseURL).hostname).toBe("localhost");
    const workerFile = new URL("../public/sw.js", import.meta.url);
    const original = await readFile(workerFile, "utf8");
    const draftTab = await context.newPage();
    try {
      await draftTab.goto("/sign-in");
      await draftTab.getByLabel("E-mail", { exact: true }).fill("rascunho@exemplo.com");
      await writeFile(workerFile, original.replace(/const VERSION = "[^"]+"/, `const VERSION = "${randomUUID()}"`));
      await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
      await expect(page.getByRole("button", { name: "Atualizar agora" })).toBeVisible();
      await expect(draftTab.getByLabel("E-mail", { exact: true })).toHaveValue("rascunho@exemplo.com");
      await Promise.all([
        page.waitForEvent("load"),
        page.getByRole("button", { name: "Atualizar agora" }).click(),
      ]);
      await expect(page.getByRole("button", { name: "Atualizar agora" })).not.toBeVisible();
      await expect(draftTab.getByLabel("E-mail", { exact: true })).toHaveValue("rascunho@exemplo.com");
      console.log("PWA update verified: release waits for acceptance; other tabs keep their drafts.");
    } finally {
      await writeFile(workerFile, original);
      await draftTab.close();
    }
  }

  // Reuse the repository's stable local validation account; never provision one.
  await page.setViewportSize({ width: 320, height: 740 });
  await theme.selectOption("dark");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: fileURLToPath(new URL("mobile-auth-error.png", artifacts)) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("E-mail", { exact: true }).fill(process.env.PWA_TEST_EMAIL ?? "admin@advocacia.test");
  await page.getByLabel("Senha", { exact: true }).fill(process.env.PWA_TEST_PASSWORD ?? "SenhaForte123!@#456");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/app/command-center");
  await theme.selectOption("dark");
  await page.screenshot({ path: fileURLToPath(new URL("desktop-dark.png", artifacts)) });
  for (const route of ["/platform/clients", "/app/vault", "/app/agenda", "/app/agents"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`${route.split("/").at(-1)}-dark.png`, artifacts)) });
  }
  await theme.selectOption("light");
  await page.screenshot({ path: fileURLToPath(new URL("desktop-light.png", artifacts)) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Tema" }).selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: fileURLToPath(new URL("mobile-dark.png", artifacts)) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Mais", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("dialog", { name: "Mais opções" }).getByRole("button", { name: "Instalar Lume" }).click();
  await expect(page.getByRole("dialog", { name: "Instalar o Lume" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Mais opções" }).getByRole("button", { name: "Instalar Lume" })).toBeFocused();
  await page.keyboard.press("Escape");
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Sem conexão");
  await page.goto("/app/vault");
  await expect(page.getByRole("heading", { name: "Você está sem conexão" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: fileURLToPath(new URL("offline-dark.png", artifacts)) });
  const cachedUrls = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith("k5-public-"));
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)))).flat();
  });
  expect(cachedUrls.length).toBeGreaterThanOrEqual(5);
  expect(cachedUrls.every((url) => url === "/offline.html" || url.startsWith("/icons/") || url.startsWith("/_next/static/"))).toBe(true);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("heading", { name: "Você está sem conexão" })).not.toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
  console.log("PWA verified: installability, icons, themes, persistence, cross-tab sync, keyboard, desktop/mobile, offline fallback, private cache exclusion and reconnect.");
} finally {
  await browser.close();
}
