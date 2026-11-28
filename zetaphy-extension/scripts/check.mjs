// Static checks before a release (no dependencies): node scripts/check.mjs
//  - manifest: MV3, no API permissions, exactly the three hosts, the listed sites, every referenced file exists
//  - safety: no remote scripts, no eval / new Function / innerHTML / outerHTML / insertAdjacentHTML / document.write,
//    and the only URLs in the code are the three hosts' (and the sites the content script runs on, in detect.js)
import { readFileSync, existsSync, readdirSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const fail = [];
const ok = (cond, msg) => cond || fail.push(msg);

const m = JSON.parse(read("manifest.json"));
ok(m.manifest_version === 3, "manifest_version must be 3");
ok(Array.isArray(m.permissions) && m.permissions.length === 0, `no API permissions expected: ${m.permissions}`);
const HOSTS = ["https://neuro.sawasdeecoin.com/*", "https://api.dexscreener.com/*", "https://api.geckoterminal.com/*"];
ok(JSON.stringify(m.host_permissions) === JSON.stringify(HOSTS), "host_permissions must be Neuro, DEX Screener's and GeckoTerminal's APIs only");
ok(!m.optional_host_permissions && !m.externally_connectable && !m.web_accessible_resources, "no optional hosts, no external messaging, no web-accessible resources");
const SITES = ["https://dexscreener.com/*", "https://www.geckoterminal.com/*", "https://pancakeswap.finance/*", "https://app.uniswap.org/*", "https://etherscan.io/*", "https://bscscan.com/*", "https://basescan.org/*", "https://arbiscan.io/*"];
ok(m.content_scripts.length === 1 && JSON.stringify(m.content_scripts[0].matches) === JSON.stringify(SITES), "content script sites changed: update scripts/check.mjs, README and PRIVACY together");
ok(m.description.length <= 132, "description longer than 132 (Chrome Web Store)");
const files = [m.background.service_worker, ...m.background.scripts, ...Object.values(m.icons), ...m.content_scripts.flatMap((c) => c.js)];
for (const f of files) ok(existsSync(root + f), `missing file ${f}`);

const ALLOWED = /^https:\/\/(neuro\.sawasdeecoin\.com|api\.dexscreener\.com|api\.geckoterminal\.com)(\/|$)/;
for (const f of readdirSync(root + "src")) {
  const s = read("src/" + f);
  if (!f.endsWith(".js")) { fail.push(`unexpected file src/${f}`); continue; }
  ok(!/\beval\s*\(|new\s+Function\s*\(|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|setTimeout\s*\(\s*["'`]/.test(s), `src/${f}: unsafe DOM / code construct`);
  for (const u of s.match(/https?:\/\/[^"'`\s)<>]+/g) || []) {
    const site = f === "detect.js" && /^https:\/\/(www\.)?(dexscreener\.com|geckoterminal\.com|pancakeswap\.finance|app\.uniswap\.org|etherscan\.io|bscscan\.com|basescan\.org|arbiscan\.io)\b/.test(u);
    ok(ALLOWED.test(u) || site, `src/${f}: unexpected URL ${u}`);
  }
}
if (fail.length) { console.error("check failed:\n - " + fail.join("\n - ")); process.exit(1); }
console.log(`check ok: ${files.length} files, ${HOSTS.length} hosts, ${SITES.length} sites`);
