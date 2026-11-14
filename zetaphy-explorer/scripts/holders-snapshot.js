#!/usr/bin/env node
// The daily ZTPHY holders snapshot (.github/workflows/holders-snapshot.yml), for the explorer's #/holders page.
//
//   node scripts/holders-snapshot.js --out holders.json [--rpc https://129-221-199-191.sslip.io] [--limit 1000]
//   node scripts/holders-snapshot.js --check holders.json     exit 1 unless the file is a valid snapshot
//
// Reads, through the public sentry's rpc-guard (CometBFT JSON-RPC abci_query, which rpc-guard lets through):
//   1. status: the latest height and its block time (every query below is pinned to that one height, so the
//      ~100 pages are one consistent state; the node keeps 100,000 recent heights)
//   2. /cosmos.bank.v1beta1.Query/SupplyOf azetaphy at that height
//   3. /cosmos.bank.v1beta1.Query/DenomOwners azetaphy at that height, `--limit` owners a page (count_total on the
//      first page), until the node gives no next key
// then writes the snapshot (src/holders-core.js buildSnapshot): holder count, supply, top 100 with labels and share
// of supply, project wallets / module accounts / everyone else, and balance bands. Labels: projectLabels() below.
// Polite: one request at a time, --delay-ms between them, and a 429 / 503 is retried after its Retry-After.
// No dependency but the explorer's own (scripts/known.js for the module accounts, which needs `npm ci`; --check
// needs nothing).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toAddress, safeText, fromBase64 } from '../src/format.js';
import { fetchAllOwners, buildSnapshot, parseSnapshot, decodeSupplyOf, supplyOfRequest, SUPPLY_OF_PATH, KINDS, TOP_N } from '../src/holders-core.js';
import { bytesToHex } from '../vendor/zetaphy-lib.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_RPC = 'https://129-221-199-191.sslip.io';
export const CHAIN_ID = 'zetaphy_3659-1';
export const LABEL_SOURCES = {
  wallets: 'zetaphy-explorer/scripts/project-wallets.json',
  readme: 'zetaphy-chain/mainnet/zetaphy_3659-1/README.md',
  contracts: 'zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json',
  launch: 'zetaphy-launch/state/3659.contracts.json',
};

// ---- labels ----

const words = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  .replace(/\bDlmm\b/g, 'DLMM').replace(/\bDao\b/g, 'DAO').replace(/\bWebauthn\b/g, 'WebAuthn');

/** The README's "## Allocations" table: [{ address, name, note, kind }]. */
export function readmeAllocations(md) {
  const sec = /^## Allocations\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(md ?? ''));
  if (!sec) return [];
  const out = [];
  for (const line of sec[1].split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|\s*`?(0x[0-9a-fA-F]{40})`?\s*\|/.exec(line);
    if (!m) continue;
    const full = m[1];
    const name = full.replace(/\s*\(.*\)\s*$/, '').trim() || full;
    const note = /\((.*)\)\s*$/.exec(full)?.[1] ?? '';
    out.push({ address: m[2], name, note, kind: /multisig/i.test(full) ? 'multisig' : /validator/i.test(full) ? 'validator' : 'project' });
  }
  return out;
}

/** The chain's module accounts as [[0x address, name]] (scripts/known.js: sha256(name)[:20]). */
export async function moduleAccounts() {
  const { MODULES, moduleAddress } = await import('./known.js');
  return MODULES.map(([m, name]) => [moduleAddress(m), name]);
}

/**
 * Map(lower 0x -> { name, kind, group, note }) of the wallets the page labels. read(path) -> file text or null;
 * modules: moduleAccounts(). The first source to name an address wins: project-wallets.json, the README's
 * allocations, the module accounts, contracts.json, 3659.contracts.json.
 */
export function projectLabels(read, modules = []) {
  const labels = new Map();
  const add = (addr, name, kind, note = '') => {
    const a = toAddress(addr);
    if (!a || /^0x0{40}$/.test(a.lower) || labels.has(a.lower)) return;
    const k = KINDS.includes(kind) ? kind : 'project';
    labels.set(a.lower, { name: safeText(name, 60), kind: k, group: k === 'module' ? 'module' : 'project', ...(note ? { note: safeText(note, 120) } : {}) });
  };
  const json = (p) => { const t = read(p); return t == null ? null : JSON.parse(t); };
  for (const w of json(LABEL_SOURCES.wallets)?.wallets ?? []) if (w?.address) add(w.address, w.name, w.kind, w.note);
  for (const r of readmeAllocations(read(LABEL_SOURCES.readme))) add(r.address, r.name, r.kind, r.note);
  for (const [addr, name] of modules) add(addr, name, 'module');
  const c = json(LABEL_SOURCES.contracts);
  if (c) {
    add(c.deployer, 'Mainnet deployer', 'deployer');
    add(c.timelock?.address, 'ZetaphyTimelock', 'timelock', c.timelock?.delaySeconds ? `delay ${Math.round(c.timelock.delaySeconds / 3600)} h` : '');
    const g = c.guardianMultisig;
    if (g) {
      add(g.address, 'Guardian multisig', 'guardian', g.threshold ? `${g.threshold} of ${g.owners?.length ?? '?'}` : '');
      (g.owners ?? []).forEach((o, i) => add(o, `Guardian owner ${i + 1}`, 'guardian'));
    }
    for (const [k, v] of Object.entries(c.contracts ?? {})) add(v, k, 'contract');
    const r = c.addedOnResume ?? {};
    for (const [prefix, group] of [['', r.contracts], ['DEX', r.dex], ['NFT', r.nft]]) {
      for (const [k, v] of Object.entries(group ?? {})) add(v, /^dlmm/.test(k) || !prefix ? words(k) : `${prefix} ${words(k).toLowerCase()}`, 'contract');
    }
  }
  const l = json(LABEL_SOURCES.launch);
  if (l) {
    for (const [k, v] of Object.entries(l.contracts ?? {})) add(v, words(k), k === 'timelock' ? 'timelock' : k === 'guardianMultisig' ? 'guardian' : 'contract');
    for (const [k, v] of Object.entries(l.dex ?? {})) add(v, `DEX ${words(k).toLowerCase()}`, 'contract');
    for (const [k, v] of Object.entries(l.nft ?? {})) add(v, `NFT ${words(k).toLowerCase()}`, 'contract');
  }
  return labels;
}

export const repoReader = (root = REPO) => (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);

// ---- the node ----

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A CometBFT JSON-RPC client over fetch: rpc(method, params) -> result. A 429 / 503 / network error is retried
 * (Retry-After, else a growing wait) up to `tries` times; a JSON-RPC error throws at once.
 */
export function cometClient(base, { fetchFn = (...a) => fetch(...a), delayMs = 250, tries = 6, sleep = sleepMs, timeoutMs = 60_000 } = {}) {
  const url = base.replace(/\/+$/, '') + '/rpc/';
  let id = 0; let lastAt = 0;
  return async function rpc(method, params) {
    for (let attempt = 1; ; attempt++) {
      const wait = lastAt + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      let res; let err = null;
      try {
        res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) { err = e; }
      if (!err && res.status !== 429 && res.status !== 503 && res.status !== 502) {
        const j = await res.json().catch(() => null);
        if (!res.ok || !j) throw new Error(`${method}: HTTP ${res.status} ${safeText(j?.error?.message ?? '', 200)}`);
        if (j.error) throw new Error(`${method}: ${safeText(j.error.message ?? '', 200)} ${safeText(j.error.data ?? '', 200)}`);
        return j.result;
      }
      if (attempt >= tries) throw new Error(`${method}: ${err ? safeText(err.message, 200) : `HTTP ${res.status}`} after ${tries} tries`);
      const ra = Number(res?.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : Math.min(60_000, 2000 * 2 ** (attempt - 1)));
    }
  };
}

/** abci_query(path, hex data, height) -> the response value bytes; a non-zero code throws. */
export const abciQuery = (rpc) => async (path, data, height) => {
  const r = await rpc('abci_query', { path, data, height: String(height), prove: false });
  const resp = r?.response ?? {};
  if (Number(resp.code ?? 0) !== 0) throw new Error(`abci_query ${path}: code ${resp.code} ${safeText(resp.log ?? '', 200)}`);
  return fromBase64(resp.value ?? '');
};

/** The whole snapshot from a node. log(text) reports progress. */
export async function takeSnapshot({ rpc, chainId = CHAIN_ID, limit = 1000, maxPages = 2000, read = repoReader(), source = '', log = () => {}, now = () => new Date() }) {
  const labels = projectLabels(read, await moduleAccounts());
  const st = await rpc('status', {});
  const network = String(st?.node_info?.network ?? '');
  if (chainId && network !== chainId) throw new Error(`the node is on ${safeText(network, 40)}, not ${chainId}: nothing written`);
  if (st?.sync_info?.catching_up) throw new Error('the node is still catching up: nothing written');
  const height = String(st?.sync_info?.latest_block_height ?? '');
  const time = String(st?.sync_info?.latest_block_time ?? '');
  if (!/^\d+$/.test(height) || Number(height) < 1) throw new Error('the node gave no height');
  const query = abciQuery(rpc);
  const supply = decodeSupplyOf(await query(SUPPLY_OF_PATH, bytesToHex(supplyOfRequest('azetaphy')), height));
  log(`height ${height} (${time}), supply ${supply} azetaphy`);
  const all = await fetchAllOwners({ query, denom: 'azetaphy', height, limit, maxPages,
    onPage: ({ pages, owners, total }) => { if (pages === 1 || pages % 10 === 0) log(`page ${pages}: ${owners} holders so far${total != null ? ` of ${total}` : ''}`); } });
  log(`${all.owners.length} holders in ${all.pages} pages`);
  const snap = buildSnapshot({
    owners: all.owners, supply, labels, topN: TOP_N,
    meta: { height, time, chainId: network, evmChainId: 3659, denom: 'azetaphy', decimals: 18, source, generatedAt: now().toISOString(),
      holdersReported: all.total != null ? Number(all.total) : all.owners.length, pages: all.pages, pageLimit: limit },
  });
  if (snap.holders !== snap.holdersCounted) log(`warning: count_total ${snap.holders} but ${snap.holdersCounted} holders read`);
  if (!snap.sumMatchesSupply) log(`warning: the balances add up to ${snap.balanceSum}, the supply is ${snap.supply}`);
  return snap;
}

/** The snapshot as text: the top-level fields one per line, each list row on its own line (small daily diffs). */
export function snapshotJson(s) {
  const lines = Object.entries(s).map(([k, v]) => (Array.isArray(v)
    ? ` ${JSON.stringify(k)}: [\n${v.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]`
    : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`));
  return `{\n${lines.join(',\n')}\n}\n`;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m) throw new Error(`unknown argument ${argv[i]}`);
    o[m[1]] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.check) {
    const s = parseSnapshot(JSON.parse(readFileSync(o.check, 'utf8')));
    console.log(`valid snapshot: block ${s.height} (${s.time}), ${s.holders} holders, ${s.top.length} in the top list`);
    return;
  }
  if (!o.out) throw new Error('usage: holders-snapshot.js --out <file> [--rpc <https url>] [--limit 1000] [--delay-ms 250] | --check <file>');
  const base = String(o.rpc ?? process.env.HOLDERS_RPC ?? DEFAULT_RPC);
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(base)) throw new Error('--rpc must be https://<host>');
  const limit = Number(o.limit ?? 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('--limit: 1 to 10000');
  const rpc = cometClient(base, { delayMs: Number(o['delay-ms'] ?? 250) });
  const snap = await takeSnapshot({ rpc, limit, source: `${base.replace(/\/+$/, '')}/rpc (abci_query ${'/cosmos.bank.v1beta1.Query/DenomOwners'})`, log: (s) => console.log(s) });
  parseSnapshot(JSON.parse(JSON.stringify(snap))); // what the page will accept
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, snapshotJson(snap));
  console.log(`${o.out}: block ${snap.height}, ${snap.holders} holders, top ${snap.top.length}, ${snap.wallets.length} labelled wallets`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`holders snapshot: ${e.message}`); process.exit(1); });
