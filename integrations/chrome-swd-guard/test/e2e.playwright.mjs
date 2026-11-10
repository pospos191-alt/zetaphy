import { createRequire } from "node:module";
// Optional end-to-end check in a real Chromium (needs Playwright: npm i -g playwright && npx playwright install chromium).
// All network calls are answered locally (page.route), so it runs offline:  node test/e2e.playwright.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
// Playwright from PLAYWRIGHT_DIR (a node_modules folder), else the global install.
const require = createRequire(join(process.env.PLAYWRIGHT_DIR || execSync("npm root -g").toString().trim(), "/"));
const { chromium } = require("playwright");
const EXT = new URL("..", import.meta.url).pathname;
const MINT = "Cmh2tu6bt5z2a8NKsx6G5WfVmaeQ9f2fcX5VnQbVaGLL";
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "swd-guard-")), {
  headless: true, channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--lang=th"],
  locale: "th-TH",
});
let apiCalls = [];
await ctx.route("https://swd-zetaphy.sawasdeecoin.com/**", (r) => {
  apiCalls.push(r.request().url());
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, audit: { level: "high", title: "ความเสี่ยงสูง", token: { symbol: "SCAM<b>" }, lines: [{ id: "x", severity: "high", text: "Mint authority <img src=x onerror=alert(1)> active" }], permalink: `https://swd-zetaphy.sawasdeecoin.com/audit/sol/${MINT}` } }) });
});
await ctx.route("https://solscan.io/**", (r) => r.fulfill({ contentType: "text/html", body: "<html><body><h1>token</h1></body></html>" }));
await ctx.route("https://sawasdeecoin-claim.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<html><body><h1>fake claim</h1></body></html>" }));
// a phishing page that knows about SWD Guard: hides the warning with CSS and keeps deleting it
await ctx.route("https://sawasdeecoin-airdrop.com/**", (r) => r.fulfill({ contentType: "text/html", body:
  "<html><head><style>swd-guard-warning{display:none!important;visibility:hidden!important;opacity:0!important}</style></head><body><h1>fake airdrop</h1>" +
  "<script>setInterval(() => document.querySelectorAll('swd-guard-warning').forEach((e) => { e.style.cssText = 'display:none'; e.remove(); }), 30)</script></body></html>" }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
console.log("extension id", id);
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`https://solscan.io/token/${MINT}`);
await page.waitForTimeout(2500);
const badge = await page.evaluate(() => !!document.querySelector("swd-guard-badge"));
console.log("badge element:", badge, "api calls:", apiCalls.length, apiCalls[0]);

const p2 = await ctx.newPage();
await p2.goto("https://sawasdeecoin-claim.com/");
await p2.waitForTimeout(800);
const phish = await p2.evaluate(() => !!document.querySelector("swd-guard-warning"));
console.log("phish warning:", phish);
if (!phish) errors.push("no phishing warning");

const p3 = await ctx.newPage();
await p3.goto("https://sawasdeecoin-airdrop.com/");
await p3.waitForTimeout(1500);
const kept = await p3.evaluate(() => {
  const w = document.querySelector("swd-guard-warning");
  if (!w) return "removed";
  const cs = getComputedStyle(w);
  return cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0" ? `hidden (${cs.display}/${cs.visibility}/${cs.opacity})` : "shown";
});
console.log("phish warning on a hostile page:", kept);
if (kept !== "shown") errors.push(`a phishing page could hide the warning: ${kept}`);

const pop = await ctx.newPage();
pop.on("pageerror", (e) => errors.push("popup: " + e.message));
pop.on("console", (m) => m.type() === "error" && errors.push("popup console: " + m.text()));
await pop.goto(`chrome-extension://${id}/src/popup.html`);
await pop.fill("#q", MINT);
await pop.click("#go");
await pop.waitForTimeout(1000);
console.log("popup result:", (await pop.textContent("#result")).slice(0, 200));

const opt = await ctx.newPage();
opt.on("pageerror", (e) => errors.push("options: " + e.message));
await opt.goto(`chrome-extension://${id}/src/options.html`);
await opt.waitForTimeout(500);
console.log("options:", (await opt.textContent("main")).slice(0, 120));
console.log("errors:", errors);
await ctx.close();
if (!badge || errors.length || !apiCalls.length) {
  console.error("e2e FAILED");
  process.exit(1);
}
console.log("e2e ok");
