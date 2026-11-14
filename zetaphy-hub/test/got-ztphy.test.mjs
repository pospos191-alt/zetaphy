// got-ztphy.html ("Did you get ZTPHY?"), pure parts: addresses (0x / zetaphy1, checksums) against ethers and chainlib,
// the published push list (manifest + shards) built by tools/push-manifest.mjs and read back exactly as the page
// reads it, the RPC helper (rpc.js), the words in 8 languages, and the page itself: shipped, in the sitemap, share
// tags, strict-CSP friendly, and never a request to sign or send anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { getAddress, hexlify } from 'ethers';
import { keccak256 } from '../../zetaphy-neuro/src/keccak.js';
import * as core from '../got-ztphy-core.js';
import { toBech32, bech32Encode } from '../chainlib.js';
import { rpcCall, getJson } from '../rpc.js';
import { writePushFiles } from '../tools/push-manifest.mjs';
import { GOT } from '../got-ztphy-i18n.js';
import { LANG_CODES } from '../i18n.js';
import { HUB_PAGES } from '../seo.mjs';
import { NET_TEXT } from '../network.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const rand = () => getAddress(hexlify(randomBytes(20)));

test('addresses: 0x in any case, EIP-55 checked; zetaphy1 is the same account; anything else is refused', () => {
  for (let i = 0; i < 50; i++) {
    const a = rand();
    const b32 = toBech32(a);
    for (const typed of [a, a.toLowerCase(), `0x${a.slice(2).toUpperCase()}`, `  ${a}\n`, b32, b32.toUpperCase()]) {
      assert.deepEqual(core.readAddress(typed, keccak256), { evm: a, bech32: b32 }, typed);
    }
  }
  const a = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // the EIP-55 test vector
  assert.equal(core.readAddress(a.toLowerCase(), keccak256).evm, a);
  assert.deepEqual(core.readAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD', keccak256), { error: 'checksum' });
  assert.deepEqual(core.readAddress('', keccak256), { error: 'empty' });
  assert.deepEqual(core.readAddress('   ', keccak256), { error: 'empty' });
  const bytes = [...Buffer.from(a.slice(2), 'hex')];
  for (const bad of ['0x1234', `${a}00`, 'hello', bech32Encode('cosmos', bytes), bech32Encode('zetaphyvaloper', bytes),
    `${toBech32(a).slice(0, -1)}${toBech32(a).endsWith('q') ? 'p' : 'q'}`, 'zetaphy1'.padEnd(46, 'b')]) {
    assert.deepEqual(core.readAddress(bad, keccak256), { error: 'bad' }, bad);
  }
});

test('balance: eth_getBalance hex -> bigint, anything else null', () => {
  assert.equal(core.balanceOf('0x8ac7230489e80000'), 10n * 10n ** 18n);
  assert.equal(core.balanceOf('0x0'), 0n);
  for (const x of [null, 1, '', '0x', '12', '0xzz', `0x${'f'.repeat(65)}`]) assert.equal(core.balanceOf(x), null, String(x));
});

test('push list -> manifest + shards -> every address is found in its shard, no other address is', () => {
  const addrs = Array.from({ length: 700 }, rand);
  const text = `${addrs.join('\r\n')}\n\n`;
  const sha256 = createHash('sha256').update(text).digest('hex');
  const { manifest, shards } = core.buildPushFiles(text, { sha256 });
  assert.deepEqual(manifest, { chainId: 3659, each: '10', count: 700, sha256, shardPrefixLength: 2, list: 'list.txt' });
  assert.deepEqual(core.cleanManifest(manifest), manifest);
  assert.equal(Object.values(shards).flat().length, 700);
  for (const a of addrs) {
    const f = core.shardFile(a, manifest);
    assert.match(f, /^shards\/[0-9a-f]{2}\.json$/);
    assert.equal(core.inShard({ addresses: shards[f.slice(7, 9)] }, a), true, a);
  }
  for (let i = 0; i < 50; i++) {
    const o = rand();
    const s = shards[core.shardFile(o, manifest).slice(7, 9)];
    assert.equal(core.inShard({ addresses: s ?? [] }, o), addrs.includes(o));
  }
  // one prefix character, another amount, no list file
  const m1 = core.buildPushFiles(addrs.join('\n'), { sha256, each: '25', prefix: 1, list: null });
  assert.equal(Object.keys(m1.shards).length <= 16, true);
  assert.deepEqual(m1.manifest, { chainId: 3659, each: '25', count: 700, sha256, shardPrefixLength: 1 });
  // refused: a bad line, a duplicate (in any case), an empty list, a bad hash
  assert.throws(() => core.buildPushFiles(`${addrs[0]}\nnot-an-address\n`, { sha256 }), /line 2: not a 0x address/);
  assert.throws(() => core.buildPushFiles(`${addrs[0]}\n${addrs[0].toLowerCase()}\n`, { sha256 }), /line 2: duplicate/);
  assert.throws(() => core.buildPushFiles('\n\n', { sha256 }), /empty/);
  assert.throws(() => core.buildPushFiles(addrs[0], { sha256: 'abc' }), /sha256/);
});

test('the manifest and shards are untrusted input: anything malformed means "no list" or "cannot read"', () => {
  const ok = { chainId: 3659, each: '10', count: 5, sha256: 'a'.repeat(64), shardPrefixLength: 2, list: 'list.txt' };
  assert.deepEqual(core.cleanManifest(ok), ok);
  for (const bad of [null, 'x', { ...ok, chainId: 77390 }, { ...ok, count: 0 }, { ...ok, count: 1.5 }, { ...ok, sha256: 'A'.repeat(64) },
    { ...ok, shardPrefixLength: 0 }, { ...ok, shardPrefixLength: 5 }, { ...ok, each: '-1' }, { ...ok, each: '1e3' }]) assert.equal(core.cleanManifest(bad), null, JSON.stringify(bad));
  for (const list of ['../secret.txt', 'https://x.example/list.txt', 'list.csv', 'a/b.txt']) assert.equal(core.cleanManifest({ ...ok, list }).list, null, list);
  const a = rand();
  for (const shard of [null, {}, { addresses: 'x' }, { addresses: [a] }, { addresses: ['0x12'] }]) assert.throws(() => core.inShard(shard, a), /bad-list/);
  assert.throws(() => core.shardFile('0x12', ok), /bad-list/);
});

test('tools/push-manifest.mjs writes the files; the sha256 is the list file\'s own (sha256sum), list.txt is byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const addrs = Array.from({ length: 300 }, rand);
    const file = join(dir, 'push.txt');
    writeFileSync(file, `${addrs.join('\n')}\n`);
    const out = join(dir, 'out');
    const m = writePushFiles(file, { out });
    assert.equal(m.sha256, createHash('sha256').update(readFileSync(file)).digest('hex'));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), m);
    assert.deepEqual(readFileSync(join(out, 'list.txt')), readFileSync(file));
    const all = readdirSync(join(out, 'shards')).flatMap((f) => JSON.parse(readFileSync(join(out, 'shards', f), 'utf8')).addresses);
    assert.deepEqual(all.sort(), addrs.map((x) => x.toLowerCase()).sort());
    for (const a of addrs.slice(0, 20)) assert.equal(core.inShard(JSON.parse(readFileSync(join(out, core.shardFile(a, m)), 'utf8')), a), true);
    // again without the list: list.txt goes away, old shards do not linger
    writeFileSync(file, `${addrs.slice(0, 3).join('\n')}\n`);
    const m2 = writePushFiles(file, { out, withList: false });
    assert.equal(m2.count, 3);
    assert.equal(m2.list, undefined);
    assert.equal(existsSync(join(out, 'list.txt')), false);
    assert.ok(readdirSync(join(out, 'shards')).length <= 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rpc.js: one JSON-RPC POST, its result; an RPC error or HTTP error throws', async () => {
  const real = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      const body = JSON.parse(init.body);
      if (body.method === 'bad') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'nope' } }));
      if (body.method === 'down') return new Response('x', { status: 503 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x8ac7230489e80000' }));
    };
    assert.equal(await rpcCall('https://rpc.example', 'eth_getBalance', ['0xabc', 'latest']), '0x8ac7230489e80000');
    assert.deepEqual(JSON.parse(seen[0].init.body), { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: ['0xabc', 'latest'] });
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.credentials, 'omit');
    await assert.rejects(rpcCall('https://rpc.example', 'bad'), /nope/);
    await assert.rejects(rpcCall('https://rpc.example', 'down'), /HTTP 503/);
    await assert.rejects(getJson('https://rpc.example/x', { method: 'POST', body: '{"method":"down"}' }), /HTTP 503/);
  } finally { globalThis.fetch = real; }
  const hub = readFileSync(join(HERE, 'hub.js'), 'utf8');
  assert.match(hub, /import \{ getJson, rpcCall \} from '\.\/rpc\.js'/, 'the hub uses the same helper');
});

test('words: every key in all 8 languages, placeholders kept; the safety rules say exactly what the announcement says', () => {
  assert.deepEqual(Object.keys(GOT).sort(), [...LANG_CODES].sort());
  const keys = Object.keys(GOT.en);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join();
  for (const l of LANG_CODES) {
    assert.deepEqual(Object.keys(GOT[l]).sort(), [...keys].sort(), `${l}: same keys`);
    for (const k of keys) {
      assert.ok(typeof GOT[l][k] === 'string' && GOT[l][k].trim(), `${l}.${k}`);
      assert.equal(ph(GOT[l][k]), ph(GOT.en[k]), `${l}.${k} placeholders`);
      if (l !== 'en' && !['addrPh'].includes(k)) assert.notEqual(GOT[l][k], GOT.en[k], `${l}.${k} translated`);
    }
    assert.ok(NET_TEXT[l].risk.length > 40, `${l}: the notice's risk sentence`);
  }
  assert.deepEqual([GOT.en.safe1, GOT.en.safe2, GOT.en.safe3, GOT.en.safe4], [
    'The coins are already in your wallet.', 'There is nothing to claim and nothing to pay.',
    'We never DM you and never ask for a seed phrase, private key, signature or approval.', 'Anyone who does is a scammer.']);
  for (const f of ['got-ztphy.js', 'got-ztphy-core.js', 'rpc.js']) assert.doesNotMatch(readFileSync(join(HERE, f), 'utf8'), /[฀-๿]/, `${f}: no Thai in the code`);
});

test('the page: shipped, in the sitemap, share tags that unfurl, strict-CSP friendly, never asks to sign or send', () => {
  const build = readFileSync(join(HERE, 'build.mjs'), 'utf8');
  for (const f of ['got-ztphy.html', 'got-ztphy.js', 'got-ztphy-core.js', 'got-ztphy-i18n.js', 'got-ztphy.css', 'rpc.js']) assert.ok(build.includes(`'${f}'`), `${f} in HUB_FILES`);
  assert.match(build, /'airdrop-push', 'manifest\.json'/, 'the published list is shipped when it exists');
  assert.ok(HUB_PAGES.includes('/got-ztphy.html'));
  const html = readFileSync(join(HERE, 'got-ztphy.html'), 'utf8');
  assert.doesNotMatch(html, /<script>|<style|\sstyle="|\son[a-z]+="/i);
  assert.doesNotMatch(html, /type="password"|mnemonic|<form/i);
  const meta = (p) => html.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]+)"`))?.[1];
  assert.equal(meta('og:url'), 'https://app.sawasdeecoin.com/got-ztphy.html');
  assert.equal(meta('og:image'), 'https://app.sawasdeecoin.com/og.png');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  for (const p of ['og:title', 'og:description', 'twitter:title', 'twitter:description', 'description']) assert.ok(meta(p)?.length > 20, p);
  assert.ok(meta('og:title').length <= 70 && meta('og:description').length <= 200);
  assert.match(html, /<link rel="canonical" href="https:\/\/app\.sawasdeecoin\.com\/got-ztphy\.html">/);
  assert.ok(existsSync(join(HERE, 'og.png')));
  for (const l of ['en', 'zh', 'es', 'ko', 'ja', 'ru', 'vi', 'th']) assert.match(html, new RegExp(`<option value="${l}">`));
  const src = readFileSync(join(HERE, 'got-ztphy.js'), 'utf8') + readFileSync(join(HERE, 'got-ztphy-core.js'), 'utf8') + readFileSync(join(HERE, 'rpc.js'), 'utf8');
  assert.doesNotMatch(src, /eth_sendTransaction|eth_sign\b|personal_sign|signTypedData|eth_signTypedData|sendTransaction|innerHTML|approve\(/);
  assert.match(src, /wallet_addEthereumChain/);
  assert.match(src, /addChainParams\(NET\)/, 'network.js parameters');
  const hub = readFileSync(join(HERE, 'hub.js'), 'utf8');
  assert.match(hub, /href: 'got-ztphy\.html', id: 'nav-got'/, 'linked from the hub menu');
});
