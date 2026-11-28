// Neuro Guard in a real Chromium: the extension loaded unpacked, the sites and Neuro's summary.json served by
// Playwright routes (no real network). node test/e2e.playwright.mjs  (CHROMIUM_PATH optional)
import { createRequire } from "node:module";
// Playwright before 1.57 routes a service worker's own requests only with this flag (the extension's fetches are there)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const req = createRequire(import.meta.url);
// "playwright" where it is installed; else Neuro's pinned playwright-core (CI: security.yml installs it and Chromium)
const { chromium } = (() => { try { return req("playwright"); } catch { return req("../../zetaphy-neuro/node_modules/playwright-core"); } })();
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ext = new URL("..", import.meta.url).pathname;
const A = "0x" + "ab".repeat(20), B = "0x" + "12".repeat(20);
const shot = process.env.SHOT;
const dir = mkdtempSync(join(tmpdir(), "ng-"));
const ctx = await chromium.launchPersistentContext(dir, {
  // extensions need the full Chromium (channel "chromium", new headless), not the headless shell
  headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }), viewport: { width: 1000, height: 700 }, locale: process.env.LANG_UI || "en-US",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
});
try {
  const seen = [];
  await ctx.route("https://neuro.sawasdeecoin.com/**", (r) => {
    seen.push(r.request().url());
    if (r.request().url().includes(A)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, chain: "bsc", address: A, symbol: "PMOON", level: "high", checkedAt: "2026-11-28T05:00:00Z",
      en: { title: "High risk", lines: [{ severity: "high", text: "Can mint new tokens (mint(address,uint256)) <img src=x onerror=alert(1)>" }, { severity: "high", text: "The owner holds 92.5% of the pool's LP tokens." }] },
      th: { title: "เสี่ยงสูง", lines: [{ severity: "high", text: "สร้างเหรียญเพิ่มได้" }] } }) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route("https://bscscan.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Token</title><h1>Token page</h1>" }));
  let sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  await page.goto(`https://bscscan.com/token/${A}`);
  const card = page.locator("neuro-guard");
  await card.waitFor({ state: "attached", timeout: 10000 });
  const text = await page.evaluate(() => document.querySelector("neuro-guard").shadowRoot); // closed: null from the page
  assert.equal(text, null, "the card's shadow root is closed to the page");
  if (shot) await page.screenshot({ path: `${shot}-high.png` });
  // single-page navigation to a token Neuro has no report for
  await page.evaluate((b) => history.pushState(null, "", `/token/${b}`), B);
  await page.waitForTimeout(2500);
  assert.equal(await card.count(), 1, "a card for the new token");
  if (shot) await page.screenshot({ path: `${shot}-missing.png` });
  assert.ok(seen.some((u) => u.endsWith(`/reports/bsc/${A}/summary.json`)) && seen.some((u) => u.endsWith(`/reports/bsc/${B}/summary.json`)), "both looked up");
  console.log("e2e ok", sw.url());
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}
