// Browser test: the "Claim airdrop" card of the Agents page on a built dist/, served with the site's CSP from
// vercel.json, against the REAL ZtphyMerkleDistributor in an in-memory EVM behind a fake node and a stand-in wallet,
// with a published list (zetaphy-network/airdrop/distributor.js: summary.json + shards/) served by the site:
// a public eligibility check without a wallet (in the list / not in it), a contract whose root does not match the
// list (refused), connect, claim from the wallet, the coins arrive, a second check says already claimed; Thai; a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { answer } from './mocknode.mjs';
import { Interface, Wallet, getAddress, keccak256 as ethKeccak, toUtf8Bytes, toBeHex, hexlify, randomBytes } from 'ethers';
import { EVM } from '@ethereumjs/evm';
import { Common, Chain, Hardfork } from '@ethereumjs/common';
import { Address, Account, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { buildRound } from '../../zetaphy-network/airdrop/distributor.js';
import { onTestnet } from './net.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const exe = process.env.CHROMIUM_PATH || undefined;
const vercel = JSON.parse(readFileSync(join(HERE, '..', 'vercel.json'), 'utf8'));
const CSP = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const ZETA = 10n ** 18n;
const art = (n) => JSON.parse(readFileSync(join(HERE, '..', '..', 'zetaphy-network', 'artifacts', `${n}.json`), 'utf8'));

async function chain() {
  const common = Common.custom({ chainId: 77390n }, { baseChain: Chain.Mainnet, hardfork: Hardfork.Cancun });
  const blockchain = { async getBlock(n) { const h = hexToBytes(ethKeccak(toBeHex(BigInt(n), 32))); return { hash: () => h }; }, shallowCopy() { return this; } };
  const evm = await EVM.create({ common, blockchain });
  const sm = evm.stateManager;
  let number = 100n, time = BigInt(Math.floor(Date.now() / 1000));
  const receipts = new Map();
  const block = () => ({ header: { number, timestamp: time, coinbase: Address.zero(), difficulty: 0n, prevRandao: new Uint8Array(32), gasLimit: 30_000_000n, baseFeePerGas: 0n, cliqueSigner: () => Address.zero(), getBlobGasPrice: () => 0n } });
  const fund = async (hex) => { await sm.putAccount(Address.fromString(hex), new Account(0n, 1000n * ZETA)); };
  async function tx(from, to, data, value = 0n) {
    const r = await evm.runCall({ caller: Address.fromString(from), to: to ? Address.fromString(to) : undefined, data: hexToBytes(data), value, gasLimit: 15_000_000n, block: block() });
    const hash = ethKeccak(toUtf8Bytes(`${number}:${from}:${data}:${Math.random()}`));
    receipts.set(hash, { transactionHash: hash, blockNumber: `0x${number.toString(16)}`, status: r.execResult.exceptionError ? '0x0' : '0x1', contractAddress: r.createdAddress?.toString() ?? null, logs: [] });
    number += 2n; time += 6n;
    if (r.execResult.exceptionError) throw Object.assign(new Error(`reverted: ${r.execResult.exceptionError.error}`), { hash });
    return { hash, created: r.createdAddress?.toString() };
  }
  async function ethCall({ from, to, data }) {
    await sm.checkpoint();
    try {
      const r = await evm.runCall({ caller: from ? Address.fromString(from) : Address.zero(), to: Address.fromString(to), data: hexToBytes(data ?? '0x'), gasLimit: 15_000_000n, block: block() });
      return r.execResult.exceptionError ? { error: { code: 3, message: 'execution reverted', data: bytesToHex(r.execResult.returnValue) } } : { result: bytesToHex(r.execResult.returnValue) };
    } finally { await sm.revert(); }
  }
  const code = async (a) => bytesToHex(await sm.getContractCode(Address.fromString(a)));
  const balance = async (a) => (await sm.getAccount(Address.fromString(a)))?.balance ?? 0n;
  async function deploy(a, args, from, value = 0n) {
    const iface = new Interface(a.abi);
    const { created } = await tx(from, null, a.bytecode + iface.encodeDeploy(args).slice(2), value);
    const c = getAddress(created);
    return {
      address: c, iface,
      send: (who, fn, xs = [], v = 0n) => tx(who, c, iface.encodeFunctionData(fn, xs), v),
      call: async (fn, xs = []) => { const out = iface.decodeFunctionResult(fn, (await ethCall({ to: c, data: iface.encodeFunctionData(fn, xs) })).result); return out.length === 1 ? out[0] : out; },
    };
  }
  return { fund, tx, ethCall, code, balance, deploy, receipts, number: () => number, now: () => time };
}

test('Claim airdrop: public check, wrong contract refused, connect, claim, already claimed', { timeout: 300_000 }, async () => {
  const c = await chain();
  const user = Wallet.createRandom();
  const ACC = user.address, GOV = '0x' + '90'.repeat(20), FUND = getAddress('0x' + 'f0'.repeat(20));
  const OTHER = getAddress(hexlify(randomBytes(20)));
  const STRANGER = getAddress(hexlify(randomBytes(20)));
  for (const a of [GOV, ACC]) await c.fund(a);
  const allocations = [{ address: ACC, amount: (234n * ZETA).toString() }, { address: OTHER, amount: (77n * ZETA).toString() },
    ...Array.from({ length: 298 }, (_, i) => ({ address: getAddress(hexlify(randomBytes(20))), amount: ((BigInt(i) + 1n) * 10n ** 15n).toString() }))];
  const round = buildRound(allocations, { chainId: 77390, prefixLen: 1 });
  const total = BigInt(round.summary.total);
  const drop = await c.deploy(art('ZtphyMerkleDistributor'), [round.summary.root, total, round.summary.count, c.now() - 60n, c.now() + 30n * 86400n, FUND, '0x' + '00'.repeat(20)], GOV);
  await c.tx(GOV, drop.address, '0x', total);
  const other = await c.deploy(art('ZtphyMerkleDistributor'), ['0x' + '42'.repeat(32), 1n, 1, c.now() - 60n, c.now() + 86400n, FUND, '0x' + '00'.repeat(20)], GOV);
  const files = { '/airdrop/summary.json': JSON.stringify(round.summary) };
  for (const [k, s] of Object.entries(round.shards)) files[`/airdrop/shards/${k}.json`] = JSON.stringify(s);
  const fetched = [];

  const handle = async (u, body) => {
    const { method, id, params } = JSON.parse(body || '{}');
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'eth_chainId') return ok('0x12e4e');
    if (method === 'eth_blockNumber') return ok(`0x${c.number().toString(16)}`);
    if (method === 'eth_getTransactionReceipt') return ok(c.receipts.get(params[0]) ?? null);
    if (method === 'eth_call' && (await c.code(params[0].to)) !== '0x') return { jsonrpc: '2.0', id, ...(await c.ethCall(params[0])) };
    if (method === 'test_send') { const t = params[0]; try { return ok((await c.tx(t.from, t.to, t.data)).hash); } catch (e) { return ok(e.hash); } }
    return answer(u, body);
  };
  const site = await serve(DIST, { headers: { 'content-security-policy': CSP } });
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await onTestnet(page); // these checks are about the testnet (network.js defaults to mainnet)
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errors.push(m.text()); });
    await page.route('**/*', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.origin === new URL(site.url).origin) {
        if (u.pathname === '/hub-config.json') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ node: '', contracts: { airdropDistributor: drop.address }, airdrop: { list: './airdrop/' }, dex: {}, nft: {}, tokens: [], saphan: [], saphanTokens: [] }) });
        }
        if (u.pathname.startsWith('/airdrop/')) {
          fetched.push(u.pathname);
          return files[u.pathname] ? route.fulfill({ status: 200, contentType: 'application/json', body: files[u.pathname] }) : route.fulfill({ status: 404, body: '' });
        }
        return route.continue();
      }
      if (u.origin === 'https://rpc.sawasdeecoin.com') {
        const a = await handle(req.url(), req.postData());
        if (a) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) });
      }
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    await page.addInitScript(([acc, rpc]) => {
      const relay = async (method, params) => (await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
      window.ethereum = { isMetaMask: true, on: () => {}, request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acc];
        if (method === 'eth_chainId') return '0x12e4e';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') return relay('test_send', params);
        throw new Error(`not mocked: ${method}`);
      } };
    }, [ACC, 'https://rpc.sawasdeecoin.com']);
    const confirmAll = setInterval(() => { page.click('#ws-confirm[open] [data-ws="go"]', { timeout: 500 }).catch(() => {}); }, 400);
    const msg = () => page.textContent('#ad-msg');
    const waitMsg = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('ad-msg').textContent), re.source, { timeout: 60_000 });
    try {
      await page.goto(`${site.url}?tab=agents`);
      await page.waitForSelector('#ad-check');
      assert.equal(await page.inputValue('#ad-drop'), drop.address);
      assert.equal(await page.inputValue('#ad-list'), './airdrop/');

      // the public checker, no wallet: someone not in the list, then someone who is
      await page.fill('#ad-addr', STRANGER);
      await page.click('#ad-check');
      await waitMsg(/is not in this airdrop's list/);
      await page.fill('#ad-addr', OTHER.toLowerCase());
      await page.click('#ad-check');
      await waitMsg(/is in the list/);
      assert.equal(await page.textContent('#ad-amount'), '77 ZTPHY');
      assert.ok(fetched.includes(`/airdrop/shards/${OTHER.toLowerCase()[2]}.json`), 'only the one shard of that address');
      assert.match(await page.textContent('#ad-out'), /"to": "0x/, 'call data for a relayer');

      // a contract whose root is not this list's: refused before any claim
      await page.fill('#ad-drop', other.address);
      await page.click('#ad-check');
      await waitMsg(/does not match the contract's root/);
      assert.equal(await page.$('#ad-claim'), null);
      await page.fill('#ad-drop', drop.address);

      // connect, empty address = the connected wallet, claim
      await page.click('#wb-btn');
      await page.waitForSelector('#wb-dialog[open] .wb-wallet:not(#wb-ledger)');
      await page.click('#wb-dialog .wb-wallet:not(#wb-ledger)');
      await page.waitForFunction((a) => document.getElementById('wb-btn').textContent.toLowerCase().includes(a.slice(0, 6).toLowerCase()), ACC);
      if (await page.isVisible('#wb-close')) await page.click('#wb-close');
      await page.fill('#ad-addr', '');
      await page.click('#ad-check');
      await waitMsg(/is in the list/);
      assert.equal(await page.textContent('#ad-amount'), '234 ZTPHY');
      const before = await c.balance(ACC);
      await page.click('#ad-claim');
      await waitMsg(/^Claimed/);
      assert.equal(await c.balance(ACC) - before, 234n * ZETA, await msg());
      assert.equal((await drop.call('claimCount')), 1n);
      await page.click('#ad-check');
      await waitMsg(/Already claimed/);

      // Thai
      await page.selectOption('#lang', 'th');
      await page.waitForFunction(() => /รับแอร์ดรอป/.test(document.querySelector('#ad-card')?.textContent ?? ''));
      // a phone: no sideways scroll
      await page.setViewportSize({ width: 375, height: 800 });
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at 375 px');
      assert.deepEqual(errors, []);
    } finally { clearInterval(confirmAll); }
  } finally {
    await browser.close();
    site.close();
  }
});
