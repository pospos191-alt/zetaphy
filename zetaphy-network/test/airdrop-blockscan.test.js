// airdrop/blockscan.js: active wallets of BNB Smart Chain from its RPC (no BigQuery dataset), resumable, bots out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanActive, sampleBlocks, senders, toCsv, rpc } from '../airdrop/blockscan.js';
import { run } from '../airdrop/cli.js';

const A = (i) => '0x' + i.toString(16).padStart(40, '0');
const BOT = A(0xb0b);
/** A fake chain: block b holds a tx from the bot and from people p(b % 7) and p(b % 13 + 100); nonce of p(i) = i. */
function chain({ failEvery = 0 } = {}) {
  let calls = 0;
  const fetchImpl = async (url, { body }) => {
    calls++;
    if (failEvery && calls % failEvery === 0) return { status: 429, json: async () => ({}) };
    const req = JSON.parse(body);
    const one = (r) => {
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x2710' }; // 10000
      if (r.method === 'eth_getBlockByNumber') {
        const b = Number(r.params[0]);
        return { jsonrpc: '2.0', id: r.id, result: { number: r.params[0], transactions: [{ from: BOT }, { from: A(b % 7 + 20) }, { from: A((b % 13) + 100) }, { from: A(b % 7 + 20) }] } };
      }
      if (r.method === 'eth_getTransactionCount') { const a = BigInt(r.params[0]); return { jsonrpc: '2.0', id: r.id, result: '0x' + (a === BigInt(BOT) ? 99999n : a).toString(16) }; }
      throw new Error(r.method);
    };
    return { status: 200, json: async () => (Array.isArray(req) ? req.map(one) : one(req)) };
  };
  return { fetchImpl, calls: () => calls };
}
const fast = { sleep: async () => {}, retryMs: 1, timeoutMs: 5000 };

test('sample: blocks spread evenly over the window; senders: each once per block, transactions as objects only', () => {
  assert.deepEqual(sampleBlocks(1000, 100, 5), [1000, 980, 960, 940, 920]);
  assert.equal(sampleBlocks(1000, 10, 50).length, 10, 'never more blocks than the window has');
  assert.equal(sampleBlocks(100, 10_000, 50).length, 50, 'a window longer than the chain starts at block 1');
  assert.ok(sampleBlocks(100, 10_000, 50).every((b) => b >= 1));
  assert.deepEqual(senders({ transactions: [{ from: '0xAB' + '0'.repeat(38) }, { from: '0xab' + '0'.repeat(38) }, '0xhash', { from: 'bad' }] }), ['0xab' + '0'.repeat(38)]);
  assert.deepEqual(senders(null), []);
});

test('scan: the bot (seen in every block) is out, nonces within [min, max], highest nonce first, want rows; CSV for push-list', async () => {
  const c = chain();
  const r = await scanActive({ rpcUrl: 'http://rpc', want: 10, days: 1, sample: 200, blockTime: 1, maxSeen: 50, minNonce: 22, maxNonce: 110, concurrency: 4, nonceBatch: 5, fetchImpl: c.fetchImpl, ...fast });
  assert.ok(!r.rows.some((x) => x.address === BOT), 'the bot is out');
  assert.equal(r.stats.bots, 1);
  assert.ok(r.rows.every((x) => x.nonce >= 22 && x.nonce <= 110));
  assert.deepEqual(r.rows.map((x) => x.nonce), [...r.rows.map((x) => x.nonce)].sort((a, b) => b - a));
  assert.equal(r.rows.length, 10);
  assert.equal(r.rows[0].nonce, 110, 'the highest nonce at most the cap (110)');
  const [x, y] = r.rows;
  assert.equal(toCsv([x, y]), `address,score\n${x.address},${x.nonce}\n${y.address},${y.nonce}\n`);
  assert.equal(x.address, A(110));
});

test('rate limits are retried; a stopped run resumes from its state file without re-reading blocks', async () => {
  const d = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    const state = join(d, 's.json');
    const c = chain({ failEvery: 5 });
    const r1 = await scanActive({ rpcUrl: 'http://a,http://b', want: 5, days: 1, sample: 100, blockTime: 1, maxSeen: 50, minNonce: 22, maxNonce: 110, concurrency: 4, state, fetchImpl: c.fetchImpl, ...fast });
    assert.equal(r1.rows.length, 5);
    assert.ok(existsSync(state));
    const c2 = chain();
    const r2 = await scanActive({ rpcUrl: 'http://a', want: 5, days: 1, sample: 100, blockTime: 1, maxSeen: 50, minNonce: 22, maxNonce: 110, state, fetchImpl: c2.fetchImpl, ...fast });
    assert.deepEqual(r2.rows, r1.rows);
    assert.equal(c2.calls(), 0, 'everything came from the state file');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a real RPC error stops the run (never guesses); a timeout is retried then reported', async () => {
  const bad = async () => ({ status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'method not found' } }) });
  await assert.rejects(rpc(['http://x'], { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, { fetchImpl: bad, ...fast }), /eth_blockNumber: method not found/);
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(rpc(['http://x'], { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, { fetchImpl: hang, retries: 2, sleep: async () => {}, retryMs: 1, timeoutMs: 10 }), /timeout \(gave up after 2 retries\)/);
});

test('cli active-blocks writes the CSV and refuses without --out', async () => {
  const d = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    const out = join(d, 'a.csv');
    const r = await run(['active-blocks', '--rpc', 'http://rpc', '--want', '3', '--days', '1', '--sample', '50', '--block-time', '1', '--min-nonce', '22', '--max-nonce', '110', '--out', out], { log: () => {}, fetchImpl: chain().fetchImpl });
    assert.equal(r.kept, 3);
    assert.match(readFileSync(out, 'utf8'), /^address,score\n0x[0-9a-f]{40},\d+\n/);
    await assert.rejects(run(['active-blocks', '--rpc', 'http://rpc'], { log: () => {} }), /--out/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the usage text is the whole header: every command, active-blocks included', async () => {
  const e = await run(['nope'], { log: () => {} }).catch((x) => x);
  assert.equal(e.usage, true);
  for (const c of ['push-list', 'active-blocks', 'links-from-issues', 'init-code', "prints the distributor's init code"]) assert.ok(e.message.includes(c), c);
  assert.ok(!/^import /m.test(e.message), 'comments only');
});

test('a resumed run does not re-read checked nonces, logs only after new requests, and still stops at want', async () => {
  const d = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    const state = join(d, 's.json');
    const base = { rpcUrl: 'http://a', days: 1, sample: 100, blockTime: 1, maxSeen: 50, minNonce: 22, maxNonce: 110, concurrency: 3, nonceBatch: 2, state, ...fast };
    await scanActive({ ...base, want: 3, fetchImpl: chain().fetchImpl });
    const logs = [];
    const c = chain();
    const r = await scanActive({ ...base, want: 12, fetchImpl: c.fetchImpl, log: (s) => logs.push(s) });
    assert.equal(r.rows.length, 12);
    const getCount = JSON.parse(readFileSync(state, 'utf8'));
    assert.ok(Object.keys(getCount.nonces).length >= 12);
    assert.ok(c.calls() > 0 && c.calls() < 20, `only new addresses asked (${c.calls()} calls)`);
    assert.ok(logs.length < 5, 'no log line per skipped batch');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
