// Holders of the native coin ZTPHY (denom azetaphy): the pure parts shared by the daily snapshot
// (scripts/holders-snapshot.js, run by .github/workflows/holders-snapshot.yml) and the #/holders page
// (src/richlist.js). No DOM, no network: the unit tests run them in Node.
//   - the bank module's DenomOwners and SupplyOf queries as abci_query bytes (protobuf by hand)
//   - every holder, page by page, at ONE height (fetchAllOwners; it stops on an empty next_key and
//     refuses a page that would loop)
//   - the snapshot: holder count, supply, top N with share of supply, project wallets / module accounts /
//     everyone else, and balance bands (buildSnapshot); parseSnapshot checks a published file
import { protoFields, bytesToHex } from '../vendor/zetaphy-lib.js';
import { toAddress, safeText } from './format.js';

export const DENOM_OWNERS_PATH = '/cosmos.bank.v1beta1.Query/DenomOwners';
export const SUPPLY_OF_PATH = '/cosmos.bank.v1beta1.Query/SupplyOf';
export const SNAPSHOT_VERSION = 1;
export const TOP_N = 100;
/** A snapshot older than this is called old on the page (it is made once a day). */
export const MAX_AGE_MS = 36 * 3600 * 1000;
const ONE = 10n ** 18n;

/** Lower bounds of the balance bands, in whole ZTPHY (the last band is open). */
export const BAND_FLOORS = [0, 1, 10, 100, 1000, 10_000, 100_000, 1_000_000, 10_000_000];
/** Who a labelled wallet belongs to: the project (multisigs, faucet, contracts, ...) or a chain module. */
export const GROUPS = ['project', 'module', 'others'];
export const KINDS = ['multisig', 'validator', 'faucet', 'airdrop', 'timelock', 'guardian', 'deployer', 'contract', 'project', 'module'];

// ---- protobuf, by hand (the few fields these two queries use) ----

const utf8 = (s) => new TextEncoder().encode(s);
function uvarint(n) {
  let v = BigInt(n); const out = [];
  if (v < 0n) throw new Error('negative varint');
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
const lenField = (no, bytes) => [(no << 3) | 2, ...uvarint(bytes.length), ...bytes];
const varField = (no, n) => [(no << 3) | 0, ...uvarint(n)];

/**
 * QueryDenomOwnersRequest { denom = 1, pagination = 2 (PageRequest { key = 1, offset = 2, limit = 3, count_total = 4 }) }.
 * count_total is only honoured on the first page (no key), as the SDK does.
 */
export function denomOwnersRequest({ denom = 'azetaphy', key = null, limit = 1000, countTotal = false } = {}) {
  const page = [];
  if (key && key.length) page.push(...lenField(1, key));
  if (limit) page.push(...varField(3, limit));
  if (countTotal) page.push(...varField(4, 1));
  return Uint8Array.from([...lenField(1, utf8(denom)), ...lenField(2, page)]);
}

/** QuerySupplyOfRequest { denom = 1 }. */
export const supplyOfRequest = (denom = 'azetaphy') => Uint8Array.from(lenField(1, utf8(denom)));

const dec = new TextDecoder('utf-8', { fatal: true });
const sub = (fields, no, wire = 2) => fields.filter((f) => f.field === no && f.wire === wire).map((f) => f.value);
const last = (fields, no, wire) => { const v = sub(fields, no, wire); return v.length ? v[v.length - 1] : undefined; };
const amountOf = (s) => { if (!/^\d{1,78}$/.test(s)) throw new Error(`bad amount ${safeText(s, 40)}`); return BigInt(s); };

/** Coin { denom = 1, amount = 2 (decimal string) } -> { denom, amount: BigInt }. */
export function decodeCoin(bytes) {
  const f = protoFields(bytes);
  const d = last(f, 1, 2); const a = last(f, 2, 2);
  return { denom: d ? dec.decode(d) : '', amount: a ? amountOf(dec.decode(a)) : 0n };
}

/**
 * QueryDenomOwnersResponse { denom_owners = 1 (DenomOwner { address = 1, balance = 2 }), pagination = 2
 * (PageResponse { next_key = 1, total = 2 }) } -> { owners: [{ address, amount }], nextKey: Uint8Array, total: BigInt|null }.
 */
export function decodeDenomOwners(bytes, denom = 'azetaphy') {
  const f = protoFields(bytes);
  const owners = sub(f, 1).map((o) => {
    const of = protoFields(o);
    const addr = last(of, 1, 2); const bal = last(of, 2, 2);
    const coin = bal ? decodeCoin(bal) : { denom, amount: 0n };
    if (coin.denom && coin.denom !== denom) throw new Error(`unexpected denom ${safeText(coin.denom, 40)}`);
    return { address: addr ? dec.decode(addr) : '', amount: coin.amount };
  });
  const p = last(f, 2, 2);
  const pf = p ? protoFields(p) : [];
  const nextKey = last(pf, 1, 2) ?? new Uint8Array();
  const total = last(pf, 2, 0);
  return { owners, nextKey, total: total === undefined ? null : BigInt(total) };
}

/** QuerySupplyOfResponse { amount = 1 (Coin) } -> BigInt. */
export function decodeSupplyOf(bytes) {
  const c = last(protoFields(bytes), 1, 2);
  return c ? decodeCoin(c).amount : 0n;
}

/**
 * Every holder of `denom` at one height, page by page.
 * query(path, dataHex, height) -> Uint8Array (the abci_query response value); it throws on a node error.
 * Stops when the node gives no next_key. Refuses (throws) an empty page that still has a next key, a key it has
 * seen before, or more than maxPages pages, so a misbehaving node can never keep it running.
 * -> { owners: [{ address, amount }], total: BigInt|null (count_total of the first page), pages }
 */
export async function fetchAllOwners({ query, denom = 'azetaphy', height, limit = 1000, maxPages = 2000, onPage = () => {} }) {
  const owners = []; const seen = new Set();
  let key = null; let total = null; let pages = 0;
  for (;;) {
    if (pages >= maxPages) throw new Error(`more than ${maxPages} pages: stopped`);
    const req = denomOwnersRequest({ denom, key, limit, countTotal: pages === 0 });
    const page = decodeDenomOwners(await query(DENOM_OWNERS_PATH, bytesToHex(req), height), denom);
    pages++;
    if (pages === 1) total = page.total;
    owners.push(...page.owners);
    onPage({ pages, owners: owners.length, total });
    if (!page.nextKey.length) break;
    if (!page.owners.length) throw new Error(`page ${pages} is empty but has a next key: stopped`);
    const k = bytesToHex(page.nextKey);
    if (seen.has(k)) throw new Error(`page ${pages} repeats a next key: stopped`);
    seen.add(k);
    key = page.nextKey;
  }
  return { owners, total, pages };
}

// ---- the snapshot ----

/** Index of the band an amount (azetaphy) falls in. */
export function bandIndex(amount) {
  const whole = BigInt(amount) / ONE;
  let i = 0;
  for (let j = 0; j < BAND_FLOORS.length; j++) if (whole >= BigInt(BAND_FLOORS[j])) i = j;
  return i;
}

/** Share of `part` in `total` as a percentage with 6 decimals (a Number; 0 when total is 0). */
export function sharePct(part, total) {
  const t = BigInt(total);
  if (t <= 0n) return 0;
  return Number((BigInt(part) * 100_000_000n) / t) / 1_000_000;
}

/** Holders sorted by balance, largest first; equal balances by address (stable output). */
export function sortHolders(rows) {
  return [...rows].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The snapshot JSON from every owner at one height.
 * owners: [{ address (zetaphy1… or 0x…), amount: BigInt }]; labels: Map(lower 0x -> { name, kind, group, note? }).
 * meta: { height, time, chainId, evmChainId, denom, decimals, source, generatedAt, holdersReported, pages, pageLimit }.
 */
export function buildSnapshot({ owners, supply, labels = new Map(), topN = TOP_N, meta = {} }) {
  const merged = new Map();
  let unreadable = 0;
  for (const o of owners) {
    const a = toAddress(o.address);
    const key = a ? a.lower : String(o.address);
    if (!a) unreadable++;
    const prev = merged.get(key);
    if (prev) { prev.amount += BigInt(o.amount); continue; } // the same account twice: never from one height, but kept honest
    merged.set(key, { key, a, raw: String(o.address), amount: BigInt(o.amount) });
  }
  const sorted = sortHolders([...merged.values()].filter((r) => r.amount > 0n));
  const sup = BigInt(supply);
  const sum = sorted.reduce((s, r) => s + r.amount, 0n);
  const labelOf = (r) => (r.a ? labels.get(r.a.lower) ?? null : null);
  const groups = Object.fromEntries(GROUPS.map((g) => [g, { count: 0, balance: 0n }]));
  const bands = BAND_FLOORS.map((f, i) => ({ min: (BigInt(f) * ONE).toString(), max: i + 1 < BAND_FLOORS.length ? (BigInt(BAND_FLOORS[i + 1]) * ONE).toString() : null, count: 0, balance: 0n }));
  for (const r of sorted) {
    const g = groups[labelOf(r)?.group ?? 'others'] ?? groups.others;
    g.count++; g.balance += r.amount;
    const b = bands[bandIndex(r.amount)]; b.count++; b.balance += r.amount;
  }
  const row = (r, i) => {
    const l = labelOf(r);
    return { rank: i + 1, address: r.a ? r.a.hex : null, bech32: r.a ? r.a.bech32 : r.raw, balance: r.amount.toString(), share: sharePct(r.amount, sup),
      label: l ? { name: l.name, kind: l.kind, group: l.group, ...(l.note ? { note: l.note } : {}) } : null };
  };
  const rankOf = new Map(sorted.map((r, i) => [r.key, i + 1]));
  const wallets = [...labels.entries()].map(([lower, l]) => {
    const r = merged.get(lower);
    const a = toAddress(lower);
    const amount = r?.amount ?? 0n;
    return { address: a.hex, bech32: a.bech32, name: l.name, kind: l.kind, group: l.group, ...(l.note ? { note: l.note } : {}),
      balance: amount.toString(), share: sharePct(amount, sup), rank: rankOf.get(lower) ?? null };
  }).sort((x, y) => (BigInt(y.balance) > BigInt(x.balance) ? 1 : BigInt(y.balance) < BigInt(x.balance) ? -1 : x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1));
  return {
    version: SNAPSHOT_VERSION,
    chainId: meta.chainId ?? '',
    evmChainId: meta.evmChainId ?? null,
    denom: meta.denom ?? 'azetaphy',
    decimals: meta.decimals ?? 18,
    height: String(meta.height ?? ''),
    time: String(meta.time ?? ''),
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: meta.source ?? '',
    holders: Number(meta.holdersReported ?? sorted.length),
    holdersCounted: sorted.length,
    supply: sup.toString(),
    balanceSum: sum.toString(),
    sumMatchesSupply: sum === sup,
    unreadableAddresses: unreadable,
    pages: meta.pages ?? null,
    pageLimit: meta.pageLimit ?? null,
    groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { count: v.count, balance: v.balance.toString(), share: sharePct(v.balance, sup) }])),
    bands: bands.map((b) => ({ min: b.min, max: b.max, count: b.count, balance: b.balance.toString(), share: sharePct(b.balance, sup) })),
    top: sorted.slice(0, topN).map(row),
    wallets,
  };
}

// ---- reading a published snapshot (the page; the deploy checks it with the same rules) ----

const DIGITS = /^\d{1,78}$/;
const HEX = /^0x[0-9a-fA-F]{40}$/;
const BECH = /^[a-z]{1,20}1[02-9ac-hj-np-z]{6,90}$/;
const num = (x, max = 1e12) => (Number.isFinite(x) && x >= 0 && x <= max ? x : (() => { throw new Error('bad number'); })());
const digits = (s) => { if (!DIGITS.test(String(s))) throw new Error('bad amount'); return String(s); };
const kindOf = (k) => (KINDS.includes(k) ? k : 'project');
const groupOf = (g) => (GROUPS.includes(g) ? g : 'project');
function cleanLabel(l) {
  if (!l || typeof l !== 'object') return null;
  const name = safeText(l.name, 60);
  return name ? { name, kind: kindOf(l.kind), group: groupOf(l.group), note: safeText(l.note ?? '', 120) } : null;
}
function cleanAddress(x) {
  if (x.address != null && !HEX.test(String(x.address))) throw new Error('bad address');
  if (!BECH.test(String(x.bech32 ?? ''))) throw new Error('bad bech32 address');
  return { address: x.address ? toAddress(x.address)?.hex ?? null : null, bech32: String(x.bech32) };
}

/**
 * A published holders.json -> a clean copy (names cut and stripped of control characters, amounts checked),
 * or an Error thrown with the first problem. Unknown fields are dropped.
 */
export function parseSnapshot(j) {
  if (!j || typeof j !== 'object') throw new Error('not a JSON object');
  if (j.version !== SNAPSHOT_VERSION) throw new Error(`unknown snapshot version ${safeText(String(j.version), 10)}`);
  if (!/^\d{1,19}$/.test(String(j.height))) throw new Error('bad height');
  if (!Number.isFinite(Date.parse(j.time))) throw new Error('bad time');
  if (!Array.isArray(j.top) || j.top.length > 1000) throw new Error('bad top list');
  if (!Array.isArray(j.bands) || j.bands.length > 32) throw new Error('bad bands');
  if (!Array.isArray(j.wallets) || j.wallets.length > 500) throw new Error('bad wallets');
  const supply = digits(j.supply);
  const groups = {};
  for (const g of GROUPS) {
    const v = j.groups?.[g] ?? { count: 0, balance: '0' };
    groups[g] = { count: num(v.count), balance: digits(v.balance) };
  }
  return {
    version: SNAPSHOT_VERSION,
    chainId: safeText(j.chainId ?? '', 40),
    evmChainId: Number.isInteger(j.evmChainId) ? j.evmChainId : null,
    height: String(j.height),
    time: new Date(Date.parse(j.time)).toISOString(),
    generatedAt: Number.isFinite(Date.parse(j.generatedAt)) ? new Date(Date.parse(j.generatedAt)).toISOString() : null,
    holders: num(j.holders), holdersCounted: num(j.holdersCounted ?? j.holders),
    supply, sumMatchesSupply: j.sumMatchesSupply !== false,
    groups,
    bands: j.bands.map((b) => ({ min: digits(b.min), max: b.max == null ? null : digits(b.max), count: num(b.count), balance: digits(b.balance) })),
    top: j.top.map((x, i) => ({ rank: Number.isInteger(x.rank) ? x.rank : i + 1, ...cleanAddress(x), balance: digits(x.balance), label: cleanLabel(x.label) })),
    wallets: j.wallets.map((w) => ({ ...cleanAddress(w), ...(cleanLabel(w) ?? { name: '?', kind: 'project', group: 'project', note: '' }),
      balance: digits(w.balance), rank: Number.isInteger(w.rank) ? w.rank : null })),
  };
}

/** 'fresh' or 'old' for a snapshot's block time against now. */
export const snapshotState = (snap, now = Date.now()) => (now - Date.parse(snap.time) > MAX_AGE_MS ? 'old' : 'fresh');
