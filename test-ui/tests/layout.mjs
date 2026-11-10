// Layout + launch-readiness browser check for test-ui/index.html (2026-11-10).
// Same harness as smoke.mjs (page served locally, esm.sh libraries swapped
// for ./stubs, every RPC answer mocked in the page — no network, no
// validator). For Thai and Russian at 360 px (phone) and 1366 px (laptop):
//   - startup finishes with no page error
//   - no horizontal scrolling on any main page, the Trust panel or a swap
//   - the network badge / banner say Devnet + test tokens, mainnet is greyed out
//   - the Trust panel reads the mocked chain (upgrade authority, security.txt, pause)
//   - the token safety chip shows the (mocked) SWD Audit API answer, and an
//     API outage still lets the swap summary open
// Run: cd test-ui/tests && node layout.mjs
// Env: SMOKE_CHROMIUM=<chromium path>, LAYOUT_ALL=1 (all 8 languages at 360 px), LAYOUT_SHOTS=<dir> (screenshots)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stub = (name) => fs.readFileSync(path.join(here, "stubs", name));
const csp = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const f = path.join(root, p);
  const type = p === "/index.html" ? "text/html; charset=utf-8" : /^\/(i18n\/)?[a-z0-9-]+\.js$/.test(p) ? "text/javascript" : /^\/[a-z0-9-]+\.css$/.test(p) ? "text/css" : null;
  if (!type || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", type);
  res.setHeader("content-security-policy", csp);
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const A = "JDxHq1Zk2yN3xG8m9pXa7vQeW4tRbY6uLcFs5oPeamz";
const B = "4T8mq3mX7nB2cR8tY4wZ1aS6dF5gH3jK2kP9o5867iN";

const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

async function run(lang, width, auditMode) {
  const tag = `${lang}@${width}`;
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 780 : 900 }, locale: { th: "th-TH", ru: "ru-RU" }[lang] || lang });
  let auditCalls = 0;
  await ctx.route((url) => !url.href.startsWith(origin), async (route) => {
    const u = route.request().url();
    const js = (body) => route.fulfill({ status: 200, contentType: "application/javascript", body });
    if (u.includes("esm.sh/@solana/web3.js")) return js(stub("web3.js"));
    if (u.includes("esm.sh/@coral-xyz/anchor")) return js(stub("anchor.js"));
    if (u.includes("esm.sh/@solana/spl-token")) return js(stub("spl-token.js"));
    if (u.includes("esm.sh/buffer")) return js(stub("buffer.js"));
    if (u.includes("klinecharts")) return js("window.klinecharts={init(){return new Proxy({}, {get:()=>()=>null})},dispose(){},registerOverlay(){},registerIndicator(){},getSupportedOverlays(){return []}};");
    if (u.startsWith("https://swd-zetaphy.sawasdeecoin.com/api/audit")) {
      auditCalls++;
      if (auditMode === "down") return route.fulfill({ status: 503, contentType: "text/html", body: "<h1>503</h1>" });
      const level = u.includes(A) ? "high" : "low";
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, audit: { level, verdict: "test", findings: [], permalink: "https://swd-zetaphy.sawasdeecoin.com/audit/sol/x" } }) });
    }
    if (/\.(css)(\?|$)/.test(u) || u.includes("fonts.googleapis")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    return js("");
  });
  await ctx.addInitScript(([lang, a, b]) => {
    if (sessionStorage.getItem("layout-seeded")) return;
    sessionStorage.setItem("layout-seeded", "1");
    localStorage.setItem("swd-amm-lang", lang);
    localStorage.setItem("swd-amm-network", "devnet");
    localStorage.setItem("swd-amm-active-mint-a", a);
    localStorage.setItem("swd-amm-active-mint-b", b);
    localStorage.setItem("swd-amm-recent-pairs-v1", JSON.stringify([{ mintA: a, mintB: b, pinned: false, lastUsedAt: Date.now() }]));
  }, [lang, A, B]);

  // a stand-in Phantom (as in safety.mjs), so the swap summary can be opened
  await ctx.addInitScript(() => {
    const owner = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const pk = { toBase58: () => owner, toString: () => owner, toBytes: () => new Uint8Array(32), toBuffer: () => new Uint8Array(32), equals: () => false };
    globalThis.__smokeLamports = 2_000_000_000;
    window.phantom = { solana: { isPhantom: true, publicKey: pk, connect: async () => ({ publicKey: pk }), disconnect: async () => {}, on() {}, off() {}, signTransaction: async (t) => t, signAllTransactions: async (t) => t } };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => { if (/Content Security Policy|Refused to/.test(m.text()) && !/esm\.sh|klinecharts|fonts|swd-logo/.test(m.text())) errors.push(`${tag} CSP: ${m.text()}`); });
  await page.goto(`${origin}/index.html`);
  const ready = await page.waitForFunction(() => document.documentElement.dataset.appReady === "1", null, { timeout: 20000 }).then(() => true, () => false);
  check(ready, `${tag}: startup never finished`);
  if (!ready) { failures.push(...errors); await ctx.close(); return; }

  // Mock the chain for the Trust panel: program -> ProgramData (single-key authority, security.txt inside), GlobalConfig paused.
  await page.evaluate(async () => {
    const w = await import("https://esm.sh/@solana/web3.js@1.95.4");
    const pid = document.getElementById("program-id-display").textContent.trim();
    const pdBytes = new Uint8Array(32).fill(9);
    const pd = new w.PublicKey(pdBytes).toBase58();
    const le = (n, len) => { const b = new Uint8Array(len); let v = BigInt(n); for (let i = 0; i < len; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
    const cat = (...p) => { const out = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of p) { out.set(x, o); o += x.length; } return out; };
    const sec = new TextEncoder().encode("=======BEGIN SECURITY.TXT V1=======\0name\0SWD AMM\0auditors\0None yet\0=======END SECURITY.TXT V1=======\0");
    const enc = (s) => new TextEncoder().encode(s);
    const gc = w.PublicKey.findProgramAddressSync([enc("global-config")], new w.PublicKey(pid))[0].toBase58();
    globalThis.__smokeAccounts = {
      [pid]: { owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true, data: cat(le(2, 4), pdBytes) },
      [pd]: { owner: "BPFLoaderUpgradeab1e11111111111111111111111", data: cat(le(3, 4), le(424242, 8), Uint8Array.of(1), new Uint8Array(32).fill(5), Uint8Array.of(0x7f, 0x45, 0x4c, 0x46), sec, new Uint8Array(64)) },
      [gc]: { owner: pid, data: cat(new Uint8Array(8), new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), Uint8Array.of(1, 255)) },
    };
  });

  const overflow = async (where) => {
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const wide = [...document.querySelectorAll("body *")].filter((el) => {
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.right > window.innerWidth + 1 && !el.closest(".table-scroll, [style*='overflow'], .tb-chart, svg, canvas, .pd-cats, .rd-nav-links, .dock-tabs");
      }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}#${el.id}.${String(el.className).split(" ")[0]} right=${Math.round(el.getBoundingClientRect().right)}`);
      return { sw: de.scrollWidth, iw: window.innerWidth, wide };
    });
    check(r.sw <= r.iw, `${tag} ${where}: page scrolls sideways (scrollWidth ${r.sw} > ${r.iw}) ${r.wide.join(", ")}`);
  };

  // Network badge / banner / mainnet option
  const net = await page.evaluate(() => ({
    badge: document.getElementById("net-badge").dataset.net,
    banner: document.getElementById("net-banner-text").textContent,
    mainnetDisabled: document.getElementById("opt-mainnet").disabled,
    faucetHidden: document.getElementById("faucet-btn").hidden,
    htmlLang: document.documentElement.lang,
  }));
  check(net.badge === "devnet", `${tag}: badge says ${net.badge}`);
  check(net.htmlLang === lang, `${tag}: <html lang> is ${net.htmlLang}`);
  check(net.mainnetDisabled, `${tag}: mainnet option is selectable before the audit`);
  check(!net.faucetHidden, `${tag}: faucet hidden on devnet`);
  check(lang !== "ru" || /[а-я]/i.test(net.banner), `${tag}: banner not in Russian: ${net.banner}`);
  check(lang !== "th" || /[฀-๿]/.test(net.banner), `${tag}: banner not in Thai: ${net.banner}`);

  for (const tab of ["tools", "liquidity", "portfolio", "marketplace", "explore"]) {
    await page.evaluate((t) => document.querySelector(`.tab-nav-btn[data-tab="${t}"]`)?.click(), tab);
    await page.waitForTimeout(250);
    await overflow(`tab ${tab}`);
  }

  // Token safety chip under the swap form (mocked API: A high, B low; or the API down).
  await page.evaluate(() => document.querySelector('.tab-nav-btn[data-tab="tools"]').click());
  const chip = await page.waitForFunction((mode) => {
    const host = [...document.querySelectorAll('[data-risk-for^="swap-mint"]')].find((h) => !h.hidden && h.offsetParent);
    if (!host) return null;
    const want = mode === "down" ? ".risk-unavailable" : ".risk-high";
    return host.querySelector(want) ? host.textContent : null;
  }, auditMode, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
  check(!!chip, `${tag}: token safety chip (${auditMode}) not shown under the swap form`);
  check(auditCalls >= 1, `${tag}: SWD Audit API never called`);

  // Pre-sign summary for a swap: pay, estimate, fee, price impact, min received, network, token safety.
  await page.click("#connect-btn");
  await page.click('#wallet-modal-list .wallet-option:has-text("Phantom")');
  await page.waitForFunction(() => document.getElementById("wallet-status").classList.contains("connected"), null, { timeout: 10000 }).catch(() => failures.push(`${tag}: stand-in wallet did not connect`));
  await page.evaluate(() => { globalThis.__smokePoolAccount = { reserveA: "5000000000", reserveB: "5000000000", feeBps: 30 }; });
  await page.evaluate(() => document.querySelector('.tab-nav-btn[data-tab="tools"]').click());
  await page.evaluate(() => document.querySelector('.dock-tab[data-dock-tool="swap"]')?.click());
  await page.fill("#swap-amount-in-ui", "1.5").catch(() => {});
  await page.waitForFunction(() => /\d/.test(document.getElementById("swap-min-out")?.value || ""), null, { timeout: 5000 }).catch(() => failures.push(`${tag}: no min received computed`));
  await page.waitForTimeout(600); // the docked form settles (pair sync re-renders it)
  await page.evaluate(() => document.getElementById("swap-btn").click());
  const summary = await page.waitForFunction(() => {
    const ov = document.getElementById("confirm-modal-overlay");
    return ov && !ov.hidden ? document.getElementById("confirm-modal-kv").innerText : null;
  }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
  check(!!summary, `${tag}: swap summary did not open: ${await page.evaluate(() => [document.getElementById("log")?.innerText.slice(0, 400), document.getElementById("swap-min-out")?.value, document.getElementById("swap-amount-in")?.value]).then(JSON.stringify)}`);
  if (summary) {
    const { STRINGS, loadLang } = await import("../i18n.js");
    await loadLang(lang);
    for (const k of ["swapYouPay", "scEstReceive", "scFee", "scImpact", "swapMinReceive", "scNetwork", "taConfirmRow"]) {
      check(summary.includes(STRINGS[lang][k]), `${tag}: swap summary lacks "${STRINGS[lang][k]}" (${k})`);
    }
    check(summary.includes("0.3%"), `${tag}: swap summary lacks the 0.3% pool fee`);
    await overflow("swap summary");
    await page.waitForTimeout(400); // open animation
    const btnVisible = await page.evaluate(() => { const b = document.getElementById("confirm-modal-ok").getBoundingClientRect(); const box = document.querySelector("#confirm-modal-overlay > .modal-box").getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight + 1 && b.height > 0; });
    check(btnVisible, `${tag}: swap summary taller than the screen (Confirm button out of reach)`);
    if (process.env.LAYOUT_SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(process.env.LAYOUT_SHOTS, `${tag}-swap-summary.png`) }); }
    await page.click("#confirm-modal-cancel");
  }
  await page.evaluate(() => { globalThis.__smokePoolAccount = null; });

  // Trust panel
  // header shield (hidden below 380 px) or the banner's "Check this app" link
  await page.click(width < 380 ? "#net-banner-trust" : "#trust-btn");
  const trust = await page.waitForFunction(() => {
    const b = document.getElementById("trust-body");
    return b && b.querySelector(".tr-list") ? { text: b.innerText, bad: b.querySelectorAll(".tr-bad").length } : null;
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
  const trustDiag = trust ? "" : await page.evaluate(() => JSON.stringify({
    open: !!document.getElementById("trust-body"),
    body: (document.getElementById("trust-body")?.innerText || "").slice(0, 600),
    log: (document.getElementById("log")?.innerText || "").slice(-600),
  }));
  check(!!trust, `${tag}: trust panel did not render ${trustDiag}`);
  if (trust) {
    check(trust.text.includes("424,242") || trust.text.includes("424 242") || trust.text.includes("424242") || /424.242/.test(trust.text), `${tag}: trust panel lacks the deploy slot`);
    check(trust.text.includes("SWD AMM"), `${tag}: trust panel lacks security.txt: ${JSON.stringify(trust.text.slice(0, 1500))}`);
    check(trust.bad >= 1, `${tag}: single-key upgrade authority not flagged`);
  }
  await overflow("trust panel");
  if (process.env.LAYOUT_SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(process.env.LAYOUT_SHOTS, `${tag}-trust.png`) }); }
  await page.keyboard.press("Escape");
  check(await page.evaluate(() => document.getElementById("trust-overlay").hidden), `${tag}: trust panel did not close on Escape`);

  // Mainnet cannot be chosen
  await page.evaluate(() => { const s = document.getElementById("network-select"); s.value = "mainnet"; s.dispatchEvent(new Event("change")); });
  check(await page.evaluate(() => document.getElementById("network-select").value !== "mainnet"), `${tag}: mainnet was selected before the audit`);

  for (const e of errors) failures.push(`page error ${e}`);
  console.log(`${errors.length ? "✗" : "✓"} ${tag} (${auditMode} audit API)`);
  await ctx.close();
}

try {
  await run("th", 360, "up");
  await run("ru", 360, "down");
  await run("th", 1366, "down");
  await run("ru", 1366, "up");
  // LAYOUT_ALL=1: the other six languages at 360 px too
  if (process.env.LAYOUT_ALL) for (const l of ["en", "zh", "ja", "ko", "vi", "es"]) await run(l, 360, "up");
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`\nLAYOUT CHECK FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nlayout check passed (th + ru, 360 px + 1366 px)");
