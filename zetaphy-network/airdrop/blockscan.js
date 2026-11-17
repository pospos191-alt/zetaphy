// Active wallets of a chain that has no free BigQuery dataset (BNB Smart Chain), read straight from its public RPC.
// Read only: it never signs or sends anything. docs/AIRDROP.md "Recipients from BNB Smart Chain".
//
// 1. Sample: `sample` blocks spread evenly over the last `days` days (eth_getBlockByNumber with transactions). Every
//    transaction sender is counted once per sampled block it appears in ("seen"). Spreading the sample over days
//    favours people who come back over one-hour bursts.
// 2. Bots out: a sender seen in more than `maxSeen` sampled blocks (a bot, a market maker, an exchange hot wallet).
// 3. History: eth_getTransactionCount (the account's nonce = every transaction it ever sent) between `minNonce`
//    (an account a person has used, not a fresh farm wallet) and `maxNonce` (default 5,000: not a high-volume account).
// 4. Output: address,score CSV (score = the nonce, capped at maxNonce), highest first, `want` rows: the input of
//    `cli.js push-list <csv> --rpc <the same chain's RPC>` (which drops contracts with eth_getCode and cleans the list).
//
// Public RPCs drop connections and rate-limit: every request has a timeout and is retried with a growing wait, and
// progress is saved to `state` (JSON) after every chunk, so a run that stops resumes where it was.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const RETRYABLE = /rate|limit|too many|capacity|busy|timeout|temporar|try again|abort|fetch failed|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i;

/** One JSON-RPC call or batch (array) with a timeout and retries; rotates over the URLs. */
export async function rpc(urls, body, { fetchImpl = globalThis.fetch, timeoutMs = 20_000, retries = 8, retryMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry, n = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const url = urls[(n + attempt) % urls.length];
    let why = null;
    let res;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      if (e?.name !== 'AbortError' && !RETRYABLE.test(String(e?.message))) throw e;
      why = e?.name === 'AbortError' ? 'timeout' : e.message;
    } finally { clearTimeout(t); }
    if (!why) {
      if (res.status === 429 || res.status >= 500) why = `HTTP ${res.status}`;
      else {
        let j = null;
        try { j = await res.json(); } catch { why = `HTTP ${res.status}, not JSON`; }
        if (!why) {
          const list = Array.isArray(j) ? j : [j];
          const bad = list.find((x) => x?.error);
          if (bad && RETRYABLE.test(String(bad.error.message))) why = bad.error.message;
          else if (bad && !Array.isArray(body)) throw new Error(`${body.method}: ${bad.error.message}`);
          else return j;
        }
      }
    }
    if (attempt >= retries) throw new Error(`${url}: ${why} (gave up after ${retries} retries)`);
    const wait = Math.min(retryMs * 2 ** attempt, 60_000);
    onRetry?.({ attempt: attempt + 1, wait, why, url });
    await sleep(wait);
  }
}

/** The sampled block numbers: `sample` numbers spread evenly over [latest - span, latest]. */
export function sampleBlocks(latest, span, sample) {
  span = Math.max(1, Math.min(span, latest - 1)); // a young chain: never before block 1
  const n = Math.max(1, Math.min(sample, span));
  const step = span / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(latest - Math.floor(i * step));
  return [...new Set(out)].filter((b) => b > 0);
}

/** Senders of one block's transactions (lower case, each once). */
export function senders(block) {
  const txs = Array.isArray(block?.transactions) ? block.transactions : [];
  return [...new Set(txs.map((t) => (typeof t === 'object' && /^0x[0-9a-fA-F]{40}$/.test(t.from) ? t.from.toLowerCase() : null)).filter(Boolean))];
}

/**
 * Runs the scan. Returns { rows: [{address, nonce}], stats }. `state`: a file to resume from and save to.
 * `blockTime`: seconds per block (BNB Smart Chain: 0.75 s since the Maxwell upgrade; pass what the chain uses).
 */
export async function scanActive({ rpcUrl, want = 150_000, days = 7, sample = 30_000, blockTime = 0.75, maxSeen = 20, minNonce = 10, maxNonce = 5_000,
  concurrency = 8, nonceBatch = 50, state = null, fetchImpl = globalThis.fetch, log = () => {}, sleep, retryMs, timeoutMs } = {}) {
  const urls = String(rpcUrl ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) throw new Error('--rpc: the chain\'s RPC URL (comma-separated for several)');
  const o = { fetchImpl, sleep, retryMs, timeoutMs, onRetry: ({ why, url, wait }) => log(`  ${new URL(url).host}: ${why}; retry in ${wait / 1000} s`) };
  let st = state && existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null;
  if (!st) {
    const latest = Number(BigInt((await rpc(urls, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, o)).result));
    const span = Math.round((days * 86_400) / blockTime);
    st = { latest, blocks: sampleBlocks(latest, span, sample), done: 0, seen: {}, nonces: {} };
  }
  const save = () => { if (state) writeFileSync(state, JSON.stringify(st)); };
  // 1. the sample
  for (let i = st.done; i < st.blocks.length; i += concurrency) {
    const part = st.blocks.slice(i, i + concurrency);
    const got = await Promise.all(part.map((b, k) => rpc(urls, { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [`0x${b.toString(16)}`, true] }, { ...o, n: i + k })));
    for (const g of got) for (const a of senders(g.result)) st.seen[a] = (st.seen[a] ?? 0) + 1;
    st.done = i + part.length;
    if (st.done % (concurrency * 25) === 0 || st.done === st.blocks.length) { save(); log(`  blocks ${st.done}/${st.blocks.length}, senders ${Object.keys(st.seen).length}`); }
  }
  // 2. bots out; the most often seen first (people who came back on several days), then the address for a stable order
  const cands = Object.entries(st.seen).filter(([, s]) => s <= maxSeen).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([a]) => a);
  // 3. history, until `want` pass
  const pass = () => cands.filter((a) => st.nonces[a] != null && st.nonces[a] >= minNonce && st.nonces[a] <= maxNonce).length;
  let k = 0;
  for (let i = 0; i < cands.length && pass() < want; i += nonceBatch) {
    const part = cands.slice(i, i + nonceBatch).filter((a) => st.nonces[a] == null);
    if (part.length) {
      const res = await rpc(urls, part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getTransactionCount', params: [a, 'latest'] })), { ...o, n: k++ });
      const byId = new Map((Array.isArray(res) ? res : [res]).map((x) => [x.id, x]));
      part.forEach((a, j) => {
        const r = byId.get(j);
        if (!r || r.error || typeof r.result !== 'string') throw new Error(`eth_getTransactionCount ${a}: ${r?.error?.message ?? 'no answer'}`);
        st.nonces[a] = Number(BigInt(r.result));
      });
    }
    if (k % 40 === 0) { save(); log(`  nonces checked ${Object.keys(st.nonces).length}, passing ${pass()}/${want}`); }
  }
  save();
  const rows = cands.filter((a) => st.nonces[a] != null && st.nonces[a] >= minNonce && st.nonces[a] <= maxNonce)
    .map((a) => ({ address: a, nonce: st.nonces[a] })).sort((a, b) => b.nonce - a.nonce || (a.address < b.address ? -1 : 1)).slice(0, want);
  const seenAll = Object.keys(st.seen).length;
  return { rows, stats: { latestBlock: st.latest, sampledBlocks: st.blocks.length, senders: seenAll, bots: seenAll - cands.length, nonceChecked: Object.keys(st.nonces).length, kept: rows.length } };
}

/** The CSV push-list reads: address,score (score = the nonce). */
export const toCsv = (rows) => `address,score\n${rows.map((r) => `${r.address},${r.nonce}`).join('\n')}\n`;
