// "Claim airdrop" card (airdrop.js), pure parts: airdrop-core.js against ethers and against the list tooling
// (zetaphy-network/airdrop/distributor.js: the same leaves, proofs and shard paths), and the words in all 8 languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface, id, getAddress, hexlify, randomBytes } from 'ethers';
import { keccak256 } from '../../zetaphy-neuro/src/keccak.js';
import { SEL, shardPath, findClaim, leafOf, rootOf, encodeClaim, encodeIsClaimed } from '../airdrop-core.js';
import { buildRound, leafHash } from '../../zetaphy-network/airdrop/distributor.js';
import { AIRDROP } from '../airdrop-i18n.js';
import { LANG_CODES } from '../i18n.js';

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
const SIGS = { claim: 'claim(uint256,address,uint256,bytes32[])', isClaimed: 'isClaimed(uint256)', merkleRoot: 'merkleRoot()', claimStart: 'claimStart()', claimDeadline: 'claimDeadline()', aborted: 'aborted()' };

test('selectors and the claim encoding are the contract ABI\'s', () => {
  for (const [k, sig] of Object.entries(SIGS)) assert.equal(SEL[k], id(sig).slice(0, 10), k);
  const iface = new Interface([`function ${SIGS.claim}`, `function ${SIGS.isClaimed}`]);
  const a = getAddress(hexlify(randomBytes(20)));
  const proof = Array.from({ length: 17 }, () => hexlify(randomBytes(32)));
  assert.equal(encodeClaim(12345, a, 10n ** 21n, proof), iface.encodeFunctionData('claim', [12345, a, 10n ** 21n, proof]));
  assert.equal(encodeClaim(0, a, 1n, []), iface.encodeFunctionData('claim', [0, a, 1n, []]));
  assert.equal(encodeIsClaimed(99_999), iface.encodeFunctionData('isClaimed', [99_999]));
});

test('leaves, proofs and shard paths are the list tooling\'s; a wrong amount or account does not reach the root', () => {
  const allocations = Array.from({ length: 1500 }, (_, i) => ({ address: getAddress(hexlify(randomBytes(20))), amount: String(10n ** 18n * BigInt(i + 1)) }));
  const round = buildRound(allocations, { chainId: 77390 });
  for (const r of [round.list[0], round.list[777], round.list.at(-1)]) {
    assert.equal(hex(leafOf(keccak256, r.index, r.address, r.amount)), leafHash(r.index, r.address, r.amount));
    const path = shardPath(r.address, round.summary);
    const shard = round.shards[path.slice('shards/'.length, -'.json'.length)];
    const c = findClaim(shard, r.address.toUpperCase().replace('0X', '0x'));
    assert.deepEqual([c.index, c.amount], [r.index, r.amount]);
    assert.equal(rootOf(keccak256, c.index, r.address, c.amount, c.proof), round.summary.root);
    assert.notEqual(rootOf(keccak256, c.index, r.address, c.amount + 1n, c.proof), round.summary.root);
    assert.notEqual(rootOf(keccak256, c.index, round.list[1].address, c.amount, c.proof), round.summary.root);
  }
  assert.equal(findClaim({ claims: {} }, round.list[0].address), null);
  assert.throws(() => findClaim({ claims: { [round.list[0].address.toLowerCase()]: { index: -1, amount: '1', proof: [] } } }, round.list[0].address), /bad-list/);
  assert.throws(() => findClaim({ claims: { [round.list[0].address.toLowerCase()]: { index: 1, amount: '1e3', proof: [] } } }, round.list[0].address), /bad-list/);
  assert.throws(() => findClaim({ claims: { [round.list[0].address.toLowerCase()]: { index: 1, amount: '1', proof: ['0x12'] } } }, round.list[0].address), /bad-list/);
  assert.throws(() => shardPath('0x12', round.summary), /bad-list/);
  assert.throws(() => shardPath(round.list[0].address, { shardPrefixLength: 9 }), /bad-list/);
});

const shape = (v, at = '') => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => shape(x, `${at}/${k}`)) : [`${at}:${typeof v}`]);
const ph = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort();

test('every language has every text, with the same placeholders; the safety warning is translated', () => {
  assert.deepEqual(Object.keys(AIRDROP).sort(), [...LANG_CODES].sort());
  const en = shape(AIRDROP.en);
  for (const l of LANG_CODES) {
    assert.deepEqual(shape(AIRDROP[l]), en, l);
    for (const [k, v] of Object.entries(AIRDROP.en)) assert.deepEqual(ph(AIRDROP[l][k]), ph(v), `${l}.${k}`);
    for (const [k, v] of Object.entries(AIRDROP[l])) assert.ok(typeof v === 'string' && v.trim(), `${l}.${k}`);
    if (l !== 'en') for (const k of ['safety', 'intro', 'gas', 'mismatch']) assert.notEqual(AIRDROP[l][k], AIRDROP.en[k], `${l}.${k}: translated`);
    assert.match(AIRDROP[l].title, /ZTPHY/);
    assert.match(AIRDROP[l].gas, /0[.,]0001 ZTPHY/);
  }
});
