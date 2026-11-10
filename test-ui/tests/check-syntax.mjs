// Syntax check for test-ui/index.html (added 2026-09-25): pulls every inline
// <script> out of the page and runs `node --check` on it, so a typo in the
// ~1.3 MB module script fails CI in seconds instead of in a browser.
// Also checks test-ui/vercel.json (header rule, /zetaphy redirect).
// Usage: node test-ui/tests/check-syntax.mjs [path/to/index.html]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || path.join(here, "..", "index.html"));
const html = fs.readFileSync(htmlPath, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "swd-ui-check-"));

let checked = 0, failed = 0;
for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  const [, attrs, body] = m;
  if (/\bsrc=/.test(attrs) || !body.trim()) continue;
  const isModule = /type=["']module["']/.test(attrs);
  const file = path.join(tmp, `inline-${checked}.${isModule ? "mjs" : "cjs"}`);
  fs.writeFileSync(file, body);
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  checked++;
  if (r.status !== 0) {
    failed++;
    console.error(`✗ inline script #${checked} (${isModule ? "module" : "classic"}):\n${r.stderr}`);
  } else {
    console.log(`✓ inline script #${checked} (${isModule ? "module" : "classic"}, ${body.length} chars)`);
  }
}
if (!checked) { console.error("no inline <script> found — wrong file?"); process.exit(1); }

// The page's own ES modules next to it (config.js, i18n.js, i18n/<lang>.js, trust.js, …).
const pageDir = path.dirname(htmlPath);
const modules = [
  ...fs.readdirSync(pageDir).filter((f) => f.endsWith(".js")).map((f) => path.join(pageDir, f)),
  ...(fs.existsSync(path.join(pageDir, "i18n")) ? fs.readdirSync(path.join(pageDir, "i18n")).filter((f) => f.endsWith(".js")).map((f) => path.join(pageDir, "i18n", f)) : []),
];
for (const f of modules) {
  const copy = path.join(tmp, path.basename(f).replace(/\.js$/, ".mjs"));
  fs.writeFileSync(copy, fs.readFileSync(f));
  const r = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8" });
  if (r.status !== 0) { failed++; console.error(`✗ ${path.relative(pageDir, f)}:\n${r.stderr}`); }
}
console.log(`✓ ${modules.length} module files`);
if (failed) process.exit(1);
console.log(`syntax OK (${checked} inline scripts)`);

// CSP (2026-11-10): script-src has no 'unsafe-inline'. The page's one inline module script is
// allowed by its SHA-256 instead, so injected markup (an <img onerror>, a <script> from a token
// name) cannot run even if an escape is missed somewhere. Any edit of the inline script changes
// the hash: `node tests/check-syntax.mjs --write-csp` puts the new one into vercel.json.
// Inline event handlers (onclick="…") are refused here too, since the CSP blocks them.
{
  const crypto = await import("node:crypto");
  const vercelPath = path.join(here, "..", "vercel.json");
  const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, a, b]) => !/\bsrc=/.test(a) && b.trim());
  const hashes = inline.map(([, , b]) => `'sha256-${crypto.createHash("sha256").update(b, "utf8").digest("base64")}'`);
  const raw = fs.readFileSync(vercelPath, "utf8");
  const cspOf = (txt) => JSON.parse(txt).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  const scriptSrc = (csp) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) || "");
  if (process.argv.includes("--write-csp")) {
    const csp = cspOf(raw);
    const old = scriptSrc(csp);
    const kept = old.split(/\s+/).slice(1).filter((x) => !/^'sha256-/.test(x) && x !== "'unsafe-inline'");
    const next = ["script-src", kept[0] === "'self'" ? "'self'" : null, ...hashes, ...kept.filter((x) => x !== "'self'")].filter(Boolean).join(" ");
    fs.writeFileSync(vercelPath, raw.replace(old, next));
    console.log(`vercel.json: ${next}`);
  }
  const src = scriptSrc(cspOf(fs.readFileSync(vercelPath, "utf8")));
  const bad = [];
  if (/'unsafe-inline'|'unsafe-eval'/.test(src)) bad.push("script-src must not allow 'unsafe-inline' / 'unsafe-eval'");
  for (const h of hashes) if (!src.includes(h)) bad.push(`the inline script's hash ${h} is not in script-src (run: node tests/check-syntax.mjs --write-csp)`);
  const stale = (src.match(/'sha256-[^']+'/g) || []).filter((h) => !hashes.includes(h));
  if (stale.length) bad.push(`stale script hashes in script-src: ${stale.join(" ")} (run: node tests/check-syntax.mjs --write-csp)`);
  const handlers = [...html.matchAll(/<[a-z][^>]*\s(on[a-z]+)=["']/gi)].map((m) => m[1]);
  if (handlers.length) bad.push(`inline event handler attributes (blocked by the CSP): ${[...new Set(handlers)].join(", ")}`);
  for (const m of html.matchAll(/<script[^>]+src=["'](https?:[^"']+)["'][^>]*>/g)) {
    if (!/\sintegrity=["']sha(256|384|512)-/.test(m[0])) bad.push(`remote <script> without integrity=: ${m[1]}`);
    if (!/@\d+\.\d+\.\d+\//.test(m[1])) bad.push(`remote <script> without an exact version: ${m[1]}`);
  }
  if (bad.length) { console.error(`✗ CSP / script checks:\n  - ${bad.join("\n  - ")}`); process.exit(1); }
  console.log(`CSP OK (script-src by hash, ${hashes.length} inline script, no inline handlers, remote scripts pinned + SRI)`);
}

// test-ui/vercel.json: one header rule for every path, and the old /zetaphy/
// address of the DEX (now its own site, zetaphy-dex/web/) redirects there.
const vercel = JSON.parse(fs.readFileSync(path.join(here, "..", "vercel.json"), "utf8"));
const want = [
  { source: "/zetaphy", destination: "https://swap.sawasdeecoin.com/", permanent: true },
  { source: "/zetaphy/:path*", destination: "https://swap.sawasdeecoin.com/:path*", permanent: true },
];
const problems = [];
if (JSON.stringify(vercel.redirects) !== JSON.stringify(want)) problems.push(`redirects are ${JSON.stringify(vercel.redirects)}`);
if (JSON.stringify((vercel.headers ?? []).map((r) => r.source)) !== JSON.stringify(["/(.*)"])) problems.push("headers must be a single /(.*) rule");
if (fs.existsSync(path.join(here, "..", "zetaphy"))) problems.push("test-ui/zetaphy/ is back: the DEX page lives in zetaphy-dex/web/");
if (problems.length) { console.error(`✗ test-ui/vercel.json: ${problems.join("; ")}`); process.exit(1); }
console.log("vercel.json OK (single header rule, /zetaphy → swap.sawasdeecoin.com)");
