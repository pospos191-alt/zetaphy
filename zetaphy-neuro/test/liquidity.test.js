// src/liquidity.js: who holds the pool's LP tokens. Read-only calls on the pair; the owner holding LP is a warning
// (it can pull the liquidity), burned LP is good, anything else is said plainly without guessing where it sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lpHolders, lpFindings, pct, BURN, LP_OWNER_HIGH, LP_OWNER_MEDIUM, LP_BURNED_GOOD } from '../src/liquidity.js';
import { analyze, withSimulation, withLiquidity } from '../src/analyze.js';
import { explain, LANGS } from '../src/explain.js';

const PAIR = '0x' + 'ab'.repeat(20), OWNER = '0x' + '0c'.repeat(20);
const w = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
function rpcOf({ total, dead = 0n, zero = 0n, owner = 0n, fail = false }) {
  const calls = [];
  return { calls, call: async (method, [tx]) => {
    assert.equal(method, 'eth_call'); assert.equal(tx.to, PAIR); calls.push(tx.data);
    if (fail) throw new Error('node down');
    if (tx.data === '0x18160ddd') return w(total);
    const who = '0x' + tx.data.slice(-40);
    return w(who === BURN[0] ? dead : who === BURN[1] ? zero : who === OWNER ? owner : 0n);
  } };
}

test('lpHolders: total supply, burned (dead + zero) and the owner\'s share, read only from the pair', async () => {
  const rpc = rpcOf({ total: 1000n, dead: 900n, zero: 10n, owner: 50n });
  assert.deepEqual(await lpHolders(rpc, PAIR, { owner: OWNER }), { pair: PAIR, total: '1000', burned: '910', owner: OWNER, ownerHeld: '50' });
  assert.ok(rpc.calls.every((d) => d === '0x18160ddd' || d.startsWith('0x70a08231')), 'only totalSupply and balanceOf');
  // no owner, or the owner is a burn address (renounced to dead): not asked
  const r2 = rpcOf({ total: 10n });
  assert.deepEqual(await lpHolders(r2, PAIR, { owner: BURN[0] }), { pair: PAIR, total: '10', burned: '0' });
  assert.equal(r2.calls.length, 3);
  assert.equal(await lpHolders(r2, 'nope'), null);
  assert.match((await lpHolders(rpcOf({ total: 1n, fail: true }), PAIR)).error, /node down/);
});

test('lpFindings: owner >= 50% high, >= 5% medium, else >= 95% burned good, else not burned (info); nothing on errors', () => {
  assert.equal(pct('1', '3'), 33.3);
  const f = (lp) => lpFindings(lp, { dex: 'PancakeSwap V2' })[0] ?? null;
  assert.deepEqual(f({ total: '100', burned: '0', owner: OWNER, ownerHeld: String(LP_OWNER_HIGH) }), { id: 'lp-owner', severity: 'high', params: { dex: 'PancakeSwap V2', share: 50, owner: OWNER } });
  assert.equal(f({ total: '100', burned: '90', owner: OWNER, ownerHeld: String(LP_OWNER_MEDIUM) }).severity, 'medium');
  assert.deepEqual(f({ total: '100', burned: String(LP_BURNED_GOOD), owner: OWNER, ownerHeld: '1' }), { id: 'lp-burned', severity: 'good', params: { dex: 'PancakeSwap V2', share: 95 } });
  assert.deepEqual(f({ total: '100', burned: '40' }), { id: 'lp-not-burned', severity: 'info', params: { dex: 'PancakeSwap V2', share: 40 } });
  assert.equal(f({ total: '0', burned: '0' }), null, 'an empty pool says nothing');
  assert.equal(f({ error: 'x' }), null);
  assert.equal(f(null), null);
});

test('withLiquidity: the finding goes before the closing caveat, raises the level, and the rules\' level stays for the verdict', () => {
  const base = analyze({ hasCode: true, functions: [{ selector: 'a9059cbb', sig: 'transfer(address,uint256)', cat: 'erc20' }], opcodes: [], proxy: { kind: null }, token: { name: 'T', symbol: 'T', decimals: 18, totalSupply: '1' } });
  const sim = withSimulation(base, { stage: 'done', dex: 'PancakeSwap V2', native: 'WBNB', expectedBuy: '100', bought: '100', expectedSell: '100', sold: '100', buyTax: 0, sellTax: 0 });
  const lp = lpFindings({ total: '100', burned: '0', owner: OWNER, ownerHeld: '80' }, { dex: 'PancakeSwap V2' });
  const out = withLiquidity(sim, lp);
  assert.equal(out.level, 'high');
  assert.equal(out.rulesLevel, base.level, 'the network verdict keeps the fixed rules\' level');
  const ids = out.findings.map((x) => x.id);
  assert.ok(ids.includes('lp-owner'));
  if (ids.includes('bytecode-only')) assert.ok(ids.indexOf('lp-owner') < ids.indexOf('bytecode-only'));
  assert.equal(withLiquidity(sim, []), sim);
});

test('every language explains the three LP findings with the share and the DEX', () => {
  for (const lang of Object.keys(LANGS)) {
    for (const [id, sev, params] of [['lp-owner', 'high', { dex: 'DEX', share: 80, owner: '0xowner' }], ['lp-burned', 'good', { dex: 'DEX', share: 99 }], ['lp-not-burned', 'info', { dex: 'DEX', share: 12.5 }]]) {
      const t = explain({ analysis: { level: sev, findings: [{ id, severity: sev, params }] } }, lang).lines[0].text;
      assert.ok(t.includes(String(params.share)) && t.includes('DEX') && !/undefined/.test(t), `${lang} ${id}: ${t}`);
    }
  }
});
