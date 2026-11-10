// Attack tests for api/devnet-faucet.js — run with `node faucet-attacks.mjs`.
// @vercel/kv and @solana/web3.js are replaced by in-memory fakes, so no
// network, no secrets and no npm install are needed.
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Map();
const kv = {
  async set(k, v, o = {}) { if (o.nx && store.has(k)) return null; store.set(k, v); return "OK"; },
  async del(k) { store.delete(k); return 1; },
  async incr(k) { const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
  async expire() { return 1; },
};
let sent = 0;
let sendBehaviour = null; // null = succeed; a function to throw instead
class PublicKey {
  constructor(s) { if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) throw new Error("Invalid public key input"); this.s = s; }
  toBase58() { return this.s; }
}
const web3 = {
  PublicKey,
  LAMPORTS_PER_SOL: 1e9,
  Keypair: { fromSecretKey: () => ({ publicKey: new PublicKey("11111111111111111111111111111111") }) },
  SystemProgram: { transfer: (x) => x },
  Transaction: class { add() { return this; } },
  Connection: class { async getBalance() { return 100e9; } async getGenesisHash() { return "devnet"; } },
  sendAndConfirmTransaction: async () => { sent++; if (sendBehaviour) sendBehaviour(); return "sig" + sent; },
};
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "@vercel/kv") return { kv };
  if (req === "@solana/web3.js") return web3;
  return realLoad.call(this, req, ...rest);
};
const require = Module.createRequire(import.meta.url);
process.env.DEVNET_FAUCET_SECRET_KEY = JSON.stringify(Array(64).fill(7));
const handler = require(path.join(here, "../api/devnet-faucet.js"));

function call({ method = "POST", body, headers = {}, query = {}, json = true }) {
  if (json && method === "POST" && !("content-type" in headers)) headers = { ...headers, "content-type": "application/json" };
  return new Promise((resolve) => {
    const res = {
      code: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code, body: null }); },
    };
    handler({ method, body, headers, query, socket: { remoteAddress: "10.0.0.1" } }, res);
  });
}
const addr = (i) => "So1111111111111111111111111111111111111" + String(i).padStart(4, "1").replace(/0/g, "2");
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log("✓", name); } catch (e) { failures++; console.log("✗", name, "—", e.message); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check("same wallet twice is refused", async () => {
  const a = await call({ body: { address: addr(1) }, headers: { "x-vercel-forwarded-for": "1.1.1.1" } });
  const b = await call({ body: { address: addr(1) }, headers: { "x-vercel-forwarded-for": "1.1.1.2" } });
  expect(a.code === 200 && b.code === 429, `got ${a.code} then ${b.code}`);
});
await check("same IP, new wallet each time, is refused", async () => {
  const b = await call({ body: { address: addr(2) }, headers: { "x-vercel-forwarded-for": "1.1.1.1" } });
  expect(b.code === 429, `got ${b.code}`);
});
await check("a forged X-Forwarded-For does not dodge the IP limit", async () => {
  const r = await call({ body: { address: addr(3) }, headers: { "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "9.9.9.9" } });
  expect(r.code === 429, `got ${r.code}`);
});
await check("many IPs and wallets hit the global hourly cap", async () => {
  let ok = 0, refused = 0;
  for (let i = 10; i < 60; i++) {
    const r = await call({ body: { address: addr(i) }, headers: { "x-vercel-forwarded-for": `2.2.${i}.1` } });
    if (r.code === 200) ok++; else if (r.code === 429) refused++;
  }
  expect(ok <= 30 && refused >= 19, `${ok} served, ${refused} refused`);
});
await check("refused requests don't burn the wallet's daily slot", async () => {
  const wk = `devnet-faucet:wallet:${addr(59)}`;
  expect(!store.has(wk), "wallet lock kept after a global-cap refusal");
});
await check("bad and oversized addresses are rejected", async () => {
  const a = await call({ body: { address: "not-a-key" }, headers: { "x-vercel-forwarded-for": "3.3.3.3" } });
  const b = await call({ body: { address: "1".repeat(5000) }, headers: { "x-vercel-forwarded-for": "3.3.3.4" } });
  const c = await call({ body: "{broken", headers: { "x-vercel-forwarded-for": "3.3.3.5" } });
  expect(a.code === 400 && b.code === 400 && c.code === 400, `${a.code} ${b.code} ${c.code}`);
});
await check("only POST dispenses", async () => {
  const r = await call({ method: "GET", headers: {} });
  expect(r.code === 405, `got ${r.code}`);
});
await check("diag never echoes the secret", async () => {
  process.env.DEVNET_FAUCET_SECRET_KEY = '[1,2,SECRETSECRETSECRET';
  const r = await call({ method: "GET", query: { diag: "1" } });
  expect(r.code === 500 && !JSON.stringify(r.body).includes("SECRET"), JSON.stringify(r.body));
});

// ---- 2026-11-10 ----
const GOOD_KEY = JSON.stringify(Array(64).fill(7));
process.env.DEVNET_FAUCET_SECRET_KEY = GOOD_KEY;
await check("cross-site simple requests (text/plain, no preflight) are refused", async () => {
  const r = await call({ body: JSON.stringify({ address: addr(70) }), headers: { "content-type": "text/plain", "x-vercel-forwarded-for": "4.4.4.1" } });
  const r2 = await call({ body: JSON.stringify({ address: addr(71) }), headers: { "x-vercel-forwarded-for": "4.4.4.2" }, json: false });
  expect(r.code === 415 && r2.code === 415, `${r.code} ${r2.code}`);
});
await check("no wildcard CORS: other websites can't drive visitors' browsers to the faucet", async () => {
  let hdrs = {};
  await new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json() { hdrs = this.headers; resolve(); }, end() { hdrs = this.headers; resolve(); } };
    handler({ method: "OPTIONS", headers: { origin: "https://evil.example" }, query: {}, socket: {} }, res);
  });
  expect(!hdrs["access-control-allow-origin"], `ACAO = ${hdrs["access-control-allow-origin"]}`);
});
await check("IPv6: rotating addresses inside one /64 does not dodge the per-IP limit", async () => {
  store.clear();
  const a = await call({ body: { address: addr(80) }, headers: { "x-vercel-forwarded-for": "2001:db8:1:2::1" } });
  const b = await call({ body: { address: addr(81) }, headers: { "x-vercel-forwarded-for": "2001:db8:1:2:dead:beef:0:7" } });
  const c = await call({ body: { address: addr(82) }, headers: { "x-vercel-forwarded-for": "2001:0db8:0001:0002:ffff::9" } });
  const d = await call({ body: { address: addr(83) }, headers: { "x-vercel-forwarded-for": "2001:db8:1:3::1" } });
  expect(a.code === 200 && b.code === 429 && c.code === 429 && d.code === 200, `${a.code} ${b.code} ${c.code} ${d.code}`);
  expect(handler.ipBucket("::ffff:1.2.3.4") === "1.2.3.4" && handler.ipBucket("1.2.3.4") === "1.2.3.4", "IPv4 stays per address");
});
await check("a confirmation timeout after sending keeps the locks (no double payout on retry)", async () => {
  store.clear();
  sendBehaviour = () => { throw new Error("TransactionExpiredTimeoutError: not confirmed in 30 s"); };
  const a = await call({ body: { address: addr(90) }, headers: { "x-vercel-forwarded-for": "5.5.5.5" } });
  sendBehaviour = null;
  const b = await call({ body: { address: addr(90) }, headers: { "x-vercel-forwarded-for": "5.5.5.6" } });
  expect(a.code === 500 && b.code === 429, `${a.code} then ${b.code}`);
});
await check("a malformed secret key never reaches the logs", async () => {
  store.clear();
  process.env.DEVNET_FAUCET_SECRET_KEY = "[1,2,ZZQQ5ecretKeyBytes";
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.map(String).join(" "));
  try {
    const r = await call({ body: { address: addr(95) }, headers: { "x-vercel-forwarded-for": "6.6.6.6" } });
    expect(r.code === 500, `got ${r.code}`);
  } finally { console.error = orig; process.env.DEVNET_FAUCET_SECRET_KEY = GOOD_KEY; }
  expect(logged.length && !logged.join(" ").includes("ZZQQ"), logged.join(" | "));
  // and the request did not burn the wallet's slot (nothing was sent)
  expect(!store.has(`devnet-faucet:wallet:${addr(95)}`), "wallet lock kept although nothing was sent");
});

console.log(failures ? `\n${failures} faucet attack test(s) FAILED` : "\nfaucet attack tests passed");
process.exit(failures ? 1 : 0);
