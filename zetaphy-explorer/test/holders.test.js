// Unit tests of the ZTPHY holders snapshot (scripts/holders-snapshot.js, src/holders-core.js) against a stub node:
// the protobuf bytes of DenomOwners / SupplyOf, paging (and where it must stop), sorting, balance bands, labels,
// 0x / zetaphy1 forms, the snapshot's checks, and the rpc client's retries.
//   node --test test/holders.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protoFields, varint, bytesToHex, hexToBytes, toBech32 } from '../vendor/zetaphy-lib.js';
import {
  denomOwnersRequest, decodeDenomOwners, supplyOfRequest, decodeSupplyOf, fetchAllOwners, buildSnapshot, parseSnapshot, snapshotState,
  bandIndex, sharePct, sortHolders, BAND_FLOORS, DENOM_OWNERS_PATH, SUPPLY_OF_PATH, MAX_AGE_MS,
} from '../src/holders-core.js';
import { projectLabels, moduleAccounts, readmeAllocations, repoReader, takeSnapshot, cometClient, abciQuery, snapshotJson, LABEL_SOURCES } from '../scripts/holders-snapshot.js';
import { moduleAddress } from '../scripts/known.js';
import { toAddress, fromBase64, toBase64 } from '../src/format.js';

const MODS = await moduleAccounts();
const Z = 10n ** 18n;
const enc = new TextEncoder();
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const len = (f, b) => concat(varint((f << 3) | 2), varint(b.length), b);
const uint = (f, v) => concat(varint(f << 3), varint(v));
const coin = (amount, denom = 'azetaphy') => concat(len(1, enc.encode(denom)), len(2, enc.encode(String(amount))));
const owner = (addr, amount) => len(1, concat(len(1, enc.encode(addr)), len(2, coin(amount))));
/** A QueryDenomOwnersResponse as a node would give it. */
const ownersPage = (rows, nextKey = null, total = null) => concat(...rows.map(([a, v]) => owner(a, v)),
  len(2, concat(nextKey ? len(1, nextKey) : new Uint8Array(), total != null ? uint(2, total) : new Uint8Array())));
const bech = (hex) => toBech32(hexToBytes(hex.replace(/^0x/, '')), 'zetaphy');
const addrN = (n) => '0x' + n.toString(16).padStart(40, '0');

/** A stub bank module: `owners` sorted by address as the store keeps them, `limit` per page at most. */
function stubBank(owners, { maxLimit = Infinity, supply = null, mutate = null } = {}) {
  const calls = [];
  const sorted = [...owners].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const query = async (path, dataHex, height) => {
    calls.push({ path, dataHex, height });
    if (path === SUPPLY_OF_PATH) return len(1, coin(supply ?? sorted.reduce((s, [, v]) => s + BigInt(v), 0n)));
    assert.equal(path, DENOM_OWNERS_PATH);
    const f = protoFields(hexToBytes(dataHex));
    assert.equal(new TextDecoder().decode(f.find((x) => x.field === 1).value), 'azetaphy');
    const pf = protoFields(f.find((x) => x.field === 2)?.value ?? new Uint8Array());
    const key = pf.find((x) => x.field === 1)?.value;
    const limit = Math.min(Number(pf.find((x) => x.field === 3)?.value ?? 100n), maxLimit);
    const count = pf.find((x) => x.field === 4)?.value === 1n;
    const start = key ? sorted.findIndex(([a]) => a === new TextDecoder().decode(key)) : 0;
    assert.ok(start >= 0, 'a key the store gave');
    const rows = sorted.slice(start, start + limit);
    const next = sorted[start + limit]?.[0];
    const page = { rows, next: next ? enc.encode(next) : null, total: count && !key ? sorted.length : null };
    if (mutate) mutate(page, calls.length);
    return ownersPage(page.rows, page.next, page.total);
  };
  return { query, calls };
}

// ---------------- protobuf ----------------

test('DenomOwners request: denom, key, limit, count_total in the SDK field numbers', () => {
  const first = protoFields(denomOwnersRequest({ denom: 'azetaphy', limit: 1000, countTotal: true }));
  assert.equal(new TextDecoder().decode(first[0].value), 'azetaphy');
  const p = protoFields(first[1].value);
  assert.deepEqual(p.map((x) => [x.field, x.wire, x.value]), [[3, 0, 1000n], [4, 0, 1n]]);
  const later = protoFields(protoFields(denomOwnersRequest({ key: Uint8Array.from([1, 2, 3]), limit: 1000 }))[1].value);
  assert.deepEqual(later.map((x) => x.field), [1, 3]); // no count_total after the first page
  assert.deepEqual([...later[0].value], [1, 2, 3]);
  // a page request with nothing in it is still field 2 (length 0)
  assert.equal(bytesToHex(denomOwnersRequest({ denom: 'a', limit: 0 })), '0a01611200');
  assert.equal(bytesToHex(supplyOfRequest('azetaphy')), '0a08617a657461706879');
});

test('DenomOwners response: owners, next key, total; SupplyOf; bad amounts and other denoms refused', () => {
  const r = decodeDenomOwners(ownersPage([[bech(addrN(1)), 5n * Z], [bech(addrN(2)), '7']], enc.encode('k'), 12));
  assert.deepEqual(r.owners, [{ address: bech(addrN(1)), amount: 5n * Z }, { address: bech(addrN(2)), amount: 7n }]);
  assert.equal(new TextDecoder().decode(r.nextKey), 'k');
  assert.equal(r.total, 12n);
  const end = decodeDenomOwners(ownersPage([], null, null));
  assert.equal(end.nextKey.length, 0); assert.equal(end.total, null);
  assert.equal(decodeSupplyOf(len(1, coin(10n ** 27n))), 10n ** 27n);
  assert.throws(() => decodeDenomOwners(len(1, concat(len(1, enc.encode('x')), len(2, coin('12abc'))))), /bad amount/);
  assert.throws(() => decodeDenomOwners(len(1, concat(len(1, enc.encode('x')), len(2, coin(1, 'uatom'))))), /unexpected denom/);
});

// ---------------- paging ----------------

test('paging: every holder at ONE height, count_total once, stops on an empty next key', async () => {
  const owners = Array.from({ length: 2345 }, (_, i) => [bech(addrN(i + 1)), BigInt(i + 1) * Z]);
  const bank = stubBank(owners);
  const seenPages = [];
  const r = await fetchAllOwners({ query: bank.query, height: '777', limit: 1000, onPage: (p) => seenPages.push(p.pages) });
  assert.equal(r.owners.length, 2345);
  assert.equal(new Set(r.owners.map((o) => o.address)).size, 2345);
  assert.equal(r.total, 2345n);
  assert.equal(r.pages, 3);
  assert.deepEqual(seenPages, [1, 2, 3]);
  assert.ok(bank.calls.every((c) => c.height === '777'), 'every page at the same height');
  // the node may give fewer than asked (its own cap): the next key is followed all the same
  const capped = stubBank(owners, { maxLimit: 300 });
  const r2 = await fetchAllOwners({ query: capped.query, height: '1', limit: 1000 });
  assert.equal(r2.owners.length, 2345); assert.equal(r2.pages, 8);
  // exactly a full last page: the node gives no next key, so no extra request
  const exact = stubBank(owners.slice(0, 2000));
  assert.equal((await fetchAllOwners({ query: exact.query, height: '1', limit: 1000 })).pages, 2);
  // no holder at all
  assert.deepEqual((await fetchAllOwners({ query: stubBank([]).query, height: '1' })).owners, []);
});

test('paging stops on a node that would loop: empty page with a key, a repeated key, too many pages', async () => {
  const owners = Array.from({ length: 50 }, (_, i) => [bech(addrN(i + 1)), Z]);
  const empty = stubBank(owners, { mutate: (p, n) => { if (n === 2) p.rows = []; } });
  await assert.rejects(fetchAllOwners({ query: empty.query, height: '1', limit: 10 }), /empty but has a next key/);
  const repeat = stubBank(owners, { mutate: (p) => { p.next = enc.encode(owners[10][0]); } });
  await assert.rejects(fetchAllOwners({ query: repeat.query, height: '1', limit: 10 }), /repeats a next key/);
  await assert.rejects(fetchAllOwners({ query: stubBank(owners).query, height: '1', limit: 10, maxPages: 3 }), /more than 3 pages/);
  // a node error stops it too
  await assert.rejects(fetchAllOwners({ query: async () => { throw new Error('code 18 height pruned'); }, height: '1' }), /pruned/);
});

// ---------------- sorting, bands, shares ----------------

test('bands: whole-ZTPHY floors, 10 ZTPHY (the airdrop) in 10 to 100, the last band open', () => {
  assert.deepEqual(BAND_FLOORS, [0, 1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]);
  assert.equal(bandIndex(1n), 0);
  assert.equal(bandIndex(Z - 1n), 0);
  assert.equal(bandIndex(Z), 1);
  assert.equal(bandIndex(10n * Z - 1n), 1);
  assert.equal(bandIndex(10n * Z), 2);
  assert.equal(bandIndex(99n * Z), 2);
  assert.equal(bandIndex(10_000_000n * Z), 8);
  assert.equal(bandIndex(500_000_000n * Z), 8);
  assert.equal(sharePct(1n, 4n), 25);
  assert.equal(sharePct(1n, 3n), 33.333333);
  assert.equal(sharePct(5n, 0n), 0);
});

test('sorting: largest first, equal balances by address', () => {
  const rows = [{ key: '0xb', amount: 5n }, { key: '0xa', amount: 5n }, { key: '0xc', amount: 9n }, { key: '0xd', amount: 1n }];
  assert.deepEqual(sortHolders(rows).map((r) => r.key), ['0xc', '0xa', '0xb', '0xd']);
});

// ---------------- labels ----------------

test('labels: README allocations, project-wallets.json (faucet; airdrop skipped until it has an address), modules, contracts', () => {
  const l = projectLabels(repoReader(), MODS);
  const get = (a) => l.get(a.toLowerCase());
  assert.deepEqual(get('0x766690Cc27485dedC4d01Eb10AC66dbAb4FD0160'), { name: 'Faucet', kind: 'faucet', group: 'project', note: "the public sentry's faucet (zetaphy_faucet, zetaphy_faucetPow)" });
  assert.deepEqual(get('0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7'), { name: 'Rewards', kind: 'multisig', group: 'project', note: 'multisig 2 of 3' });
  assert.equal(get('0x53E762B680b28a378cE33eafc6b6384D9DF4B989').name, 'Community');
  assert.equal(get('0xF9526e78d3f107c4147f83325Bc2bb42c3328B32').kind, 'validator');
  assert.equal(get('0x58B726B2A5404b0374842fE15149294D139D62A8').note, 'multisig 2 of 3; locked 1 year, then linear to year 4');
  assert.equal(get('0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA').kind, 'timelock');
  assert.equal(get('0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519').kind, 'guardian');
  assert.equal(get('0x11391E190692BE087792c6e34FB699828b6BFC4e').kind, 'deployer');
  assert.equal(get('0xb73856D25a3547581D36E8F2D9F3601a5DF39eBE').name, 'ZetaphyBounty');
  assert.equal(get('0xc0800dBEbFFC80120f5DC0E6f2a603C00F6AF391').name, 'NFT factory');
  // the timelock's proposer is the governance module: labelled as the module, not as a project wallet
  assert.deepEqual(get('0x7b5Fe22B5446f7C62Ea27B8BD71CeF94e03f3dF2'), { name: 'Governance (module)', kind: 'module', group: 'module' });
  assert.equal(get(moduleAddress('bonded_tokens_pool')).group, 'module');
  for (const [, v] of l) assert.ok(v.name && v.name.length <= 61);
  // every allocation in the README is labelled
  const readme = readFileSync(new URL('../../' + LABEL_SOURCES.readme, import.meta.url), 'utf8');
  const alloc = readmeAllocations(readme);
  assert.equal(alloc.length, 7);
  for (const a of alloc) assert.ok(l.has(a.address.toLowerCase()), a.name);
  // the airdrop row has no address yet: skipped, and nothing named after it
  assert.ok(![...l.values()].some((v) => v.kind === 'airdrop'));
});

test('labels: adding one is a row in project-wallets.json (0x or zetaphy1); it wins over the other sources', () => {
  const files = {
    [LABEL_SOURCES.wallets]: JSON.stringify({ wallets: [
      { address: bech('0x00000000000000000000000000000000000000a1'), name: 'Airdrop hot key', kind: 'airdrop' },
      { address: '0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7', name: 'Rewards pool', kind: 'multisig' },
      { address: '', name: 'not yet', kind: 'airdrop' }, { address: 'nonsense', name: 'bad', kind: 'faucet' },
      { address: '0x00000000000000000000000000000000000000a2', name: 'x'.repeat(90), kind: 'whatever' },
    ] }),
    [LABEL_SOURCES.readme]: '# t\n\n## Allocations\n\n| Account | Address | ZTPHY |\n|---|---|---|\n| Rewards (multisig 2 of 3) | `0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7` | 5 |\n\n## Next\n| Other | `0x00000000000000000000000000000000000000ff` | 1 |\n',
  };
  const l = projectLabels((p) => files[p] ?? null, MODS);
  assert.deepEqual(l.get('0x00000000000000000000000000000000000000a1'), { name: 'Airdrop hot key', kind: 'airdrop', group: 'project' });
  assert.equal(l.get('0x3b87f248a644aa66bf35a33c26abeff3326b3dd7').name, 'Rewards pool');
  assert.equal(l.get('0x00000000000000000000000000000000000000a2').kind, 'project');
  assert.ok(l.get('0x00000000000000000000000000000000000000a2').name.length <= 61);
  assert.ok(!l.has('0x00000000000000000000000000000000000000ff'), 'only the Allocations section');
  assert.equal([...l.values()].filter((v) => v.group === 'module').length, 11);
});

// ---------------- the snapshot ----------------

function sample() {
  const faucet = '0x766690Cc27485dedC4d01Eb10AC66dbAb4FD0160';
  const rewards = '0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7';
  const bonded = moduleAddress('bonded_tokens_pool');
  const owners = [
    [bech(rewards), 500_000_000n * Z], [bech(bonded), 1_000_000n * Z], [bech(faucet), 50_000n * Z],
    ...Array.from({ length: 150 }, (_, i) => [bech(addrN(0x1000 + i)), 10n * Z]), // the airdrop
    [bech(addrN(0x9999)), Z / 2n],
    // a 32-byte (contract) account: counted, no 0x form
    [toBech32(new Uint8Array(32).fill(7), 'zetaphy'), 3n * Z],
  ];
  const supply = owners.reduce((s, [, v]) => s + v, 0n);
  return { owners: owners.map(([address, amount]) => ({ address, amount })), supply, faucet, rewards, bonded };
}

test('snapshot: sorted top N with 0x and zetaphy1 forms and labels, groups, bands, every labelled wallet', () => {
  const { owners, supply, faucet, rewards, bonded } = sample();
  const labels = projectLabels(repoReader(), MODS);
  const s = buildSnapshot({ owners, supply, labels, topN: 100, meta: { height: '4242', time: '2026-11-15T02:00:00Z', chainId: 'zetaphy_3659-1', holdersReported: owners.length } });
  assert.equal(s.holders, 155); assert.equal(s.holdersCounted, 155);
  assert.equal(s.supply, supply.toString()); assert.equal(s.sumMatchesSupply, true);
  assert.equal(s.top.length, 100);
  assert.deepEqual(s.top.map((x) => x.rank).slice(0, 3), [1, 2, 3]);
  assert.equal(s.top[0].address, rewards);
  assert.equal(s.top[0].bech32, bech(rewards));
  assert.equal(s.top[0].label.name, 'Rewards');
  assert.equal(s.top[1].address.toLowerCase(), bonded);
  assert.equal(s.top[1].label.group, 'module');
  assert.equal(s.top[2].address, faucet);
  assert.equal(s.top[2].label.kind, 'faucet');
  assert.equal(s.top[3].balance, (10n * Z).toString()); // the 32-byte account (3) and dust come after the airdropped 10s
  assert.ok(s.top.slice(3).every((x) => x.label === null));
  for (const x of s.top) if (x.address) assert.equal(toAddress(x.bech32).hex, x.address); // the two forms agree
  for (let i = 1; i < s.top.length; i++) assert.ok(BigInt(s.top[i - 1].balance) >= BigInt(s.top[i].balance));
  assert.equal(s.unreadableAddresses, 1);
  assert.ok(Math.abs(s.top[0].share - Number((500_000_000n * Z * 100_000_000n) / supply) / 1e6) < 1e-9);
  // groups add up to every holder and the whole supply
  assert.equal(s.groups.project.count, 2); assert.equal(s.groups.module.count, 1); assert.equal(s.groups.others.count, 152);
  assert.equal(BigInt(s.groups.project.balance) + BigInt(s.groups.module.balance) + BigInt(s.groups.others.balance), supply);
  // bands: 0.5 -> 0-1, 3 -> 1-10, 10 x150 -> 10-100, 50,000 -> 10k-100k, 1M -> 1M-10M, 500M -> 10M+
  assert.deepEqual(s.bands.map((b) => b.count), [1, 1, 150, 0, 0, 1, 0, 1, 1]);
  assert.equal(s.bands[2].min, (10n * Z).toString()); assert.equal(s.bands[2].max, (100n * Z).toString()); assert.equal(s.bands[8].max, null);
  assert.equal(s.bands.reduce((n, b) => n + b.count, 0), s.holdersCounted);
  // every labelled wallet, held or not, largest first, with its rank
  assert.equal(s.wallets.length, labels.size);
  assert.equal(s.wallets[0].address, rewards); assert.equal(s.wallets[0].rank, 1);
  const unheld = s.wallets.find((w) => w.address === '0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA');
  assert.equal(unheld.balance, '0'); assert.equal(unheld.rank, null);
  // what the page reads back
  const back = parseSnapshot(JSON.parse(snapshotJson(s)));
  assert.equal(back.top.length, 100); assert.equal(back.top[2].label.name, 'Faucet'); assert.equal(back.holders, 155);
  assert.equal(back.wallets.length, labels.size);
});

test('snapshot: duplicates merged, zero balances dropped, count_total kept apart from the rows read', () => {
  const a = bech(addrN(5));
  const s = buildSnapshot({ owners: [{ address: a, amount: 2n }, { address: addrN(5), amount: 3n }, { address: bech(addrN(6)), amount: 0n }], supply: 6n, meta: { holdersReported: 3 } });
  assert.equal(s.holdersCounted, 1); assert.equal(s.holders, 3);
  assert.equal(s.top[0].balance, '5'); assert.equal(s.sumMatchesSupply, false);
});

test('parseSnapshot: refuses what the page must not show, cleans names', () => {
  const { owners, supply } = sample();
  const good = JSON.parse(snapshotJson(buildSnapshot({ owners, supply, labels: projectLabels(repoReader(), MODS), meta: { height: '9', time: '2026-11-15T02:00:00Z' } })));
  const bad = (f) => { const j = structuredClone(good); f(j); return () => parseSnapshot(j); };
  assert.throws(bad((j) => { j.version = 2; }), /version/);
  assert.throws(bad((j) => { j.height = '1e9'; }), /height/);
  assert.throws(bad((j) => { j.time = 'yesterday'; }), /time/);
  assert.throws(bad((j) => { j.supply = '-1'; }), /amount/);
  assert.throws(bad((j) => { j.top[0].balance = '1.5'; }), /amount/);
  assert.throws(bad((j) => { j.top[0].address = 'javascript:alert(1)'; }), /address/);
  assert.throws(bad((j) => { j.top[0].bech32 = '<img>'; }), /bech32/);
  assert.throws(bad((j) => { j.top = Array(1001).fill(j.top[0]); }), /top/);
  assert.throws(() => parseSnapshot(null), /object/);
  const j = structuredClone(good);
  j.top[0].label = { name: 'Re‮wards\u0000 ' + 'x'.repeat(100), kind: 'evil', group: 'evil' };
  j.extra = 'dropped';
  const p = parseSnapshot(j);
  assert.ok(!p.top[0].label.name.includes('‮')); assert.ok([...p.top[0].label.name].length <= 61);
  assert.equal(p.top[0].label.kind, 'project'); assert.equal(p.top[0].label.group, 'project');
  assert.equal(p.extra, undefined);
  // old after 36 h
  assert.equal(snapshotState(p, Date.parse(p.time) + MAX_AGE_MS - 1000), 'fresh');
  assert.equal(snapshotState(p, Date.parse(p.time) + MAX_AGE_MS + 1000), 'old');
});

// ---------------- the whole run against a stub node ----------------

/** A stub CometBFT JSON-RPC (the shape rpc-guard passes through): status and abci_query. */
function stubNode({ owners, chainId = 'zetaphy_3659-1', height = '5000', catchingUp = false, limitCap = Infinity }) {
  const bank = stubBank(owners.map((o) => [o.address, o.amount]), { maxLimit: limitCap });
  const methods = [];
  const rpc = async (method, params) => {
    methods.push(method);
    if (method === 'status') return { node_info: { network: chainId }, sync_info: { latest_block_height: height, latest_block_time: '2026-11-15T02:00:00.123Z', catching_up: catchingUp } };
    if (method === 'abci_query') {
      assert.equal(params.prove, false);
      assert.equal(params.height, height);
      const v = await bank.query(params.path, params.data, params.height);
      return { response: { code: 0, value: toBase64(v), height } };
    }
    throw new Error(`method not available on this public RPC: ${method}`);
  };
  return { rpc, methods, bank };
}

test('takeSnapshot: status, SupplyOf and every DenomOwners page at the status height; refuses another chain', async () => {
  const { owners } = sample();
  const node = stubNode({ owners, limitCap: 40 });
  const lines = [];
  const s = await takeSnapshot({ rpc: node.rpc, limit: 1000, log: (x) => lines.push(x), now: () => new Date('2026-11-15T02:05:00Z') });
  assert.equal(s.height, '5000'); assert.equal(s.time, '2026-11-15T02:00:00.123Z'); assert.equal(s.chainId, 'zetaphy_3659-1');
  assert.equal(s.holders, 155); assert.equal(s.pages, 4); assert.equal(s.pageLimit, 1000); assert.equal(s.generatedAt, '2026-11-15T02:05:00.000Z');
  assert.ok(new Set(node.methods).size === 2 && node.methods.every((m) => m === 'status' || m === 'abci_query'), 'only methods rpc-guard allows');
  assert.ok(lines.some((x) => /155 holders in 4 pages/.test(x)));
  await assert.rejects(takeSnapshot({ rpc: stubNode({ owners, chainId: 'zetaphy_77390-1' }).rpc }), /not zetaphy_3659-1/);
  await assert.rejects(takeSnapshot({ rpc: stubNode({ owners, catchingUp: true }).rpc }), /catching up/);
});

test('abciQuery: a non-zero code is an error (e.g. a pruned height)', async () => {
  const q = abciQuery(async () => ({ response: { code: 38, log: 'height 3 is not available' } }));
  await assert.rejects(q(DENOM_OWNERS_PATH, '00', '3'), /code 38 height 3 is not available/);
  const ok = abciQuery(async () => ({ response: { code: 0, value: toBase64(Uint8Array.from([1, 2])) } }));
  assert.deepEqual([...await ok('/x', '', '1')], [1, 2]);
  assert.deepEqual([...fromBase64(toBase64(Uint8Array.from([9])))], [9]);
});

test('cometClient: JSON-RPC POST to <host>/rpc/, waits out 429 (Retry-After) and 503, refuses errors', async () => {
  const sent = []; const slept = [];
  const answers = [
    { status: 429, headers: { 'retry-after': '3' }, body: { error: { message: 'too many requests' } } },
    { status: 503, body: {} },
    { status: 200, body: { jsonrpc: '2.0', id: 3, result: { ok: 1 } } },
    { status: 200, body: { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'method not available on this public RPC: net_info' } } },
    { status: 403, body: { error: { message: 'method not available' } } },
  ];
  const fetchFn = async (url, init) => {
    sent.push({ url, init: { method: init.method, body: JSON.parse(init.body) } });
    const a = answers.shift();
    return { status: a.status, ok: a.status < 300, headers: { get: (k) => a.headers?.[k] ?? null }, json: async () => a.body };
  };
  const rpc = cometClient('https://sentry.example/', { fetchFn, delayMs: 0, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(await rpc('status', {}), { ok: 1 });
  assert.equal(sent[0].url, 'https://sentry.example/rpc/');
  assert.equal(sent[0].init.method, 'POST'); assert.equal(sent[0].init.body.method, 'status');
  assert.deepEqual(slept, [3000, 4000]);
  await assert.rejects(rpc('net_info', {}), /method not available/);
  await assert.rejects(rpc('abci_query', {}), /HTTP 403/);
  // gives up after `tries`
  const always = cometClient('https://sentry.example', { fetchFn: async () => ({ status: 503, ok: false, headers: { get: () => null }, json: async () => ({}) }), delayMs: 0, tries: 3, sleep: async () => {} });
  await assert.rejects(always('status', {}), /HTTP 503 after 3 tries/);
});

test('snapshotJson: one row per line, valid JSON', () => {
  const { owners, supply } = sample();
  const s = buildSnapshot({ owners, supply, meta: { height: '1', time: '2026-11-15T02:00:00Z' } });
  const text = snapshotJson(s);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(s)));
  assert.ok(text.split('\n').length > s.top.length);
  assert.ok(text.length < 200_000, 'small enough to publish daily');
});

test('CLI --check (what the explorer deploy runs before it serves the file): exit 0 on a good snapshot, 1 otherwise', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'holders-check-'));
  try {
    const { owners, supply } = sample();
    const good = join(dir, 'good.json'); const bad = join(dir, 'bad.json');
    writeFileSync(good, snapshotJson(buildSnapshot({ owners, supply, labels: projectLabels(repoReader(), MODS), meta: { height: '77', time: '2026-11-15T02:00:00Z', holdersReported: 155 } })));
    writeFileSync(bad, '{"version": 1, "height": "77", "time": "2026-11-15T02:00:00Z", "top": "<script>"}');
    const run = (f) => spawnSync(process.execPath, [new URL('../scripts/holders-snapshot.js', import.meta.url).pathname, '--check', f], { encoding: 'utf8' });
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /valid snapshot: block 77 \(2026-11-15T02:00:00.000Z\), 155 holders, 100 in the top list/);
    const no = run(bad);
    assert.equal(no.status, 1); assert.match(no.stderr, /bad top list/);
    assert.equal(run(join(dir, 'missing.json')).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
