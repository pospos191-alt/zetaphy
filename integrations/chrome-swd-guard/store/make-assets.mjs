// Builds the Chrome Web Store images from the REAL extension UI (not mockups):
//   store/screenshots/*.png  1280×800   (badge, popup, phishing warning, settings; th + en)
//   store/promo/*.png        440×280 small tile, 1400×560 marquee
// Every network request is answered locally (page.route), like test/e2e.playwright.mjs: no real site is contacted.
// The token pages are plain demo pages served at the matching URLs so the content script runs; the audit data is
// a made-up demo token. Needs Playwright + Chromium (and a Thai font, e.g. fonts-noto-core):
//   node store/make-assets.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
const require = createRequire(join(execSync("npm root -g").toString().trim(), "/"));
const { chromium } = require("playwright");
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const EXT = new URL("..", import.meta.url).pathname;
const OUT = new URL(".", import.meta.url).pathname;
mkdirSync(OUT + "screenshots", { recursive: true });
mkdirSync(OUT + "promo", { recursive: true });
// the icon as vector (same shapes as scripts/make-icons.py), so it stays sharp at any size
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><polygon points="256,28 456,96 440,300 256,488 72,300 56,96" fill="#047857"/><polygon points="256,70 414,124 400,290 256,440 112,290 98,124" fill="#0b1f1a"/><polyline points="170,262 232,324 348,192" fill="none" stroke="#6ee7b7" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = "data:image/svg+xml;base64," + Buffer.from(ICON_SVG).toString("base64");
const API = "https://swd-zetaphy.sawasdeecoin.com";
// demo addresses (valid base58 shape, not real tokens)
const BADGE_MINT = "DemoHighRiskToken1111111111111111111111111";
const POPUP_MINT = "DemoMediumRiskToken111111111111111111111111";
const FONT = `system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", "Noto Sans", sans-serif`;

const TEXT = {
  en: {
    high: { title: "Demo token: several risky settings", sym: "DEMO", lines: [
      ["high", "Mint authority is still active: the creator can print more tokens."],
      ["high", "Freeze authority is active: holders' tokens can be frozen."],
      ["medium", "Top 10 holders own 78% of the supply."]] },
    medium: { title: "Demo token: check before trading", sym: "DMED", lines: [
      ["medium", "Liquidity is small (about $4,200), so prices can move fast."],
      ["medium", "Token is 2 days old."],
      ["low", "Metadata can still be changed by the creator."],
      ["info", "Mint authority has been revoked."]] },
    badgeCap: "A risk badge on token pages",
    badgeSub: "Solscan · Jupiter · Birdeye · DEX Screener · pump.fun",
    popupCap: "Check any token, transaction or link",
    popupSub: "Paste a Solana or EVM address, a transaction hash or an explorer link. Results come from SWD Audit's automated rules and are information, not financial advice.",
    optCap: "You choose what it does",
    optSub: "Badges on/off, an opt-in updated phishing list, and an optional permission you can remove at any time.",
    explorer: "Token explorer (demo page)", supply: "Supply", holders: "Holders", price: "Price", overview: "Overview", txs: "Transactions",
  },
  th: {
    high: { title: "เหรียญตัวอย่าง: มีการตั้งค่าที่เสี่ยงหลายข้อ", sym: "DEMO", lines: [
      ["high", "สิทธิ์ mint ยังเปิดอยู่: ผู้สร้างผลิตเหรียญเพิ่มได้"],
      ["high", "สิทธิ์ freeze ยังเปิดอยู่: เหรียญของผู้ถืออาจถูกแช่แข็ง"],
      ["medium", "ผู้ถือ 10 อันดับแรกถือ 78% ของเหรียญทั้งหมด"]] },
    medium: { title: "เหรียญตัวอย่าง: ควรตรวจก่อนซื้อขาย", sym: "DMED", lines: [
      ["medium", "สภาพคล่องน้อย (ประมาณ $4,200) ราคาเปลี่ยนเร็วได้"],
      ["medium", "เหรียญเพิ่งสร้างมา 2 วัน"],
      ["low", "ผู้สร้างยังแก้ไขข้อมูลเหรียญได้"],
      ["info", "ยกเลิกสิทธิ์ mint แล้ว"]] },
    badgeCap: "ป้ายบอกความเสี่ยงบนหน้าเหรียญ",
    badgeSub: "Solscan · Jupiter · Birdeye · DEX Screener · pump.fun",
    popupCap: "ตรวจเหรียญ ธุรกรรม หรือลิงก์ใดก็ได้",
    popupSub: "วางที่อยู่ Solana หรือ EVM, hash ธุรกรรม หรือลิงก์ explorer ผลมาจากกฎอัตโนมัติของ SWD Audit เป็นข้อมูลประกอบ ไม่ใช่คำแนะนำการลงทุน",
    optCap: "คุณเลือกเองว่าจะให้ทำอะไร",
    optSub: "เปิด/ปิดป้าย เลือกดาวน์โหลดรายชื่อเว็บหลอกฉบับล่าสุด และสิทธิ์เสริมที่ยกเลิกได้ทุกเมื่อ",
    explorer: "ตัวสำรวจเหรียญ (หน้าตัวอย่าง)", supply: "จำนวนทั้งหมด", holders: "ผู้ถือ", price: "ราคา", overview: "ภาพรวม", txs: "ธุรกรรม",
  },
};

function auditFor(url) {
  const u = new URL(url);
  const lang = u.searchParams.get("lang") === "th" ? "th" : "en";
  const addr = u.searchParams.get("address");
  const kind = addr === BADGE_MINT ? "high" : "medium";
  const d = TEXT[lang][kind];
  return {
    ok: true,
    audit: {
      level: kind, title: d.title, token: { symbol: d.sym },
      lines: d.lines.map(([severity, text], i) => ({ id: "r" + i, severity, text })),
      permalink: `${API}/audit/sol/${addr}`,
      disclaimer: "Automated rules, not financial advice.",
    },
  };
}

// a neutral, unbranded explorer-style page inside a simple browser frame, with a caption band on top
function tokenPage(lang) {
  const T = TEXT[lang];
  const rows = Array.from({ length: 6 }, (_, i) => `<tr><td class="mono">${"5x" + "Kq9".repeat(3)}…${i}a${i}</td><td>${i % 2 ? "Swap" : "Transfer"}</td><td>${(1234.5 * (i + 1)).toLocaleString("en")}</td><td>${i + 1} min</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;height:100%} body{font:13px/1.4 ${FONT};background:linear-gradient(135deg,#0b1f1a,#063b2e);color:#18181b;overflow:hidden}
  .cap{height:78px;display:flex;align-items:center;gap:14px;padding:0 28px;color:#f4f4f5}
  .cap img{width:40px;height:40px} .cap b{font-size:22px;display:block} .cap span{color:#6ee7b7;font-size:13px}
  .win{position:absolute;left:24px;right:0;top:78px;bottom:0;background:#fff;border-radius:12px 0 0 0;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  .bar{height:34px;background:#e4e4e7;display:flex;align-items:center;gap:8px;padding:0 12px}
  .bar i{width:10px;height:10px;border-radius:50%;background:#a1a1aa;display:inline-block}
  .url{flex:1;margin-left:10px;background:#fff;border-radius:14px;padding:4px 12px;color:#52525b;font-size:12px}
  .pg{padding:16px 20px} h1{font-size:18px;margin:0 0 4px} .sub{color:#71717a;font-size:12px;margin-bottom:12px}
  .mono{font-family:ui-monospace,monospace} .stats{display:flex;gap:10px;margin-bottom:12px}
  .st{flex:1;border:1px solid #e4e4e7;border-radius:8px;padding:8px 10px} .st small{color:#71717a;display:block}
  .tabs{display:flex;gap:16px;border-bottom:1px solid #e4e4e7;margin-bottom:6px;color:#71717a} .tabs b{color:#18181b;border-bottom:2px solid #18181b;padding-bottom:6px}
  table{width:62%;border-collapse:collapse;font-size:12px} td{padding:6px 4px;border-bottom:1px solid #f4f4f5}
  .logo{width:26px;height:26px;border-radius:50%;background:#d4d4d8;display:inline-block;vertical-align:middle;margin-right:8px}
  </style></head><body>
  <div class="cap"><img src="${ICON}" alt=""><div><b>${T.badgeCap}</b><span>${T.badgeSub}</span></div></div>
  <div class="win"><div class="bar"><i></i><i></i><i></i><div class="url">solscan.io/token/${BADGE_MINT}</div></div>
  <div class="pg"><h1><span class="logo"></span>DEMO Token</h1><div class="sub">${T.explorer} · <span class="mono">${BADGE_MINT.slice(0, 8)}…${BADGE_MINT.slice(-4)}</span></div>
  <div class="stats"><div class="st"><small>${T.price}</small>$0.00042</div><div class="st"><small>${T.supply}</small>1,000,000,000</div><div class="st"><small>${T.holders}</small>312</div></div>
  <div class="tabs"><b>${T.txs}</b><span>${T.overview}</span></div><table>${rows}</table></div></div>
  </body></html>`;
}

// a fake "claim" page; the warning covers it (kept small and at the top so it does not show through the text)
const PHISH_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:11px sans-serif;background:#fde68a;padding:8px 12px">
<b>Claim your SWD airdrop</b> · connect wallet</body></html>`;

async function launch(lang) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "swd-guard-assets-")), {
    headless: true, channel: "chromium", colorScheme: "dark", deviceScaleFactor: SCALE, viewport: { width: 1280 / SCALE, height: 800 / SCALE },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang}`],
    locale: lang === "th" ? "th-TH" : "en-US",
  });
  await ctx.route(`${API}/**`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(auditFor(r.request().url())) }));
  await ctx.route("https://solscan.io/**", (r) => r.fulfill({ contentType: "text/html", body: tokenPage(lang) }));
  await ctx.route("https://sawasdeecoin-claim.com/**", (r) => r.fulfill({ contentType: "text/html", body: PHISH_PAGE }));
  await ctx.route("https://raw.githubusercontent.com/**", (r) => r.abort());
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  return { ctx, id: sw.url().split("/")[2] };
}

// 1280×800 output: an 800×500 CSS viewport at device scale factor 1.6 (set on the context), so the UI is legible
const SCALE = 1.6;
async function pageCtx(ctx) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280 / SCALE, height: 800 / SCALE });
  return page;
}

// a stage around an extension page: brand background, caption on the left, the real page on the right
const STAGE_CSS = (w) => `
  html { background: linear-gradient(135deg, #0b1f1a 0%, #063b2e 100%) !important; min-height: 100%; }
  body { position: absolute !important; right: 40px; top: 50%; transform: translateY(-50%); margin: 0 !important; width: ${w}px !important; max-width: none !important;
         border-radius: 14px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55); border: 1px solid #1f3d35; }
  #swd-cap { position: fixed; left: 40px; top: 50%; transform: translateY(-50%); color: #f4f4f5; font-family: ${FONT}; }
  #swd-cap img { width: 56px; height: 56px; display: block; margin-bottom: 14px; }
  #swd-cap b { display: block; font-size: 26px; line-height: 1.25; margin-bottom: 10px; }
  #swd-cap span { display: block; font-size: 14px; line-height: 1.55; color: #a7f3d0; }`;
async function stage(page, w, capW, cap, sub, mode) {
  await page.addStyleTag({ content: STAGE_CSS(w) + `#swd-cap { width: ${capW}px; }` });
  await page.evaluate(([icon, cap, sub, mode]) => {
    const d = document.createElement("div");
    d.id = "swd-cap";
    const img = Object.assign(document.createElement("img"), { src: icon, alt: "" });
    d.append(img, Object.assign(document.createElement("b"), { textContent: cap }), Object.assign(document.createElement("span"), { textContent: sub }));
    document.documentElement.append(d);
    const b = document.body;
    if (mode === "fit") {
      // the whole popup, scaled down only as much as needed to fit the frame
      const k = Math.min(1, (innerHeight - 32) / b.offsetHeight);
      b.style.transformOrigin = "right center";
      b.style.transform = `translateY(-50%) scale(${k})`;
    } else {
      // a long page: show it from the top, fading out at the bottom edge like a scrolled window
      Object.assign(b.style, { top: "28px", transform: "none", borderRadius: "14px 14px 0 0" });
      const fade = document.createElement("div");
      fade.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:70px;background:linear-gradient(transparent,#063b2e)";
      document.documentElement.append(fade);
    }
  }, [ICON, cap, sub, mode]);
}

async function shoot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}screenshots/${name}.png` });
  console.log("wrote screenshots/" + name + ".png");
}

for (const lang of ["en", "th"]) {
  const T = TEXT[lang];
  const { ctx, id } = await launch(lang);

  // 1. the badge on a token page
  const p1 = await pageCtx(ctx);
  await p1.goto(`https://solscan.io/token/${BADGE_MINT}`);
  await p1.waitForFunction(() => document.querySelector("swd-guard-badge"), null, { timeout: 15000 });
  await p1.waitForTimeout(2500);
  await shoot(p1, `1-badge-${lang}`);

  // 2. the popup auditing an address
  const p2 = await pageCtx(ctx);
  await p2.goto(`chrome-extension://${id}/src/popup.html`);
  await p2.fill("#q", POPUP_MINT);
  await p2.click("#go");
  await p2.waitForFunction(() => document.querySelector("#result ul"), null, { timeout: 15000 });
  await stage(p2, 360, 330, T.popupCap, T.popupSub, "fit");
  await shoot(p2, `2-popup-${lang}`);

  // 3. the phishing warning
  const p3 = await pageCtx(ctx);
  await p3.goto("https://sawasdeecoin-claim.com/");
  await p3.waitForFunction(() => document.querySelector("swd-guard-warning"), null, { timeout: 15000 });
  await shoot(p3, `3-phishing-${lang}`);

  // 4. the settings page
  const p4 = await pageCtx(ctx);
  await p4.goto(`chrome-extension://${id}/src/options.html`);
  await p4.waitForTimeout(500);
  await stage(p4, 470, 230, T.optCap, T.optSub, "top");
  await shoot(p4, `4-options-${lang}`);

  await ctx.close();
}

// promo tiles (English, plain brand graphics: the icon, the name, what it does, and that it is informational)
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const tile = (w, h, big) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(circle at ${big ? "78% 40%" : "85% 20%"},#0e5a44 0%,#0b1f1a 62%);color:#f4f4f5;font-family:${FONT};display:flex;align-items:center}
  .wrap{display:flex;align-items:center;gap:${big ? 56 : 22}px;padding:0 ${big ? 110 : 30}px}
  img{width:${big ? 260 : 112}px;height:${big ? 260 : 112}px;image-rendering:auto;filter:drop-shadow(0 10px 30px rgba(0,0,0,.45))}
  h1{margin:0;font-size:${big ? 76 : 38}px;letter-spacing:-.5px;line-height:1.05}
  p{margin:${big ? 16 : 8}px 0 0;color:#a7f3d0;font-size:${big ? 28 : 15}px;line-height:1.35}
  ul{list-style:none;padding:0;margin:${big ? 28 : 12}px 0 0;display:flex;flex-wrap:wrap;gap:${big ? 12 : 6}px}
  li{background:rgba(110,231,183,.12);border:1px solid rgba(110,231,183,.35);border-radius:999px;padding:${big ? "8px 18px" : "3px 9px"};font-size:${big ? 20 : 11}px;color:#d1fae5}
  small{display:block;margin-top:${big ? 24 : 10}px;color:#86a89c;font-size:${big ? 17 : 10}px}
  </style></head><body><div class="wrap"><img src="${ICON}" alt=""><div>
  <h1>SWD Guard</h1><p>${big ? "Check crypto token risk before you buy or approve" : "Check token risk before you buy"}</p>
  <ul><li>Risk badges</li><li>Audit popup</li><li>Phishing warnings</li>${big ? "<li>8 languages</li>" : ""}</ul>
  <small>${big ? "Informational risk checks by automated rules · not financial advice" : "Informational only · not financial advice"}</small></div></div></body></html>`;
for (const [name, w, h, big] of [["small-promo-440x280", 440, 280, false], ["marquee-1400x560", 1400, 560, true]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(tile(w, h, big));
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}promo/${name}.png` });
  console.log("wrote promo/" + name + ".png");
}
await browser.close();
