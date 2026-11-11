// Severity policy (2026-11-11): owner-held powers alone are "trust the owner" (medium);
// next to unnamed functions, as a 3+ trapping-power kit, or for seize / Solana freeze they are high.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';
import { analyzeSolana } from '../src/solana.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';
const fn = (cat, sig) => ({ selector: '0x00000000', sig, cat });
const ERC = [fn('erc20', 'transfer(address,uint256)')];
const run = (extra, o = {}) => analyze({
  hasCode: true, functions: [...ERC, ...extra], opcodes: {}, proxy: { kind: null },
  token: { name: 'T', symbol: 'T', decimals: 18, totalSupply: '1' }, owner: OWNER, ...o,
});
const sev = (r, id) => r.findings.find((f) => f.id === id)?.severity;

test('one owner power with every function named: medium', () => {
  for (const [cat, id] of [['mint', 'can-mint'], ['blacklist', 'can-blacklist'], ['pause', 'can-pause']]) {
    const r = run([fn(cat, 'x()')]);
    assert.equal(sev(r, id), 'medium', id);
    assert.equal(r.level, 'medium', id);
  }
});

test('the same power next to unnamed functions: high', () => {
  const r = run([fn('mint', 'mint(address,uint256)')], { unknownSelectors: ['0xdeadbeef'] });
  assert.equal(sev(r, 'can-mint'), 'high');
  assert.equal(r.level, 'high');
});

test('upgradeable proxy: medium when named, high with unnamed functions', () => {
  const p = { proxy: { kind: 'eip1967', implementation: OWNER } };
  assert.equal(sev(run([], p), 'proxy-upgradeable'), 'medium');
  assert.equal(sev(run([], { ...p, unknownSelectors: ['0xdeadbeef'] }), 'proxy-upgradeable'), 'high');
});

test('three trapping powers together (honeypot kit): high; two: medium', () => {
  const three = run([fn('blacklist', 'a()'), fn('trading', 'b()'), fn('fee', 'c()')]);
  for (const id of ['can-blacklist', 'trading-switch', 'can-change-fee']) assert.equal(sev(three, id), 'high', id);
  const two = run([fn('blacklist', 'a()'), fn('fee', 'c()')]);
  assert.equal(two.level, 'medium');
});

test('seize stays high; renounced owner and official issuers stay low', () => {
  assert.equal(sev(run([fn('seize', 's()')]), 'can-seize'), 'high');
  const kit = [fn('blacklist', 'a()'), fn('trading', 'b()'), fn('fee', 'c()'), fn('mint', 'm()')];
  assert.equal(run(kit, { owner: ZERO }).level, 'low');
  const known = { symbol: 'T', issuer: 'X', kind: 'stablecoin', address: OWNER };
  assert.equal(run(kit, { known, unknownSelectors: ['0xdeadbeef'] }).level, 'low');
});

test('Solana: mint authority medium, freeze authority high', () => {
  const mint = (o) => analyzeSolana({ kind: 'mint', token: { name: 'T', symbol: 'T', decimals: 6, supply: '1' }, extensions: {}, ...o });
  assert.equal(sev(mint({ mintAuthority: 'A' }), 'sol-mint-authority'), 'medium');
  assert.equal(mint({ mintAuthority: 'A' }).level, 'medium');
  assert.equal(sev(mint({ freezeAuthority: 'F' }), 'sol-freeze-authority'), 'high');
});
