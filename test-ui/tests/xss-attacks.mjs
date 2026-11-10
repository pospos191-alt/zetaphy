// XSS attack tests for test-ui/index.html (2026-11-10). Run: node xss-attacks.mjs
//
// Feeds the page hostile data from every place an attacker controls and checks that none of it
// becomes markup or runs:
//   - on-chain Metaplex metadata (token name / symbol / uri) — anyone can mint a token named <img onerror>,
//   - an error message stored with a failed limit order (RPC / simulation errors carry program logs,
//     and a token's transfer hook can log anything),
//   - a token nickname (Token Labels),
//   - the SWD Audit API answer (verdict, permalink).
// Pass 1 serves the page WITHOUT a CSP, so only the page's own escaping protects it.
// Pass 2 serves it with the real CSP from vercel.json: the page must still start (no inline
// handler / script it depends on is blocked), and an injected handler must be refused.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(here, "../index.html");
const stub = (name) => fs.readFileSync(path.join(here, "stubs", name));
const vercel = JSON.parse(fs.readFileSync(path.join(here, "../vercel.json"), "utf8"));
const CSP = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

function serve(withCsp) {
  const server = http.createServer((req, res) => {
    if (withCsp) res.setHeader("content-security-policy", CSP);
    if (req.url.startsWith("/index.html")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(fs.readFileSync(htmlPath));
    }
    if (/^\/(i18n\/)?[a-z0-9-]+\.(js|css)$/.test(req.url)) {
      const f = path.join(path.dirname(htmlPath), req.url.slice(1));
      if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
      res.setHeader("content-type", req.url.endsWith(".css") ? "text/css" : "text/javascript");
      return res.end(fs.readFileSync(f));
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const A = "JDxHq1Zk2yN3xG8m9pXa7vQeW4tRbY6uLcFs5oPeamz";
const B = "4T8mq3mX7nB2cR8tY4wZ1aS6dF5gH3jK2kP9o5867iN";
const P = (tag) => `<img data-xss="${tag}" src=x onerror="__xss('${tag}')"><svg data-xss="${tag}-svg" onload="__xss('${tag}-svg')">`;

const failures = [];
const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
for (const withCsp of [false, true]) {
  const label = withCsp ? "with CSP" : "no CSP (escaping only)";
  const server = await serve(withCsp);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.route((url) => !url.href.startsWith(origin), async (route) => {
    const u = route.request().url();
    const js = (body) => route.fulfill({ status: 200, contentType: "application/javascript", body });
    if (u.includes("esm.sh/@solana/web3.js")) return js(stub("web3.js"));
    if (u.includes("esm.sh/@coral-xyz/anchor")) return js(stub("anchor.js"));
    if (u.includes("esm.sh/@solana/spl-token")) return js(stub("spl-token.js"));
    if (u.includes("esm.sh/buffer")) return js(stub("buffer.js"));
    if (u.includes("/api/audit")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ ok: true, audit: { level: "high", verdict: `"><b data-xss=verdict>${P("verdict")}`, permalink: `https://x.example/" onmouseover="__xss('permalink')`, findings: [{ title: P("finding") }] } }) });
    }
    if (u.includes("evil.example/meta.json")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ image: `javascript:__xss('image')` }) });
    }
    if (u.includes("klinecharts")) return js("window.klinecharts={init(){return new Proxy({}, {get:()=>()=>null})},dispose(){},registerOverlay(){},registerIndicator(){},getSupportedOverlays(){return []}};");
    if (/\.(css)(\?|$)/.test(u) || u.includes("fonts.googleapis")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (/\.(png|svg|jpe?g|gif|webp)(\?|$)/.test(u)) return route.fulfill({ status: 404, body: "" });
    return js("");
  });
  await ctx.addInitScript(([a, b]) => {
    const payload = (tag) => `<img data-xss="${tag}" src=x onerror="__xss('${tag}')"><svg data-xss="${tag}-svg" onload="__xss('${tag}-svg')">`;
    window.__pwned = [];
    window.__xss = (tag) => window.__pwned.push(tag);
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ""} ${(e.sample || "").slice(0, 60)}`));
    // Metaplex metadata accounts with a hostile name / symbol / uri, for every mint the page asks about
    const enc = new TextEncoder();
    const bstr = (s) => { const b = enc.encode(s); const out = new Uint8Array(4 + b.length); new DataView(out.buffer).setUint32(0, b.length, true); out.set(b, 4); return out; };
    const meta = () => { const parts = [new Uint8Array(65), bstr(payload("name")), bstr(payload("sym").slice(0, 60)), bstr("https://evil.example/meta.json")]; const n = parts.reduce((x, p) => x + p.length, 0); const d = new Uint8Array(n); let o = 0; for (const p of parts) { d.set(p, o); o += p.length; } return d; };
    globalThis.__smokeMultiple = (keys) => keys.map(() => ({ data: meta(), owner: null, lamports: 1, executable: false }));
    if (sessionStorage.getItem("xss-seeded")) return;
    sessionStorage.setItem("xss-seeded", "1");
    localStorage.setItem("swd-amm-active-mint-a", a);
    localStorage.setItem("swd-amm-active-mint-b", b);
    localStorage.setItem("swd-amm-recent-pairs-v1", JSON.stringify([{ mintA: a, mintB: b, pinned: false, lastUsedAt: Date.now() }]));
    localStorage.setItem("swd-amm-recent-mints", JSON.stringify([a, b]));
    localStorage.setItem("swd-amm-token-labels", JSON.stringify({ [a]: payload("nickname") }));
    localStorage.setItem("swd-amm-limit-orders", JSON.stringify([{ id: "lo-1", mintA: a, mintB: b, aToB: true, poolType: "cp", amountIn: "1000", decIn: 6,
      targetPrice: 1, condition: "lte", status: "failed", failCount: 5, createdAt: Date.now(),
      lastError: `Simulation failed. Logs: ["Program log: ${payload("lastError")}"]` }]));
  }, [A, B]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/index.html`);
  const ready = await page.waitForFunction(() => document.documentElement.dataset.appReady === "1", null, { timeout: 25000 }).then(() => true, () => false);
  if (!ready) failures.push(`${label}: startup never finished (${errors.slice(0, 3).join(" | ")})`);
  // let the metadata batch (300 ms) and the coalesced re-render (400 ms) run, then poke a few views
  await page.waitForTimeout(1500);
  for (const sel of ['.tab-nav-btn[data-tab="tools"]', '.dock-tab[data-dock-tool="lo"]', '.dock-tab[data-dock-tool="swap"]']) {
    await page.click(sel, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const r = await page.evaluate(() => ({
    pwned: window.__pwned,
    injected: [...document.querySelectorAll("[data-xss]")].map((e) => e.getAttribute("data-xss")),
    csp: window.__csp,
    loErr: document.getElementById("lo-list-container")?.textContent.includes("Program log:") ?? false,
    // the hostile names did reach the page (as plain text, with < > " ' stripped)
    shownAsText: document.body.textContent.includes("img data-xss=nickname") && document.body.textContent.includes("img data-xss"),
    metaFetched: [...document.querySelectorAll("[data-token-label]")].some((e) => e.textContent.startsWith("img data-xss") && !e.textContent.includes("nickname")),
  }));
  if (r.pwned.length) failures.push(`${label}: injected code RAN: ${r.pwned.join(", ")}`);
  if (r.injected.length) failures.push(`${label}: hostile data became markup: ${r.injected.join(", ")}`);
  if (!r.shownAsText) failures.push(`${label}: the hostile nickname never reached the page (test setup?)`);
  if (!r.metaFetched) failures.push(`${label}: the hostile on-chain symbol never reached the page (test setup?)`);
  if (!r.loErr) failures.push(`${label}: the failed limit order's error text is not shown (test setup?)`);
  if (withCsp) {
    const own = r.csp.filter((v) => !/xss/.test(v));
    if (own.length) failures.push(`with CSP: the page's own code was blocked: ${own.slice(0, 4).join(" | ")}`);
  }
  console.log(`${label}: ready=${ready} pwned=${r.pwned.length} injected=${r.injected.length} cspViolations=${r.csp.length}`);
  await ctx.close();
  server.close();
}
await browser.close();
if (failures.length) { console.error("✗ XSS attack tests FAILED:\n  - " + failures.join("\n  - ")); process.exit(1); }
console.log("XSS attack tests passed");
